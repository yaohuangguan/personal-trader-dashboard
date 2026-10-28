import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {multiLineEvidence} from '../src/shared/shape-rules';
import {CLASSIC_MA,FIBONACCI_MA} from '../src/shared/ma-system';
import {chartStudy} from '../src/shared/chart-study';
import {passesMulti,DEFAULT_MULTI} from '../src/shared/pattern-screen';
import type {Candle} from '../src/shared/types';
const {candles:bars}=JSON.parse(readFileSync(new URL('./fixtures/002472-20261020.json',import.meta.url),'utf8')) as {candles:Candle[]};
const now=new Date('2026-10-20T08:00:00Z');
test('002472 October 20 is a valid multi-line candle in each system without requiring centered strong criteria',()=>{
 const a=multiLineEvidence(bars,CLASSIC_MA)!,b=multiLineEvidence(bars,FIBONACCI_MA)!;
 assert.equal(a.normal,true);assert.equal(a.strong,false);assert.deepEqual(a.periods,[13,20,30,60,144]);
 assert.equal(b.normal,true);assert.equal(b.includes60,true);assert.deepEqual(b.periods,[13,21,34,55,89,144]);
 const both=multiLineEvidence(bars);assert.ok(passesMulti(both,'multi',{...DEFAULT_MULTI,system:'both'}));assert.equal(passesMulti(both,'strongmulti'),false);
});
test('MA edits recompute the pattern and causal trade evidence instead of reusing fixed-parameter arrows',()=>{
 const classic=chartStudy(bars,{now,maPeriods:CLASSIC_MA,symbol:'002472.SZ'}),fib=chartStudy(bars,{now,maPeriods:FIBONACCI_MA,symbol:'002472.SZ'}),custom=chartStudy(bars,{now,maPeriods:[5,10,13],symbol:'002472.SZ'});
 assert.ok(classic.patternMarks.some(m=>m.time==='2026-10-20'&&m.kind==='multi'));assert.ok(fib.patternMarks.some(m=>m.time==='2026-10-20'&&m.kind==='multi'));assert.ok(custom.patternMarks.every(m=>m.kind!=='multi'));
 assert.ok(classic.strategy!.plan.patternEvidence.some(m=>m.kind==='multi'));assert.deepEqual(fib.strategy!.plan.maPeriods,FIBONACCI_MA);
 const future=[...bars,{...bars.at(-1)!,time:'2026-10-21',open:38.8,high:39,low:35,close:36,volume:1e7}];assert.deepEqual(chartStudy(future,{now:new Date('2026-10-21T08:00:00Z'),maPeriods:CLASSIC_MA}).tradeMarkers.filter(m=>m.time<='2026-10-20'),classic.tradeMarkers);
});
