import {SignalMonitor,type MonitorNamespace} from './signal-monitor';
import {scannerCall} from './full-market-scanner';
import {afterClose,beijingParts,nextMonitorRun,validMonitorSymbols,type MonitorConfig,type SignalEvent} from '../shared/monitor';
import type {CloseReport,CloseManifest} from '../shared/close-report';
import {expectedReportDate,reportIsCurrent,type SessionInfo} from '../shared/close-schedule';
import {apiError} from './http';
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;delete(key:string):Promise<boolean>;setAlarm(t:number):Promise<void>;deleteAlarm():Promise<void>;getAlarm():Promise<number|null>};
type State={id?:{toString():string};storage:Storage;blockConcurrencyWhile<T>(fn:()=>Promise<T>):Promise<T>};
type Env={MARKET_SCANNER?:MonitorNamespace;FIREBASE_SERVICE_ACCOUNT?:string};
const CHECK_INTERVAL_MS=120000;
const response=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
/** Reuses the existing subscriptions/VAPID state; replaces only config/check/alarm behavior. */
export class CloseSignalMonitor extends SignalMonitor{
 private closing=false;
 constructor(private closeState:State,private closeEnv?:Env){super(closeState,closeEnv);}
 private async register(enabled:boolean,until:number){const ns=this.closeEnv?.MARKET_SCANNER;if(!ns){if(enabled)throw new Error('共享收盘报告尚未部署');return;}let id=await this.closeState.storage.get<string>('leaseId');if(!id){id=crypto.randomUUID();await this.closeState.storage.put('leaseId',id);}await scannerCall(ns,enabled?'ensure':'release',{id,until,target:this.closeState.id?.toString()});if(enabled)await this.closeState.storage.put('lease-sync',{until,at:Date.now()});else await this.closeState.storage.delete('lease-sync');}
 /** Renews the coordinator lease only when the expiry changed or once a day, not on every wake. */
 private async ensureLease(until:number){const sync=await this.closeState.storage.get<{until:number;at:number}>('lease-sync');if(sync&&sync.until===until&&Date.now()-sync.at<86400000)return;await this.register(true,until);}
 override async fetch(req:Request){const action=new URL(req.url).pathname.split('/').at(-1),s=this.closeState.storage;
  if(req.method==='POST'&&action==='config'){
   const raw=await req.text();if(raw.length>16000)return response({error:'请求过大'},413);let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return response({error:'无效请求'},400);}
   if(typeof body.enabled!=='boolean'||body.enabled&&body.scope!=='all'&&!validMonitorSymbols(body.symbols))return response({error:'请选择1至60只不重复的沪深北个股'},400);
   const old=await s.get<MonitorConfig>('config');const config:MonitorConfig={enabled:body.enabled,scope:body.scope==='all'?'all':'selected',symbols:body.scope==='all'?[]:body.enabled?body.symbols as string[]:old?.symbols||[],activityFilter:body.activityFilter!==false,locale:body.locale==='en'?'en':'zh-CN',updatedAt:Date.now(),expiresAt:Date.now()+30*86400000,cadence:'close'};
   await s.put('config',config);await this.register(config.enabled,config.expiresAt);if(config.enabled)await s.setAlarm(afterClose()?Date.now()+1000:nextMonitorRun());else await s.deleteAlarm();
   return super.fetch(new Request('https://monitor/status'));
  }
  if(req.method==='POST'&&action==='check'){
   // Manual checks are per device; at most one every two minutes.
   const last=await s.get<number>('check-at'),wait=last?CHECK_INTERVAL_MS-(Date.now()-last):0;
   if(wait>0)return apiError(429,'每2分钟最多手动检查一次',{code:'RATE_LIMITED',retryAfter:Math.ceil(wait/1000)});
   await s.put('check-at',Date.now());await this.runClose('check');return super.fetch(new Request('https://monitor/status'));
  }
  if(req.method==='POST'&&action==='internal-close'){await this.runClose('push');return super.fetch(new Request('https://monitor/status'));}
  return super.fetch(req);
 }
 override async alarm(){try{await this.runClose('alarm');}catch(e){await this.closeState.storage.put('run',{lastRun:Date.now(),status:'收盘报告暂不可用',deliveryError:e instanceof Error?e.message:'来源失败'});const c=await this.closeState.storage.get<MonitorConfig>('config');if(c?.enabled)await this.closeState.storage.setAlarm(nextMonitorRun());}}
 /**
  * Delivers the shared closing report once per trade date. A wake only downloads the small
  * manifest; the full report is fetched when a current, undelivered report exists. Reports for the
  * latest session are accepted even when they arrive after Beijing midnight (late GitHub runs).
  * trigger: 'alarm' (scheduled wake), 'push' (coordinator fan-out) or 'check' (manual).
  */
 private async runClose(trigger:'alarm'|'push'|'check'='alarm'){if(this.closing)return;this.closing=true;const s=this.closeState.storage;
  try{const config=await s.get<MonitorConfig>('config');if(!config?.enabled)return;
   if(config.expiresAt<=Date.now()){await this.register(false,config.expiresAt);await s.put('config',{...config,enabled:false,cadence:'close'});await s.deleteAlarm();return;}
   await this.ensureLease(config.expiresAt);
   if(trigger==='alarm'&&!afterClose()){await s.setAlarm(nextMonitorRun());await s.put('run',{status:'等待收盘汇总 · 北京时间15:20启动'});return;}
   const ns=this.closeEnv?.MARKET_SCANNER;if(!ns)throw new Error('共享收盘任务尚未部署');
   const now=new Date(),today=beijingParts(now).date,waitAgain=()=>s.setAlarm(afterClose(now)&&beijingParts(now).minute<1020?Date.now()+10*60000:nextMonitorRun());
   const head=await scannerCall(ns,'manifest') as {report?:CloseManifest|null;session?:SessionInfo|null};
   let manifest:CloseManifest|CloseReport|null,full:CloseReport|null=null;
   if(head&&typeof head==='object'&&'report' in head)manifest=head.report??null;
   else{full=(await scannerCall(ns,'results') as {report:CloseReport|null}).report;manifest=full;}// Coordinator without the manifest action.
   if(!manifest||!reportIsCurrent(manifest.date,now,expectedReportDate(head?.session,now,900))){await s.put('run',{status:'等待本交易日收盘报告；非交易日不发送',lastRun:Date.now()});await waitAgain();return;}
   const day=manifest.date,subscribed=!!await s.get('subscription')||!!this.closeEnv?.FIREBASE_SERVICE_ACCOUNT&&!!await s.get('native-token');
   let sent=await s.get<string>('digestDay');
   const processed=await s.get<{id:string;attempts:number}>('close-processed');
   // Nothing new to deliver: keep the stored events and run status, do not download the report again.
   const reportKey=manifest.id||manifest.date,seen=processed&&processed.id===reportKey?processed.attempts:0;
   if(seen&&(sent===day||!subscribed||seen>=6)){await s.setAlarm(nextMonitorRun());return;}
   const r=full??(await scannerCall(ns,'results') as {report:CloseReport|null}).report;
   if(!r||(r.id||r.date)!==reportKey){await waitAgain();return;}
   const latest=await s.get<MonitorConfig>('config');if(!latest?.enabled||latest.updatedAt!==config.updatedAt)return;
   const selected=r.candidates.filter(c=>(config.scope==='all'||config.symbols.includes(c.symbol))&&(!config.activityFilter||!!c.character&&!c.character.quiet&&!c.character.weakFollow)&&(c.marketCap??Infinity)<=1000e8);
   const {candidates:_,...report}=r;
   const events:SignalEvent[]=selected.slice(0,200).map(c=>({id:day+':'+c.symbol+':close',symbol:c.symbol,name:c.name,date:day,asOf:day+'T15:00:00+08:00',kind:'daily-candidate',price:c.price!,gain:c.changePercent,volumeRatio:c.volumeRatio,launchDate:c.eventDate,delivery:'none',observedAt:Date.now()}));
   let deliveryError='';
   if(sent!==day&&subscribed){const english=config.locale==='en',label=day===today?'':english?day+' · ':day+' ';const body=r.checked===0?english?'Market sources could not be verified; no signal conclusion.':'行情来源尚未完成核验，暂不判断今日是否有信号。':selected.length?selected.slice(0,3).map(c=>`${c.name} ${c.symbol} · ${c.ranking?.score??'—'}${english?' pts':'分'}`).join('\n'):english?'No stocks met today’s liquidity, chip and pattern conditions.':'今日没有符合成交额、筹码和形态条件的候选。';
    try{await this.push({title:english?'Market Atlas · Closing report':'Market Atlas · 收盘精选',body:label+(r.failed?'部分来源未完成 · ':'')+body,url:'/?view=screener&report='+day,tag:'atlas-close-'+day},86400);await s.put('digestDay',day);sent=day;}catch(e){deliveryError=e instanceof Error?e.message:'推送失败';}
   }
   await s.put('close-processed',{id:reportKey,attempts:seen+1});
   for(const e of events)e.delivery=sent===day?'sent':subscribed?'failed':'none';await s.put('events',events);
   await s.put('run',{status:sent===day?(day===today?'今日':day+' ')+'收盘汇总已推送':subscribed?'收盘报告已生成，推送待重试':'收盘报告已生成，设备未订阅',digestDate:sent,report,lastRun:Date.now(),checked:r.checked,ready:r.checked,failures:r.failureSample,deliveryError});
   const current=await s.get<MonitorConfig>('config');if(current?.enabled&&current.updatedAt===config.updatedAt){if(deliveryError)await waitAgain();else await s.setAlarm(nextMonitorRun());}
  }finally{this.closing=false;}
 }
}
