import {evaluateScreen,parseScreenOptions} from '../shared/pattern-screen';
import {parseQuotes,memo,quotes} from './desk-data';
import {validateDailyBars,sinaBeijingDaily} from './research';
import type {Candle} from '../shared/types';
type Node={day?:unknown[][];qfqday?:unknown[][];qt?:Record<string,string[]>};
async function daily(symbol:string,adjusted:boolean){
 const wire=symbol.slice(-2).toLowerCase()+symbol.slice(0,6),url='https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+wire+',day,,,'+(adjusted?'500,qfq':'20,');
 const r=await fetch(url,{headers:{Referer:'https://gu.qq.com/','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(7000)});if(!r.ok)throw new Error('形态日线来源 HTTP '+r.status);
 const data=await r.json() as {data?:Record<string,Node>},node=data.data?.[wire],rows=adjusted?(node?.qfqday||node?.day):node?.day;
 if(!Array.isArray(rows)||!rows.length)throw new Error('来源缺少所需复权日线');
 const candles:Candle[]=validateDailyBars(rows.map(r=>({time:String(r[0]),open:Number(r[1]),close:Number(r[2]),high:Number(r[3]),low:Number(r[4]),volume:Number(r[5])})));
 if(candles.length!==rows.length)throw new Error('日线含无效记录');
 const fields=node?.qt?.[wire],quote=fields?parseQuotes('v_'+wire+'="'+fields.join('~')+'";')[0]:undefined;
 return {candles,quote,provider:adjusted?'腾讯财经前复权日线 / 公开快照':'腾讯财经未复权日线'};
}
export async function patternScreen(symbol:string,params:URLSearchParams){
 const options=parseScreenOptions(params);
 if(symbol.endsWith('.BJ')){const [daily,book]=await Promise.all([memo('screen:bj:'+symbol,300,()=>sinaBeijingDaily(symbol,500)),memo('screen:quote:'+symbol,5,()=>quotes([symbol]))]);const quote=book.items.find(q=>q.symbol===symbol);if(!quote)throw new Error('北交所快照暂不可用');const result=evaluateScreen({bars:daily.candles,raw:daily.candles,quote,provider:'新浪北交所未复权日线 / 腾讯快照',volumeUnit:'股',options});if(result.candidate)result.candidate.risks.push('北交所未复权历史，除权除息可能影响形态，请复核');return {available:true,...result};}

 const adjusted=await memo('screen:adjusted:'+symbol,60,()=>daily(symbol,true));
 if(!adjusted.quote)throw new Error('形态筛选缺少可核验快照');
 if(adjusted.quote.amount===null||adjusted.quote.amount<2e8)return {available:true,candidate:null,reason:'成交额不足2亿元'};
 if(options.maxMarketCap!==null&&(adjusted.quote.marketCap===null||adjusted.quote.marketCap>options.maxMarketCap))return {available:true,candidate:null,reason:'超过市值上限或市值待核验'};
 const raw=await memo('screen:raw:'+symbol,300,()=>daily(symbol,false));
 return {available:true,...evaluateScreen({bars:adjusted.candles,raw:raw.candles,quote:adjusted.quote,provider:adjusted.provider,volumeUnit:/^68[89]/.test(symbol)?'股':'手',options})};
}
