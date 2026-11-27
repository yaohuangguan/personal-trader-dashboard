import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TokenBucket,eastmoney,eastmoneyEndpoint} from '../src/worker/desk-data';

test('token buckets allow a short burst, then pace and refuse waits beyond the limit',()=>{
 const bucket=new TokenBucket(2,900,0);
 assert.deepEqual([bucket.reserve(4500,0),bucket.reserve(4500,0),bucket.reserve(4500,0),bucket.reserve(4500,0)],[0,0,900,1800]);
 for(let i=0;i<3;i++)bucket.reserve(4500,0);
 assert.equal(bucket.reserve(4500,0),null,'more than 4.5 s of backlog is refused');
 assert.equal(bucket.reserve(4500,20000),0,'tokens refill over time');
 assert.equal(eastmoneyEndpoint('https://push2.eastmoney.com/api/qt/slist/get?secid=1'),'push2.eastmoney.com/api/qt/slist/get');
});
test('Eastmoney calls reuse completed responses, pace per endpoint and honour aborts',async()=>{
 const original=globalThis.fetch,seen:string[]=[];
 globalThis.fetch=async input=>{seen.push(input instanceof Request?input.url:String(input));return Response.json({ok:true});};
 try{
  const url='https://push2.eastmoney.com/api/qt/test-reuse/get?x=1';
  assert.deepEqual(await(await eastmoney(url)).json(),{ok:true});
  assert.deepEqual(await(await eastmoney(url)).json(),{ok:true});
  assert.equal(seen.length,1,'a completed response is reused for a few seconds');
  // Exhaust one endpoint: another endpoint is not delayed by it.
  const busy='https://push2.eastmoney.com/api/qt/test-busy/get?n=';
  await eastmoney(busy+1);await eastmoney(busy+2);
  const begun=Date.now();await eastmoney('https://reportapi.eastmoney.com/report/test-other?x=1');assert.ok(Date.now()-begun<200);
  await assert.rejects(eastmoney(busy+3,9000,AbortSignal.timeout(30)));
  assert.ok(Date.now()-begun<600,'an aborted wait stops early');
 }finally{globalThis.fetch=original;}
});
