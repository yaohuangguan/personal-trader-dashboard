import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shareClassSymbol} from '../src/shared/market-clock';
import {usQuotes} from '../src/worker/us-market';
import {secCompany} from '../src/worker/research';
import {sectorNews} from '../src/worker/sector-map';
import {countRequest} from '../src/worker/rate-limit';
import {monitorRoute} from '../src/worker/signal-monitor';

test('US share classes are spelled per source and answered in the caller spelling',async()=>{
 assert.deepEqual(['BRK-B','brk.b','BRK/B','BF-B','NVDA','600519.SH','BRK-BB'].map(s=>shareClassSymbol(s,'.')),['BRK.B','BRK.B','BRK.B','BF.B','NVDA','600519.SH','BRK-BB']);
 assert.equal(shareClassSymbol('BRK.B','-'),'BRK-B');
 const original=globalThis.fetch,urls:string[]=[];
 globalThis.fetch=async input=>{urls.push(String(input));const f=Array(70).fill('');Object.assign(f,{2:'BRK.B.N',3:'579.32',4:'577.21',5:'576.75',6:'3000000',30:'2026-11-27 13:00:00',31:'2.11',32:'0.37',33:'581.47',34:'575.10',35:'USD',37:'1700000000',46:'Berkshire Hathaway Inc. New'});return new Response('v_usBRK.B="'+f.join('~')+'";');};
 try{const feed=await usQuotes(['BRK-B']);assert.match(urls[0],/q=usBRK\.B$/);assert.equal(feed.items[0].symbol,'BRK-B');assert.deepEqual(feed.unavailable,[]);}
 finally{globalThis.fetch=original;}
});
test('the SEC ticker index is downloaded once and share classes match the SEC spelling',async()=>{
 const original=globalThis.fetch;let downloads=0;
 globalThis.fetch=async()=>{downloads++;return Response.json({0:{ticker:'BRK-B',cik_str:1067983,title:'BERKSHIRE HATHAWAY INC'},1:{ticker:'NVDA',cik_str:1045810,title:'NVIDIA CORP'}});};
 try{
  assert.deepEqual(await secCompany('BRK.B','Atlas test contact@example.org'),{ticker:'BRK-B',cik_str:1067983,title:'BERKSHIRE HATHAWAY INC'});
  assert.equal((await secCompany('NVDA','Atlas test contact@example.org'))?.cik_str,1045810);
  assert.equal(await secCompany('ZZZZ','Atlas test contact@example.org'),null);
  assert.equal(downloads,1);
 }finally{globalThis.fetch=original;}
});
test('industry sector news searches the industry map instead of returning nothing',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>{const url=String(input);
  if(url.includes('newSinaHy.php'))return new Response(new TextEncoder().encode('var S_Finance_bankuai_sinaindustry = {"new_dzqj":"new_dzqj,LED,120,10,1,1.5,0,2e10,sz000001,2.1,0,0,PA"};'));
  if(url.includes('newFLJK.php'))return new Response(new TextEncoder().encode('var x = {"gn_jqr":"gn_jqr,机器人,80,10,1,1.2,0,1e10,0,sz000002,2,0,万科"};'));
  if(url.includes('cls.cn'))return Response.json({errno:0,data:{roll_data:[{id:1,title:'LED 订单回暖',brief:'b',ctime:1795000000,level:'B'}]}});
  return Response.json({code:20000,data:{items:[]}});
 };
 try{const news=await sectorNews('SN:new_dzqj') as {items:{title:string}[]};assert.equal(news.items.length,1);assert.match(news.items[0].title,/LED/);}
 finally{globalThis.fetch=original;}
});
test('monitor objects cannot be minted without limit from one address',async()=>{
 const store=new Map<string,{count:number;start:number}>();
 assert.deepEqual([0,0,0].map(()=>countRequest(store,'k',2,60000,1000)).slice(1),[0,60]);
 assert.equal(countRequest(store,'k',2,60000,62000),0,'the window resets');
 let reached=false;const ns={idFromName:(n:string)=>n,get:()=>({fetch:async()=>{reached=true;return Response.json({});}})};
 const req=new Request('https://atlas.example/api/monitor/public-key',{headers:{authorization:'Bearer '+'a'.repeat(64),'cf-connecting-ip':'198.51.100.9'}});
 const limited=await monitorRoute(req,ns,async key=>{assert.equal(key,'monitor:198.51.100.9');return 42;});
 assert.equal(limited!.status,429);assert.equal(limited!.headers.get('retry-after'),'42');assert.equal(reached,false);
 const status=await monitorRoute(new Request('https://atlas.example/api/monitor/status',{headers:{authorization:'Bearer '+'a'.repeat(64)}}),ns,async()=>42);
 assert.equal(status!.status,200,'reading status is not limited');
});
