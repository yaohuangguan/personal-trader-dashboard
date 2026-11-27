import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeCache,studySession,cachePhase,dataDateOf,LAGGING_TTL} from '../src/worker/compute-cache';
import {computeShard,computeRequest,originalRequest,offload} from '../src/worker/compute-offload';
import {parseChartStudy,MAX_CHART_STUDY_BARS} from '../src/worker/chart-study-input';
import worker,{MarketScanner} from '../src/worker/index';

function fakeCaches(){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'caches'),stored=new Map<string,Response>();
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async(r:Request)=>stored.get(r.url)?.clone(),put:async(r:Request,v:Response)=>{stored.set(r.url,v.clone());}}}});
 return {stored,restore:()=>{if(previous)Object.defineProperty(globalThis,'caches',previous);else Reflect.deleteProperty(globalThis,'caches');}};
}

test('public compute results are reused, never cache failures and stay browser-cacheable with ETags',async()=>{
 const {stored,restore}=fakeCaches();let calls=0;
 const request=new Request('https://atlas.example/api/chart-study',{method:'POST'}),action=()=>{calls++;return Response.json({value:calls});};
 const now=new Date('2026-11-26T03:00:00Z');
 try{
  const first=await computeCache(request,'symbol=A;ma=5,13',15,action,{now});assert.equal(first.headers.get('x-atlas-compute-cache'),'miss');
  assert.match(first.headers.get('cache-control')!,/^public, max-age=15, stale-while-revalidate=15$/);const etag=first.headers.get('etag')!;assert.ok(etag);
  const second=await computeCache(request,'symbol=A;ma=5,13',15,action,{now});assert.equal(second.headers.get('x-atlas-compute-cache'),'hit');assert.deepEqual(await second.json(),{value:1});assert.equal(calls,1);
  assert.match(second.headers.get('cache-control')!,/public/,'hits are not forced to no-store');
  const revalidated=await computeCache(new Request(request.url,{headers:{'if-none-match':etag}}),'symbol=A;ma=5,13',15,action,{now});assert.equal(revalidated.status,304);
  await computeCache(request,'symbol=A;ma=5,20',15,action,{now});assert.equal(calls,2);
  const failed=await computeCache(request,'failed',15,()=>new Response('unavailable',{status:503}),{now});assert.equal(failed.headers.get('cache-control'),'no-store');
  const recovered=await computeCache(request,'failed',15,action,{now});assert.equal(recovered.headers.get('x-atlas-compute-cache'),'miss');assert.equal(calls,3);
  // A new live bucket recomputes.
  await computeCache(request,'symbol=A;ma=5,13',15,action,{now:new Date(now.getTime()+16000)});assert.equal(calls,4);
  assert.equal([...stored.values()].every(r=>r.status===200),true);
 }finally{restore();}
});
test('closed-session results are kept until the next open only when their data covers that session',async()=>{
 const {stored,restore}=fakeCaches(),now=new Date('2026-11-26T08:00:00Z');// 16:00 Beijing Thursday
 const dated=(day:string)=>()=>Response.json({ok:true},{headers:{'x-atlas-data-date':day}});
 try{
  await computeCache(new Request('https://atlas.example/a'),'final',5,dated('2026-11-26'),{now});
  await computeCache(new Request('https://atlas.example/a'),'lagging',5,dated('2026-11-25'),{now});
  const ages=[...stored.values()].map(r=>r.headers.get('cache-control'));
  assert.deepEqual(ages,['public, max-age='+(17*3600+15*60),'public, max-age='+LAGGING_TTL]);
 }finally{restore();}
});
test('cache phases follow each market clock',()=>{
 assert.equal(cachePhase(new Date('2026-11-26T03:00:00Z'),'cn',5).live,true);
 assert.deepEqual(cachePhase(new Date('2026-11-26T08:00:00Z'),'cn',5),{bucket:'closed:2026-11-26',ttl:62100,closedSince:'2026-11-26',live:false});
 assert.equal(cachePhase(new Date('2026-11-27T00:30:00Z'),'cn',5).bucket,'closed:2026-11-26','pre-open shares the previous close bucket');
 assert.deepEqual(cachePhase(new Date('2026-11-28T04:00:00Z'),'cn',5),{bucket:'closed:2026-11-27',ttl:86400,closedSince:'2026-11-27',live:false});
 assert.equal(cachePhase(new Date('2026-11-26T15:00:00Z'),'us',5).live,true);
 const usClosed=cachePhase(new Date('2026-11-26T22:00:00Z'),'us',5);assert.equal(usClosed.bucket,'closed:2026-11-26');assert.equal(usClosed.ttl,(16*60+25)*60);
 assert.equal(dataDateOf({market:{candles:[{time:'2026-11-25'},{time:'2026-11-26'}]}}),'2026-11-26');
 assert.equal(dataDateOf({trend:{asOf:'2026-11-26T15:00:03+08:00'}}),'2026-11-26');
 assert.equal(dataDateOf({candles:[]}),null);
});
test('intraday provisional results cannot cross the Shanghai close or trading date',()=>{
 assert.notEqual(studySession(new Date('2026-10-29T06:59:00Z')),studySession(new Date('2026-10-29T07:00:00Z')));
 assert.notEqual(studySession(new Date('2026-10-29T15:59:00Z')),studySession(new Date('2026-10-29T16:01:00Z')));
});
test('chart-study input is bounded and bad JSON is a client error',async()=>{
 const bar={time:'2026-01-01',open:1,high:1,low:1,close:1,volume:1};
 assert.equal((parseChartStudy('{bad') as {status:number}).status,400);
 assert.equal((parseChartStudy(JSON.stringify({candles:Array(MAX_CHART_STUDY_BARS+1).fill(bar),ma:[]})) as {status:number}).status,413);
 assert.equal((parseChartStudy(JSON.stringify({candles:[{...bar,open:'x'}],ma:[]})) as {status:number}).status,400);
 assert.ok('body' in parseChartStudy(JSON.stringify({candles:[bar],ma:[5]})));
 const bad=await worker.fetch(new Request('https://atlas.example/api/chart-study',{method:'POST',body:'{not json'}),{} as never);
 assert.equal(bad.status,400);assert.equal((await bad.json() as {code:string}).code,'BAD_REQUEST');
});
test('heavy analysis runs in a compute Durable Object and falls back inline when objects fail',async()=>{
 assert.equal(computeShard('300545.SZ'),computeShard('300545.SZ'));assert.ok(computeShard('NVDA')<8);
 const original=new Request('https://atlas.example/api/chart-study?x=1',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 const rebuilt=(await originalRequest(computeRequest(original,'{"a":1}')))!;assert.equal(rebuilt.url,original.url);assert.equal(await rebuilt.text(),'{"a":1}');
 assert.equal(await(await offload(original,{idFromName:n=>n,get:()=>({fetch:async()=>{throw new Error('Exceeded allowed volume of requests in Durable Objects free tier');}})},'k',()=>new Response('inline'))).text(),'inline');
 const {restore}=fakeCaches();
 const bars=Array.from({length:160},(_,i)=>({time:new Date(Date.UTC(2026,0,1)+i*86400000).toISOString().slice(0,10),open:10+i*.05,high:10.4+i*.05,low:9.7+i*.05,close:10.1+i*.05,volume:1e6+i*1000}));
 const body=JSON.stringify({candles:bars,ma:[5,10,20],symbol:'300545.SZ',name:'Fixture',unit:'day'});
 const coordinator=new MarketScanner({storage:{get:async()=>undefined,put:async()=>{},delete:async()=>true,setAlarm:async()=>{},getAlarm:async()=>null,deleteAlarm:async()=>{}},blockConcurrencyWhile:async<T>(fn:()=>Promise<T>)=>fn()} as never,{} as never);
 const names:string[]=[];const ns={idFromName:(n:string)=>n,get:(n:unknown)=>({fetch:(r:Request)=>{names.push(String(n));return coordinator.fetch(r);}})};
 try{
  const viaObject=await worker.fetch(new Request('https://atlas.example/api/chart-study',{method:'POST',body}),{MARKET_SCANNER:ns} as never);
  assert.equal(viaObject.status,200);assert.match(names[0],/^compute:\d$/);
  const inline=await worker.fetch(new Request('https://atlas.example/api/chart-study',{method:'POST',body:body.replace('Fixture','Fixture ')}),{} as never);
  const a=await viaObject.json() as Record<string,unknown>,b=await inline.json() as Record<string,unknown>;
  assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),'response shape is identical');
  assert.deepEqual(a.patternMarks,b.patternMarks);
 }finally{restore();}
});
