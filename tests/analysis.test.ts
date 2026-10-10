import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCandles } from '../src/shared/analysis';
import { normalizeSymbol, searchLocal, SECTORS } from '../src/shared/catalog';
import type { Candle } from '../src/shared/types';
const make=(count:number,rise:number):Candle[]=>Array.from({length:count},(_,i)=>{
 const close=100+i*rise;
 return {time:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:close-0.2,high:close+1,low:close-1,close,volume:10000+i*50};
});
test('insufficient history never emits a full trend score',()=>{const a=analyzeCandles(make(30,1));assert.equal(a.ready,false);assert.equal(a.score,0);assert.equal(a.stage,'数据不足');});
test('five MA periods are 5/10/20/60/120 and rising series align',()=>{const a=analyzeCandles(make(150,1));assert.equal(a.ready,true);assert.equal(a.aligned,true);assert.equal(a.rising,true);assert.ok(a.ma[5]!>a.ma[120]!);});
test('falling market is not bullish five-line alignment',()=>{const a=analyzeCandles(make(150,-0.2));assert.equal(a.aligned,false);assert.equal(a.bloom,false);});
test('handles no candles without fake confidence',()=>{const a=analyzeCandles([]);assert.equal(a.ready,false);assert.equal(a.ma[5],null);});
test('normalizes A-share exchanges',()=>{assert.equal(normalizeSymbol('600519'),'600519.SH');assert.equal(normalizeSymbol('300308'),'300308.SZ');assert.equal(normalizeSymbol('AAPL'),'AAPL');});
test('can search Chinese names and all seven sectors exist',()=>{assert.ok(searchLocal('中际旭创').some(x=>x.symbol==='300308.SZ'));assert.equal(SECTORS.length,7);});
