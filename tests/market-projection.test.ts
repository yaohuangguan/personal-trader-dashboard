import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectMarket,projectionTimes} from '../src/shared/market-projection';
import {chartIndicators,defaultMAs,bollinger} from '../src/shared/chart-indicators';
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
test('each scenario supplies valid hypothetical OHLCV and indicators extend from the observed prefix',()=>{
 const r=projectMarket(bars,{now:new Date('2026-10-29T03:00:00Z')}),ma=defaultMAs();
 for(const scenario of r.scenarios){
  assert.equal(scenario.candles.length,15);
  assert.ok(scenario.candles.every(c=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.low>0&&c.volume>=0));
  assert.deepEqual(scenario.candles.map(c=>c.close),r.points.map(p=>p[scenario.id]));
  const combined=[...bars,...scenario.candles],computed=chartIndicators(combined,ma);
  const expected=([...bars.slice(-4),scenario.candles[0]].reduce((s,c)=>s+c.close,0))/5;
  assert.ok(Math.abs(computed.ma[5].find(p=>p.time===scenario.candles[0].time)!.value-expected)<1e-8);
  assert.equal(bollinger(combined).at(-1)!.time,scenario.candles.at(-1)!.time);
 }
});
test('week, month and minute projections use period ends and skip lunch and weekends',()=>{
 assert.deepEqual(projectionTimes('2026-10-29','week',2),['2026-11-06','2026-11-13']);
 assert.deepEqual(projectionTimes('2026-01-30','month',2),['2026-02-27','2026-03-31']);
 assert.deepEqual(projectionTimes('2026-10-30 11:30','m5',2),['2026-10-30 13:05','2026-10-30 13:10']);
 assert.deepEqual(projectionTimes('2026-10-30 15:00','m60',2),['2026-11-02 10:30','2026-11-02 11:30']);
 for(const unit of ['week','month','m5','m15','m30','m60','m120']){
  const input=unit.startsWith('m')&&unit!=='month'?bars.map(c=>({...c,time:c.time+' 15:00'})):bars;
  const r=projectMarket(input,{unit,now:new Date('2026-10-29T03:00:00Z')});assert.equal(r.available,true);assert.equal(r.scenarios[0].candles.length,15);assert.ok(r.scenarios[0].candles.every(c=>c.time>r.asOf!));
 }
});
