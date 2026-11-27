import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeErrorBody,finalizeApiResponse,apiError,timingSafeEqual,etagMatches} from '../src/worker/http';
import worker from '../src/worker/index';

test('error bodies are normalised to {error, code, retryAfter} without dropping fields',()=>{
 assert.deepEqual(normalizeErrorBody({available:false,reason:'来源失败',fetchedAt:'t'},502),{available:false,reason:'来源失败',fetchedAt:'t',error:'来源失败',code:'UPSTREAM_ERROR'});
 assert.deepEqual(normalizeErrorBody({error:'busy'},503),{error:'busy',code:'UNAVAILABLE',retryAfter:30});
 assert.equal(normalizeErrorBody({error:'slow down',retryAt:new Date(Date.now()+90500).toISOString()},429).retryAfter,91);
 assert.deepEqual(normalizeErrorBody({error:'x',code:'AUTH_REQUIRED'},401),{error:'x',code:'AUTH_REQUIRED'});
 assert.equal(normalizeErrorBody(null,500).error,'服务暂不可用，请稍后重试');
 assert.equal(normalizeErrorBody({error:'nope',retryAfter:5},400).retryAfter,undefined,'retryAfter only on 429/503');
});
test('finalized API errors are JSON, no-store and carry Retry-After',async()=>{
 const text=await finalizeApiResponse(new Response('error code: 1102',{status:503,headers:{'cache-control':'public, max-age=60'}}));
 assert.equal(text.headers.get('content-type'),'application/json; charset=utf-8');assert.equal(text.headers.get('cache-control'),'no-store');assert.equal(text.headers.get('retry-after'),'30');
 assert.deepEqual(await text.json(),{error:'error code: 1102',code:'UNAVAILABLE',retryAfter:30});
 const ok=new Response('{"a":1}',{headers:{'cache-control':'public, max-age=5'}});assert.equal(await finalizeApiResponse(ok),ok);
 const limited=apiError(429,'太频繁',{retryAfter:12});assert.equal(limited.headers.get('retry-after'),'12');assert.deepEqual(await limited.json(),{error:'太频繁',code:'RATE_LIMITED',retryAfter:12});
});
test('every API path answers errors in the envelope and failed fallbacks are never public',async()=>{
 const unknown=await worker.fetch(new Request('https://atlas.example/api/nope'),{} as never);
 assert.equal(unknown.status,404);assert.deepEqual(await unknown.json(),{error:'Unknown API path',code:'NOT_FOUND'});
 const desk=await worker.fetch(new Request('https://atlas.example/api/desk/quotes?symbols=bad'),{} as never);
 assert.equal(desk.status,400);const body=await desk.json() as {error:string;code:string};assert.ok(body.error);assert.equal(body.code,'BAD_REQUEST');
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('offline');};
 try{const r=await worker.fetch(new Request('https://atlas.example/api/earnings-calendar?symbol=NVDA'),{FMP_API_KEY:'k'} as never);assert.equal(r.status,200);assert.equal((await r.json() as {available:boolean}).available,false);assert.equal(r.headers.get('cache-control'),'no-store');}
 finally{globalThis.fetch=original;}
});
test('token comparison is constant-time and validators match weak and listed ETags',async()=>{
 assert.equal(await timingSafeEqual('secret-token','secret-token'),true);
 assert.equal(await timingSafeEqual('secret-tokeN','secret-token'),false);
 assert.equal(await timingSafeEqual('','secret-token'),false);assert.equal(await timingSafeEqual('x',''),false);
 assert.equal(etagMatches('W/"a", "b"','"b"'),true);assert.equal(etagMatches('"a"','"b"'),false);assert.equal(etagMatches(null,'"b"'),false);
});
