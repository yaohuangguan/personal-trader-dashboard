import type {Candle} from './types';
/** Tencent timestamps are exchange local time, and denote interval ends. */
export function parseMinuteBars(rows:unknown,now=new Date()):Candle[]{
 if(!Array.isArray(rows))throw new Error('分钟线来源格式异常');
 const limit=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 const result=rows.map(r=>{
  if(!Array.isArray(r)||!/^\d{12}$/.test(String(r[0])))throw new Error('分钟线时间缺失');
  const raw=String(r[0]),time=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)} ${raw.slice(8,10)}:${raw.slice(10,12)}`;
  const [open,close,high,low,volume]=r.slice(1,6).map(Number),minute=Number(raw.slice(8,10))*60+Number(raw.slice(10,12));
  if(!Number.isFinite(Date.parse(time.replace(' ','T')+':00+08:00'))||![open,close,high,low,volume].every(Number.isFinite)||Math.min(open,close,high,low)<=0||volume<0||high<Math.max(open,close)||low>Math.min(open,close)||!((minute>570&&minute<=690)||(minute>780&&minute<=900)))throw new Error('分钟线 OHLCV 或交易时段异常');
  return {time,open,close,high,low,volume};
 }).filter(c=>c.time<=limit).sort((a,b)=>a.time.localeCompare(b.time));
 if(result.some((c,i)=>i>0&&c.time===result[i-1].time))throw new Error('分钟线重复时间');
 return result;
}
/** Only combine a complete pair; never promote a truncated historical session. */
export function aggregate120(rows:Candle[]):Candle[]{
 const groups=new Map<string,Candle[]>();
 for(const c of rows){const h=Number(c.time.slice(11,13));const key=c.time.slice(0,10)+(h<12?' AM':' PM');groups.set(key,[...(groups.get(key)||[]),c]);}
 return [...groups.values()].flatMap(g=>{
  if(g.length!==2)return [];
  const ends=g.map(c=>c.time.slice(11));
  if(!((ends[0]==='10:30'&&ends[1]==='11:30')||(ends[0]==='14:00'&&ends[1]==='15:00')))return [];
  return [{time:g[1].time,open:g[0].open,close:g[1].close,high:Math.max(...g.map(c=>c.high)),low:Math.min(...g.map(c=>c.low)),volume:g[0].volume+g[1].volume}];
 });
}
