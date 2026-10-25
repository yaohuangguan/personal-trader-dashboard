import {buildPushPayload,type VapidKeys,type PushSubscription} from '@block65/webcrypto-web-push';
import {quotes} from './desk-data';
import {tencentAshares,sinaAdjustedDaily,sinaBeijingDaily} from './research';
import type {Candle} from '../shared/types';
import {beijingParts,monitorWindow,nextMonitorRun,evaluateLiveSignal,validPushEndpoint,validMonitorSymbols,type MonitorConfig,type SignalEvent,type MonitorStatus} from '../shared/monitor';
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;delete(key:string):Promise<boolean>;setAlarm(time:number):Promise<void>;deleteAlarm():Promise<void>;getAlarm():Promise<number|null>};
type State={storage:Storage;blockConcurrencyWhile<T>(fn:()=>Promise<T>):Promise<T>};
export type MonitorNamespace={idFromName(name:string):unknown;get(id:unknown):{fetch(request:Request):Promise<Response>}};
type Baseline={candles:Candle[];volumeUnit:'股'|'手';loaded:number;date:string;source:string};
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const defaults=():MonitorConfig=>({enabled:false,symbols:[],activityFilter:true,locale:'zh-CN',updatedAt:0,expiresAt:0});
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export async function generateVapid():Promise<VapidKeys>{
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const privateKey=await crypto.subtle.exportKey('jwk',keys.privateKey),publicKey=await crypto.subtle.exportKey('raw',keys.publicKey);
 return {subject:'https://personal-market-atlas.nzs.workers.dev',publicKey:base64(new Uint8Array(publicKey)),privateKey:privateKey.d!};
}
export class SignalMonitor {
 private busy=false;
 constructor(private state:State){}
 private async keys(){let keys=await this.state.storage.get<VapidKeys>('vapid');if(!keys){keys=await generateVapid();await this.state.storage.put('vapid',keys);}return keys;}
 private async status():Promise<MonitorStatus>{
  const s=this.state.storage,config=await s.get<MonitorConfig>('config')||defaults(),events=await s.get<SignalEvent[]>('events')||[],run=await s.get<Partial<MonitorStatus>>('run');
  return {available:true,configured:!!config.updatedAt,config,subscribed:!!await s.get('subscription'),events,lastRun:null,nextRun:await s.getAlarm(),checked:0,ready:0,failures:[],pending:events.filter(e=>e.delivery==='pending').length,...run,status:!config.enabled?config.updatedAt?'已暂停后台盯盘':'尚未开启':run?.status||'等待后台扫描'};
 }
 async fetch(req:Request){
  const action=new URL(req.url).pathname.split('/').at(-1),s=this.state.storage;
  if(req.method==='GET'&&action==='status')return response(await this.status());
  if(req.method==='GET'&&action==='public-key'){const keys=await this.state.blockConcurrencyWhile(()=>this.keys());return response({publicKey:keys.publicKey});}
  if(req.method!=='POST')return response({error:'Method not allowed'},405);
  if(Number(req.headers.get('content-length')||0)>16000)return response({error:'请求过大'},413);
  const raw=await req.text();if(raw.length>16000)return response({error:'请求过大'},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw||'{}');}catch{return response({error:'无效请求'},400);}
  if(action==='config'){
   if(typeof body.enabled!=='boolean'||body.enabled&&!validMonitorSymbols(body.symbols))return response({error:'请选择1至60只不重复的沪深北个股'},400);
   const previous=await s.get<MonitorConfig>('config')||defaults(),config:MonitorConfig={enabled:body.enabled,symbols:body.enabled?body.symbols as string[]:previous.symbols,activityFilter:body.activityFilter!==false,locale:body.locale==='en'?'en':'zh-CN',updatedAt:Date.now(),expiresAt:Date.now()+30*86400000};
   await s.put('config',config);if(config.enabled)await s.setAlarm(Date.now()+1000);else await s.deleteAlarm();return response(await this.status());
  }
  if(action==='subscribe'){
   const sub=body.subscription as PushSubscription|undefined;
   if(!sub||!validPushEndpoint(sub.endpoint)||!sub.keys||!/^[a-zA-Z0-9_-]{87}$/.test(sub.keys.p256dh)||!/^[a-zA-Z0-9_-]{22}$/.test(sub.keys.auth))return response({error:'无效浏览器通知订阅'},400);
   await s.put('subscription',sub);return response({subscribed:true});
  }
  if(action==='unsubscribe'){await s.delete('subscription');return response({subscribed:false});}
  if(action==='test'){
   const config=await s.get<MonitorConfig>('config')||defaults();try{await this.push({title:config.locale==='en'?'Market Atlas · Test':'Market Atlas · 通知测试',body:config.locale==='en'?'Background browser notifications are connected.':'后台浏览器通知已接通。这是测试，不是股票信号。',url:'/?view=signals',tag:'atlas-test'});return response({sent:true});}catch(e){return response({error:e instanceof Error?e.message:'推送失败'},502);}
  }
  if(action==='check'){if(this.busy)return response({error:'后台扫描进行中'},409);const status=await this.status();if(status.lastRun&&Date.now()-status.lastRun<55000)return response({error:'每分钟最多检查一次'},429);await this.run();return response(await this.status());}
  return response({error:'Unknown action'},404);
 }
 private async push(data:{title:string;body:string;url:string;tag:string}){
  const sub=await this.state.storage.get<PushSubscription>('subscription');if(!sub)throw new Error('尚未订阅设备通知');
  if(!validPushEndpoint(sub.endpoint))throw new Error('通知服务地址无效');
  const payload=await buildPushPayload({data:JSON.stringify(data),options:{ttl:300}},sub,await this.keys());
  const r=await fetch(sub.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(7000)});
  if(r.status===404||r.status===410)await this.state.storage.delete('subscription');
  if(!r.ok)throw new Error('通知服务 HTTP '+r.status);
 }
 async alarm(){try{await this.run();}catch{await this.state.storage.put('run',{lastRun:Date.now(),status:'后台任务失败，稍后重试',failures:[]});const c=await this.state.storage.get<MonitorConfig>('config');if(c?.enabled)await this.state.storage.setAlarm(nextMonitorRun());}}
 private async baseline(symbol:string,day:string):Promise<Baseline>{
  let data:{candles:Candle[];url:string},volumeUnit:'股'|'手'='手',source='腾讯前复权日线';
  try{if(symbol.endsWith('.BJ'))throw new Error('使用北交所日线');data=await tencentAshares(symbol);if(/^68[89]/.test(symbol))volumeUnit='股';}
  catch{data=symbol.endsWith('.BJ')?await sinaBeijingDaily(symbol):await sinaAdjustedDaily(symbol);volumeUnit='股';source=symbol.endsWith('.BJ')?'新浪北交所未复权日线':'新浪前复权日线';}
  return {candles:data.candles.slice(-270),volumeUnit,loaded:Date.now(),date:day,source};
 }
 private async run(){
  if(this.busy)return;this.busy=true;const s=this.state.storage;
  try{
   let config=await s.get<MonitorConfig>('config');if(!config?.enabled)return;
   const now=new Date(),day=beijingParts(now).date;
   if(config.expiresAt<=Date.now()){config={...config,enabled:false};await s.put('config',config);await s.deleteAlarm();await s.put('run',{status:'监控已到期，请续期开启'});return;}
   const baselines=new Map<string,Baseline>(),failures:{symbol:string;reason:string}[]=[],missing:string[]=[];
   for(const symbol of config.symbols){const baseline=await s.get<Baseline>('baseline:'+symbol);if(baseline&&baseline.date===day)baselines.set(symbol,baseline);else missing.push(symbol);}
   // Four histories per invocation keep cold starts bounded. Completed values only are persisted.
   const attempt=await s.get<{day:string;counts:Record<string,number>}>('attempts')||{day,counts:{}};if(attempt.day!==day){attempt.day=day;attempt.counts={};}
   const ordered=missing.filter(symbol=>monitorWindow(now)||(attempt.counts[symbol]||0)<1).sort((a,b)=>(attempt.counts[a]||0)-(attempt.counts[b]||0));
   const batch=ordered.slice(0,4),loaded=await Promise.allSettled(batch.map(async symbol=>{const b=await this.baseline(symbol,day);await s.put('baseline:'+symbol,b);return {symbol,b};}));
   loaded.forEach((r,i)=>{attempt.counts[batch[i]]=(attempt.counts[batch[i]]||0)+1;if(r.status==='fulfilled')baselines.set(r.value.symbol,r.value.b);else failures.push({symbol:batch[i],reason:'历史源暂不可用'});});await s.put('attempts',attempt);
   const previous=await s.get<SignalEvent[]>('events')||[],known=new Set(previous.map(e=>e.id)),events=[...previous],fresh:SignalEvent[]=[];
   let checked=0,status='历史底稿准备中';
   if(monitorWindow(now)){
    const feed=await quotes([...new Set([...config.symbols,'000001.SH'])]),index=feed.items.find(q=>q.symbol==='000001.SH');
    if(!index||index.asOf.slice(0,10)!==day){status='来源尚非本交易日，等待开市';}
    else{
     for(const symbol of config.symbols){const base=baselines.get(symbol),quote=feed.items.find(q=>q.symbol===symbol);if(!base)continue;if(!quote){failures.push({symbol,reason:'快照暂不可用'});continue;}
      const result=evaluateLiveSignal(base.candles,base.volumeUnit,quote,now,config.activityFilter);checked++;
      if(result.reason&&!result.reason.startsWith('股性过滤'))failures.push({symbol,reason:result.reason});
      for(const signal of result.signals)if(!known.has(signal.id)){known.add(signal.id);fresh.push(signal);events.unshift(signal);}
     }
     status=beijingParts(now).minute>=900?'收盘核验中':'盘中分钟轮询';
    }
   }else status=baselines.size===config.symbols.length?'休市，等待下一交易时段':'休市，准备历史底稿';
   const latestConfig=await s.get<MonitorConfig>('config');if(!latestConfig?.enabled||latestConfig.updatedAt!==config.updatedAt)return;
   const subscribed=!!await s.get('subscription');for(const event of fresh)if(!subscribed)event.delivery='none';
   // Persist detections before network delivery. Alarms are at-least-once: IDs prevent duplicate events.
   await s.put('events',events.slice(0,200));
   let deliveryError='';const pending=events.filter(e=>e.delivery==='pending'&&Date.now()-Date.parse(e.asOf)<5*60000);
   if(pending.length&&subscribed){
    const english=config.locale==='en',labels={intraday:english?'Intraday candidate':'盘中候选','launch-close':english?'Closed launch':'收盘启动',confirmed:english?'Confirmed bloom':'开花确认',invalidated:english?'Invalidated':'确认失效'};
    const first=pending[0],body=pending.slice(0,5).map(e=>`${e.name} ${e.symbol} · ${labels[e.kind]} · ${e.price.toFixed(2)}`).join('\n');
    try{await this.push({title:`Market Atlas · ${pending.length}${english?' signals':'个信号'}`,body,url:pending.length===1?'/?symbol='+first.symbol:'/?view=signals',tag:first.id});for(const e of pending)e.delivery='sent';}
    catch(e){deliveryError=e instanceof Error?e.message:'推送失败';for(const e of pending){e.delivery='failed';e.deliveryError=deliveryError;}}
   }
   for(const event of events)if(event.delivery==='pending'&&Date.now()-Date.parse(event.asOf)>=5*60000){event.delivery='failed';event.deliveryError='超过5分钟通知时效，保留记录';}
   await s.put('events',events.slice(0,200));
   await s.put('run',{lastRun:Date.now(),checked,ready:baselines.size,failures,status,deliveryError,pending:events.filter(e=>e.delivery==='pending').length});
   // A stop or configuration change while fetching must not revive an old alarm.
   const current=await s.get<MonitorConfig>('config');if(current?.enabled){const warm=ordered.length>4;await s.setAlarm(warm?Date.now()+30000:nextMonitorRun());}
  }finally{this.busy=false;}
 }
}
export async function monitorRoute(req:Request,namespace?:MonitorNamespace){
 const path=new URL(req.url).pathname;if(!path.startsWith('/api/monitor/'))return null;
 if(!namespace)return response({available:false,error:'后台监控尚未部署'},503);
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');if(!/^[a-f0-9]{64}$/.test(token))return response({error:'缺少设备监控凭证'},401);
 const origin=req.headers.get('Origin');if(origin&&origin!==new URL(req.url).origin)return response({error:'Invalid origin'},403);
 if(!['status','public-key','config','subscribe','unsubscribe','test','check'].includes(path.split('/').at(-1)||''))return response({error:'Unknown action'},404);
 return namespace.get(namespace.idFromName(token)).fetch(req);
}
