import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WatchInsightCache} from '../src/client/hooks/watchInsightCache';
import {rankWatch,watchPhase,watchTrendScore,type WatchInsightData} from '../src/shared/watch-insight';

const now=Date.parse('2026-11-05T02:00:00Z');
function insight(symbol:string,score=70):WatchInsightData{return {symbol,generatedAt:new Date(now).toISOString(),expiresAt:new Date(now+20000).toISOString(),trend:{score,label:'偏强',current:true,date:'2026-11-05',provisional:true},operation:{action:'观望',label:'回踩观察',phase:'pullback',ready:true,score:42,reasons:[]},structure:{state:'均线交织',direction:'neutral',period:'day'}};}
test('scroll/remount shares pending work and reuses the score until absolute expiry; failed refresh retains it',async()=>{
 let at=now,calls=0,fail=false;
 const cache=new WatchInsightCache(async s=>{calls++;await Promise.resolve();if(fail)throw new Error('offline');return insight(s);},()=>at);
 const [a,b]=await Promise.all([cache.load('NVDA'),cache.load('NVDA')]);
 assert.equal(calls,1);assert.equal(a,b);assert.equal(cache.peek('NVDA')?.trend.score,70);
 at+=19999;assert.equal(await cache.load('NVDA'),a);assert.equal(calls,1);
 at++;fail=true;await assert.rejects(cache.load('NVDA'),/offline/);
 assert.equal(calls,2);assert.equal(cache.peek('NVDA'),a);
 fail=false;await cache.load('NVDA');assert.equal(calls,3);
 await cache.load('AAPL');assert.equal(cache.peek('AAPL')?.symbol,'AAPL');
});
test('dynamic views rank current scores stably, exclude stale/historical values, and filter real plan stages',()=>{
 const a=insight('a',80),b=insight('b',40),c=insight('c',99),d=insight('d',80);
 c.trend.current=false;
 const data={a,b,c,d};
 assert.deepEqual(rankWatch(['b','a','missing','d','c'],data,now),['a','d','b','missing','c']);
 assert.equal(watchPhase(a,now),'pullback');
 assert.equal(watchPhase({...a,operation:{...a.operation!,ready:false}},now),'pending');
 assert.equal(watchPhase({...a,quoteStale:true},now),'pending');
 assert.equal(watchTrendScore(c,now),null);
 assert.equal(watchTrendScore(a,now+90000),null);
 assert.equal(watchPhase(a,now+90000),'pending');
});
