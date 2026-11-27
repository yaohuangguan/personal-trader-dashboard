import {readJson} from '../http';
import type {WatchInsightData} from '../../shared/watch-insight';
import {KeyedPoller} from '../keyed-poller';

/** Screen-independent memory: keep the last value visible while refreshing. */
export class WatchInsightCache{
 private values=new Map<string,WatchInsightData>();
 private pending=new Map<string,Promise<WatchInsightData>>();
 constructor(private fetcher:(symbol:string)=>Promise<WatchInsightData>,private clock=Date.now){}
 peek(symbol:string){return this.values.get(symbol);}
 /** When the cached value should be refreshed (its server expiry, guarded against clock skew). */
 staleAt(symbol:string){const saved=this.peek(symbol);if(!saved)return 0;const expires=Date.parse(saved.expiresAt),generated=Date.parse(saved.generatedAt);return Number.isFinite(expires)&&generated<=this.clock()+60000?expires:0;}
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
 const response=await fetch('/api/desk/insight?symbol='+encodeURIComponent(symbol),{signal:AbortSignal.timeout(30000)});
 const data=await readJson<any>(response);
 if(data.available===false)throw new Error(data.reason||data.error||'研判暂不可用');
 return data as WatchInsightData;
});
/** All rows share this poller: one timer, refresh at server expiry, back off after failures (e.g. 1102). */
export const insightPoller=new KeyedPoller<WatchInsightData>({
 load:symbol=>watchInsightCache.load(symbol,true),
 staleAt:data=>watchInsightCache.staleAt(data.symbol),
 concurrency:3,
});
