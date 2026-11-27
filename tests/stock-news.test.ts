import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/index';

test('A-share stock news uses the Eastmoney stock index instead of English feed matching',async()=>{
 const original=globalThis.fetch,hosts:string[]=[];
 globalThis.fetch=async input=>{const url=new URL(input instanceof Request?input.url:String(input));hosts.push(url.hostname);
  if(url.hostname==='search-api-web.eastmoney.com')return new Response('jQuery_news('+JSON.stringify({result:{cmsArticleWebOld:[{code:'1',title:'<em>测试</em>公司公告',content:'摘要',date:'2026-11-26 15:30:00',mediaName:'证券时报',url:'https://finance.eastmoney.com/a/1.html'},{code:'2',title:'无日期',content:'',date:'',url:'https://finance.eastmoney.com/a/2.html'}]}})+')');
  throw new Error('unexpected '+url.hostname);};
 try{
  const begun=Date.now(),r=await worker.fetch(new Request('https://atlas.example/api/stock/news?symbol=300545.SZ'),{} as never);
  assert.equal(r.status,200);const body=await r.json() as {items:{title:string;publishedAt:string|null}[];source:string;notice:string};
  assert.equal(body.source,'index');assert.equal(body.items.length,2);assert.equal(body.items[0].title,'测试公司公告');assert.equal(body.items[0].publishedAt,'2026-11-26T15:30:00+08:00');
  assert.equal(body.items[1].publishedAt,null,'a missing date is null, never "+08:00"');assert.ok(body.notice);
  assert.deepEqual([...new Set(hosts)],['search-api-web.eastmoney.com']);assert.ok(Date.now()-begun<3000);
 }finally{globalThis.fetch=original;}
});
