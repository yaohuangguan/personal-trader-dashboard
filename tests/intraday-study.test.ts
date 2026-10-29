import {test} from 'node:test';import assert from 'node:assert/strict';
import {intradayStudy,isMarketIndex} from '../src/shared/intraday-study';
import {sessionGrid} from '../src/shared/intraday-axis';
const points=sessionGrid('2026-10-29').slice(0,100).map((p,i)=>({...p,price:10+Math.sin(i/5)*.1,volume:100,cumulativeVolume:(i+1)*100,amount:null}));
test('volume color follows previous minute while MACD uses only traded observations and preserves the full-day axis',()=>{
 const s=intradayStudy(points,10);
 assert.equal(s[1].rising,true);assert.equal(s[20].rising,false);
 assert.ok(s.slice(0,33).every(p=>p.warmup));assert.equal(s[33].warmup,false);
 assert.deepEqual(s.slice(0,60),intradayStudy(points.slice(0,60),10));
 assert.equal(sessionGrid('2026-10-29').at(-1)!.clock,'15:00');
 assert.ok(s.some(p=>p.histogram>0)&&s.some(p=>p.histogram<0));
 assert.equal(isMarketIndex('000001.SH'),true);assert.equal(isMarketIndex('300031.SZ'),false);
});
