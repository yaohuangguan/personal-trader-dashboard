import {analyzeGuide,type GuideAnalysis} from './guide-analysis';
import {stockCharacter,type StockCharacter} from './stock-character';
import {guideScore} from './guide-score';
import {sma} from './chart-indicators';
import type {Candle} from './types';
export function guideAction(g:GuideAnalysis,c:StockCharacter|null){
 const strength=guideScore(g,c),score=strength.score;
 let action='观望',reason='形态尚未完成，等待有效启动与后续确认。';
 if(!g.ready||!c){action='观望';reason='日线或股性样本不足，暂停给出买卖判断。';}
 else if(g.stage==='确认失效'||g.event?.state==='failed'){action='卖出';reason='启动确认已失效；持仓应复核退出条件，空仓继续回避。';}
 else if(g.stage==='开花后走弱'){action='卖出';reason='确认后收盘跌回MA20下方，趋势支撑走弱。';}
 else if(g.bias60!==null&&g.bias60>20||g.risks.length>=2){action='减仓';reason='乖离或多项风险触发，已有持仓复核止盈与风险，空仓不追高。';}
 else if(g.provisional){reason='今日K线尚未收盘，盘中满足条件仍可能回落，等待收盘核验。';}
 else if(c.quiet||c.weakFollow){reason=c.quiet?'历史低波动、缺少大阳脉冲，粘合更可能继续震荡。':'历史放量突破延续较弱，等待板块与量能共同验证。';}
 else if(g.event?.state==='confirmed'&&g.event.confirmationDate===g.asOf&&(score??0)>=70){action=(score??0)>=85&&c.active&&c.breakouts>=3&&(c.continuation??0)>=.5&&g.risks.length===0?'强烈买入':'买入';reason='3–5日确认已完成，阳线半位守住、五线多头排列，股性与指标协同达到阈值。';}
 else if(g.event?.state==='confirmed'){action='持有 / 观察';reason='已确认形态仍在跟踪中；持仓观察支撑，空仓等待回踩或下一次有效信号。';}
 else if(g.currentLaunch||g.event?.state==='pending'){reason='已有启动迹象，后续3–5日确认尚未完成，不把待确认信号当成买入点。';}
 const reasons=[reason,...g.rules.filter(r=>r.state==='pass').slice(0,3).map(r=>r.title+'：'+r.value),...(c?.warnings||[]),...g.risks];
 return {action,score,asOf:g.asOf,provisional:g.provisional,reasons,invalidation:g.event?{midpoint:g.event.midpoint,low:g.event.low,ma20:g.ma[20]}:null,notice:'基于公开日线的规则建议，不是保证收益或个性化仓位指令。买入只在收盘确认当日触发；卖出/减仓针对已有持仓，空仓视为回避。'};
}
export type TradeMarker={time:string;side:'buy'|'sell';price:number;label:string;reason:string};
/** Confirmation-day entries and the first subsequent closed-bar support failure. */
export function guideTradeMarkers(input:Candle[],guide:GuideAnalysis):TradeMarker[]{
 const closed=input.filter(c=>guide.asOf!==null&&c.time<=guide.asOf&&(!guide.provisional||c.time<guide.asOf)),ma20=new Map(sma(closed,20).map(p=>[p.time,p.value])),out:TradeMarker[]=[];
 for(const event of guide.events){const date=event.confirmationDate;if(!date)continue;const index=closed.findIndex(c=>c.time===date);if(index<0)continue;
  const prefix=closed.slice(0,index+1),analysis=analyzeGuide(prefix,{now:new Date(date+'T08:01:00Z')}),action=guideAction(analysis,stockCharacter(prefix,date));
  if(!['买入','强烈买入'].includes(action.action))continue;
  out.push({time:date,side:'buy',price:closed[index].close,label:'B '+action.action,reason:action.reasons[0]});
  const exit=closed.slice(index+1).find(c=>c.low<event.midpoint||c.close<(ma20.get(c.time)??0));
  if(exit)out.push({time:exit.time,side:'sell',price:exit.close,label:'S 卖出',reason:exit.low<event.midpoint?'日线失守启动阳线半位':'收盘跌回MA20下方'});
 }
 return [...new Map(out.map(p=>[p.time+p.side,p])).values()].sort((a,b)=>a.time.localeCompare(b.time));
}
