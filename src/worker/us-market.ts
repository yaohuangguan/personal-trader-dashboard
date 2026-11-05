import type {Candle} from '../shared/types';
import type {Snapshot} from '../shared/desk-types';
import {isUSStock,marketClock,newYorkTimestamp} from '../shared/market-clock';
import {validHistoryDate} from '../shared/chart-history';
import {requestTencentHistory} from './chart-history';

const number=(s:string|undefined)=>s!==undefined&&s.trim()!==''&&Number.isFinite(Number(s))?Number(s):null;
export function parseUSQuotes(text:string,now=new Date()):Array<Snapshot&{wire:string;currency:string}>{
 const result:Array<Snapshot&{wire:string;currency:string}>=[];
 for(const match of text.matchAll(/v_us([A-Za-z0-9_.-]+)="([^"]*)"/g)){
  const symbol=match[1].toUpperCase(),f=match[2].split('~'),price=number(f[3]),previous=number(f[4]),asOf=newYorkTimestamp(f[30]||'');
  if(!isUSStock(symbol)||!f[2]?.startsWith(symbol+'.')||!/^.+\.(?:OQ|N|A|PK)$/.test(f[2])||!asOf||!price||price<=0||!previous||previous<=0||f[35]!=='USD')continue;
  const clock=marketClock(now,symbol),weekday=new Date(clock.date+'T12:00:00Z').getUTCDay(),session=weekday>0&&weekday<6&&clock.minute>=570&&clock.minute<960?'trading':'closed',age=now.getTime()-Date.parse(asOf);
  // Preserve the exchange-local date at the start: candle overlap verification uses it.
  const offset=(Date.parse(f[30].replace(' ','T')+'Z')-Date.parse(asOf))/3600000;
  const timestamp=f[30].replace(' ','T')+(offset<0?'-':'+')+String(Math.abs(offset)).padStart(2,'0')+':00';
  result.push({symbol,wire:'us'+f[2],name:f[46]||f[1]||symbol,currency:'USD',price,previous,open:number(f[5]),high:number(f[33]),low:number(f[34]),change:number(f[31]),changePercent:number(f[32]),volume:number(f[6]),amount:number(f[37]),turnover:number(f[38]),pe:number(f[39]),pb:null,marketCap:null,floatCap:null,volumeRatio:null,limitUp:null,limitDown:null,asOf:timestamp,session,stale:age< -60000||age>7*86400000||session==='trading'&&age>120000,bids:[],asks:[],volumeUnit:'股'});
 }
 return result;
}
export async function usQuotes(symbols:string[],signal?:AbortSignal){
 if(!symbols.length||symbols.some(s=>!isUSStock(s)))throw new RangeError('Invalid US stock symbol');
 const url='https://qt.gtimg.cn/q='+symbols.map(s=>'us'+s).join(',');
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://gu.qq.com/'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('US quote source HTTP '+response.status);
 const items=parseUSQuotes(new TextDecoder('gbk').decode(await response.arrayBuffer()));
 if(!items.length)throw new Error('US quote source returned no valid snapshots');
 return {items,source:'腾讯财经美股公开快照',sourceUrl:url,fetchedAt:new Date().toISOString(),available:true,unavailable:symbols.filter(s=>!items.some(q=>q.symbol===s)),level2:false as const,depth:5 as const};
}
export function parseUSHistory(node:Record<string,string[][]>,period:string,before=''):Candle[]{
 const raw=node['qfq'+period];
 // The ordinary fqkline endpoint silently returns unadjusted US prices. Never mix it in.
 if(!Array.isArray(raw)||raw.length>501||!raw.length&&node[period]?.length)throw new Error('US adjusted history response is incomplete');
 const dates=new Set<string>();
 return raw.map(row=>{
  if(!Array.isArray(row)||row.length<6)throw new Error('Invalid US history row');
  const time=row[0],values=row.slice(1,6),[open,close,high,low,volume]=values.map(Number);
  if(!validHistoryDate(time)||before&&time>before||dates.has(time)||values.some(v=>typeof v!=='string'||v.trim()==='')||![open,close,high,low,volume].every(Number.isFinite)||Math.min(open,close,high,low)<=0||volume<0||high<Math.max(open,close)||low>Math.min(open,close))throw new Error('Invalid US adjusted OHLCV');
  dates.add(time);return {time,open,close,high,low,volume};
 }).sort((a,b)=>a.time.localeCompare(b.time));
}
export async function usHistory(symbol:string,period:string,before=''){
 if(!isUSStock(symbol)||!['day','week','month'].includes(period)||before&&!validHistoryDate(before))throw new RangeError('Invalid US history parameters');
 const quote=(await usQuotes([symbol])).items.find(q=>q.symbol===symbol);
 if(!quote)throw new Error('US ticker could not be resolved');
 const {node,url}=await requestTencentHistory(quote.wire,period,before,501);
 const candles=parseUSHistory(node,period,before);
 return {symbol,period,candles,source:'腾讯财经美股前复权历史',sourceUrl:url,url,name:quote.name,fetchedAt:new Date().toISOString(),available:true,volumeUnit:'股' as const};
}
