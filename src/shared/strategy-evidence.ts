import type {PatternMark} from './pattern-marks';
import type {IndicatorMark} from './indicator-marks';
// Request-local evidence reuse. Weak keys never retain old candles or enter JSON.
const evidence=new WeakMap<object,{patterns:PatternMark[];indicators:IndicatorMark[];trends:PatternMark[];key:string}>();
type Options={symbol?:string;name?:string;maPeriods?:number[]};
const key=(options:Options,now:Date)=>{const cn=new Date(now.getTime()+28800000);return JSON.stringify([options.symbol,options.name,options.maPeriods,cn.toISOString().slice(0,10),cn.getUTCHours()<15]);};
export const strategyEvidence=(strategy:object)=>evidence.get(strategy);
export const reusablePatterns=(strategy:object,options:Options,now:Date)=>{const saved=evidence.get(strategy);return saved?.key===key(options,now)?saved.patterns:undefined;};
export function withStrategyEvidence<T extends object>(strategy:T,patterns:PatternMark[],indicators:IndicatorMark[],options:Options,now:Date,trends:PatternMark[]=[]):T{evidence.set(strategy,{patterns,indicators,trends,key:key(options,now)});return strategy;}
