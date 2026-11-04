import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyPage} from '../src/worker/chart-history';
import {mergeHistoryPage} from '../src/shared/chart-history';
import {deskRoute} from '../src/worker/desk-api';

const bar=(time:string,close=12)=>({time,open:11,high:13,low:10,close,volume:100});
test('history pages use an exclusive cursor, retain the overlap and keep loading beyond 500 bars',async()=>{
  const original=globalThis.fetch;
  const calls:string[]=[];
  globalThis.fetch=async (input,options)=>{
    const url=String(input);calls.push(url);
    assert.ok(url.includes('sh000001,week,,2020-01-10,501,qfq'));
    assert.equal(new Headers(options?.headers).get('referer'),'https://gu.qq.com/');
    return Response.json({data:{sh000001:{week:[['2020-01-03','11','12','13','10','100'],['2020-01-10','11','12','13','10','100']]}}});
  };
  try {
    const page=await historyPage('000001.SH','week','2020-01-10');
    assert.deepEqual(page.candles,[bar('2020-01-03')]);
    assert.deepEqual(page.anchor,bar('2020-01-10'));
    assert.equal(page.nextBefore,'2020-01-03');
    assert.equal(page.hasMore,true);
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=original;}
});
test('an unavailable Tencent host falls back without changing price basis',async()=>{
  const original=globalThis.fetch,hosts:string[]=[];
  globalThis.fetch=async input=>{
    const url=new URL(String(input));hosts.push(url.hostname);
    return hosts.length===1?new Response('',{status:503}):Response.json({data:{sh000001:{day:[]}}});
  };
  try{const page=await historyPage('000001.SH','day','1990-01-01');assert.equal(page.hasMore,false);assert.deepEqual(hosts,['web.ifzq.gtimg.cn','ifzq.gtimg.cn']);}finally{globalThis.fetch=original;}
});
test('empty source pages mark the source boundary; errors do not masquerade as exhausted history',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({data:{sz300545:{qfqmonth:[]}}});
    const empty=await historyPage('300545.SZ','month','2000-01-01');
    assert.equal(empty.hasMore,false);assert.deepEqual(empty.candles,[]);
    globalThis.fetch=async()=>Response.json({data:{sz300545:{}}});
    await assert.rejects(historyPage('300545.SZ','month','2000-01-01'),/格式/);
    globalThis.fetch=async()=>Response.json({data:{sz300545:{qfqmonth:[],month:[['1999-01-01','11','12','13','10','100']]}}});
    await assert.rejects(historyPage('300545.SZ','month','2000-01-01'),/格式/);
    globalThis.fetch=async()=>Response.json({data:{sz300545:{qfqmonth:[['1999-01-01','-11','-12','-10','-13','100']]}}});
    await assert.rejects(historyPage('300545.SZ','month','2000-01-01'),/复权价格非正/);
  } finally {globalThis.fetch=original;}
});
test('invalid cursor dates and minute pagination fail before making upstream requests',async()=>{
  for(const query of ['before=2024-02-30&period=day','before=bad&period=day','before=2020-01-01&period=m5']){
    const response=await deskRoute(new Request('https://atlas/api/desk/history?symbol=300545.SZ&'+query));
    assert.equal(response?.status,400);
  }
});
test('prepending history deduplicates, preserves live candles and rejects a changed adjustment basis',()=>{
  const latest=[bar('2020-01-10'),bar('2020-01-17',12.5)];
  const page={candles:[bar('2020-01-03')],anchor:bar('2020-01-10')};
  assert.deepEqual(mergeHistoryPage(latest,page),[bar('2020-01-03'),...latest]);
  assert.deepEqual(mergeHistoryPage(mergeHistoryPage(latest,page),page),[bar('2020-01-03'),...latest]);
  assert.throws(()=>mergeHistoryPage(latest,{...page,anchor:bar('2020-01-10',11)}),/复权/);
});
