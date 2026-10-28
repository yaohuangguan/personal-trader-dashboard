import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indicatorMarks} from '../src/shared/indicator-marks';
import {chartStudy} from '../src/shared/chart-study';
import type {Candle} from '../src/shared/types';
const now=new Date('2027-01-01T08:00:00Z');
function waves(reverse=false):Candle[]{return Array.from({length:260},(_,i)=>{const v=30+i*.035+Math.sin(i/5)*(1+3*Math.exp(-i/45)),close=reverse?70-v:v;return {time:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:close-.05,high:close+.2,low:close-.2,close,volume:10000};});}
test('MACD and KDJ crosses live in their own panes and do not turn into buy arrows',()=>{
 const bars=waves(),marks=indicatorMarks(bars,now);for(const pane of ['MACD','KDJ'])for(const kind of ['golden','death'])assert.ok(marks.some(m=>m.pane===pane&&m.kind===kind));
 const study=chartStudy(bars,{now,unit:'week'});assert.equal(study.tradeMarkers.length,0);assert.ok(study.indicatorMarks.length>10);
});
test('divergence waits for right-side swing confirmation and cannot rewrite an earlier prefix',()=>{
 const groups=[indicatorMarks(waves(),now),indicatorMarks(waves(true),now)];
 assert.ok(groups[0].some(m=>m.kind==='top-divergence'));assert.ok(groups[1].some(m=>m.kind==='bottom-divergence'));
 for(const reverse of [false,true]){const bars=waves(reverse),all=indicatorMarks(bars,now);for(const mark of all.filter(m=>m.kind.includes('divergence'))){const i=bars.findIndex(b=>b.time===mark.time),anchor=bars.findIndex(b=>b.time===mark.anchorTime);assert.equal(i-anchor,2);assert.ok(indicatorMarks(bars.slice(0,i),now).every(m=>m.time!==mark.time));assert.deepEqual(all.filter(m=>m.time<mark.time),indicatorMarks(bars.slice(0,i),now));}}
});
test('volume baseline is the previous twenty bars; unfinished bars cannot be labelled full-day contraction',()=>{
 const b=waves().slice(0,50);b[49].volume=15000;let m=indicatorMarks(b,now).filter(m=>m.pane==='VOL');assert.equal(m.at(-1)?.label,'放量回落');assert.match(m.at(-1)!.detail,/1.50倍/);
 b[49].volume=1000;m=indicatorMarks(b,new Date(b[49].time+'T02:00:00Z')).filter(m=>m.pane==='VOL');assert.ok(m.every(m=>m.time!==b[49].time));
});
