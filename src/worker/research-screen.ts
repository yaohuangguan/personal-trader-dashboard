import {beijingParts} from '../shared/monitor';
import {universe,quotes} from './desk-data';
import {fetchScreenDaily,extendHistory,type DayData} from './pattern-screen';
import {sinaBeijingDaily} from './research';
import {evaluateScreen,DEFAULT_SCREEN,SCREEN_MODES} from '../shared/pattern-screen';
import type {ScreenCandidate,UniverseItem} from '../shared/screening';
import type {Snapshot} from '../shared/desk-types';
export type ScreenStorage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;setAlarm(t:number):Promise<void>;getAlarm():Promise<number|null>;list?<T>(options:{prefix:string;limit:number}):Promise<Map<string,T>>};
export type ResearchJob={id:string;phase:'universe'|'quotes'|'screening'|'complete'|'paused';total:number;registered:number;page:number;pages:number;cursor:number;targets:number;checked:number;cached:number;failed:number;candidateCount:number;startedAt:number;updatedAt:number;finishedAt?:number;message:string;rejected:Record<string,number>;pageAttempts:number;failureSample:{symbol:string;reason:string}[];consecutiveFailed?:number;previous?:string;seed?:string;retryOf?:string;baseChecked?:number;catalog?:string;quoteCursor?:number};
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
  const previous=job.previous?await this.storage.get<ResearchJob>(PREFIX+'archive:'+job.previous):undefined;
  const previousReport=includeCandidates&&previous?{job:previous,candidates:await this.candidates(previous)}:undefined;
  return {available:true,job,...(includeCandidates?{candidates,previousReport}:{}),notice:'按需启动一次全市场扫描，服务端继续处理；仅前台轮询任务进度，不重复扫描行情。不触发盘中推送。'};
 }
 private async batches(job:ResearchJob){return Promise.all(Array.from({length:Math.ceil(job.cursor/8)},(_,i)=>this.storage.get<Batch>(key(job.id,'result',i))));}
 private async candidates(job:ResearchJob):Promise<ScreenCandidate[]>{
  const seed=job.seed?await this.storage.get<ResearchJob>(PREFIX+'archive:'+job.seed):undefined;
  const candidates=[...(seed?await this.candidates(seed):[]),...(await this.batches(job)).flatMap(b=>b?.candidates||[])];
  return [...new Map(candidates.map(c=>[c.symbol,c])).values()].sort((a,b)=>(b.ranking?.score||0)-(a.ranking?.score||0));
 }
 private async catalog(){
  let meta=await this.storage.get<{id:string;pages:number;total:number;at:string}>(PREFIX+'catalog');
  // Recover an already verified catalog after upgrading the scanner; no hardcoded ticker list.
  if(!meta&&this.storage.list){const first=await this.storage.list({prefix:PREFIX+'m',limit:1});const id=first.keys().next().value?.split(':')[2];if(id){const page=await this.storage.get<Awaited<ReturnType<typeof universe>>>(key(id,'universe',1));if(page){const pages=Math.ceil(page.total/page.pageSize),all=await Promise.all(Array.from({length:pages},(_,i)=>this.storage.get<Awaited<ReturnType<typeof universe>>>(key(id,'universe',i+1))));if(all.every(Boolean)&&new Set(all.flatMap(p=>p!.items.map(s=>s.symbol))).size===page.total){meta={id,pages,total:page.total,at:page.fetchedAt};await this.storage.put(PREFIX+'catalog',meta);}}}}
  return meta&&beijingParts(new Date(meta.at)).date===beijingParts().date?meta:null;
 }
 async start(retry=false){
  const previous=await this.storage.get<ResearchJob>(PREFIX+'job');
  if(previous&&['universe','quotes','screening'].includes(previous.phase)){
   if(!await this.storage.getAlarm())await this.storage.setAlarm(Date.now()+100);
   return this.read();
  }
  if(previous?.phase==='complete'&&!retry&&Date.now()-(previous.finishedAt||0)<120000)return this.read();
  if(previous?.phase==='paused'){
   const catalog=await this.catalog();if(previous.page<=previous.pages&&catalog){previous.phase='quotes';previous.catalog=catalog.id;previous.total=catalog.total;previous.registered=catalog.total;previous.pages=catalog.pages;previous.quoteCursor=0;}else previous.phase=previous.page<=previous.pages?'universe':'screening';previous.pageAttempts=0;previous.message='从已保存的位置继续';await this.save(previous);return this.read();
  }
  if(previous?.checked){await this.storage.put(PREFIX+'archive:'+previous.id,previous);await this.storage.put(PREFIX+'last-good',previous.id);}
  const id=Date.now().toString(36),job:ResearchJob={id,phase:'universe',total:0,registered:0,page:1,pages:1,cursor:0,targets:0,checked:0,cached:0,failed:0,candidateCount:0,startedAt:Date.now(),updatedAt:Date.now(),message:'读取全市场证券池',rejected:{},pageAttempts:0,failureSample:[]};
  if(retry&&previous?.phase==='complete'&&previous.failed){
   const failed=(await this.batches(previous)).flatMap(b=>b?.failed||[]);
   if(failed.length){await this.storage.put(PREFIX+'archive:'+previous.id,previous);job.seed=previous.id;job.retryOf=previous.id;job.baseChecked=(previous.baseChecked||0)+previous.checked;job.phase='screening';job.total=previous.total;job.registered=previous.registered;job.page=2;job.pages=1;job.targets=failed.length;job.candidateCount=(await this.candidates(previous)).length;await this.targets(job,failed);}
  }
  if(job.phase==='universe'){const catalog=await this.catalog();if(catalog){job.phase='quotes';job.catalog=catalog.id;job.pages=catalog.pages;job.total=catalog.total;job.registered=catalog.total;job.quoteCursor=0;job.message='复用当日完整名单，批量更新全市场快照';}}
  job.previous=await this.storage.get<string>(PREFIX+'last-good');
  await this.save(job);return this.read();
 }
 private async targets(job:ResearchJob,stocks:UniverseItem[]){for(let i=0;i<stocks.length;i+=100)await this.storage.put(key(job.id,'targets',i/100),stocks.slice(i,i+100));}
 private async save(job:ResearchJob){job.updatedAt=Date.now();await this.storage.put(PREFIX+'job',job);if(['universe','quotes','screening'].includes(job.phase))await this.storage.setAlarm(Date.now()+100);}
 async step(){
  const job=await this.storage.get<ResearchJob>(PREFIX+'job');if(!job||!['universe','quotes','screening'].includes(job.phase))return false;
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
     const first=pages[0]!;await this.storage.put(PREFIX+'catalog',{id:job.id,pages:job.pages,total:job.total,at:first.fetchedAt});
     job.catalog=job.id;job.quoteCursor=0;job.phase='quotes';job.message='名单核对完成，批量更新快照并预筛流动性';
    }
   }else if(job.phase==='quotes'){
    const cursor=job.quoteCursor||0,stocks:UniverseItem[]=[];
    for(let i=cursor;i<Math.min(cursor+240,job.total);i++){const page=await this.storage.get<Awaited<ReturnType<typeof universe>>>(key(job.catalog!,'universe',Math.floor(i/80)+1));if(!page?.items[i%80])throw new Error('证券名单缺页');stocks.push(page.items[i%80]);}
    const eligible:UniverseItem[]=[];
    await Promise.all(Array.from({length:Math.ceil(stocks.length/60)},(_,i)=>stocks.slice(i*60,i*60+60)).map(async batch=>{
      let book=new Map<string,Snapshot>();try{const feed=await quotes(batch.map(s=>s.symbol));book=new Map(feed.items.map(q=>[q.symbol,q]));}catch{/* Missing snapshots proceed to history verification, never silently excluded. */}
      for(const stock of batch){const q=book.get(stock.symbol),reason=/ST|退/i.test(q?.name||stock.name)?'排除ST与退市名称':q&&!q.stale&&q.amount!==null&&q.amount<2e8?'成交额不足2亿元':null;if(reason)job.rejected[reason]=(job.rejected[reason]||0)+1;else eligible.push(stock);}
    }));
    await this.storage.put(key(job.id,'liquid',Math.floor(cursor/240)),eligible);job.quoteCursor=cursor+stocks.length;job.message='已更新快照'+job.quoteCursor+' / '+job.total;
    if(job.quoteCursor>=job.total){const chunks=await Promise.all(Array.from({length:Math.ceil(job.total/240)},(_,i)=>this.storage.get<UniverseItem[]>(key(job.id,'liquid',i))));const targets=chunks.flatMap(c=>c||[]);await this.targets(job,targets);job.targets=targets.length;job.phase='screening';job.cursor=0;job.page=job.pages+1;job.message='流动性预筛完成，开始并行核验';}
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
    job.consecutiveFailed=result.failed.length===stocks.length?(job.consecutiveFailed||0)+stocks.length:0;
    job.message='已核验'+job.cursor+' / '+job.targets+'，候选'+job.candidateCount+'，未完成'+job.failed;
    if((job.consecutiveFailed||0)>=24){job.phase='paused';job.message='行情源连续失败，已停止请求并保留进度。可继续或仅重试未完成标的；上一轮结果不会删除。';}
    else if(job.cursor>=job.targets){job.phase='complete';job.finishedAt=Date.now();job.message=job.failed?'本轮扫描结束；来源未完成标的可单独重试':'全市场扫描完成';}
   }
  }catch(e){job.phase='paused';job.message=failure(e);}
  await this.save(job);return ['universe','quotes','screening'].includes(job.phase);
 }
}
