import {chartStudy} from './chart-study';
import {chartPayload} from '../worker/chart-payload';
import {analyzeGuide} from './guide-analysis';
import {stockCharacter} from './stock-character';
import {guideScore} from './guide-score';
import {guideAction} from './guide-action';
import {marketContext} from './market-context';
import {reviewTrade} from './trade-review';
import {GUIDE_PATTERN_COVERAGE} from './guide-patterns';
import {evaluateStrategyHistory} from './strategy-backtest';
import {screenCandidate} from './screening';
import {patchSession} from './patch-session';
import {projectMarket} from './market-projection';
import type {MarketPayload,Candle} from './types';
type Input={task?:'projection';horizon?:number;candles:Candle[];symbol:string;name?:string;ma:number[];unit?:string;amount?:number|null;now?:string;market?:MarketPayload;quote?:NonNullable<Parameters<typeof reviewTrade>[2]>['quote'];context?:Parameters<typeof reviewTrade>[2]};
/** Bundled with the iOS app: exactly the shared rules, with no network or DOM dependency. */
export function computeJSON(raw:string){
 const input=JSON.parse(raw) as Input;
 if(!Array.isArray(input.candles)||input.candles.length>1500||!Array.isArray(input.ma)||input.ma.some(p=>!Number.isInteger(p)||p<1||p>500))throw Error('无效图表样本');
 const now=input.now?new Date(input.now):new Date();
 if(!Number.isFinite(now.getTime()))throw Error('无效分析时间');
 if(input.task==='projection')return JSON.stringify({projection:projectMarket(input.candles,{horizon:input.horizon,maPeriods:input.ma,now,unit:input.unit,symbol:input.symbol,name:input.name})});
 const reviewQuote=input.context?input.context.quote:input.quote;
 if(input.market&&input.context?.quote){
  const quote=input.context.quote,unit:'股'|'手'=input.market.provider.includes('新浪')||/^68[89]/.test(input.symbol)?'股':'手',updated=patchSession({candles:input.candles,provider:input.market.provider},quote,unit);
  if(updated){input.candles=updated.candles;input.amount=quote.amount;input.market={...input.market,candles:updated.candles,last:quote.price,previous:quote.previous,change:quote.change,changePercent:quote.changePercent,asOf:updated.candles.at(-1)!.time};}
 }
 const study=chartStudy(input.candles,{symbol:input.symbol,name:input.name,maPeriods:input.ma,unit:input.unit,amount:input.amount,now});
 const display=chartPayload(study),strategy=study.strategy;
 let analysis;
 if(input.market&&strategy){
  const guide=analyzeGuide(input.candles,{now}),character=guide.asOf?stockCharacter(input.candles,guide.asOf):null;
  const candidate=screenCandidate({symbol:input.symbol,name:input.market.name,price:input.market.last,changePercent:input.market.changePercent,amount:null,turnover:null},guide,input.market.provider);if(candidate){candidate.character=character;candidate.risks=[...candidate.risks,...(character?.warnings||[])];}
  analysis={available:true,market:input.market,strategy,review:reviewTrade(strategy,input.candles,{...input.context,quote:reviewQuote,now}),guide,character,candidate,resonance:null,strategyHistory:evaluateStrategyHistory(input.candles,strategy.signals,{riskStops:strategy.riskStops}),strength:guideScore(guide,character),action:{...strategy.plan,notice:strategy.method},guideAction:guideAction(guide,character),tradeMarkers:study.tradeMarkers,patternMarks:study.patternMarks,indicatorMarks:study.indicatorMarks,maPeriods:strategy.plan.maPeriods,patternCoverage:GUIDE_PATTERN_COVERAGE,context:marketContext(input.candles,guide.provisional),local:true};
 }
 if(analysis)Object.assign(analysis,{liveAlerts:study.liveAlerts});
 return JSON.stringify({...display,analysis,verification:{symbol:input.symbol,unit:input.unit||'day',maPeriods:[...input.ma].sort((a,b)=>a-b),candleCount:input.candles.length,last:input.candles.at(-1)}});
}
