import {test} from 'node:test';
import assert from 'node:assert/strict';
import {level2} from '../src/worker/level2';
test('no licensed gateway means no invented depth or trade rows',async()=>{const r=await level2('300031.SZ',{});assert.equal(r.connected,false);assert.equal(r.licensed,false);assert.deepEqual(r.bids,[]);assert.equal(r.depth,0);});
test('licensed gateway validates symbol, licensing and timestamp before exposing data',async()=>{
 const original=globalThis.fetch;let payload:Record<string,unknown>={symbol:'300031.SZ',licensed:true,provider:'Test licensed gateway',asOf:new Date().toISOString(),volumeUnit:'股',bids:[{price:20,volume:100}],asks:[{price:21,volume:200}],trades:[],orders:[]};
 globalThis.fetch=async(_url,init)=>{assert.equal(new Headers(init?.headers).get('authorization'),'Bearer test-token');return Response.json(payload);};
 try{const env={LEVEL2_GATEWAY_URL:'https://gateway.example/quote',LEVEL2_GATEWAY_TOKEN:'test-token'},r=await level2('300031.SZ',env);assert.equal(r.connected,true);assert.equal(r.depth,1);payload={...payload,symbol:'600000.SH'};await assert.rejects(level2('300031.SZ',env));payload={...payload,symbol:'300031.SZ',licensed:false};await assert.rejects(level2('300031.SZ',env));}finally{globalThis.fetch=original;}
});
