import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MarketScanner,SignalMonitor} from '../src/worker/index';
import {LeaseStore,normalizeLegacyLeases} from '../src/worker/close-leases';
import {closeReportRoute} from '../src/worker/close-report-route';
import {resetSessionMemory} from '../src/worker/close-session';

/** DO storage double with ordered list(prefix,start,limit) like the SQLite-backed API. */
function storage(){
 const map=new Map<string,unknown>();let alarm:number|null=null,puts=0;
 return {map,get puts(){return puts;},
  get:async<T>(k:string)=>structuredClone(map.get(k)) as T|undefined,put:async(k:string,v:unknown)=>{puts++;map.set(k,structuredClone(v));},delete:async(k:string)=>map.delete(k),
  list:async<T>({prefix,start,limit=1000}:{prefix:string;start?:string;limit?:number})=>new Map([...map.entries()].filter(([k])=>k.startsWith(prefix)&&(!start||k>=start)).sort(([a],[b])=>a<b?-1:1).slice(0,limit)) as Map<string,T>,
  setAlarm:async(t:number)=>{alarm=t;},getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;}};
}
const lock={blockConcurrencyWhile:async<T>(fn:()=>Promise<T>)=>fn()};
const session=(quoteDate:string,sessions:string[])=>({at:Date.now(),info:{quoteDate,sessions}});
const manifest=(id:string,date:string,count=1)=>({id,date,generatedAt:Date.now(),total:5,eligible:2,checked:2,failed:0,failureSample:[],rejected:{},complete:true,source:'fixture',elapsedMs:1,cacheHits:0,chunks:1,count});

test('legacy lease map migrates to one key per lease and unchanged renewals do not write',async()=>{
 const s=storage(),now=Date.now();
 await s.put('leases',{['a'.repeat(36)]:now+60000,['b'.repeat(36)]:{until:now+60000,target:'c'.repeat(64)},['d'.repeat(36)]:now-1});
 assert.equal(normalizeLegacyLeases(await s.get('leases'),now).length,2);
 const leases=new LeaseStore(s);
 const all=await leases.all(now);
 assert.deepEqual([...all.keys()].sort(),['a'.repeat(36),'b'.repeat(36)]);
 assert.equal(s.map.has('leases'),false);assert.deepEqual(s.map.get('lease:'+'b'.repeat(36)),{until:now+60000,target:'c'.repeat(64)});
 const before=s.puts;
 assert.equal(await leases.ensure('b'.repeat(36),now+60000,undefined,now),false,'same expiry keeps the stored target without a write');
 assert.equal(s.puts,before);
 assert.equal(await leases.ensure('e'.repeat(36),now+90*86400000,'f'.repeat(64),now),true);
 assert.equal((s.map.get('lease:'+'e'.repeat(36)) as {until:number}).until,now+30*86400000,'leases are capped at 30 days');
 await leases.release('a'.repeat(36),now);assert.equal(s.map.has('lease:'+'a'.repeat(36)),false);
 await s.put('lease:'+'g'.repeat(36),{until:now-5});assert.equal(await leases.prune(now),1);
});

test('a late report fans out once per trade date and old report chunks are pruned',async ctx=>{
 // 00:30 Beijing on 2026-10-27: the 10-26 session report arrives late.
 ctx.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-26T16:30:00Z')});resetSessionMemory();
 const s=storage();await s.put('close:session-info',session('2026-10-26',['2026-10-23','2026-10-26']));
 await s.put('lease:'+'a'.repeat(36),{until:Date.now()+86400000,target:'b'.repeat(64)});
 for(let i=0;i<4;i++){await s.put('close:old-'+i+':0',[{symbol:'X'}]);}
 const m=new MarketScanner({...lock,storage:s} as never,{MARKET_SCANNER:{idFromName:(n:string)=>n,get:()=>({fetch:async()=>Response.json({})})}} as never);
 const post=(action:string,body:unknown)=>m.fetch(new Request('https://scanner/'+action,{method:'POST',body:JSON.stringify(body)}));
 try{
  await post('chunk',{id:'r1',index:0,candidates:[{symbol:'300031.SZ',asOf:'2026-10-26',provisional:false,advice:{action:'观望',reasons:['long text'],notice:'n'}}]});
  assert.equal((await post('publish',manifest('r1','2026-10-26'))).status,200);
  assert.deepEqual(s.map.get('close:outbox'),['b'.repeat(64)]);assert.equal(s.map.get('close:fanned'),'2026-10-26');
  assert.ok(![...s.map.keys()].some(k=>k.startsWith('close:old-')),'unretained report chunks are deleted');
  await s.put('close:outbox',[]);
  await post('chunk',{id:'r2',index:0,candidates:[{symbol:'300031.SZ',asOf:'2026-10-26',provisional:false}]});
  assert.equal((await post('publish',manifest('r2','2026-10-26'))).status,200);
  assert.deepEqual(s.map.get('close:outbox'),[],'a republished report for the same date is not pushed again');
  const summary=await(await m.fetch(new Request('https://scanner/manifest'))).json() as any;
  assert.equal(summary.report.id,'r2');assert.equal(summary.expectedDate,'2026-10-26');assert.equal(summary.stale,false);assert.equal(summary.report.candidates,undefined);
  const list=await(await m.fetch(new Request('https://scanner/results?view=list'))).json() as any;
  assert.equal(list.report.candidates.length,1);
 }finally{ctx.mock.timers.reset();resetSessionMemory();}
});

