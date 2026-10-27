import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeStrategy,type StrategySignal} from '../src/shared/strategy';
import {evaluateStrategyHistory} from '../src/shared/strategy-backtest';
import type {Candle} from '../src/shared/types';
const now=new Date('2026-04-01T08:00:00Z');
const bars=(n=100):Candle[]=>Array.from({length:n},(_,i)=>({time:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:10,high:10.2,low:9.8,close:10,volume:10000}));
const buy=(time:string):StrategySignal=>({time,side:'buy',price:10,label:'买',reason:'fixture',kind:'breakout',confirmed:true,stop:9,entryZone:[9.5,10.5]});
test('invalid or absent history cannot become an actionable strategy',()=>{
 assert.equal(analyzeStrategy([],{now}).plan.action,'观望');
 const b=bars();b[99].high=8;assert.equal(analyzeStrategy(b,{now}).signals.length,0);
});
test('a moving average cross alone is not a buy',()=>{
 const b=bars(80);b[79]={...b[79],open:9.99,close:10.1};
 const r=analyzeStrategy(b,{now});assert.equal(r.signals.length,0);assert.equal(r.plan.action,'观望');
});
test('forming breakout is only a warning and produces no confirmed arrow',()=>{
 const b=bars(80);b[79]={...b[79],open:9.9,high:10.6,low:9.8,close:10.55,volume:30000};
 const r=analyzeStrategy(b,{now:new Date(b[79].time+'T02:00:00Z')});
 assert.equal(r.plan.provisional,true);assert.equal(r.plan.action,'盘中预警');assert.equal(r.signals.filter(s=>s.time===b[79].time).length,0);
});
test('appending later candles does not repaint earlier confirmed signals',()=>{
 const b=bars(90);for(let i=0;i<55;i++){const close=10+.3*Math.sin(i*2);b[i]={...b[i],open:close,close,high:close+.2,low:close-.2};}b[79]={...b[79],open:10.12,high:10.47,low:10.12,close:10.42,volume:30000};
 const a=analyzeStrategy(b.slice(0,80),{now}),c=analyzeStrategy(b,{now});
 assert.ok(a.signals.some(s=>s.side==='buy'),'fixture must produce an actual confirmed buy');
 assert.deepEqual(c.signals.filter(s=>s.time<=b[79].time),a.signals);
});
test('a close signal never fills on the signal candle and a gap outside the zone cancels',()=>{
 const b=bars(6);b[1]={...b[1],open:12,high:12.5,low:11.5,close:12};
 const r=evaluateStrategyHistory(b,[buy(b[0].time)],{startIndex:0});
 assert.equal(r.completed,0);assert.equal(r.openPosition,false);assert.equal(r.skippedEntries,1);
});
test('T+1 defers an entry-day stop to the next tradable open, including a one-price lock',()=>{
 const b=bars(6);b[1]={...b[1],low:8.5};b[2]={...b[2],open:8,high:8,low:8,close:8};b[3]={...b[3],open:8,high:8.4,low:7.9,close:8.2};
 const r=evaluateStrategyHistory(b,[buy(b[0].time)],{startIndex:0});
 assert.equal(r.completed,1);assert.equal(r.trades[0].entryDate,b[1].time);assert.equal(r.trades[0].exitDate,b[3].time);assert.equal(r.trades[0].exit,8);assert.ok(r.trades[0].returnPct < -20);assert.equal(r.winRate,null);
});
test('when both stop and target are inside the same bar, conservative stop wins',()=>{
 const b=bars(5);b[2]={...b[2],open:10,low:8,high:13,close:11};
 const r=evaluateStrategyHistory(b,[buy(b[0].time)],{startIndex:0});
 assert.equal(r.trades[0].exit,9);assert.ok(r.trades[0].returnPct < -10);assert.ok(r.maxDrawdown>=10);
});

test('a stop raised before the current candle is executed at that stop, not a later close',()=>{
 const b=bars(5);b[2]={...b[2],open:10.5,high:11,low:10.2,close:10.6};
 const r=evaluateStrategyHistory(b,[buy(b[0].time)],{startIndex:0,riskStops:[{time:b[2].time,price:10.3}]});
 assert.equal(r.completed,1);assert.equal(r.trades[0].exit,10.3);
});
