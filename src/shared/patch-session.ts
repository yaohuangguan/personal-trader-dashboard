import type {Candle} from './types';
import type {Snapshot} from './desk-types';
/** Update/append actual quote OHLCV only when its previous-close adjustment base is verified. */
export function patchSession<T extends {candles:Candle[];provider:string}>(data:T,q:Snapshot,unit:'手'|'股'):T|null{
 const last=data.candles.at(-1),day=q.asOf.slice(0,10);
 if(!last||q.stale||q.previous===null||[q.price,q.open,q.high,q.low,q.volume].some(v=>v===null||!Number.isFinite(v))||!(q.price>0&&q.low!>0&&q.high!>=Math.max(q.open!,q.price)&&q.low!<=Math.min(q.open!,q.price)))return null;
 const same=last.time===day,previous=same?data.candles.at(-2):last;
 const gap=(Date.parse(day)-Date.parse(last.time))/86400000;
 if(!previous||(!same&&(!(gap>0)||gap>7))||Math.abs(previous.close-q.previous)>Math.max(.005,q.previous*.0005))return null;
 const volume=q.volume!*(q.volumeUnit==='手'?100:1)/(unit==='手'?100:1);
 if(volume<0||same&&volume+Math.max(1,last.volume*.001)<last.volume)return null;
 const bar={time:day,open:q.open!,high:q.high!,low:q.low!,close:q.price,volume};
 const candles=same?[...data.candles.slice(0,-1),bar]:[...data.candles,bar].slice(-Math.max(500,data.candles.length));
 return {...data,candles};
}
