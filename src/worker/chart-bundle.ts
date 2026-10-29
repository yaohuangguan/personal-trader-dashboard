import type {MarketPayload} from '../shared/types';
import {chartStudy} from '../shared/chart-study';
import {chartPayload} from './chart-payload';
import {patchSession} from './research-screen';
import type {Snapshot} from '../shared/desk-types';

/** First paint has one consistent price/study snapshot; optional review sources are not prerequisites. */
export async function loadChartFrame(symbol:string,loadMarket:()=>Promise<MarketPayload>,loadQuote:()=>Promise<Snapshot|undefined>,now=new Date()){
 const [original,quote]=await Promise.all([loadMarket(),loadQuote().catch(()=>undefined)]);
 const unit:'股'|'手'=original.provider.includes('新浪')||/^68[89]/.test(symbol)?'股':'手';
 const patched=quote?patchSession({candles:original.candles,provider:original.provider},quote,unit):null;
 const market:MarketPayload=patched&&quote?{...original,candles:patched.candles,last:quote.price,previous:quote.previous,change:quote.change,changePercent:quote.changePercent,asOf:quote.asOf.slice(0,10),name:quote.name}:original;
 // Reject a conflicting quote as a pair, rather than letting the client patch the verified chart again.
 const verifiedQuote=patched?quote:undefined;
 return {market,quote:verifiedQuote??null,volumeUnit:unit,asOf:now.toISOString(),quoteVerified:!!verifiedQuote};
}
export async function loadChartBundle(symbol:string,maPeriods:number[],loadMarket:()=>Promise<MarketPayload>,loadQuote:()=>Promise<Snapshot|undefined>,now=new Date()){
 const frame=await loadChartFrame(symbol,loadMarket,loadQuote,now),{market,quote}=frame;
 const study=chartStudy(market.candles,{symbol,name:market.name,maPeriods,now,amount:quote?.amount});
 return {...frame,study:{...chartPayload(study),verification:{symbol,unit:'day',maPeriods,candleCount:market.candles.length,last:market.candles.at(-1)}}};
}
