import {test} from 'node:test';
import assert from 'node:assert/strict';
import {excludedFromAutoscale,sameShape} from '../src/client/components/chart-data';

const bar=(time:string,close=10)=>({time,open:close,high:close,low:close,close,volume:1});
test('long moving averages leave autoscale on short ranges so candles fill the pane',()=>{
 // 1 month (~26 visible bars): MA60/120/144/250 no longer stretch the price scale; MA5–30 still count.
 for(const p of [60,120,144,250])assert.equal(excludedFromAutoscale(p,26),true,'MA'+p);
 for(const p of [5,13,20,30])assert.equal(excludedFromAutoscale(p,26),false,'MA'+p);
 // 1 year (~264 bars): every average is part of the range again.
 for(const p of [60,120,144,250])assert.equal(excludedFromAutoscale(p,264),false,'MA'+p);
});
test('a tick of the forming bar keeps the chart shape; new bars and history pages do not',()=>{
 const base=[bar('2026-11-25'),bar('2026-11-26')];
 assert.equal(sameShape(base,[bar('2026-11-25'),bar('2026-11-26',11)]),true);
 assert.equal(sameShape(base,[...base,bar('2026-11-27')]),false);
 assert.equal(sameShape(base,[bar('2026-11-24'),...base].slice(0,2)),false);
});
