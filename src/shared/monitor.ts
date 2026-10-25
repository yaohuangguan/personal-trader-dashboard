import type {Candle} from './types';
import type {Snapshot} from './desk-types';
import {analyzeGuide} from './guide-analysis';
import {stockCharacter} from './stock-character';
export type SignalKind='intraday'|'launch-close'|'confirmed'|'invalidated';
export type SignalEvent={id:string;symbol:string;name:string;date:string;asOf:string;kind:SignalKind;price:number;gain:number|null;volumeRatio:number|null;launchDate:string|null;delivery:'pending'|'sent'|'failed'|'none';deliveryError?:string;observedAt?:number;activityEligible?:boolean};
export type MonitorConfig={enabled:boolean;scope?:'all'|'selected';symbols:string[];activityFilter:boolean;locale:'zh-CN'|'en';updatedAt:number;expiresAt:number};
export type MonitorStatus={available:boolean;configured:boolean;config:MonitorConfig;subscribed:boolean;events:SignalEvent[];lastRun:number|null;nextRun:number|null;checked:number;ready:number;failures:{symbol:string;reason:string}[];status:string;deliveryError?:string;pending:number;market?:import('./full-market').FullMarketStatus};
export function beijingParts(now=new Date()){
 const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now),get=(s:string)=>p.find(v=>v.type===s)!.value;
 return {date:get('year')+'-'+get('month')+'-'+get('day'),minute:Number(get('hour'))*60+Number(get('minute')),weekday:get('weekday')};
}
export function monitorWindow(now=new Date()){
 const p=beijingParts(now);return !['Sat','Sun'].includes(p.weekday)&&((p.minute>=570&&p.minute<=690)||(p.minute>=780&&p.minute<=930));
}
export function nextMonitorRun(now=new Date()){
 const p=beijingParts(now);if(monitorWindow(now))return now.getTime()+60000;
 if(!['Sat','Sun'].includes(p.weekday)&&p.minute>690&&p.minute<780)return Date.parse(p.date+'T13:00:00+08:00');
 let d=new Date(p.date+'T09:30:00+08:00');if(p.minute>=570)d=new Date(d.getTime()+86400000);
 while([0,6].includes(new Date(d.getTime()+8*3600000).getUTCDay()))d=new Date(d.getTime()+86400000);
 return d.getTime();
}
export function evaluateLiveSignal(history:Candle[],volumeUnit:'股'|'手',quote:Snapshot,now=new Date(),activityFilter=true){
 const p=beijingParts(now),closed=p.minute>=900;
 if(!monitorWindow(now)||quote.asOf.slice(0,10)!==p.date||!Number.isFinite(Date.parse(quote.asOf))||now.getTime()-Date.parse(quote.asOf)<-60000||now.getTime()-Date.parse(quote.asOf)>(closed?90*60000:120000))return {reason:'休市或快照不是本交易日的有效数据',signals:[]};
 const prior=history.filter(c=>c.time<p.date).sort((a,b)=>a.time.localeCompare(b.time));
 if(prior.length<64||Date.parse(p.date)-Date.parse(prior.at(-1)!.time)>10*86400000)return {reason:'历史日线不足或过期',signals:[]};
 const previous=prior.at(-1)!;
 if(Math.abs(previous.close/quote.previous-1)>.005)return {reason:'历史复权价与昨收不一致，等待重新获取',signals:[]};
 const {open,high,low,volume}=quote;
 if(open===null||high===null||low===null||volume===null||Math.min(open,low,quote.price)<=0||high<Math.max(open,quote.price)||low>Math.min(open,quote.price)||volume<=0)return {reason:'当前OHLCV不完整',signals:[]};
 const converted=volume*(quote.volumeUnit==='手'?100:1)/(volumeUnit==='手'?100:1);
 const candles=[...prior,{time:p.date,open,high,low,close:quote.price,volume:converted}],guide=analyzeGuide(candles,{now});
 const character=stockCharacter(prior,previous.time);
 if(activityFilter&&(!character||character.quiet||character.weakFollow))return {reason:'股性过滤：低弹性或历史延续较弱',signals:[]};
 const kinds:SignalKind[]=[];
 if(guide.currentLaunch)kinds.push(closed?'launch-close':'intraday');
 if(guide.event?.confirmationDate===p.date&&guide.event.state==='confirmed'&&closed&&guide.stage==='开花确认')kinds.push('confirmed');
 if(guide.event?.invalidationDate===p.date&&closed)kinds.push('invalidated');
 const signals=kinds.map(kind=>({id:[p.date,quote.symbol,kind,guide.event?.date||p.date].join(':'),symbol:quote.symbol,name:quote.name,date:p.date,asOf:quote.asOf,kind,price:quote.price,gain:quote.changePercent,volumeRatio:guide.volumeRatio,launchDate:guide.event?.date||null,delivery:'pending' as const}));
 return {reason:'',signals};
}
export function validPushEndpoint(endpoint:string){try{const u=new URL(endpoint);return u.protocol==='https:'&&u.port===''&&!u.username&&!u.password&&u.pathname.length>1&&(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.notify.windows.com'));}catch{return false;}}
export function validMonitorSymbols(value:unknown):value is string[]{return Array.isArray(value)&&value.length>0&&value.length<=60&&new Set(value).size===value.length&&value.every(s=>typeof s==='string'&&/^\d{6}\.(SH|SZ|BJ)$/.test(s)&&!(/^(?:000\d{3}\.SH|399\d{3}\.SZ)$/.test(s)));}
