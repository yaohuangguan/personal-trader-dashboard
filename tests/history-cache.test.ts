import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalSnapshot} from '../src/worker/history-cache';
import type {MarketPayload} from '../src/shared/types';
test('history source failure preserves only a dated same-symbol successful snapshot',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'caches'),store=new Map<string,Response>();
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async(r:Request)=>store.get(r.url)?.clone(),put:async(r:Request,v:Response)=>{store.set(r.url,v.clone());}}}});
 const market={symbol:'300001.SZ',candles:[{time:'2026-10-28',open:10,high:11,low:9,close:10,volume:1}],notice:'known'} as MarketPayload;
 try{
  const first=await historicalSnapshot('https://example.test','300001.SZ',async()=>market);assert.equal(first.symbol,market.symbol);
  const key=[...store.keys()][0];store.set(key,Response.json({savedAt:Date.now()-70000,market}));
  const fallback=await historicalSnapshot('https://example.test','300001.SZ',async()=>{throw Error('source down');});assert.equal(fallback.stale,true);assert.equal(fallback.candles[0].time,'2026-10-28');
  await assert.rejects(historicalSnapshot('https://example.test','300002.SZ',async()=>{throw Error('source down');}));
 }finally{if(previous)Object.defineProperty(globalThis,'caches',previous);else Reflect.deleteProperty(globalThis,'caches');}
});
