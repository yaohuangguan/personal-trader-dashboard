import {memo,history,quotes,intraday} from './desk-data';
import {dailyTrend} from '../shared/daily-trend';
import {marketContext} from '../shared/market-context';
export async function watchInsight(symbol:string){
 const [daily,feed,minutes]=await Promise.all([memo('history'+symbol+'day',600,()=>history(symbol,'day')),memo('watch-quotes:'+symbol,20,()=>quotes([symbol,'000300.SH'])),memo('intraday'+symbol,30,()=>intraday(symbol)).catch(()=>undefined)]);
 const q=feed.items.find(q=>q.symbol===symbol),benchmark=feed.items.find(q=>q.symbol==='000300.SH');
 const trend=dailyTrend(daily.candles,{symbol,quote:q,benchmark,intraday:minutes,volumeUnit:daily.volumeUnit as '股'|'手',source:daily.source});
 let bars=daily.candles;
 if(q&&trend.asOf===q.asOf&&q.open!=null&&q.high!=null&&q.low!=null&&q.volume!=null){
  const day=q.asOf.slice(0,10);bars=[...bars.filter(b=>b.time<day),{time:day,open:q.open,high:q.high,low:q.low,close:q.price,volume:q.volume*(q.volumeUnit==='手'?100:1)/(daily.volumeUnit==='手'?100:1)}];
 }
 return {available:true,symbol,trend:{score:trend.score,label:trend.label,date:trend.date,asOf:trend.asOf,provisional:trend.provisional,current:trend.current,coveredWeight:trend.coveredWeight},operation:trend.operation,...marketContext(bars,trend.provisional)};
}
