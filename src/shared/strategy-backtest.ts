import type {Candle} from './types';
import type {StrategySignal} from './strategy';
export function evaluateStrategyHistory(bars:Candle[],signals:StrategySignal[],options:{costBps?:number;startIndex?:number;maxHolding?:number;riskStops?:{time:string;price:number}[]}={}){
 const costBps=options.costBps??15,cost=costBps/10000,start=options.startIndex??Math.max(65,Math.floor(bars.length*.7)),maxHolding=options.maxHolding??20;
 const stops=new Map((options.riskStops||[]).map(s=>[s.time,s.price]));
 const buys=new Map(signals.filter(s=>s.side==='buy').map(s=>[s.time,s])),sells=new Set(signals.filter(s=>s.side==='sell').map(s=>s.time));
 let cash=1,peak=1,drawdown=0,pending:StrategySignal|null=null,pendingExit=false,skipped=0,position:{entry:number;time:string;index:number;stop:number;target:number;units:number;capital:number}|null=null;
 const trades:{entryDate:string;exitDate:string;entry:number;exit:number;returnPct:number;reason:string;holdingBars:number}[]=[];
 for(let i=start;i<bars.length;i++){
  const c=bars[i],tradable=c.high-c.low>.000001&&c.volume>0;
  if(position){
   position.stop=Math.max(position.stop,stops.get(c.time)||0);
   // A close signal enters next open; A-share T+1 forbids an exit on that entry day.
   let exit:number|null=null,reason='';
   if(i>position.index&&tradable){if(pendingExit){exit=c.open;reason='前序结构退出信号，下一可交易开盘';}else if(c.low<=position.stop){exit=Math.min(c.open,position.stop);reason='结构止损（跳空按较差开盘价）';}else if(c.high>=position.target){exit=position.target;reason='2R计划止盈';}else if(i-position.index>=maxHolding){exit=c.close;reason='观察窗口结束';}}
   if(exit!==null){cash=position.units*exit*(1-cost);trades.push({entryDate:position.time,exitDate:c.time,entry:position.entry,exit,returnPct:(cash/position.capital-1)*100,reason,holdingBars:i-position.index});position=null;pendingExit=false;}
   else if(sells.has(c.time)||c.low<=position.stop)pendingExit=true;
  }
  if(!position&&pending){const zone=pending.entryZone;
   if(tradable&&zone&&c.open>=zone[0]&&c.open<=zone[1]&&pending.stop!=null&&c.open>pending.stop){const risk=c.open-pending.stop;position={entry:c.open,time:c.time,index:i,stop:pending.stop,target:c.open+2*risk,units:cash*(1-cost)/c.open,capital:cash};pendingExit=c.low<=position.stop||sells.has(c.time);}
   else skipped++;pending=null;
  }
  if(!position){const signal=buys.get(c.time);if(signal)pending=signal;}
  const equity=position?position.units*c.close:cash;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,1-equity/peak);
 }
 const equity=position?position.units*bars.at(-1)!.close:cash,wins=trades.filter(t=>t.returnPct>0).length;
 return {from:bars[start]?.time||null,to:bars.at(-1)?.time||null,trades:trades.slice(-50),completed:trades.length,wins,winRate:trades.length>=20?wins/trades.length:null,averageReturn:trades.length?trades.reduce((n,t)=>n+t.returnPct,0)/trades.length:null,sequenceReturn:(equity-1)*100,maxDrawdown:drawdown*100,skippedEntries:skipped,openPosition:!!position,costBps,sufficient:trades.length>=20,notice:`固定参数的后30%时间窗口历史模拟；收盘信号后下一开盘且仍在入场区间才成交，T+1、单边综合成本${costBps}bp、跳空止损按较差开盘价，一字K保守跳过；未模拟排队、停牌延长和真实下单。胜率少于20笔不显示，非样本外实盘业绩。`};
}
