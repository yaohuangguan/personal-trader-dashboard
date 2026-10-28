import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeFlow} from '../src/shared/flow-observation';
import type {Tick} from '../src/shared/desk-types';
const at=(s:number)=>[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');
const trades=(side:'B'|'S',price=10):Tick[]=>Array.from({length:110},(_,i)=>({sequence:i,time:at(36000+i*3),price,volume:100,amount:price*100*100,side}));
test('repeated small aggregates produce disjoint candidates, never an institutional net-flow estimate',()=>{
 const r=observeFlow({date:'2026-10-28',items:[...trades('S'),...trades('S').slice(0,2)]},2e8,'2026-10-28');
 assert.equal(r.enough,true);assert.equal(r.stance,'positive');assert.match(r.label,/承接/);assert.equal(r.count,110);assert.equal(r.coverage,.055);
 assert.ok(r.clusters.length>0);assert.ok(r.clusters.reduce((n,g)=>n+g.count,0)<=r.count);assert.match(r.notice,/无法还原原始订单/);assert.equal(r.buckets.reduce((n,b)=>n+b.buy+b.sell+b.neutral,0),r.amount);
});
test('buy pressure with no price progress is selling resistance, not a buy signal',()=>{
 const r=observeFlow({date:'2026-10-28',items:trades('B')},2e8,'2026-10-27');
 assert.equal(r.stance,'negative');assert.equal(r.coverage,null);assert.match(r.explanation,/不能据此认定/);
});
test('auctions, lunch gaps, unknown sides and sparse samples do not manufacture confident signals',()=>{
 const few=trades('B').slice(0,20);assert.equal(observeFlow({date:'2026-10-28',items:few}).enough,false);
 const acrossLunch=[...few.map((t,i)=>({...t,time:at(41330+i*3)})),...few.map((t,i)=>({...t,sequence:i+20,time:at(46800+i*3)}))];
 assert.equal(observeFlow({date:'2026-10-28',items:acrossLunch}).enough,false);
 const auction=trades('B').map((t,i)=>({...t,time:at(53900+i%20)}));assert.equal(observeFlow({date:'2026-10-28',items:auction}).available,false);
 const unknown=trades('B').map(t=>({...t,side:'M' as const}));assert.equal(observeFlow({date:'2026-10-28',items:unknown}).enough,false);
});
test('unequal sizes and big aggregates are not labelled as similar small-order runs',()=>{
 const irregular=trades('B').map((t,i)=>({...t,volume:i%2?10:150,amount:i%2?10000:150000}));assert.equal(observeFlow({date:'2026-10-28',items:irregular}).clusters.length,0);
 const big=trades('B').map(t=>({...t,amount:1e6}));assert.equal(observeFlow({date:'2026-10-28',items:big}).clusters.length,0);
});
