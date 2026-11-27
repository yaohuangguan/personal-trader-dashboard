import {ResearchScreen} from './research-screen';
import {watchVault} from './watch-sync';
import {accountStore} from './account';
import {beijingParts} from '../shared/monitor';
import type {FullMarketStatus} from '../shared/full-market';
import {listCandidate,type CloseManifest} from '../shared/close-report';
import {expectedReportDate,reportIsCurrent,reportIsStale,REPORT_DUE_MINUTE} from '../shared/close-schedule';
import type {ScreenCandidate} from '../shared/screening';
import type {MonitorNamespace} from './signal-monitor';
import {LeaseStore} from './close-leases';
import {sessionInfo} from './close-session';
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;delete(key:string):Promise<boolean>;setAlarm(t:number):Promise<void>;deleteAlarm():Promise<void>;getAlarm():Promise<number|null>;list?<T>(options:{prefix:string;limit?:number;start?:string}):Promise<Map<string,T>>};
type State={storage:Storage;blockConcurrencyWhile<T>(fn:()=>Promise<T>):Promise<T>};
type Env={MARKET_SCANNER:MonitorNamespace;SIGNAL_MONITOR?:MonitorNamespace};
export type CloseReportView='full'|'list'|'summary';
/** Report ids kept in storage; older chunks are deleted when a new report is published. */
const KEEP_REPORTS=3;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
/** Shared close report storage and fan-out. Existing DO IDs and push subscriptions are retained. */
export class CloseCoordinator{
 private reportText:{key:string;text:string}|null=null;
 private leaseStore:LeaseStore;
 constructor(private state:State,private env:Env){this.leaseStore=new LeaseStore(state.storage);}
 async fetch(req:Request){const action=new URL(req.url).pathname.slice(1),s=this.state.storage;
  if(action==='cloud-watch')return this.state.blockConcurrencyWhile(()=>watchVault(req,s));
  if(action==='account')return this.state.blockConcurrencyWhile(()=>accountStore(req,s));
  if(action==='research-status'){const job=await s.get<import('./research-screen').ResearchJob>('research:v1:job'),url=new URL(req.url),same=job&&url.searchParams.get('id')===job.id&&Number(url.searchParams.get('count')??-1)===job.candidateCount;return json(await new ResearchScreen(s).read(!same));}
  if(action==='research-start'&&req.method==='POST'){const body=await req.json() as {retry?:boolean};return this.state.blockConcurrencyWhile(async()=>json(await new ResearchScreen(s).start(body.retry===true)));}
  if(action==='status'){const m=await s.get<CloseManifest>('close:latest');return json({phase:m?'complete':'closed',registered:m?.total||0,total:m?.total||0,pages:0,universeComplete:!!m?.complete,countMatches:!!m?.complete,shards:0,ready:m?.checked||0,checked:m?.checked||0,freshShards:0,lastRun:m?.generatedAt||null,lastQuoteAt:m?.date||null,failures:m?.failed||0,failureSample:m?.failureSample||[],events:[],source:m?.source||'共享收盘任务',notice:'每个交易日15:20北京时间启动一次收盘筛选，完成后合并推送。盘中不轮询行情；非交易日以来源日期跳过。',active:await this.leaseStore.active(),date:m?.date,report:m} satisfies FullMarketStatus);}
  if(action==='manifest')return json(await this.manifest());
  if(action==='results')return this.results(new URL(req.url).searchParams.get('view'));
  if(req.method!=='POST')return json({error:'Method not allowed'},405);const body=await req.json() as Record<string,any>;
  if(action==='ensure'||action==='release'){if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id))return json({error:'Invalid lease'},400);const target=typeof body.target==='string'&&/^[a-f0-9]{64}$/.test(body.target)?body.target:undefined;await this.state.blockConcurrencyWhile(async()=>{if(action==='release')await this.leaseStore.release(body.id);else await this.leaseStore.ensure(body.id,Number(body.until),target);});return json({active:action==='ensure'?Number(body.until)>Date.now():await this.leaseStore.active()});}
  if(action==='chunk'){if(!/^[\w-]{1,60}$/.test(body.id)||!Number.isInteger(body.index)||body.index<0||body.index>1000||!Array.isArray(body.candidates)||body.candidates.length>20||JSON.stringify(body.candidates).length>110000)return json({error:'Invalid report chunk'},400);await s.put('close:'+body.id+':'+body.index,body.candidates);return json({ok:true});}
  if(action==='publish'){const m=body as CloseManifest;if(!/^[\w-]{1,60}$/.test(m.id)||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||m.date>beijingParts().date||!Number.isInteger(m.chunks)||m.chunks<0||m.chunks>1000||m.checked+m.failed!==m.eligible||m.eligible>m.total||!Number.isFinite(m.generatedAt))return json({error:'Invalid close manifest'},400);const chunks=await Promise.all(Array.from({length:m.chunks},(_,i)=>s.get<ScreenCandidate[]>('close:'+m.id+':'+i)));if(chunks.some(c=>!c)||chunks.reduce((n,c)=>n+c!.length,0)!==m.count||chunks.flat().some(c=>c?.asOf!==m.date||c.provisional))return json({error:'Report incomplete or provisional'},409);
   const old=await s.get<CloseManifest>('close:latest');if(old&&old.date>m.date)return json({error:'Older report rejected'},409);await s.put('close:latest',m);this.reportText=null;
   const ids=[...(await s.get<string[]>('close:ids')||[]).filter(id=>id!==m.id),m.id].slice(-KEEP_REPORTS);await s.put('close:ids',ids);
   await this.pruneReports(new Set([...ids,...(old?[old.id]:[])]));
   await this.fanOut(m);return json({ok:true,count:m.count});}
  if(action==='configure'){await s.put('shard',{enabled:false});await s.deleteAlarm();return json({ok:true,retired:true});}
  return json({error:'Unknown action'},404);
 }
 async alarm(){const s=this.state.storage;const research=new ResearchScreen(s);let pending=false;for(let i=0;i<8;i++){const phase=(await s.get<import('./research-screen').ResearchJob>('research:v1:job'))?.phase;pending=await research.step();if(!pending||phase!=='cache')break;}if(pending)return;if(await s.get('shard')){await s.put('shard',{enabled:false});await s.deleteAlarm();return;}const ids=await s.get<string[]>('close:outbox')||[],ns=this.env.SIGNAL_MONITOR;
  if(!ids.length||!ns?.idFromString){await s.deleteAlarm();return;}
  for(const id of ids.slice(0,8)){try{await ns.get(ns.idFromString(id)).fetch(new Request('https://monitor/internal-close',{method:'POST',body:'{}'}));}catch{/* Per-device close fallback retries delivery without rescanning. */}}
  const remaining=ids.slice(8);await s.put('close:outbox',remaining);if(remaining.length)await s.setAlarm(Date.now()+1000);else{await s.deleteAlarm();await this.leaseStore.prune();}
 }
 /** Benchmark-derived expected session (cached; may fetch one small index request). */
 private async expectation(network=true){const info=await sessionInfo(this.state.storage,{network}),now=new Date();return {info,expected:expectedReportDate(info,now,REPORT_DUE_MINUTE),now};}
 /** Small status for devices and the closing job: no candidates. */
 private async manifest(){const m=await this.state.storage.get<CloseManifest>('close:latest'),{info,expected}=await this.expectation();return {available:true,report:m??null,expectedDate:expected,stale:reportIsStale(m?.date,expected),session:info};}
 /**
  * Serialised once per report id and view, then passed through by the Worker without parsing.
  * Shape (default view): {available,stale,expectedDate,report:{...manifest,candidates}}.
  */
 private async results(rawView:string|null){
  const view:CloseReportView=rawView==='list'||rawView==='summary'?rawView:'full',s=this.state.storage,m=await s.get<CloseManifest>('close:latest'),{expected}=await this.expectation();
  const head=JSON.stringify({available:true,stale:reportIsStale(m?.date,expected),expectedDate:expected});
  const etag='"close-'+(m?.id??'none')+'-'+view+'-'+(expected??'na')+'"';
  let body:string;
  if(!m)body=head.slice(0,-1)+',"report":null,"notice":"首份共享收盘报告尚未生成，可使用手动并行扫描。"}';
  else{
   const key=m.id+':'+view;
   if(this.reportText?.key!==key){
    let text:string;
    if(view==='summary')text=JSON.stringify(m);
    else{const chunks=await Promise.all(Array.from({length:m.chunks},(_,i)=>s.get<ScreenCandidate[]>('close:'+m.id+':'+i))),candidates=chunks.flatMap(c=>c||[]);text=JSON.stringify({...m,candidates:view==='list'?candidates.map(listCandidate):candidates});}
    this.reportText={key,text};
   }
   body=head.slice(0,-1)+',"report":'+this.reportText.text+'}';
  }
  return new Response(body,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',etag}});
 }
 /** One fan-out per trade date, and only for the latest session's report (late runs included). */
 private async fanOut(m:CloseManifest){
  const s=this.state.storage,{info,now}=await this.expectation(false);
  if(!reportIsCurrent(m.date,now,expectedReportDate(info,now,900))||await s.get<string>('close:fanned')===m.date)return;
  const targets=[...(await this.leaseStore.all()).values()].map(l=>l.target).filter((t):t is string=>!!t);
  await s.put('close:outbox',targets);await s.put('close:fanned',m.date);await s.setAlarm(Date.now()+1000);
 }
 /** Deletes candidate chunks of reports that are no longer retained (bounded per publish). */
 private async pruneReports(retained:Set<string>,budget=300){
  const s=this.state.storage;if(!s.list)return 0;let removed=0,start:string|undefined;
  for(let page=0;page<5&&removed<budget;page++){
   const batch=await s.list<unknown>({prefix:'close:',limit:100,...(start?{start}:{})});let last='';
   for(const key of batch.keys()){last=key;const match=/^close:([\w-]{1,60}):(\d+)$/.exec(key);if(match&&!retained.has(match[1])){await s.delete(key);if(++removed>=budget)break;}}
   if(batch.size<100||!last)break;start=last+'\0';
  }
  return removed;
 }
}
