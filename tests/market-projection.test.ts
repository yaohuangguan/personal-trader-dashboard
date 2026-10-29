import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectMarket} from '../src/shared/market-projection';
import {computeJSON} from '../src/shared/local-study';
import type {Candle} from '../src/shared/types';
const bars:Candle[]=Array.from({length:600},(_,i)=>{const close=30+i*.01+Math.sin(i/8),open=close-.05;return {time:new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10),open,close,high:close+.3,low:open-.3,volume:10000+(i%5)*1000};});
test('conditional paths remain bounded, ordered and separate from all observed candles',()=>{
 const original=JSON.stringify(bars),r=projectMarket(bars,{horizon:15,now:new Date('2026-10-29T03:00:00Z')});
 assert.equal(r.available,true);assert.equal(r.points.length,15);assert.equal(JSON.stringify(bars),original);assert.equal(r.anchor,bars.at(-1)!.close);
 assert.ok(r.points.every((p,i)=>p.time>r.asOf!&&p.session===i+1&&p.bear<=p.base&&p.base<=p.bull&&p.bear>0&&p.bull<r.anchor!*2));assert.ok(r.conditions.every(c=>c.text.length>20));assert.match(r.notice,/非确定预测/);
 const native=JSON.parse(computeJSON(JSON.stringify({task:'projection',symbol:'300031.SZ',candles:bars,ma:[5,13,20,30,60,120,144,250],horizon:15,now:'2026-10-29T03:00:00Z'})));
 assert.deepEqual(native.projection,r);
});
test('only the selected prefix is used and limited history exposes a rules fallback',()=>{
 const past=bars.slice(0,100),asOf=new Date(past.at(-1)!.time+'T08:00:00Z');
 assert.deepEqual(projectMarket(bars,{now:asOf}),projectMarket(past,{now:asOf}));
 const r=projectMarket(past,{now:asOf});assert.equal(r.model,'rules');assert.equal(r.sampleCount,0);
 const bad=past.map((b,i)=>i===90?{...b,high:0}:b);assert.equal(projectMarket(bad,{now:asOf}).available,false);
});
