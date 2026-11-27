import {useEffect,useMemo,useRef,useState} from 'react';
import {chartStudy} from '../../shared/chart-study';
import {bollinger,chartIndicators,parabolicSar,rsi,type MAPreference} from '../../shared/chart-indicators';
import type {TradeMarker} from '../../shared/guide-action';
import type {GuideEvent} from '../../shared/guide-analysis';
import type {Candle} from '../../shared/types';

type Study=ReturnType<typeof chartStudy>;
type Indicators=ReturnType<typeof chartIndicators>;
type Extra={boll:ReturnType<typeof bollinger>;rsi:ReturnType<typeof rsi>;sar:ReturnType<typeof parabolicSar>};
export type ChartDataSnapshot={candles:Candle[];futureCandles:Candle[];indicators:Indicators;projectedIndicators:Indicators;extra:Extra;projectedExtra:Extra;study:Study;tradeMarkers:TradeMarker[];guideEvents?:GuideEvent[];markers:boolean;shapesVisible:boolean;crossMarkers:boolean;indicatorLabels:boolean;period:string;projectionPoints:number};

const EMPTY_STUDY={trendRegimes:[],patternMarks:[],liveAlerts:[],indicatorMarks:[],tradeMarkers:[],strategy:null,method:''} as unknown as Study;
const extraOf=(bars:Candle[]):Extra=>({boll:bollinger(bars),rsi:rsi(bars),sar:parabolicSar(bars)});

/** Same bars except the forming last one: an intraday tick, not a new bar or a history page. */
export function sameShape(a:Candle[],b:Candle[]){return a.length===b.length&&a[0]?.time===b[0]?.time&&a.at(-1)?.time===b.at(-1)?.time;}

/**
 * The full chart study (strategy, pattern review, ~60ms) follows new bars and history pages immediately,
 * but only every `ms` for ticks of the forming bar; candles and indicators themselves stay live.
 */
export function useThrottledBars(bars:Candle[],ms:number){
 const [value,setValue]=useState(bars),last=useRef(0);
 const immediate=!sameShape(value,bars);
 useEffect(()=>{
  if(bars===value)return;
  if(immediate){last.current=Date.now();setValue(bars);return;}
  const wait=Math.max(0,last.current+ms-Date.now()),timer=setTimeout(()=>{last.current=Date.now();setValue(bars);},wait);
  return()=>clearTimeout(timer);
 },[bars,value,immediate,ms]);
 return immediate?bars:value;
}

export function useChartData({candles,futureCandles,preferences,symbol,unit,amount,amountDate,providedTrades,compact}:{candles:Candle[];futureCandles:Candle[];preferences:MAPreference[];symbol?:string;unit:string;amount?:number|null;amountDate?:string;providedTrades:TradeMarker[];compact:boolean}){
 const indicators=useMemo(()=>chartIndicators(candles,preferences),[candles,preferences]);
 const projectedIndicators=useMemo(()=>futureCandles.length?chartIndicators([...candles,...futureCandles],preferences):indicators,[candles,futureCandles,preferences,indicators]);
 const extra=useMemo(()=>extraOf(candles),[candles]);
 const projectedExtra=useMemo(()=>futureCandles.length?extraOf([...candles,...futureCandles]):extra,[candles,futureCandles,extra]);
 const studyBars=useThrottledBars(candles,15000);
 const maPeriods=preferences.filter(p=>p.enabled).map(p=>p.period).join(',');
 // The day's turnover moves on every quote; sample it together with the throttled bars.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const studyAmount=useMemo(()=>amount,[studyBars,amountDate]);
 const study=useMemo(()=>compact?EMPTY_STUDY:chartStudy(studyBars,{symbol,unit,amount:amountDate===studyBars.at(-1)?.time?studyAmount??null:null,maPeriods:maPeriods.split(',').filter(Boolean).map(Number)}),[compact,studyBars,symbol,unit,maPeriods,studyAmount,amountDate]);
 const tradeMarkers=unit==='day'?study.tradeMarkers:providedTrades;
 return {indicators,projectedIndicators,extra,projectedExtra,study,tradeMarkers};
}

/** Long averages far from price must not shrink the candles: they leave autoscale once their period exceeds 2x the visible bars. */
export const excludedFromAutoscale=(period:number,visibleBars:number)=>period>Math.max(20,visibleBars*2);
