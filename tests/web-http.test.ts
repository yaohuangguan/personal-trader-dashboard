import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError,BUSY_MESSAGE,parseApiBody,readJson} from '../src/client/http';
import {failureBackoff,nextEndpointDelay,quotePollDelay,shouldRefetchOnResume} from '../src/client/hooks/live-policy';

test('Cloudflare plain-text errors become a localized busy message instead of a JSON SyntaxError',async()=>{
 assert.throws(()=>parseApiBody(503,'error code: 1102'),(e:unknown)=>e instanceof ApiError&&e.message===BUSY_MESSAGE&&e.status===503);
 assert.throws(()=>parseApiBody(502,'<html>Bad gateway</html>'),(e:unknown)=>e instanceof ApiError&&e.message===BUSY_MESSAGE);
 await assert.rejects(readJson(new Response('error code: 1102',{status:503,headers:{'retry-after':'7'}})),(e:unknown)=>e instanceof ApiError&&e.retryAfter===7&&!/JSON|Unexpected/.test(e.message));
 assert.throws(()=>parseApiBody(200,'<!doctype html>'),(e:unknown)=>e instanceof ApiError&&/异常响应/.test(e.message));
});
test('JSON errors keep the server message, code and retryAfter',()=>{
 assert.throws(()=>parseApiBody(401,JSON.stringify({error:'登录后可发起全市场扫描',code:'AUTH_REQUIRED'})),(e:unknown)=>e instanceof ApiError&&e.code==='AUTH_REQUIRED'&&e.status===401&&e.message==='登录后可发起全市场扫描');
 assert.throws(()=>parseApiBody(429,JSON.stringify({error:'慢一点',retryAfter:30})),(e:unknown)=>e instanceof ApiError&&e.retryAfter===30);
 assert.throws(()=>parseApiBody(500,JSON.stringify({})),(e:unknown)=>e instanceof ApiError&&e.message===BUSY_MESSAGE);
 assert.throws(()=>parseApiBody(404,JSON.stringify({reason:'暂无'})),(e:unknown)=>e instanceof ApiError&&e.message==='暂无');
 assert.deepEqual(parseApiBody(200,'{"items":[1]}'),{items:[1]});
});
test('resume refetches only stale live data and never one-shot endpoints that already loaded',()=>{
 const now=1_000_000;
 assert.equal(shouldRefetchOnResume({intervalMs:0,updatedAt:now-86400000,hasData:true,hasError:false,now}),false);
 assert.equal(shouldRefetchOnResume({intervalMs:0,updatedAt:0,hasData:false,hasError:true,now}),true);
 assert.equal(shouldRefetchOnResume({intervalMs:60000,updatedAt:now-10000,hasData:true,hasError:false,now}),false);
 assert.equal(shouldRefetchOnResume({intervalMs:60000,updatedAt:now-61000,hasData:true,hasError:false,now}),true);
 assert.equal(shouldRefetchOnResume({intervalMs:60000,updatedAt:now-1000,hasData:true,hasError:true,now}),true);
});
test('quote polling slows down outside trading sessions and failures back off',()=>{
 assert.equal(quotePollDelay([{session:'closed'},{session:'trading'}]),5000);
 assert.equal(quotePollDelay([{session:'break'},{session:'closed'}]),15000);
 assert.equal(quotePollDelay([{session:'closed'}]),60000);
 assert.equal(quotePollDelay([]),5000);
 assert.equal(nextEndpointDelay(5000,{items:[{session:'closed'}]}),30000);
 assert.equal(nextEndpointDelay(60000,{items:[{session:'closed'}]}),60000);
 assert.deepEqual([1,2,3,6,10].map(failureBackoff),[30000,60000,120000,600000,600000]);
});
