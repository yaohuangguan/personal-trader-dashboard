import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firstSuccess} from '../src/worker/provider-chain';
import {lastGoodMarket} from '../src/worker/history-cache';

const after=<T,>(ms:number,value:T,fail=false)=>()=>new Promise<T>((resolve,reject)=>setTimeout(()=>fail?reject(new Error(String(value))):resolve(value),ms));
const never=()=>new Promise<string>(()=>{});
const options={hedgeAfterMs:20,preferHigherMs:60,deadlineMs:400};

test('the primary provider wins without starting backups when it answers quickly',async()=>{
 let started=0;const r=await firstSuccess([{name:'a',run:after(5,'A')},{name:'b',run:()=>{started++;return Promise.resolve('B');}}],options);
 assert.deepEqual([r.value,r.index,started],['A',0,0]);
});
test('a slow primary is hedged but keeps priority when it answers within the grace period',async()=>{
 const r=await firstSuccess([{name:'a',run:after(50,'A')},{name:'b',run:after(5,'B')}],options);
 assert.deepEqual([r.value,r.index],['A',0]);
});
test('a hung primary is replaced by the hedged backup and failures fall through immediately',async()=>{
 const begun=Date.now(),r=await firstSuccess([{name:'a',run:never},{name:'b',run:after(5,'B')}],options);
 assert.deepEqual([r.value,r.index],['B',1]);assert.ok(Date.now()-begun<300);
 const fallthrough=await firstSuccess([{name:'a',run:after(1,'down',true)},{name:'b',run:after(1,'')},{name:'c',run:after(1,'C')}],{...options,valid:v=>!!v});
 assert.deepEqual([fallthrough.value,fallthrough.failures],['C',['a: down','b: empty result']]);
});
test('the chain fails with every reason, or at the overall deadline',async()=>{
 await assert.rejects(firstSuccess([{name:'a',run:after(1,'x',true)},{name:'b',run:after(1,'y',true)}],options),/a: x; b: y/);
 const begun=Date.now();await assert.rejects(firstSuccess([{name:'a',run:never},{name:'b',run:never}],{...options,deadlineMs:80}),/exceeded 80ms/);
 assert.ok(Date.now()-begun<300);
 await assert.rejects(firstSuccess([],options),/No provider/);
});
test('market history falls back to the last good copy when every provider fails',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'caches'),stored=new Map<string,Response>();
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async(r:Request)=>stored.get(r.url)?.clone(),put:async(r:Request,v:Response)=>{stored.set(r.url,v.clone());}}}});
 const market={symbol:'LASTGOOD',candles:[{time:'2026-11-26',open:1,high:1,low:1,close:1,volume:1}],notice:'n'} as never;
 try{
  assert.equal(await lastGoodMarket('https://atlas.example','LASTGOOD',async()=>market),market);
  const fallback=await lastGoodMarket('https://atlas.example','LASTGOOD',async()=>{throw new Error('all down');});
  assert.equal(fallback.stale,true);assert.match(fallback.notice,/上次成功历史/);
  await assert.rejects(lastGoodMarket('https://atlas.example','UNKNOWN',async()=>{throw new Error('all down');}),/all down/);
 }finally{if(previous)Object.defineProperty(globalThis,'caches',previous);else Reflect.deleteProperty(globalThis,'caches');}
});
