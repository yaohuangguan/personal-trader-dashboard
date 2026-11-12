import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseExtendedPage, extendedQuote} from '../src/worker/us-extended';
import {deskRoute} from '../src/worker/desk-api';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/us-extended-yahoo.json',import.meta.url),'utf8'));
const quote=fixture.quoteResponse.result[0];
const page=(rows:unknown[]= [quote])=>'<script type="application/json" data-sveltekit-fetched>'+JSON.stringify({status:200,body:JSON.stringify({quoteResponse:{result:rows,error:null}})})+'</script>';
const now=new Date('2026-11-12T01:17:00Z');
test('real Yahoo public-page data preserves regular prices and separates all three sessions',()=>{
 const result=parseExtendedPage(page([{...quote,symbol:'MSFT'},quote]),'AAPL',now);
 assert.equal(result.current?.session,'overnight');
 assert.equal(result.current?.price,355.62);
 assert.equal(result.current?.asOf,'2026-11-12T01:16:12.000Z');
 assert.equal(result.current?.reference,355.63);
 assert.ok(Math.abs(result.current!.changePercent-(-0.00281191))<0.000001);
 assert.equal(result.quotes.pre?.reference,348.51);
 assert.equal(result.quotes.post?.reference,355.63);
 assert.equal(result.quotes.overnight?.source,'Yahoo Finance / Blue Ocean ATS');
 assert.equal(result.current?.stale,false);
});
test('session selection respects provider holidays, missing overnight, old premarket and invalid data',()=>{
 assert.equal(parseExtendedPage(page([{...quote,marketState:'REGULAR'}]),'AAPL',now).current,null);
 const missing=parseExtendedPage(page([{...quote,overnightMarketPrice:{}}]),'AAPL',now);
 assert.equal(missing.current,null);assert.equal(missing.activeSession,'overnight');
 assert.equal(parseExtendedPage(page([{...quote,overnightMarketTime:{raw:1794446401}}]),'AAPL',now).current,null);
 assert.equal(parseExtendedPage(page([{...quote,marketState:'PRE'}]),'AAPL',now).current,null);
 assert.throws(()=>parseExtendedPage(page([{...quote,currency:'EUR'}]),'AAPL',now));
 assert.throws(()=>parseExtendedPage(page([{...quote,symbol:'MSFT'}]),'AAPL',now));
 assert.throws(()=>parseExtendedPage('<script>window.evil=true</script>','AAPL',now));
 assert.equal(parseExtendedPage(page(),'AAPL',new Date('2026-11-12T02:00:00Z')).current?.stale,true);
});
test('premarket uses previous close; summer timestamps and 24h night rollover stay exchange-local',()=>{
 const summer={...quote,marketState:'PRE',regularMarketTime:Date.parse('2026-07-10T20:00:01Z')/1000,preMarketTime:1783947600,preMarketPrice:102,regularMarketPreviousClose:99,regularMarketPrice:100};
 const result=parseExtendedPage(page([summer]),'AAPL',new Date('2026-07-13T13:01:00Z'));
 assert.equal(result.current?.session,'pre');assert.equal(result.current?.reference,100);
 assert.equal(result.current?.changePercent,2);
});
test('extended endpoint validates symbols and source failure never affects the regular quote route',async()=>{
 assert.equal((await deskRoute(new Request('https://atlas/api/desk/extended-quote?symbol=300545.SZ')))?.status,400);
 const original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=async input=>{urls.push(String(input));return new Response(page());};
 try{
  const result=await extendedQuote('AAPL',now);
  assert.equal(result.current?.price,355.62);assert.equal(urls[0],'https://finance.yahoo.com/quote/AAPL/');
  globalThis.fetch=async()=>new Response('rate limited',{status:429});
  await assert.rejects(extendedQuote('AAPL',now),/429/);
  const fields=Array(70).fill('');
  Object.assign(fields,{2:'AAPL.OQ',3:'355.63',4:'348.51',30:'2026-11-11 16:00:01',31:'7.12',32:'2.04',35:'USD'});
  globalThis.fetch=async input=>{
   if(String(input).startsWith('https://qt.gtimg.cn/q='))return new Response('v_usAAPL="'+fields.join('~')+'";');
   if(String(input).startsWith('https://finance.yahoo.com/'))return new Response('rate limited',{status:429});
   throw new Error('Unexpected '+input);
  };
  const regular=await deskRoute(new Request('https://atlas/api/desk/quotes?symbols=AAPL'));
  assert.equal(regular?.status,200);
  assert.equal((await regular!.json() as {items:{price:number}[]}).items[0].price,355.63);
  assert.equal((await deskRoute(new Request('https://atlas/api/desk/extended-quote?symbol=AAPL')))?.status,502);
 }finally{globalThis.fetch=original;}
});
