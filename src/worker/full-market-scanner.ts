import {universe,quotes} from './desk-data';
import {tencentAshares,sinaAdjustedDaily,sinaBeijingDaily} from './research';
import {evaluateLiveSignal,beijingParts,monitorWindow,nextMonitorRun,type SignalEvent} from '../shared/monitor';
import {partitionMarket,type FullMarketStatus} from '../shared/full-market';
import {stockCharacter} from '../shared/stock-character';
import type {Candle} from '../shared/types';
import type {Snapshot} from '../shared/desk-types';
import type {MonitorNamespace} from './signal-monitor';
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;setAlarm(t:number):Promise<void>;deleteAlarm():Promise<void>;getAlarm():Promise<number|null>};
type State={storage:Storage;blockConcurrencyWhile<T>(fn:()=>Promise<T>):Promise<T>};
type Env={MARKET_SCANNER:MonitorNamespace};
type Master={symbols:string[];registered:number;page:number;complete:boolean;date:string;shards:number;revision:string;error?:string};
type ShardConfig={index:number;symbols:string[];revision:string;enabled:boolean};
type Baseline={candles:Candle[];unit:'股'|'手';loaded:number;attemptDay?:string;attempts?:number};
type Report={index:number;revision:string;total:number;ready:number;checked:number;lastRun:number;lastQuoteAt:string|null;failures:{symbol:string;reason:string}[];events:SignalEvent[]};
export const FULL_MARKET_MASTER='market-all-v1';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
export async function scannerCall(ns:MonitorNamespace,path:string,body?:unknown){const stub=ns.get(ns.idFromName(FULL_MARKET_MASTER));const r=await stub.fetch(new Request('https://scanner/'+path,{method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)}));if(!r.ok)throw new Error('全市场扫描服务暂不可用');return r.json();}
export class MarketScanner {
 private busy=false;
 constructor(private state:State,private env:Env){}
 private shard(i:number){return this.env.MARKET_SCANNER.get(this.env.MARKET_SCANNER.idFromName('market-shard-'+i));}
 private async send(i:number,path:string,body?:unknown){return this.shard(i).fetch(new Request('https://scanner/'+path,{method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)}));}
 private async active(){const leases=await this.state.storage.get<Record<string,number>>('leases')||{};return Object.values(leases).some(t=>t>Date.now());}
 async fetch(req:Request){
  const action=new URL(req.url).pathname.slice(1),s=this.state.storage;
  if(action==='status')return json(await this.status());
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await req.json() as Record<string,unknown>;
  if(action==='ensure'||action==='release'){
   if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id))return json({error:'Invalid lease'},400);
   await this.state.blockConcurrencyWhile(async()=>{const leases=await s.get<Record<string,number>>('leases')||{};for(const [id,until]of Object.entries(leases))if(until<Date.now())delete leases[id];if(action==='ensure')leases[body.id as string]=Math.min(Number(body.until)||0,Date.now()+30*86400000);else delete leases[body.id as string];await s.put('leases',leases);});
   if(!await s.getAlarm())await s.setAlarm(Date.now()+1000);else if(action==='release'&&!await this.active())await s.setAlarm(Date.now()+1000);
   return json({active:await this.active()});
  }
  if(action==='configure'){
   const config=body as unknown as ShardConfig;if(!Array.isArray(config.symbols)||config.symbols.length>160||!Number.isInteger(config.index))return json({error:'Invalid shard'},400);
   const previous=await s.get<ShardConfig>('shard');await s.put('shard',config);
   if(config.enabled&&(!previous?.enabled||previous.revision!==config.revision||!await s.getAlarm()))await s.setAlarm(Date.now()+1000+config.index*300);
   if(!config.enabled)await s.deleteAlarm();return json({ok:true});
  }
  if(action==='report'){
   await this.state.blockConcurrencyWhile(async()=>{const report=body as unknown as Report,master=await s.get<Master>('master');if(!master||report.revision!==master.revision)return;const reports=await s.get<Record<string,Report>>('reports')||{};reports[String(report.index)]={...report,events:[]};await s.put('reports',reports);const events=await s.get<SignalEvent[]>('events')||[],unique=new Map(events.map(e=>[e.id,e]));for(const e of report.events)if(!unique.has(e.id))unique.set(e.id,e);await s.put('events',[...unique.values()].sort((a,b)=>(b.observedAt||0)-(a.observedAt||0)).slice(0,1000));});return json({ok:true});
  }
  return json({error:'Unknown action'},404);
 }
 private async status():Promise<FullMarketStatus>{
  const s=this.state.storage,m=await s.get<Master>('master'),reports=Object.values(await s.get<Record<string,Report>>('reports')||{}),active=await this.active();
  const fresh=reports.filter(r=>Date.now()-r.lastRun<150000),ready=reports.reduce((n,r)=>n+r.ready,0),checked=fresh.reduce((n,r)=>n+r.checked,0),failures=reports.flatMap(r=>r.failures);
  return {phase:!active?'idle':!m?.complete?'universe':ready<(m?.symbols.length||0)?'warming':!monitorWindow()?'closed':fresh.length<(m?.shards||0)?'partial':'scanning',registered:m?.registered||0,total:m?.symbols.length||0,pages:Math.max(0,(m?.page||1)-1),universeComplete:!!m?.complete,countMatches:!!m?.complete&&m.symbols.length===m.registered,shards:m?.shards||0,ready,checked,freshShards:fresh.length,lastRun:reports.length?Math.max(...reports.map(r=>r.lastRun)):null,lastQuoteAt:reports.map(r=>r.lastQuoteAt).filter(Boolean).sort().at(-1)||null,failures:failures.length,failureSample:failures.slice(0,60),events:await s.get<SignalEvent[]>('events')||[],source:'新浪全证券名单 + 腾讯沪深北快照 / 腾讯与新浪日线',notice:m?.error||'全量名单分片扫描，不按涨幅或自选预先缩小范围；历史不足、停牌、源失败分别计入未完成。初始化底稿需要时间，当前覆盖以就绪数量为准。',active};
 }
 async alarm(){
  if(this.busy)return;this.busy=true;
  try{if(await this.state.storage.get('shard'))await this.runShard();else await this.runMaster();}
  catch(e){const s=this.state.storage;const shard=await s.get<ShardConfig>('shard');if(shard?.enabled)await s.setAlarm(Date.now()+60000);else if(await this.active())await s.setAlarm(Date.now()+60000);const m=await s.get<Master>('master');if(m){m.error=e instanceof Error?e.message:'扫描源暂不可用';await s.put('master',m);}}
  finally{this.busy=false;}
 }
 private async runMaster(){
  const s=this.state.storage;let m=await s.get<Master>('master');
  if(!await this.active()){if(m)for(let i=0;i<m.shards;i++)await this.send(i,'configure',{index:i,symbols:[],revision:m.revision,enabled:false});await s.deleteAlarm();return;}
  const day=beijingParts().date;
  if(!m||m.date!==day){m={symbols:[],registered:0,page:1,complete:false,date:day,shards:m?.shards||0,revision:crypto.randomUUID()};await s.put('master',m);}
  if(!m.complete){
   for(let n=0;n<8;n++){
    const page=await universe(m.page);m.registered=page.total;m.symbols=[...new Set([...m.symbols,...page.items.map(r=>r.symbol)])];m.page++;
    if(page.sourceRows<page.pageSize){m.complete=true;break;}if(m.page>100)throw new Error('名单超过已验证范围，停止并保留进度');
   }
   m.error=undefined;await s.put('master',m);
   if(!m.complete){await s.setAlarm(Date.now()+5000);return;}
   const partitions=partitionMarket(m.symbols);const old=m.shards;m.shards=partitions.length;await s.put('master',m);await s.put('reports',{});
   for(let start=0;start<Math.max(old,m.shards);start+=6)await Promise.all(Array.from({length:Math.min(6,Math.max(old,m.shards)-start)},(_,j)=>{const i=start+j;return this.send(i,'configure',{index:i,symbols:partitions[i]||[],revision:m!.revision,enabled:i<m!.shards});}));
  }
  await s.setAlarm(Math.min(Date.now()+60000,nextMonitorRun()));
 }
 private async loadBaseline(symbol:string):Promise<Baseline>{
  let data,unit:'股'|'手'='手';try{if(symbol.endsWith('.BJ'))throw new Error('BJ');data=await tencentAshares(symbol);if(/^68[89]/.test(symbol))unit='股';}catch{data=symbol.endsWith('.BJ')?await sinaBeijingDaily(symbol):await sinaAdjustedDaily(symbol);unit='股';}
  return {candles:data.candles.slice(-270),unit,loaded:Date.now()};
 }
 private async runShard(){
  const s=this.state.storage,config=await s.get<ShardConfig>('shard');if(!config?.enabled)return;
  const now=new Date(),day=beijingParts(now).date,inSession=monitorWindow(now),baselines=new Map<string,Baseline>(),missing:string[]=[],failures:{symbol:string;reason:string}[]=[],snapshots=new Map<string,Snapshot>();
  if(inSession){for(let i=0;i<config.symbols.length;i+=60){try{const data=await quotes(config.symbols.slice(i,i+60));data.items.forEach(q=>snapshots.set(q.symbol,q));}catch{config.symbols.slice(i,i+60).forEach(symbol=>failures.push({symbol,reason:'快照源暂不可用'}));}}}
  const attempts=await s.get<{date:string;counts:Record<string,number>}>('attempts')||{date:day,counts:{}};if(attempts.date!==day){attempts.date=day;attempts.counts={};}
  for(const symbol of config.symbols){const b=await s.get<Baseline>('b:'+symbol),q=snapshots.get(symbol),prior=b?.candles.filter(c=>c.time<day).at(-1);if(b&&now.getTime()-b.loaded<7*86400000&&(!q||prior&&Math.abs(prior.close/q.previous-1)<=.005))baselines.set(symbol,b);else missing.push(symbol);}
  const pending=missing.filter(symbol=>inSession||!attempts.counts[symbol]).sort((a,b)=>(attempts.counts[a]||0)-(attempts.counts[b]||0));
  for(let i=0;i<Math.min(4,pending.length);i+=2)await Promise.all(pending.slice(i,i+2).map(async symbol=>{attempts.counts[symbol]=(attempts.counts[symbol]||0)+1;try{const baseline=await this.loadBaseline(symbol);baselines.set(symbol,baseline);await s.put('b:'+symbol,baseline);}catch{failures.push({symbol,reason:'历史日线源暂不可用'});}}));await s.put('attempts',attempts);
  const seen=await s.get<Record<string,boolean>>('seen')||{},events:SignalEvent[]=[];let checked=0,lastQuoteAt:string|null=null;
  if(inSession)for(const symbol of config.symbols){const b=baselines.get(symbol),q=snapshots.get(symbol);if(!b||!q)continue;const result=evaluateLiveSignal(b.candles,b.unit,q,now,false);if(result.reason){failures.push({symbol,reason:result.reason});continue;}checked++;lastQuoteAt=q.asOf;
   const character=stockCharacter(b.candles.filter(c=>c.time<day),day),eligible=!!character&&!character.quiet&&!character.weakFollow;
   for(const event of result.signals)if(!seen[event.id]){seen[event.id]=true;events.push({...event,observedAt:Date.now(),activityEligible:eligible,delivery:'none'});}
   if(beijingParts(now).minute>=900&&q.open&&q.high&&q.low&&q.volume){const volume=q.volume*(q.volumeUnit==='手'?100:1)/(b.unit==='手'?100:1);const candle={time:day,open:q.open,high:q.high,low:q.low,close:q.price,volume};b.candles=[...b.candles.filter(c=>c.time<day),candle].slice(-270);await s.put('b:'+symbol,b);}
  }
  for(const id of Object.keys(seen))if(id.slice(0,10)<new Date(Date.now()-10*86400000).toISOString().slice(0,10))delete seen[id];await s.put('seen',seen);
  const outbox=await s.get<SignalEvent[]>('outbox')||[],unsent=[...new Map([...outbox,...events].map(e=>[e.id,e])).values()];await s.put('outbox',unsent);
  const report:Report={index:config.index,revision:config.revision,total:config.symbols.length,ready:baselines.size,checked,lastRun:Date.now(),lastQuoteAt,failures,events:unsent};await scannerCall(this.env.MARKET_SCANNER,'report',report);await s.put('outbox',[]);
  const current=await s.get<ShardConfig>('shard');if(current?.enabled){await s.setAlarm(pending.length>4?Date.now()+30000:nextMonitorRun());}
 }
}
