import {deskRoute} from '../src/worker/desk-api';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyPage} from '../src/worker/chart-history';
import * as historyTools from '../src/shared/chart-history';
const {mergeHistoryPage,normalizeHistoryPage,historyBasisFor}=historyTools;
const bar=(time:string,volume:number)=>({time,open:10,close:10,high:12,low:9,volume});
test('history volume normalization converts declared lots and shares without changing prices or live data',()=>{
 const older=bar('2024-01-31',30),anchor=bar('2024-02-29',40),page={candles:[older],anchor,volumeUnit:'手',hasMore:true,nextBefore:older.time,source:'腾讯财经'};
 const normalized=normalizeHistoryPage(page,'股');
 assert.equal(normalized.candles[0].volume,3000);assert.equal(normalized.anchor?.volume,4000);assert.equal(older.volume,30);
 assert.deepEqual(mergeHistoryPage([bar(anchor.time,4000)],normalized),[bar(older.time,3000),bar(anchor.time,4000)]);
 assert.equal(normalizeHistoryPage(normalized,'手').candles[0].volume,30);
 assert.throws(()=>normalizeHistoryPage({...page,volumeUnit:'unknown'},'股'),/成交量口径/);
 assert.throws(()=>mergeHistoryPage([bar(anchor.time,4000)],{...normalized,anchor:{...anchor,close:9}}),/复权/);
});
test('Sina history pages adjust raw daily prices before weekly/monthly aggregation, preserving the initial source basis',async()=>{
 const original=globalThis.fetch,calls:string[]=[];
 globalThis.fetch=async input=>{
  const url=String(input);calls.push(url);
  if(url.includes('/qfq.js'))return new Response('var sz300545qfq={"data":[{"d":"1970-01-01","f":"2"},{"d":"2024-01-16","f":"1"}]}');
  assert.ok(url.includes('sz300545,day,,2024-02-29,501,'));assert.ok(!url.endsWith(',qfq'));
  return Response.json({data:{sz300545:{day:[['2024-01-02','20','22','24','18','10'],['2024-01-31','11','10','12','9','20'],['2024-02-29','10','10','12','9','40']]}}});
 };
 try{
  const page=await historyPage('300545.SZ','month','2024-02-29','sina-qfq');
  assert.equal(page.volumeUnit,'股');assert.deepEqual(page.candles,[bar('2024-01-31',3000)]);assert.deepEqual(page.anchor,bar('2024-02-29',4000));
  assert.equal(calls.filter(u=>u.includes('/qfq.js')).length,1);
 }finally{globalThis.fetch=original;}
});
test('Sina provider hints distinguish adjusted equities from raw Beijing/index history',()=>{
 assert.equal(historyBasisFor('新浪公开日线（前复权因子校正，成交量为股）','300545.SZ'),'sina-qfq');
 assert.equal(historyBasisFor('新浪日线聚合 · 指数原值','000001.SH'),'sina-raw');
 assert.equal(historyBasisFor('新浪公开日线（北交所，不复权）','920982.BJ'),'sina-raw');
 assert.equal(historyBasisFor('腾讯财经前复权日线','300545.SZ'),'tencent');
});

test('client-rendered weekly history skips redundant server studies and rejects unknown adjustment hints',async()=>{
 const invalid=await deskRoute(new Request('https://atlas/api/desk/history?symbol=300545.SZ&period=day&before=2024-02-29&basis=unknown'));
 assert.equal(invalid?.status,400);
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:{sz300545:{qfqweek:[['2024-02-23','10','10','12','9','100'],['2024-03-01','10','10','12','9','100']]}}});
 try{
  const response=await deskRoute(new Request('https://atlas/api/desk/history?symbol=300545.SZ&period=week&study=client'));
  assert.equal(response?.status,200);const data=await response!.json() as {candles:unknown[];patternMarks?:unknown};
  assert.equal(data.candles.length,2);assert.equal(data.patternMarks,undefined);
 }finally{globalThis.fetch=original;}
});
