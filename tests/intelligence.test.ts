import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventId,relatedTickers,linkedSectors,stableArticleKey} from '../src/worker/intelligence';
import {validateDailyBars,headlineRiskTags} from '../src/worker/research';
import type {Candle,NewsItem} from '../src/shared/types';

const event:NewsItem={
 id:'source-generated-random-id',title:'NVIDIA and HBM semiconductor market demand rises',
 originalTitle:'NVIDIA and HBM semiconductor market demand rises',url:'https://news.example.org/story/ai-hbm?utm_source=feed',
 source:'Publisher A',publishedAt:'2026-10-10T12:01:00Z',category:'ai-hardware'
};
test('ingestion id is stable across feed updates and tracking query changes',async()=>{
 const first=await eventId(event);
 const again=await eventId({...event,id:'different-row-id',url:'https://news.example.org/story/ai-hbm?utm_medium=rss'});
 assert.equal(first,again);
 assert.equal(first.length,36);
});
test('same URL different reported headline produces new revision key',()=>{
 assert.notEqual(stableArticleKey(event),stableArticleKey({...event,title:'Editorial correction: declining orders'}));
});
test('industry classification carries an explicit reason',()=>{
 const sectors=linkedSectors(event);
 assert.ok(sectors.some(x=>x.id==='ai-hardware'&&x.reason));
 assert.ok(relatedTickers('NVIDIA reports new silicon shipment').includes('NVDA'));
 assert.ok(relatedTickers('中际旭创订单增长').includes('300308.SZ'));
});
test('unrelated short ticker words do not automatically match',()=>{
 assert.ok(!relatedTickers('The value of IN moving average').includes('IN'));
});
test('OHLCV rejects impossible candles, duplicate dates and future dates',()=>{
 const input:Candle[]=[
  {time:'2026-05-01',open:10,high:11,low:9,close:10.5,volume:10},
  {time:'2026-05-01',open:10,high:12,low:9,close:11,volume:20},
  {time:'2026-05-02',open:11,high:10,low:9,close:11,volume:20},
  {time:'2035-01-01',open:1,high:2,low:0.5,close:1,volume:10}
 ];
 const result=validateDailyBars(input);
 assert.equal(result.length,1);
 assert.equal(result[0].volume,20);
});

test('announcement title classification is deterministic and conservatively scoped',()=>{
 assert.deepEqual(headlineRiskTags('中际旭创：关于重大合同中标与回购股份的公告'),['订单/合同','回购']);
 assert.deepEqual(headlineRiskTags('关于董事会召开时间的通知'),[]);
});
