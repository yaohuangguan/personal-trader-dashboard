import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {computeJSON} from '../src/shared/local-study';
import {chartStudy} from '../src/shared/chart-study';
import {chartPayload} from '../src/worker/chart-payload';
import {CLASSIC_MA,FIBONACCI_MA} from '../src/shared/ma-system';
const now='2026-10-28T08:00:00Z';
const candles=Array.from({length:340},(_,i)=>{const close=i<260?30+Math.sin(i*.5):i<290?30+(i-260)*.5:45-(i-290)*.3,open=close-.05;return {time:new Date(Date.UTC(2025,9,i+1)).toISOString().slice(0,10),open,close,high:close+.2,low:open-.2,volume:i%8===0?40000:10000};});
test('bundled offline engine matches the full shared rules for both MA systems without fetch or a DOM',()=>{
 const sandbox:Record<string,any>={};vm.createContext(sandbox);vm.runInContext(readFileSync(new URL('../mobile/assets/chart_engine.js',import.meta.url),'utf8'),sandbox);
 for(const ma of [CLASSIC_MA,FIBONACCI_MA])for(const unit of ['day','week','month']){
  const input={symbol:'300001.SZ',candles,ma,unit,now},expected=JSON.parse(JSON.stringify(chartPayload(chartStudy(candles,{symbol:input.symbol,maPeriods:ma,unit,now:new Date(now)})))),actual=JSON.parse(sandbox.AtlasLocalStudy.computeJSON(JSON.stringify(input)));
  for(const key of ['patternMarks','indicatorMarks','tradeMarkers','trendRegimes'])assert.deepEqual(actual[key],expected[key]);
  assert.deepEqual(actual.verification.last,candles.at(-1));assert.deepEqual(actual,JSON.parse(computeJSON(JSON.stringify(input))));
 }
});
test('local guide and strategy remain available with explicit missing context instead of requiring optional sources',()=>{
 const input={symbol:'300001.SZ',candles,ma:CLASSIC_MA,now,market:{symbol:'300001.SZ',name:'Fixture',candles,last:candles.at(-1)!.close,provider:'Tencent',asOf:candles.at(-1)!.time,notice:''}},actual=JSON.parse(computeJSON(JSON.stringify(input)));
 assert.equal(actual.analysis.available,true);assert.ok(actual.analysis.strategy.plan);assert.ok(actual.analysis.guide);assert.ok(actual.analysis.review.waitingFor.length>0);assert.equal(actual.analysis.review.current,false);
});
test('periodic context reviews use the latest verified quote rather than freezing at page-open prices',()=>{
 const last=candles.at(-1)!,day=new Date(Date.parse(last.time)+86400000).toISOString().slice(0,10),quote={symbol:'300001.SZ',name:'Fixture',asOf:day+'T15:05:00+08:00',price:last.close+.5,previous:last.close,open:last.close,high:last.close+.6,low:last.close-.1,volume:50000,volumeUnit:'手',amount:3e8,stale:false,change:.5,changePercent:.5/last.close*100,turnover:5,pe:20,pb:2,marketCap:1e10,floatCap:8e9,volumeRatio:2,limitUp:last.close*1.2,limitDown:last.close*.8,bids:[],asks:[],session:'closed'};
 const input={symbol:'300001.SZ',candles,ma:CLASSIC_MA,now:day+'T08:00:00Z',market:{symbol:'300001.SZ',name:'Fixture',candles,last:last.close,provider:'Tencent',asOf:last.time,notice:''},context:{quote}},actual=JSON.parse(computeJSON(JSON.stringify(input)));
 assert.equal(actual.analysis.market.last,quote.price);assert.equal(actual.verification.last.close,quote.price);assert.equal(actual.analysis.strategy.plan.asOf,day);assert.equal(actual.analysis.review.current,true);
});
