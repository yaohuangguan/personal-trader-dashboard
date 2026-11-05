import type {WatchInsightData} from '../../shared/watch-insight';

/** Screen-independent memory: keep the last value visible while refreshing. */
export class WatchInsightCache{
 private values=new Map<string,WatchInsightData>();
 private pending=new Map<string,Promise<WatchInsightData>>();
 constructor(private fetcher:(symbol:string)=>Promise<WatchInsightData>,private clock=Date.now){}
 peek(symbol:string){return this.values.get(symbol);}
 async load(symbol:string,force=false){
  const saved=this.peek(symbol),now=this.clock();
  if(!force&&saved&&Date.parse(saved.expiresAt)>now&&Date.parse(saved.generatedAt)<=now+60000)return saved;
  const pending=this.pending.get(symbol);if(pending)return pending;
  const task=this.fetcher(symbol).then(data=>{
   if(data.symbol!==symbol)throw new Error('研判代码不匹配');
   if(this.values.size>=120&&!this.values.has(symbol))this.values.delete(this.values.keys().next().value!);
   this.values.set(symbol,data);return data;
  });
  this.pending.set(symbol,task);
  try{return await task;}finally{this.pending.delete(symbol);}
 }
}
export const watchInsightCache=new WatchInsightCache(async symbol=>{
 const response=await fetch('/api/desk/insight?symbol='+encodeURIComponent(symbol),{cache:'no-store',signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok||data.available===false)throw new Error(data.reason||data.error||'研判暂不可用');
 return data as WatchInsightData;
});