test('close report route passes the coordinator body through with ETag, 304 and stale fields',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-26T09:00:00Z')});resetSessionMemory();
 const previous=Object.getOwnPropertyDescriptor(globalThis,'caches'),stored=new Map<string,Response>();
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async(r:Request)=>stored.get(r.url)?.clone(),put:async(r:Request,v:Response)=>{stored.set(r.url,v.clone());}}}});
 const s=storage();await s.put('close:session-info',session('2026-11-26',['2026-11-25','2026-11-26']));
 await s.put('close:latest',manifest('2026-11-13-1','2026-11-13',0));
 let calls=0;const coordinator=new MarketScanner({...lock,storage:s} as never,{} as never);
 const ns={idFromName:(n:string)=>n,get:()=>({fetch:async(r:Request)=>{calls++;return coordinator.fetch(r);}})};
 try{
  const first=await closeReportRoute(new Request('https://atlas.example/api/desk/close-report'),ns);
  assert.equal(first.status,200);const etag=first.headers.get('etag')!;assert.match(etag,/2026-11-13-1/);
  assert.match(first.headers.get('cache-control')!,/stale-while-revalidate/);
  const body=await first.json() as any;
  assert.deepEqual([body.available,body.stale,body.expectedDate,body.report.date,body.report.candidates.length],[true,true,'2026-11-26','2026-11-13',0]);
  const again=await closeReportRoute(new Request('https://atlas.example/api/desk/close-report',{headers:{'if-none-match':etag}}),ns);
  assert.equal(again.status,304);assert.equal(again.headers.get('x-atlas-close-cache'),'hit');assert.equal(calls,1,'the edge copy answers without the coordinator');
  const summary=await(await closeReportRoute(new Request('https://atlas.example/api/desk/close-report?view=summary'),ns)).json() as any;
  assert.equal(summary.report.id,'2026-11-13-1');assert.equal('candidates' in summary.report,false);
  const broken={idFromName:(n:string)=>n,get:()=>({fetch:async()=>new Response('boom',{status:500})})};stored.clear();
  const failed=await closeReportRoute(new Request('https://atlas.example/api/desk/close-report'),broken);
  assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'no-store');assert.ok(failed.headers.get('retry-after'));assert.equal(stored.size,0,'errors are never cached');
 }finally{if(previous)Object.defineProperty(globalThis,'caches',previous);else Reflect.deleteProperty(globalThis,'caches');ctx.mock.timers.reset();resetSessionMemory();}
});

test('devices accept a late report for the latest session, poll only the manifest and throttle manual checks',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-27T16:30:00Z')});// 00:30 Beijing 10-28
 const map=new Map<string,unknown>();let alarm:number|null=null;
 const s={storage:{get:async<T>(k:string)=>structuredClone(map.get(k)) as T|undefined,put:async(k:string,v:unknown)=>{map.set(k,structuredClone(v));},delete:async(k:string)=>map.delete(k),setAlarm:async(t:number)=>{alarm=t;},getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;}},id:{toString:()=>'b'.repeat(64)},...lock};
 map.set('native-token','device-token-'.padEnd(40,'x'));map.set('config',{enabled:true,scope:'all',symbols:[],activityFilter:false,updatedAt:Date.now(),expiresAt:Date.now()+86400000,locale:'zh-CN'});
 const report={...manifest('late','2026-10-27'),candidates:[{symbol:'300031.SZ',name:'Fixture',price:10,changePercent:1,volumeRatio:1,eventDate:null,marketCap:1e9}]};
 const {candidates:_,...head}=report,paths:string[]=[];
 const ns={idFromName:(n:string)=>n,get:()=>({fetch:async(r:Request)=>{const p=new URL(r.url).pathname;paths.push(p);return Response.json(p==='/manifest'?{report:head,session:{quoteDate:'2026-10-27',sessions:['2026-10-26','2026-10-27']}}:p==='/results'?{report}:{active:true});}})};
 const pushes:unknown[]=[];const monitor=new SignalMonitor(s as never,{MARKET_SCANNER:ns,FIREBASE_SERVICE_ACCOUNT:'configured'} as never);
 (monitor as unknown as {push:(d:unknown,ttl:number)=>Promise<void>}).push=async(d,ttl)=>{pushes.push({d,ttl});};
 try{
  const first=await monitor.fetch(new Request('https://monitor/internal-close',{method:'POST',body:'{}'}));assert.equal(first.status,200);
  assert.equal(pushes.length,1);assert.equal(map.get('digestDay'),'2026-10-27');assert.equal((pushes[0] as {ttl:number}).ttl,86400);
  assert.match(JSON.stringify(pushes[0]),/report=2026-10-27/);
  paths.length=0;await monitor.alarm();
  assert.deepEqual(paths,[],'before 15:20 a scheduled wake makes no coordinator calls');
  ctx.mock.timers.tick(15*3600000);// 15:30 Beijing 10-28
  paths.length=0;await monitor.alarm();
  assert.deepEqual(paths,['/manifest'],'an already delivered report is not downloaded again');assert.equal(pushes.length,1);
  const checked=await monitor.fetch(new Request('https://monitor/check',{method:'POST',body:'{}'}));assert.equal(checked.status,200);
  const limited=await monitor.fetch(new Request('https://monitor/check',{method:'POST',body:'{}'}));
  assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);assert.equal((await limited.json() as any).code,'RATE_LIMITED');
 }finally{ctx.mock.timers.reset();}
});
