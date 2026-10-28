import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeCache,studySession} from '../src/worker/compute-cache';

test('public compute results are reused without caching failures or exposing browser-cacheable snapshots',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'caches'),stored=new Map<string,Response>();let calls=0;
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async(r:Request)=>stored.get(r.url)?.clone(),put:async(r:Request,v:Response)=>{stored.set(r.url,v.clone());}}}});
 const request=new Request('https://atlas.example/api/chart-study',{method:'POST'}),action=()=>{calls++;return Response.json({value:calls});};
 try{
  const first=await computeCache(request,'symbol=A;ma=5,13',15,action);assert.equal(first.headers.get('x-atlas-compute-cache'),'miss');assert.equal(first.headers.get('cache-control'),'no-store');
  const second=await computeCache(request,'symbol=A;ma=5,13',15,action);assert.equal(second.headers.get('x-atlas-compute-cache'),'hit');assert.deepEqual(await second.json(),{value:1});assert.equal(calls,1);
  await computeCache(request,'symbol=A;ma=5,20',15,action);assert.equal(calls,2);
  await computeCache(request,'failed',15,()=>new Response('unavailable',{status:503}));const recovered=await computeCache(request,'failed',15,action);assert.equal(recovered.headers.get('x-atlas-compute-cache'),'miss');assert.equal(calls,3);
 }finally{if(previous)Object.defineProperty(globalThis,'caches',previous);else Reflect.deleteProperty(globalThis,'caches');}
});
test('intraday provisional results cannot cross the Shanghai close or trading date',()=>{
 assert.notEqual(studySession(new Date('2026-10-29T06:59:00Z')),studySession(new Date('2026-10-29T07:00:00Z')));
 assert.notEqual(studySession(new Date('2026-10-29T15:59:00Z')),studySession(new Date('2026-10-29T16:01:00Z')));
});
