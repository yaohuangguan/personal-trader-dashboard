import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailyTrend} from '../src/shared/daily-trend';
import type {Candle} from '../src/shared/types';
import type {Snapshot,IntradayPayload} from '../src/shared/desk-types';
const now=new Date('2026-10-26T02:00:00Z');
const history:Candle[]=Array.from({length:30},(_,i)=>({time:new Date(Date.UTC(2026,8,26+i)).toISOString().slice(0,10),open:100,high:102,low:98,close:100,volume:1000}));
const quote={symbol:'300545.SZ',price:104,previous:100,open:100,high:105,low:99,volume:1200,volumeUnit:'手',asOf:'2026-10-26T10:00:00+08:00',stale:false} as Snapshot;
const benchmark={...quote,symbol:'000300.SH',changePercent:1};
const intraday={date:'2026-10-26',points:[{time:now.getTime()/1000-60,price:101,volume:100,cumulativeVolume:100},{time:now.getTime()/1000,price:103,volume:300,cumulativeVolume:400}]} as IntradayPayload;
test('daily strength uses observed prices, the matching benchmark and incremental minute volume',()=>{
 const r=dailyTrend(history,{symbol:quote.symbol,quote,benchmark,intraday,volumeUnit:'手',now});
 assert.equal(r.current,true);assert.equal(r.provisional,true);assert.equal(r.coveredWeight,100);assert.equal(r.levels.vwap,102.5);assert.equal(r.volumeRatio,1.2);assert.ok(r.score!>=75&&r.score!<=100);
 assert.ok(r.observations.some(v=>v.includes('3.00')));assert.ok(r.risks.some(v=>v.includes('盘中评分')));
 const future={...history.at(-1)!,time:'2026-10-27',close:9999,high:10000};
 assert.deepEqual(dailyTrend([...history,future],{symbol:quote.symbol,quote,benchmark,intraday,volumeUnit:'手',now}),r);
});
test('missing sources have no imputed points; historical dates and adjustment mismatches stay visible',()=>{
 const r=dailyTrend(history,{symbol:quote.symbol,quote,volumeUnit:'手',now});
 assert.equal(r.coveredWeight,65);assert.equal(r.dimensions.find(d=>d.key==='相对沪深300')?.score,null);
 const stale=dailyTrend(history,{symbol:quote.symbol,quote:{...quote,stale:true},benchmark,intraday,now});
 assert.equal(stale.current,false);assert.equal(stale.coveredWeight,65);assert.ok(stale.risks.some(v=>v.includes('不是今日')));
 const mismatch=dailyTrend(history,{symbol:quote.symbol,quote:{...quote,previous:80},now});assert.ok(mismatch.risks.some(v=>v.includes('不一致')));
 assert.equal(dailyTrend(history.slice(-5),{symbol:quote.symbol,now}).score,null);
});
test('share/lot conversion is invariant and one-price bars do not fabricate location scores',()=>{
 const a=dailyTrend(history,{symbol:quote.symbol,quote,volumeUnit:'手',now});
 const b=dailyTrend(history.map(c=>({...c,volume:c.volume*100})),{symbol:quote.symbol,quote,volumeUnit:'股',now});assert.equal(a.volumeRatio,b.volumeRatio);
 const flat=dailyTrend(history,{symbol:quote.symbol,quote:{...quote,open:104,high:104,low:104},volumeUnit:'手',now});
 assert.equal(flat.dimensions.find(d=>d.key==='日内位置')?.score,null);assert.ok(flat.risks.some(v=>v.includes('流动性')));
});
