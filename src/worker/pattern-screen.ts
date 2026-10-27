import {evaluateScreen,parseScreenOptions} from '../shared/pattern-screen';
import {parseQuotes,memo,quotes} from './desk-data';
import {validateDailyBars,sinaBeijingDaily} from './research';
import type {Candle} from '../shared/types';
export type DayData={candles:Candle[];quote?:import('../shared/desk-types').Snapshot;provider:string};
type Node={day?:unknown[][];qfqday?:unknown[][];qt?:Record<string,string[]>};
export async function fetchScreenDaily(symbol:string,adjusted:boolean,count=adjusted?500:20,signal?:AbortSignal){
 const wire=symbol.slice(-2).toLowerCase()+symbol.slice(0,6),base='https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=';
 const url=(size:number)=>base+wire+',day,,,'+size+','+(adjusted?'qfq':'');
 const request=(size:number)=>fetch(url(size),{headers:{Referer:'https://gu.qq.com/','User-Agent':'Mozilla/5.0'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7000)]):AbortSignal.timeout(7000)});
 let r=await request(count);
 // The upstream CDN sometimes returns HTTP 501 for short adjusted windows from Workers.
 // Use the canonical full-history URL, then slice locally; never turn that into an empty result.
 if(!r.ok&&adjusted&&count<500)r=await request(500);
 if(!r.ok)throw new Error('形态日线来源 HTTP '+r.status);
 const data=await r.json() as {data?:Record<string,Node>},node=data.data?.[wire],rows=adjusted?(node?.qfqday||node?.day):node?.day;
 if(!Array.isArray(rows)||!rows.length)throw new Error('来源缺少所需复权日线');
 // Tencent may append the forming session to the requested N historical bars.
 const parsed:Candle[]=validateDailyBars(rows.map(r=>({time:String(r[0]),open:Number(r[1]),close:Number(r[2]),high:Number(r[3]),low:Number(r[4]),volume:Number(r[5])})),rows.length);
 if(parsed.length!==rows.length)throw new Error('日线含无效记录');
 const candles=parsed.slice(-count);
 const fields=node?.qt?.[wire],quote=fields?parseQuotes('v_'+wire+'="'+fields.join('~')+'";')[0]:undefined;
 return {candles,quote,provider:adjusted?'腾讯财经前复权日线 / 公开快照':'腾讯财经未复权日线'};
}
export async function patternScreen(symbol:string,params:URLSearchParams){
 const options=parseScreenOptions(params);
 if(symbol.endsWith('.BJ')){const [daily,book]=await Promise.all([memo('screen:bj:'+symbol,300,()=>sinaBeijingDaily(symbol,500)),memo('screen:quote:'+symbol,5,()=>quotes([symbol]))]);const quote=book.items.find(q=>q.symbol===symbol);if(!quote)throw new Error('北交所快照暂不可用');const result=evaluateScreen({bars:daily.candles,raw:daily.candles,quote,provider:'新浪北交所未复权日线 / 腾讯快照',volumeUnit:'股',options});if(result.candidate)result.candidate.risks.push('北交所未复权历史，除权除息可能影响形态，请复核');return {available:true,...result};}

 const adjusted=await memo('screen:adjusted:'+symbol,60,()=>fetchScreenDaily(symbol,true));
 if(!adjusted.quote)throw new Error('形态筛选缺少可核验快照');
 if(adjusted.quote.amount===null||adjusted.quote.amount<2e8)return {available:true,candidate:null,reason:'成交额不足2亿元'};
 if(options.maxMarketCap!==null&&(adjusted.quote.marketCap===null||adjusted.quote.marketCap>options.maxMarketCap))return {available:true,candidate:null,reason:'超过市值上限或市值待核验'};
 const needsRaw=options.auto||options.recentLimitUp||options.modes.includes('limitup');
 const raw=needsRaw?await memo('screen:raw:'+symbol,300,()=>fetchScreenDaily(symbol,false)):{candles:[]};
 return {available:true,...evaluateScreen({bars:adjusted.candles,raw:raw.candles,quote:adjusted.quote,provider:adjusted.provider,volumeUnit:/^68[89]/.test(symbol)?'股':'手',options})};
}

/** A cached adjusted history is extendable only if every overlapping close is unchanged. */
export function extendHistory(previous:Candle[],recent:Candle[]):Candle[]|null{
 if(!previous.length||!recent.length)return null;const last=previous.at(-1)!;if(!recent.some(c=>c.time===last.time))return null;
 const known=new Map(previous.map(c=>[c.time,c]));for(const c of recent){const old=known.get(c.time);if(old&&Math.abs(old.close-c.close)>Math.max(.00001,c.close*.000001))return null;}
 return [...new Map([...previous,...recent].map(c=>[c.time,c])).values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-500);
}
export async function patternBatch(symbols:string[],params:URLSearchParams){
 const options=parseScreenOptions(params),feed=await quotes(symbols),book=new Map(feed.items.map(q=>[q.symbol,q]));
 const results=await Promise.all(symbols.map(async symbol=>{try{const q=book.get(symbol);if(!q)return {symbol,candidate:null,unverified:true,reason:'快照来源暂不可用'};if(q.amount===null||q.amount<2e8)return {symbol,candidate:null,reason:'成交额不足2亿元'};if(options.maxMarketCap!==null&&(q.marketCap===null||q.marketCap>options.maxMarketCap))return {symbol,candidate:null,reason:'超过市值上限或市值待核验'};return {symbol,...await patternScreen(symbol,params)};}catch(e){return {symbol,candidate:null,unverified:true,reason:e instanceof Error?e.message:'来源暂不可用'};}}));
 return {available:true,items:results,concurrency:4};
}
