import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patternMarks,primaryPatternMarks} from '../src/shared/pattern-marks';
import {guidePatternMarks,GUIDE_PATTERN_COVERAGE} from '../src/shared/guide-patterns';
import {classicShapes,multiLineEvidence} from '../src/shared/shape-rules';
import {passesMulti,parseScreenOptions} from '../src/shared/pattern-screen';
import type {Candle} from '../src/shared/types';
const date=(i:number)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),now=new Date('2027-01-01T09:00:00Z');
const trend=(up=true):Candle[]=>Array.from({length:80},(_,i)=>{const c=up?10+i*.1:20-i*.1;return {time:date(i),open:c-.04,close:c,high:c+.2,low:c-.2,volume:10000};});
function add(b:Candle[],v:Omit<Candle,'time'>){b.push({time:date(b.length),...v});}
test('controlled upper-wick probes need an early rising context and later confirmation is not backdated',()=>{
 const bars=trend();add(bars,{open:17.9,close:18,high:18.65,low:17.7,volume:11000});
 const first=patternMarks(bars,now),probe=first.find(m=>m.kind==='pointer'&&m.time===date(80));assert.ok(probe);assert.equal(probe.chartVisible,false);assert.ok(primaryPatternMarks(first).every(m=>m.kind!=='pointer'));assert.ok(first.every(m=>m.kind!=='pointer-confirmed'));
 add(bars,{open:18.05,close:18.9,high:19,low:18,volume:19000});const later=patternMarks(bars,now),confirmation=later.find(m=>m.kind==='pointer-confirmed');assert.equal(confirmation?.time,date(81));assert.equal(confirmation?.anchorTime,date(80));assert.deepEqual(later.filter(m=>m.time<=date(80)),first);
 const declining=trend(false);add(declining,{open:12.1,close:12.15,high:12.8,low:11.9,volume:11000});assert.ok(patternMarks(declining,now).every(m=>m.kind!=='pointer'));
 const excessive=trend();add(excessive,{open:17.9,close:18,high:21,low:17.7,volume:11000});assert.ok(patternMarks(excessive,now).every(m=>m.kind!=='pointer'));
});
test('three crossed lines are not a multi-line candle; strong requires centered density and real volume expansion',()=>{
 const bars=trend().map(b=>({...b,open:10,close:10,high:10.2,low:9.8}));add(bars,{open:10.15,close:10.6,high:10.61,low:10.1,volume:25000});
 const ma=(p:number)=>({5:10,10:10.1,20:10.2,30:10.4,60:10.5}[p]??10);
 assert.ok(classicShapes(bars,80,ma,.4,2.5,[5,10,20,30,60]).every(m=>m.kind!=='multi'));
 bars[80].open=10.05;const strong=classicShapes(bars,80,ma,.4,2.5,[5,10,20,30,60]).find(m=>m.kind==='multi');assert.equal(strong?.label,'强力一阳多线');
 bars[80].volume=13000;assert.notEqual(classicShapes(bars,80,ma,.4,1.3,[5,10,20,30,60]).find(m=>m.kind==='multi')?.label,'强力一阳多线');
 assert.throws(()=>parseScreenOptions(new URLSearchParams('multiLines=3')));assert.throws(()=>parseScreenOptions(new URLSearchParams('multiVolume=0')));
 const raw=trend().map(b=>({...b,open:10,close:10,high:10.2,low:9.8}));add(raw,{open:9.5,close:10.8,high:10.81,low:9.49,volume:30000});const e=multiLineEvidence(raw);assert.ok(e?.normal);assert.ok(passesMulti(e,'multi'));assert.equal(passesMulti(undefined,'multi'),false);assert.equal(passesMulti({...e!,includes60:false,strong:false,systems:undefined},'strongmulti'),false);
});
test('bottom-fractal and W-bottom annotations wait for the right-hand evidence',()=>{
 const bars=trend(false),last=bars.at(-1)!;add(bars,{open:last.close-.1,close:last.close-.4,high:last.close,low:last.close-.8,volume:10000});const before=patternMarks(bars,now);assert.ok(before.every(m=>m.kind!=='bottom-fractal'||m.time!==date(80)));
 add(bars,{open:last.close-.2,close:last.close+.2,high:last.close+.3,low:last.close-.4,volume:15000});const fractal=patternMarks(bars,now).find(m=>m.kind==='bottom-fractal'&&m.time===date(81));assert.equal(fractal?.anchorTime,date(80));
 const w=Array.from({length:30},(_,i)=>({time:date(i),open:20,close:20,high:20.2,low:19.8,volume:10000}));
 for(const close of [18,17,16,15,14,13,12,12.5,13,14,15,14.5,14,13,12.1,12.5,13,14,14.5]){const open=w.at(-1)!.close;add(w,{open,close,high:Math.max(open,close)+.2,low:Math.min(open,close)-.2,volume:10000});}
 const observed=guidePatternMarks(w,now);add(w,{open:14.5,close:15.8,high:16,low:14.4,volume:22000});const found=guidePatternMarks(w,now);assert.deepEqual(found.filter(m=>m.time<=date(48)),observed);assert.ok(found.some(m=>m.kind==='double-bottom'&&m.time===date(49)));
});
test('guide inventory covers the documented families without pretending order-book or chip intent is OHLCV',()=>{
 assert.ok(GUIDE_PATTERN_COVERAGE.some(g=>g.items.includes('头肩顶' as never)));assert.ok(GUIDE_PATTERN_COVERAGE.some(g=>'unavailable' in g&&g.unavailable));
 const bars=trend(false);add(bars,{open:12.1,close:12.15,high:12.2,low:11,volume:10000});assert.ok(guidePatternMarks(bars,now).some(m=>m.kind==='hammer'&&m.time===date(80)));
 const duplicate=[...bars,bars.at(-1)!];assert.deepEqual(guidePatternMarks(duplicate,now),[]);
 const month=guidePatternMarks(bars,new Date(date(80)+'T02:00:00Z'),'month');assert.ok(month.every(m=>m.time.slice(0,7)<date(80).slice(0,7)));
});
