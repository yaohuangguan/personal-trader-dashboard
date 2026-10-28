import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chartStudy} from '../src/shared/chart-study';
import {consolidationMarks,visiblePatternRanges} from '../src/shared/consolidation';
import {FIBONACCI_MA} from '../src/shared/ma-system';
import {compactPatternRanges} from '../src/worker/chart-payload';
import type {Candle} from '../src/shared/types';
const time=(i:number)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),now=new Date('2026-12-01T08:00:00Z');
function setup(){const b=Array.from({length:80},(_,i)=>{const close=i<55?10+.3*Math.sin(i*2):10;return {time:time(i),open:close,close,high:close+.2,low:close-.2,volume:10000};});b[79]={time:time(79),open:10.12,high:10.47,low:10.12,close:10.42,volume:30000};return b;}
const trends=(b:Candle[],at=now,maPeriods?:number[])=>chartStudy(b,{now:at,maPeriods}).patternMarks.filter(p=>p.kind.startsWith('trend-'));
test('trend lifecycle distinguishes a supported pullback from low-volume structural failure and can restart',()=>{
 const b=setup();assert.equal(trends(b).at(-1)?.kind,'trend-start');
 b.push({time:time(80),open:10.4,high:10.45,low:10.25,close:10.3,volume:9000});assert.equal(trends(b).length,1);
 b.push({time:time(81),open:10.3,high:10.35,low:9.5,close:9.6,volume:6000});const ended=trends(b);assert.equal(ended.at(-1)?.kind,'trend-end');assert.match(ended.at(-1)!.detail,/结构防线/);
 for(let i=0;i<8;i++)b.push({time:time(b.length),open:9.65,high:9.8,low:9.5,close:9.65,volume:7000});
 b.push({time:time(b.length),open:9.65,high:10.5,low:9.6,close:10.45,volume:35000});assert.equal(trends(b).at(-1)?.kind,'trend-end','one reclaim while the middle MA still falls is not yet a new trend');
 b.push({time:time(b.length),open:10.45,high:11.1,low:10.4,close:11,volume:35000});assert.equal(trends(b).at(-1)?.kind,'trend-start');
 assert.deepEqual(trends(b).filter(p=>p.time<=time(81)),ended);
});
test('crosses without volume/structure do not launch a trend; intraday starts stay provisional with adaptive MA',()=>{
 const b=setup();b[79].volume=10000;assert.equal(trends(b).length,0);
 const strong=setup(),forming=trends(strong,new Date(time(79)+'T02:00:00Z'),FIBONACCI_MA);
 assert.equal(forming.at(-1)?.kind,'trend-start');assert.equal(forming.at(-1)?.provisional,true);assert.equal(forming.at(-1)?.status,'candidate');
});
test('box boundaries are causal, stable, cover quiet consolidation and remain visible when panning history',()=>{
 const b=Array.from({length:60},(_,i)=>{const close=10+.3*Math.sin(i*Math.PI/3);return {time:time(i),open:close,close,high:close+.15,low:close-.15,volume:10000};});
 const first=consolidationMarks(b.slice(0,35),now);assert.ok(first.some(p=>p.kind==='box-range'));
 b.push({time:time(60),open:10,high:11,low:9.95,close:10.9,volume:30000});
 const full=consolidationMarks(b,now);assert.deepEqual(full.filter(p=>p.time<=time(34)),first);assert.equal(full.at(-1)?.kind,'box-break');
 const visible=visiblePatternRanges(full,b,21,34);assert.equal(visible.length,1);assert.equal(visible[0].range!.to,time(34));assert.equal(visible[0].range!.high,first[0].range!.high);
 const compact=compactPatternRanges(full),transported=visiblePatternRanges(compact,b,21,34);assert.equal(transported.length,1);assert.equal(transported[0].range!.high,visible[0].range!.high);assert.equal(transported[0].knownAt,time(20));assert.equal(visiblePatternRanges(compact,b,0,19).length,0);assert.ok(compact.length<full.length/10);
 const declining=b.slice(0,50).map((r,i)=>({...r,open:10-i*.04,close:10-i*.04,high:10-i*.04+.05,low:10-i*.04-.05}));assert.equal(consolidationMarks(declining,now).length,0);
});
