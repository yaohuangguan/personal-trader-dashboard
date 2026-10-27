import {universe,quotes} from './desk-data';
import {fetchScreenDaily,extendHistory,type DayData} from './pattern-screen';
import {sinaBeijingDaily} from './research';
import {evaluateScreen,DEFAULT_SCREEN,SCREEN_MODES} from '../shared/pattern-screen';
import type {ScreenCandidate,UniverseItem} from '../shared/screening';
import type {Snapshot} from '../shared/desk-types';
export type ScreenStorage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;setAlarm(t:number):Promise<void>;getAlarm():Promise<number|null>};
export type ResearchJob={id:string;phase:'universe'|'screening'|'complete'|'paused';total:number;registered:number;page:number;pages:number;cursor:number;targets:number;checked:number;cached:number;failed:number;candidateCount:number;startedAt:number;updatedAt:number;finishedAt?:number;message:string;rejected:Record<string,number>;pageAttempts:number;failureSample:{symbol:string;reason:string}[];seed?:string;retryOf?:string;baseChecked?:number};
type Batch={candidates:ScreenCandidate[];failed:UniverseItem[]};
type Cached={at:number;adjusted:DayData;raw:DayData;quote:Snapshot;result:ReturnType<typeof evaluateScreen>};
const PREFIX='research:v1:',key=(id:string,kind:string,n:number)=>PREFIX+id+':'+kind+':'+n;
const OPTIONS={...DEFAULT_SCREEN,modes:Object.keys(SCREEN_MODES) as (keyof typeof SCREEN_MODES)[],auto:true,activity:false,maxMarketCap:null};
const failure=(e:unknown)=>/timeout|abort|time.*out/i.test(String(e))?'行情来源响应超时，保留进度，可重试未完成标的':e instanceof Error?e.message:'行情来源暂不可用';
export class ResearchScreen {
 constructor(private storage:ScreenStorage){}
 async read(includeCandidates=true){
  const job=await this.storage.get<ResearchJob>(PREFIX+'job');if(!job)return {available:true,job:null,candidates:[]};
  const candidates=includeCandidates?await this.candidates(job):[];
  return {available:true,job,...(includeCandidates?{candidates}:{}),notice:'按需启动一次全市场扫描，服务端继续处理；仅前台轮询任务进度，不重复扫描行情。不触发盘中推送。'};
 }
 private async batches(job:ResearchJob){return Promise.all(Array.from({length:Math.ceil(job.cursor/8)},(_,i)=>this.storage.get<Batch>(key(job.id,'result',i))));}
 private async candidates(job:ResearchJob):Promise<ScreenCandidate[]>{
  const seed=job.seed?await this.storage.get<ResearchJob>(PREFIX+'archive:'+job.seed):undefined;
  const candidates=[...(seed?await this.candidates(seed):[]),...(await this.batches(job)).flatMap(b=>b?.candidates||[])];
  return [...new Map(candidates.map(c=>[c.symbol,c])).values()].sort((a,b)=>(b.ranking?.score||0)-(a.ranking?.score||0));
 }
 async start(retry=false){
  const previous=await this.storage.get<ResearchJob>(PREFIX+'job');
  if(previous&&['universe','screening'].includes(previous.phase)){
   if(!await this.storage.getAlarm())await this.storage.setAlarm(Date.now()+100);
   return this.read();
  }
  if(previous?.phase==='complete'&&!retry&&Date.now()-(previous.finishedAt||0)<120000)return this.read();
  if(previous?.phase==='paused'){
   previous.phase=previous.page<=previous.pages?'universe':'screening';previous.pageAttempts=0;previous.message='从已保存的位置继续';await this.save(previous);return this.read();
  }
  const id=Date.now().toString(36),job:ResearchJob={id,phase:'universe',total:0,registered:0,page:1,pages:1,cursor:0,targets:0,checked:0,cached:0,failed:0,candidateCount:0,startedAt:Date.now(),updatedAt:Date.now(),message:'读取全市场证券池',rejected:{},pageAttempts:0,failureSample:[]};
  if(retry&&previous?.phase==='complete'&&previous.failed){
   const failed=(await this.batches(previous)).flatMap(b=>b?.failed||[]);
   if(failed.length){await this.storage.put(PREFIX+'archive:'+previous.id,previous);job.seed=previous.id;job.retryOf=previous.id;job.baseChecked=(previous.baseChecked||0)+previous.checked;job.phase='screening';job.total=previous.total;job.registered=previous.registered;job.page=2;job.pages=1;job.targets=failed.length;job.candidateCount=(await this.candidates(previous)).length;await this.targets(job,failed);}
  }
  await this.save(job);return this.read();
 }
 private async targets(job:ResearchJob,stocks:UniverseItem[]){for(let i=0;i<stocks.length;i+=100)await this.storage.put(key(job.id,'targets',i/100),stocks.slice(i,i+100));}
 private async save(job:ResearchJob){job.updatedAt=Date.now();await this.storage.put(PREFIX+'job',job);if(['universe','screening'].includes(job.phase))await this.storage.setAlarm(Date.now()+100);}
 async step(){
  const job=await this.storage.get<ResearchJob>(PREFIX+'job');if(!job||!['universe','screening'].includes(job.phase))return false;
  try{
   if(job.phase==='universe'){
    // Four independent pages run together. A failed page retries without losing successful pages.
    const pages=Array.from({length:Math.min(4,job.pages-job.page+1)},(_,i)=>job.page+i);
    const results=await Promise.allSettled(pages.map(async page=>{const saved=await this.storage.get<Awaited<ReturnType<typeof universe>>>(key(job.id,'universe',page));return saved||universe(page);}));
    for(let i=0;i<results.length;i++){const result=results[i];if(result.status==='fulfilled'){const page=result.value;await this.storage.put(key(job.id,'universe',pages[i]),page);job.total=page.total;job.pages=Math.ceil(page.total/page.pageSize);}}
    let failed=false;
    for(const page of pages){const result=await this.storage.get<Awaited<ReturnType<typeof universe>>>(key(job.id,'universe',page));if(!result){failed=true;break;}job.page=page+1;}
    job.registered=0;for(let p=1;p<=job.pages;p++){const data=await this.storage.get<Awaited<ReturnType<typeof universe>>>(key(job.id,'universe',p));job.registered+=data?.items.length||0;}
    if(failed){job.pageAttempts++;job.message='证券名单第'+job.page+'页暂未完成，正在重试';if(job.pageAttempts>=3){job.phase='paused';job.message='证券名单来源连续超时，已保存'+job.registered+'只。点击继续会从第'+job.page+'页恢复。';}}
    else {job.pageAttempts=0;job.message='已读取'+job.registered+' / '+job.total+'只证券';}
    if(job.page>job.pages){
     const pages=await Promise.all(Array.from({length:job.pages},(_,i)=>this.storage.get<Awaited<ReturnType<typeof universe>>>(key(job.id,'universe',i+1))));
     const all=[...new Map(pages.flatMap(p=>p?.items||[]).map(s=>[s.symbol,s])).values()];
     if(all.length!==job.total)throw new Error('全市场名单数量未对齐，未伪装成完整覆盖');
     const stocks=all.filter(s=>{const reason=/ST|退/i.test(s.name)?'排除ST与退市名称':s.amount!==null&&s.amount<2e8?'成交额不足2亿元':null;if(reason){job.rejected[reason]=(job.rejected[reason]||0)+1;return false;}return true;});
     await this.targets(job,stocks);job.targets=stocks.length;job.phase='screening';job.message='流动性预筛完成，开始并行核验量价与筹码';
    }
   }else{
    const stocks:UniverseItem[]=[];for(let i=job.cursor;i<Math.min(job.cursor+8,job.targets);i++){const page=await this.storage.get<UniverseItem[]>(key(job.id,'targets',Math.floor(i/100)));if(!page?.[i%100])throw new Error('任务列表缺失，已保存进度');stocks.push(page[i%100]);}
    const result:Batch={candidates:[],failed:[]};
    await Promise.all(stocks.map(async stock=>{
     try{
      const cacheKey=PREFIX+'history:'+stock.symbol,cached=await this.storage.get<Cached>(cacheKey);
      let out:ReturnType<typeof evaluateScreen>,adjusted:DayData,raw:DayData,quote:Snapshot;
      if(cached&&Date.now()-cached.at<300000&&!/缺失|无效|不一致|未对齐|过期/.test(cached.result.reason||'')){out=cached.result;job.cached++;}
      else {
       if(stock.symbol.endsWith('.BJ')){const [daily,feed]=await Promise.all([sinaBeijingDaily(stock.symbol,500),quotes([stock.symbol])]);adjusted={candles:daily.candles,provider:'新浪北交所未复权日线'};raw=adjusted;const q=feed.items.find(q=>q.symbol===stock.symbol);if(!q)throw new Error('北交所快照缺失');quote=q;}
       else {const [recent,unadjusted]=await Promise.all([fetchScreenDaily(stock.symbol,true,cached?5:500),fetchScreenDaily(stock.symbol,false,20)]);const merged=cached?extendHistory(cached.adjusted.candles,recent.candles):null;adjusted=cached&&!merged?await fetchScreenDaily(stock.symbol,true,500):{...recent,candles:merged||recent.candles};raw=unadjusted;if(!recent.quote)throw new Error('缺少可核验快照');quote=recent.quote;}
       out=evaluateScreen({bars:adjusted.candles,raw:raw.candles,quote,provider:adjusted.provider,volumeUnit:stock.symbol.endsWith('.BJ')||/^68[89]/.test(stock.symbol)?'股':'手',options:OPTIONS});
       if(/缺失|无效|不一致|未对齐|过期/.test(out.reason||''))throw new Error(out.reason!);
       await this.storage.put(cacheKey,{at:Date.now(),adjusted,raw,quote,result:out} satisfies Cached);
      }
      job.checked++;if(out.candidate){result.candidates.push(out.candidate as ScreenCandidate);job.candidateCount++;}else{const reason=out.reason||'未命中';job.rejected[reason]=(job.rejected[reason]||0)+1;}
     }catch(e){job.failed++;result.failed.push(stock);if(job.failureSample.length<40)job.failureSample.push({symbol:stock.symbol,reason:failure(e)});}
    }));
    await this.storage.put(key(job.id,'result',Math.floor(job.cursor/8)),result);job.cursor+=stocks.length;
    job.message='已核验'+job.cursor+' / '+job.targets+'，候选'+job.candidateCount+'，未完成'+job.failed;
    if(job.cursor>=job.targets){job.phase='complete';job.finishedAt=Date.now();job.message=job.failed?'本轮扫描结束；来源未完成标的可单独重试':'全市场扫描完成';}
   }
  }catch(e){job.phase='paused';job.message=failure(e);}
  await this.save(job);return ['universe','screening'].includes(job.phase);
 }
}
