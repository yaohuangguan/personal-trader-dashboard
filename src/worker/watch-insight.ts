import {analyzeStrategy,STRATEGY_VERSION} from '../shared/strategy';
import {memo,history,quotes,intraday} from './desk-data';
import {dailyTrend} from '../shared/daily-trend';
import {marketContext} from '../shared/market-context';
import {isUSStock} from '../shared/market-clock';
import {usHistory} from './us-market';
import type {Candle} from '../shared/types';
import {createHash} from 'node:crypto';
export async function watchInsight(symbol:string){
 const us=isUSStock(symbol),benchmarkSymbol=us?'SPY':'000300.SH';
 const [daily,feed,minutes]=await Promise.all([memo<{candles:Candle[];volumeUnit:string;source:string}>('history'+symbol+'day',600,()=>us?usHistory(symbol,'day'):history(symbol,'day')),memo('watch-quotes:'+symbol,3,()=>quotes([...new Set([symbol,benchmarkSymbol])])),us?undefined:memo('intraday'+symbol,10,()=>intraday(symbol)).catch(()=>undefined)]);
 const q=feed.items.find(q=>q.symbol===symbol),benchmark=feed.items.find(q=>q.symbol===benchmarkSymbol);
 // Reuse unchanged verified inputs; the clock bucket prevents crossing a session boundary.
 const identity='watch-plan-v3:'+STRATEGY_VERSION+':'+createHash('sha256').update(JSON.stringify([symbol,daily.candles,q,benchmark,minutes,Math.floor(Date.now()/20000)])).digest('hex');
 return memo(identity,20,async()=>{
 const trend=dailyTrend(daily.candles,{symbol,quote:q,benchmark,intraday:minutes,volumeUnit:daily.volumeUnit as '股'|'手',source:daily.source});
 let bars=daily.candles;
 if(q&&trend.asOf===q.asOf&&q.open!=null&&q.high!=null&&q.low!=null&&q.volume!=null){
  const day=q.asOf.slice(0,10);bars=[...bars.filter(b=>b.time<day),{time:day,open:q.open,high:q.high,low:q.low,close:q.price,volume:q.volume*(q.volumeUnit==='手'?100:1)/(daily.volumeUnit==='手'?100:1)}];
 }
 const plan=trend.operation??analyzeStrategy(bars,{symbol,amount:q?.amount}).plan;
 const generatedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+20000).toISOString();
 return {available:true,symbol,generatedAt,expiresAt,quoteStale:!q||q.stale,trend:{score:trend.score,label:trend.label,date:trend.date,asOf:trend.asOf,provisional:trend.provisional,current:trend.current,coveredWeight:trend.coveredWeight},operation:{action:plan.action,label:plan.label,phase:plan.phase,ready:plan.metrics!==null,score:plan.score,scoreKind:'entry-timing',scope:'量价初判，综合联动在个股详情核验',asOf:plan.asOf,provisional:plan.provisional,reasons:plan.reasons},...marketContext(bars,trend.provisional)};
 });
}
