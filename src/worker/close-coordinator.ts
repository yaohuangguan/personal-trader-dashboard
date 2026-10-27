import {afterClose,beijingParts} from '../shared/monitor';
import type {FullMarketStatus} from '../shared/full-market';
import type {CloseManifest} from '../shared/close-report';
import type {ScreenCandidate} from '../shared/screening';
import type {MonitorNamespace} from './signal-monitor';
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;setAlarm(t:number):Promise<void>;deleteAlarm():Promise<void>;getAlarm():Promise<number|null>};
type State={storage:Storage;blockConcurrencyWhile<T>(fn:()=>Promise<T>):Promise<T>};
type Env={MARKET_SCANNER:MonitorNamespace;SIGNAL_MONITOR?:MonitorNamespace};
type Lease={until:number;target?:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
/** Shared close report storage and fan-out. Existing DO IDs and push subscriptions are retained. */
export class CloseCoordinator{
 constructor(private state:State,private env:Env){}
 private async leases(){const raw=await this.state.storage.get<Record<string,number|Lease>>('leases')||{};return Object.fromEntries(Object.entries(raw).map(([id,v])=>[id,typeof v==='number'?{until:v}:v]).filter(([,v])=>(v as Lease).until>Date.now())) as Record<string,Lease>;}
 async fetch(req:Request){const action=new URL(req.url).pathname.slice(1),s=this.state.storage;
  if(action==='status'){const m=await s.get<CloseManifest>('close:latest');return json({phase:m?'complete':'closed',registered:m?.total||0,total:m?.total||0,pages:0,universeComplete:!!m?.complete,countMatches:!!m?.complete,shards:0,ready:m?.checked||0,checked:m?.checked||0,freshShards:0,lastRun:m?.generatedAt||null,lastQuoteAt:m?.date||null,failures:m?.failed||0,failureSample:m?.failureSample||[],events:[],source:m?.source||'共享收盘任务',notice:'每个交易日15:20北京时间启动一次收盘筛选，完成后合并推送。盘中不轮询行情；非交易日以来源日期跳过。',active:Object.keys(await this.leases()).length>0,date:m?.date,report:m} satisfies FullMarketStatus);}
  if(action==='results'){const m=await s.get<CloseManifest>('close:latest');if(!m)return json({available:true,report:null,notice:'首份共享收盘报告尚未生成，可使用手动并行扫描。'});const chunks=await Promise.all(Array.from({length:m.chunks},(_,i)=>s.get<ScreenCandidate[]>('close:'+m.id+':'+i)));return json({available:true,report:{...m,candidates:chunks.flatMap(c=>c||[])}});}
  if(req.method!=='POST')return json({error:'Method not allowed'},405);const body=await req.json() as Record<string,any>;
  if(action==='ensure'||action==='release'){if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id))return json({error:'Invalid lease'},400);await this.state.blockConcurrencyWhile(async()=>{const leases=await this.leases();if(action==='release')delete leases[body.id];else leases[body.id]={until:Math.min(Number(body.until)||0,Date.now()+30*86400000),target:typeof body.target==='string'&&/^[a-f0-9]{64}$/.test(body.target)?body.target:leases[body.id]?.target};await s.put('leases',leases);});return json({active:Object.keys(await this.leases()).length>0});}
  if(action==='chunk'){if(!/^[\w-]{1,60}$/.test(body.id)||!Number.isInteger(body.index)||body.index<0||body.index>1000||!Array.isArray(body.candidates)||body.candidates.length>20||JSON.stringify(body.candidates).length>110000)return json({error:'Invalid report chunk'},400);await s.put('close:'+body.id+':'+body.index,body.candidates);return json({ok:true});}
  if(action==='publish'){const m=body as CloseManifest;if(!/^[\w-]{1,60}$/.test(m.id)||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||m.date>beijingParts().date||!Number.isInteger(m.chunks)||m.chunks<0||m.chunks>1000||m.checked+m.failed!==m.eligible||m.eligible>m.total||!Number.isFinite(m.generatedAt))return json({error:'Invalid close manifest'},400);const chunks=await Promise.all(Array.from({length:m.chunks},(_,i)=>s.get<ScreenCandidate[]>('close:'+m.id+':'+i)));if(chunks.some(c=>!c)||chunks.reduce((n,c)=>n+c!.length,0)!==m.count||chunks.flat().some(c=>c?.asOf!==m.date||c.provisional))return json({error:'Report incomplete or provisional'},409);
   const old=await s.get<CloseManifest>('close:latest');if(old&&old.date>m.date)return json({error:'Older report rejected'},409);await s.put('close:latest',m);
   if(afterClose()&&m.date===beijingParts().date){await s.put('close:outbox',Object.values(await this.leases()).map(l=>l.target).filter((t):t is string=>!!t));await s.setAlarm(Date.now()+1000);}return json({ok:true,count:m.count});}
  if(action==='configure'){await s.put('shard',{enabled:false});await s.deleteAlarm();return json({ok:true,retired:true});}
  return json({error:'Unknown action'},404);
 }
 async alarm(){const s=this.state.storage;if(await s.get('shard')){await s.put('shard',{enabled:false});await s.deleteAlarm();return;}const ids=await s.get<string[]>('close:outbox')||[],ns=this.env.SIGNAL_MONITOR;
  if(!ids.length||!ns?.idFromString){await s.deleteAlarm();return;}
  for(const id of ids.slice(0,8)){try{await ns.get(ns.idFromString(id)).fetch(new Request('https://monitor/internal-close',{method:'POST',body:'{}'}));}catch{/* Per-device close fallback retries delivery without rescanning. */}}
  const remaining=ids.slice(8);await s.put('close:outbox',remaining);if(remaining.length)await s.setAlarm(Date.now()+1000);else await s.deleteAlarm();
 }
}
