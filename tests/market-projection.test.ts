import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectMarket,projectionTimes} from '../src/shared/market-projection';
import {chartIndicators,defaultMAs,bollinger} from '../src/shared/chart-indicators';
import {computeJSON} from '../src/shared/local-study';
import type {Candle} from '../src/shared/types';
const bars:Candle[]=Array.from({length:600},(_,i)=>{const close=30+i*.01+Math.sin(i/8),open=close-.05;return {time:new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10),open,close,high:close+.3,low:open-.3,volume:10000+(i%5)*1000};});
test('conditional whole paths remain bounded and separate from all observed candles',()=>{
 const original=JSON.stringify(bars),r=projectMarket(bars,{horizon:15,now:new Date('2026-10-29T03:00:00Z')});
 assert.equal(r.available,true);assert.equal(r.points.length,15);assert.equal(JSON.stringify(bars),original);assert.equal(r.anchor,bars.at(-1)!.close);
 assert.ok(r.points.every((p,i)=>p.time>r.asOf!&&p.session===i+1&&p.bear>0&&p.bull<r.anchor!*2));assert.ok(r.conditions.every(c=>c.text.length>20));assert.match(r.notice,/非确定预测/);
 const native=JSON.parse(computeJSON(JSON.stringify({task:'projection',symbol:'300031.SZ',candles:bars,ma:[5,13,20,30,60,120,144,250],horizon:15,now:'2026-10-29T03:00:00Z'})));
 assert.deepEqual(native.projection,projectMarket(bars,{symbol:'300031.SZ',horizon:15,now:new Date('2026-10-29T03:00:00Z')}));
});
test('only the selected prefix is used and limited history exposes a rules fallback',()=>{
 const past=bars.slice(0,100),asOf=new Date(past.at(-1)!.time+'T08:00:00Z');
 assert.deepEqual(projectMarket(bars,{now:asOf}),projectMarket(past,{now:asOf}));
 const r=projectMarket(past,{now:asOf});assert.equal(r.model,'rules');assert.ok(r.sampleCount<4);
 const bad=past.map((b,i)=>i===90?{...b,high:0}:b);assert.equal(projectMarket(bad,{now:asOf}).available,false);
});
test('each scenario supplies valid hypothetical OHLCV and indicators extend from the observed prefix',()=>{
 const r=projectMarket(bars,{now:new Date('2026-10-29T03:00:00Z')}),ma=defaultMAs();
 for(const scenario of r.scenarios){
  assert.equal(scenario.candles.length,10);
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
  const r=projectMarket(input,{unit,now:new Date('2026-10-29T03:00:00Z')});assert.equal(r.available,true);assert.equal(r.scenarios[0].candles.length,10);assert.ok(r.scenarios[0].candles.every(c=>c.time>r.asOf!));
 }
});


function activeBars(direction=1):Candle[]{
 let previous=30;
 return Array.from({length:140},(_,i)=>{
  const gap=[.001,-.004,.003,0][i%4],change=direction*.003+[.016,-.008,.009,-.013,.005][i%5];
  const open=previous*(1+gap),close=previous*(1+change);previous=close;
  return{time:new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10),open,close,high:Math.max(open,close)*1.008,low:Math.min(open,close)*.992,volume:10000*(1+[.3,.8,.1,.5,.2][i%5])};
 });
}
test('limited-history fallback preserves actual body, wick and volume variation instead of a doji staircase',()=>{
 const input=activeBars().slice(-80),r=projectMarket(input,{horizon:20,now:new Date('2026-10-29T08:00:00Z')});
 assert.equal(r.model,'rules');assert.equal(r.horizon,20);
 const future=r.scenarios[0].candles,body=future.map(c=>Math.abs(Math.log(c.close/c.open)));
 assert.ok(Math.max(...body)-Math.min(...body)>.002);
 assert.ok(new Set(future.map(c=>Math.round(c.volume))).size>=3);
 assert.ok(future.some(c=>c.close<c.open)&&future.some(c=>c.close>c.open));
 assert.equal(r.basis?.matchedWindows,r.sampleCount);assert.match(r.scenarios[0].explanation!,/重采样/);
 assert.ok(r.basis!.limitations.some(s=>s.includes('未引入板块')));
});
test('four-week paths include traceable whole-window evidence and preserve a source candle rather than daily marginal medians',()=>{
 const r=projectMarket(bars,{horizon:20,now:new Date('2026-10-29T08:00:00Z')});
 assert.equal(r.horizon,20);assert.equal(r.model,'analogs');
 for(const s of r.scenarios){
  const i=bars.findIndex(b=>b.time===s.source!.from);
  assert.ok(i>=64&&i+20<bars.length);
  const sourceRatio=Math.log(bars[i+1].close/bars[i+1].open),ratio=Math.log(s.candles[0].close/s.candles[0].open);
  assert.ok(sourceRatio*ratio>0);assert.ok(s.source!.distance!<.95);assert.match(s.explanation!,/完整量价路径/);
 }
 assert.ok(r.scenarios[1].endReturn!>=r.scenarios[0].endReturn!);
 assert.ok(r.scenarios[2].endReturn!<=r.scenarios[0].endReturn!);
});
test('trend regimes and incomplete-day volume are exposed explicitly with the actual MA system',()=>{
 const up=activeBars(1),down=activeBars(-1),now=new Date(up.at(-1)!.time+'T03:30:00Z');
 const a=projectMarket(up,{now,maPeriods:[5,13,21,34,55,89,144,233]}),b=projectMarket(down,{now});
 assert.notEqual(a.basis?.regime,b.basis?.regime);
 assert.equal(a.basis?.volumeAdjusted,true);assert.match(a.basis!.facts[1],/MA5\/13\/34\/55/);
 assert.match(a.basis!.facts[2],/已过交易时段估计/);
 assert.notDeepEqual(a.scenarios[0].candles,b.scenarios[0].candles);
});
test('stock day projections stay on price ticks and within the applicable daily board bound',()=>{
 const input=activeBars();
 for(const [symbol,rate] of [['002594.SZ',.1],['300750.SZ',.2],['920002.BJ',.3]] as const){
  const r=projectMarket(input,{symbol,horizon:20,now:new Date('2026-10-29T08:00:00Z')});
  for(const s of r.scenarios){
   let prior=input.at(-1)!.close;
   for(const b of s.candles){
    const hi=Math.round(prior*(1+rate)*100)/100,lo=Math.round(prior*(1-rate)*100)/100;
    assert.ok(b.high<=hi+1e-8&&b.low>=lo-1e-8);assert.ok(Math.abs(b.close*100-Math.round(b.close*100))<1e-7);
    assert.ok(b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close));prior=b.close;
   }
  }
 }
});
