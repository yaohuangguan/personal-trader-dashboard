import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidateNow} from '../src/shared/candidate-now';
import type {Snapshot} from '../src/shared/desk-types';
const now=new Date('2026-10-29T02:02:00Z'),candidate={symbol:'300750.SZ',asOf:'2026-10-28',price:100,riskReference:{date:'2026-10-28',rawClose:100,stop:97}};
const quote={symbol:candidate.symbol,price:98,previous:100,open:101,asOf:'2026-10-29T10:01:00+08:00',stale:false,session:'trading',changePercent:-2,volumeRatio:.6} as Snapshot;
test('current green quote replaces yesterday red display but a low-volume retest is not automatically rejected or bought',()=>{
 const input=JSON.stringify(candidate),r=candidateNow(candidate,quote,now);
 assert.equal(r.price,98);assert.equal(r.changePercent,-2);assert.equal(r.fresh,true);assert.match(r.label,/缩量回踩/);assert.equal(r.tone,'neutral');assert.equal(JSON.stringify(candidate),input);
});
test('volume selling and breached structural defense override optimistic prior guidance',()=>{
 assert.match(candidateNow(candidate,{...quote,volumeRatio:2},now).label,/放量走弱/);
 assert.match(candidateNow(candidate,{...quote,price:96},now).label,/失守结构防守位/);
 assert.equal(candidateNow(candidate,{...quote,price:105,open:101,changePercent:5,volumeRatio:1.6},now).tone,'bull');
});
test('missing, stale, future and wrong-symbol quotes never masquerade as current validation',()=>{
 assert.equal(candidateNow(candidate,undefined,now).price,null);
 for(const q of [{...quote,stale:true},{...quote,asOf:'2026-10-28T10:00:00+08:00'},{...quote,asOf:'2026-10-29T11:00:00+08:00'},{...quote,symbol:'002594.SZ'}])assert.equal(candidateNow(candidate,q,now).fresh,false);
});
test('ex-right reference differences disable direct comparison to an old raw-price stop',()=>{
 const r=candidateNow(candidate,{...quote,previous:90,price:89,volumeRatio:1,changePercent:-1.11},now);
 assert.doesNotMatch(r.label,/失守结构防守位/);
});
