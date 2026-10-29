import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intraday} from '../src/worker/desk-data';
test('source 501 recovers through an independent minute feed with correctly accumulated amount and volume',async t=>{
 const original=globalThis.fetch,visited:string[]=[];
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=(async input=>{
  const url=String(input);visited.push(url);
  if(url.includes('gtimg.cn'))return new Response('',{status:501});
  return Response.json({data:{preClose:10,trends:[
   '2026-10-29 09:26,10,10.2,10.2,10,100,102000,10.2',
   '2026-10-29 09:31,10.2,10.3,10.3,10.2,20,20600,10.3',
   '2026-10-29 09:32,10.3,10.4,10.4,10.3,30,31200,10.4',
  ]}});
 }) as typeof fetch;
 const result=await intraday('300031.SZ');
 assert.equal(visited.length,3);assert.match(result.source,/独立备用源/);assert.equal(result.date,'2026-10-29');assert.equal(result.previous,10);assert.equal(result.points.length,2);assert.equal(result.points.at(-1)!.cumulativeVolume,50);assert.equal(result.points.at(-1)!.amount,51800);assert.equal(result.volumeUnit,'手');
});
