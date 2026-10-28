import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadChartBundle} from '../src/worker/chart-bundle';
import {CLASSIC_MA} from '../src/shared/ma-system';
import type {MarketPayload} from '../src/shared/types';
import type {Snapshot} from '../src/shared/desk-types';
const candles=Array.from({length:80},(_,i)=>({time:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:10,high:10.2,low:9.8,close:10,volume:10000}));
const market={symbol:'300001.SZ',name:'Fixture',provider:'腾讯',candles,last:10,previous:10,asOf:candles.at(-1)!.time,notice:''} as MarketPayload;
test('first chart response pairs verified OHLCV with its study and does not wait on optional review sources',async()=>{
 const quote={symbol:market.symbol,name:market.name,asOf:market.asOf+'T15:05:00+08:00',price:10.55,previous:10,open:10,high:10.6,low:9.9,volume:30000,volumeUnit:'手',amount:3e8,stale:false,change:.55,changePercent:5.5} as Snapshot;
 const result=await loadChartBundle(market.symbol,CLASSIC_MA,async()=>market,async()=>quote,new Date(market.asOf+'T08:00:00Z'));
 assert.equal(result.market.candles.at(-1)!.close,10.55);assert.deepEqual(result.study.verification.last,result.market.candles.at(-1));assert.deepEqual(result.study.verification.maPeriods,CLASSIC_MA);assert.equal(result.study.verification.last!.time,result.market.asOf);assert.ok(result.study.patternMarks.length>0);assert.equal(result.quoteVerified,true);
});
test('a bad adjustment base or an unavailable quote cannot silently reprice the paired chart',async()=>{
 const result=await loadChartBundle(market.symbol,CLASSIC_MA,async()=>market,async()=>undefined);assert.equal(result.quote,null);assert.equal(result.market.last,10);
 const rejected=await loadChartBundle(market.symbol,CLASSIC_MA,async()=>market,async()=>({asOf:market.asOf+'T15:00:00+08:00',previous:50,price:52,open:50,high:53,low:49,volume:30000,volumeUnit:'手',stale:false} as Snapshot));assert.equal(rejected.quote,null);assert.deepEqual(rejected.market.candles,candles);
});
