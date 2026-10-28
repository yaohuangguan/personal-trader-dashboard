import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTrendRegimes} from '../src/shared/trend-regime';
import {consolidationMarks,visiblePatternRanges} from '../src/shared/consolidation';
import {FIBONACCI_MA} from '../src/shared/ma-system';
import {compactPatternRanges} from '../src/worker/chart-payload';
import type {Candle} from '../src/shared/types';
const time=(i:number)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),now=new Date('2026-12-01T08:00:00Z');
function series(n:number,fn:(i:number)=>number):Candle[]{return Array.from({length:n},(_,i)=>{const close=fn(i),open=fn(Math.max(0,i-1));return {time:time(i),open,close,high:Math.max(open,close)+.15,low:Math.min(open,close)-.15,volume:10000};});}
test('both directions are recognized on separate horizons, including quiet-volume declines; a flat box is not a trend',()=>{
 for(const direction of [1,-1]){const b=series(150,i=>30+direction*i*.1);if(direction<0)for(let i=90;i<b.length;i++)b[i].volume=4000;const r=analyzeTrendRegimes(b,{now});assert.equal(r.regimes.length,2);assert.ok(r.regimes.every(s=>s.direction===(direction===1?'up':'down')));assert.ok(r.marks.some(m=>m.trendScale==='short'&&m.regime===(direction===1?'up':'down')));assert.ok(r.marks.every(m=>m.direction===(direction===1?'bullish':'bearish')));}
 const flat=analyzeTrendRegimes(series(140,i=>10+.15*Math.sin(i*Math.PI/3)),{now});assert.ok(flat.regimes.every(r=>r.direction==='range'));assert.equal(flat.marks.filter(m=>m.kind==='trend-start').length,0);
});
test('an impulse is evidence, not immediate trend confirmation, and short bounce may coexist with a down swing',()=>{
 const b=series(90,i=>20-i*.08);for(let k=0;k<6;k++){const p=b.at(-1)!.close;b.push({time:time(b.length),open:p,high:p+.7,low:p-.05,close:p+.6,volume:18000});if(k===0)assert.ok(analyzeTrendRegimes(b,{now}).regimes.every(r=>r.direction!=='up'));}
 const r=analyzeTrendRegimes(b,{now});assert.equal(r.regimes.find(s=>s.scale==='short')!.direction,'up');assert.notEqual(r.regimes.find(s=>s.scale==='swing')!.direction,'up');
});
test('a confirmation candle itself must support its direction, not a high-open selloff or a low-open reversal',()=>{
 for(const sign of [1,-1]){const b=series(110,i=>i<80?20+(i%2)*.1:20+sign*(i-80)*.16),r=analyzeTrendRegimes(b,{now}),first=r.marks.find(m=>m.kind==='trend-start'&&m.regime===(sign===1?'up':'down'))!;assert.ok(first);const index=b.findIndex(c=>c.time===first.time),changed=b.slice(0,index+1).map(c=>({...c})),bar=changed.at(-1)!;bar.open=bar.close+sign*.3;bar.high=Math.max(bar.open,bar.close)+.1;bar.low=Math.min(bar.open,bar.close)-.1;assert.ok(!analyzeTrendRegimes(changed,{now}).marks.some(m=>m.time===bar.time&&m.kind==='trend-start'&&m.regime===first.regime));}
});
test('supported pullback preserves the swing; sustained structure reversal can establish a down trend',()=>{
 const b=series(120,i=>20+i*.1),before=analyzeTrendRegimes(b,{now});assert.equal(before.regimes[1].direction,'up');
 const p=b.at(-1)!.close;b.push({time:time(b.length),open:p,high:p+.1,low:p-.35,close:p-.2,volume:5000});assert.equal(analyzeTrendRegimes(b,{now}).regimes[1].direction,'up');
 for(let k=0;k<28;k++){const p=b.at(-1)!.close;b.push({time:time(b.length),open:p,high:p+.05,low:p-.55,close:p-.5,volume:8000});}const full=analyzeTrendRegimes(b,{now});assert.ok(full.regimes.every(r=>r.direction==='down'));assert.deepEqual(full.marks.filter(m=>m.time<=time(119)),before.marks);
});
test('every historical prefix agrees, current confirmations stay provisional, and custom MA roles are explicit',()=>{
 const b=series(165,i=>i<80?20-i*.07:i<125?14.4+(i-80)*.14:20.7-(i-125)*.16),full=analyzeTrendRegimes(b,{now,maPeriods:FIBONACCI_MA});
 for(let end=75;end<b.length;end+=7){const prefix=analyzeTrendRegimes(b.slice(0,end),{now:new Date(time(end-1)+'T08:00:00Z'),maPeriods:FIBONACCI_MA});assert.deepEqual(prefix.marks,full.marks.filter(m=>m.time<=time(end-1)));}
 assert.equal(full.regimes[1].slowPeriod,55);assert.equal(full.regimes[0].slowPeriod,13);
 const mark=full.marks.find(m=>m.kind==='trend-start'&&m.regime==='up')!,end=b.findIndex(c=>c.time===mark.time)+1,forming=analyzeTrendRegimes(b.slice(0,end),{now:new Date(mark.time+'T02:00:00Z'),maPeriods:FIBONACCI_MA}).marks.find(m=>m.time===mark.time&&m.trendScale===mark.trendScale)!;assert.equal(forming.provisional,true);assert.equal(forming.status,'candidate');
 assert.ok(analyzeTrendRegimes(b,{now,maPeriods:[100,200]}).regimes.every(r=>r.direction==='unknown'));
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
