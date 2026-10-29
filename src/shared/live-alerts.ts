import type {PatternMark} from './pattern-marks';
import type {TradeMarker} from './guide-action';
export type LiveAlert={id:string;time:string;kind:string;title:string;detail:string;direction:'bullish'|'bearish'|'neutral';provisional:true};
/** Live, revocable observations belong above the chart, never on its last candle. */
export function splitLiveAlerts<T extends TradeMarker>(patterns:PatternMark[],trades:T[]){
 const alerts:LiveAlert[]=[],seen=new Set<string>();
 for(const p of [...patterns.filter(m=>m.provisional).sort((a,b)=>b.priority-a.priority)]){
  const id=p.kind+':'+p.time;if(seen.has(id))continue;seen.add(id);
  alerts.push({id,time:p.time,kind:p.kind,title:p.label,detail:p.detail,direction:p.direction||'neutral',provisional:true});
 }
 for(const t of trades.filter(m=>m.provisional)){
  const id='timing:'+t.side+':'+t.time;if(seen.has(id))continue;seen.add(id);
  alerts.unshift({id,time:t.time,kind:'timing-'+t.side,title:t.label,detail:t.reason,direction:t.side==='buy'?'bullish':'bearish',provisional:true});
 }
 return {patternMarks:patterns.filter(m=>!m.provisional),tradeMarkers:trades.filter(m=>!m.provisional),liveAlerts:alerts};
}
