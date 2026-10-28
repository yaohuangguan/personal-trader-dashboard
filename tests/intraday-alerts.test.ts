import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chartStudy} from '../src/shared/chart-study';
import {analyzeStrategy} from '../src/shared/strategy';
import type {Candle} from '../src/shared/types';
function trend():Candle[]{return Array.from({length:100},(_,i)=>{const close=i<90?10+i*.09:18.1+(i-90)*.5;return {time:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:close-.05,close,high:close+.15,low:close-.15,volume:10000};});}
function append(bars:Candle[],v:Omit<Candle,'time'>){bars.push({...v,time:new Date(Date.UTC(2026,0,bars.length+1)).toISOString().slice(0,10)});return bars;}
test('intraday volume stall/rejection is a revocable sell warning, independent of a simulated holding',()=>{
 const b=trend(),p=b.at(-1)!;append(b,{open:p.close+.1,close:p.close,high:p.close+1,low:p.close-.2,volume:25000});
 const now=new Date(b.at(-1)!.time+'T03:00:00Z'),study=chartStudy(b,{now,amount:3e8});
 assert.ok(study.patternMarks.some(m=>m.time===b.at(-1)!.time&&m.kind==='vp-stall'&&m.provisional));
 const alert=study.tradeMarkers.find(m=>m.time===b.at(-1)!.time&&m.side==='sell');assert.equal(alert?.label,'卖预警');assert.equal(alert?.confirmed,false);assert.equal(alert?.provisional,true);assert.match(alert!.reason,/量大滞涨|放量冲高回落/);
 assert.ok(study.strategy!.signals.every(m=>m.time!==b.at(-1)!.time));
 const repaired=b.map((v,i)=>i===b.length-1?{...v,close:p.close+.9,high:p.close+1,low:p.close-.2}:v),next=chartStudy(repaired,{now,amount:3e8});assert.ok(next.tradeMarkers.every(m=>m.time!==b.at(-1)!.time||m.side!=='sell'));
 assert.deepEqual(next.tradeMarkers.filter(m=>m.time<b.at(-1)!.time),study.tradeMarkers.filter(m=>m.time<b.at(-1)!.time));
});
test('dark cloud warning appears during the session and is confirmed only after the close',()=>{
 const b=trend();append(b,{open:22.5,close:24,high:24.1,low:22.4,volume:20000});append(b,{open:24.3,close:23,high:24.4,low:22.8,volume:25000});
 const day=b.at(-1)!.time,live=chartStudy(b,{now:new Date(day+'T03:00:00Z')}),close=chartStudy(b,{now:new Date(day+'T08:00:00Z')});
 assert.ok(live.patternMarks.some(m=>m.time===day&&m.kind==='dark-cloud'&&m.provisional));assert.ok(close.patternMarks.some(m=>m.time===day&&m.kind==='dark-cloud'&&!m.provisional));
 assert.equal(live.patternMarks.find(m=>m.time===day&&m.kind==='dark-cloud')?.direction,'bearish');
 assert.ok(live.tradeMarkers.some(m=>m.time===day&&m.label==='卖预警'&&m.confirmed===false));
 assert.ok(close.tradeMarkers.some(m=>m.time===day&&m.label==='减仓观察'&&m.confirmed===false));
});
test('an intraday pattern trigger can be observed without inventing a confirmed trade',()=>{
 const b=Array.from({length:90},(_,i)=>({time:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:10,close:10,high:10.2,low:9.8,volume:10000}));append(b,{open:9.9,close:10.6,high:10.61,low:9.8,volume:30000});
 const s=analyzeStrategy(b,{now:new Date(b.at(-1)!.time+'T03:00:00Z'),amount:3e8});assert.ok(s.alerts.some(m=>m.label==='买预警'));assert.ok(s.signals.every(m=>m.time!==b.at(-1)!.time));
});
