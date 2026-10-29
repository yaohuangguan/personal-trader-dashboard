import type {Candle} from './types';
import {analyzeStrategy} from './strategy';
import {reviewedPatternMarks} from './pattern-marks';
import {guidePatternMarks} from './guide-patterns';
import {indicatorMarks} from './indicator-marks';
import {strategyEvidence} from './strategy-evidence';
import {splitLiveAlerts} from './live-alerts';
export function chartStudy(bars:Candle[],options:{now?:Date;maPeriods?:number[];symbol?:string;name?:string;unit?:string;amount?:number|null}={}){
 const now=options.now||new Date(),unit=options.unit||'day',strategy=unit==='day'?analyzeStrategy(bars,options):null;
 const presentation=splitLiveAlerts(strategy?reviewedPatternMarks(bars,strategy,now,options):unit==='week'||unit==='month'?guidePatternMarks(bars,now,unit,options.maPeriods):[],strategy?[...strategy.signals,...strategy.alerts].sort((a,b)=>a.time.localeCompare(b.time)):[]);
 return {trendRegimes:strategy&&strategyEvidence(strategy)?.regimes||[],...presentation,indicatorMarks:strategy&&strategyEvidence(strategy)?.indicators||indicatorMarks(bars,now),strategy,method:'使用当前图表MA与同一组OHLCV；盘中可撤销预警展示在行情摘要，不覆盖K线。形态是证据，买卖点另需承接、位置、风险和股性确认。历史不含当时未保存的板块资金情绪。'};
}
