import type {MarketPayload} from '../shared/types';
import {analyzeStrategy} from '../shared/strategy';
import {reviewTrade} from '../shared/trade-review';
import {beijingParts} from '../shared/monitor';
import {quotes,memo,fundFlow,sectors} from './desk-data';
import {marketPools} from './market-overview';
import {patchSession} from './research-screen';

/** One stock review, not a second full-market scanner. Each optional source has a cancellable budget. */
export async function loadTradeReview(symbol:string,original:MarketPayload,maPeriods?:number[]){
 const now=new Date(),date=beijingParts(now).date;
 const [book,flow,boards,pools]=await Promise.allSettled([
  memo('review-quotes:'+symbol,10,()=>quotes([symbol,'000001.SH','000300.SH','399006.SZ'],AbortSignal.timeout(5000))),
  memo('flow'+symbol,45,()=>fundFlow(symbol,AbortSignal.timeout(5000))),
  memo('sectors'+symbol,90,()=>sectors(symbol,AbortSignal.timeout(4500))),
  memo('market-pools'+date,90,()=>marketPools(date,AbortSignal.timeout(4500))),
 ]);
 const quote=book.status==='fulfilled'?book.value.items.find(q=>q.symbol===symbol):undefined;
 const unit: '股'|'手'=original.provider.includes('新浪')||/^68[89]/.test(symbol)?'股':'手';
 const updated=quote?patchSession({candles:original.candles,provider:original.provider},quote,unit):null;
 const market:MarketPayload=updated&&quote?{...original,candles:updated.candles,last:quote.price,previous:quote.previous,change:quote.change,changePercent:quote.changePercent,asOf:quote.asOf.slice(0,10),name:quote.name,notice:original.notice+'；当日OHLCV与腾讯快照核对前收基准后更新。'}:original;
 const strategy=analyzeStrategy(market.candles,{symbol,name:market.name,amount:quote?.amount,now,maPeriods});
 const review=reviewTrade(strategy,market.candles,{now,quote,benchmarks:book.status==='fulfilled'?book.value.items.filter(q=>q.symbol!==symbol):[],flow:flow.status==='fulfilled'?flow.value:undefined,sectors:boards.status==='fulfilled'?boards.value:undefined,pools:pools.status==='fulfilled'?pools.value:undefined});
 return {market,strategy,review};
}
