import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{MarketScanner} from '../src/worker/index';
import {screenJobDecision,parseScreenJobBody,sessionBucket,MAX_RETRY_SYMBOLS} from '../src/worker/screen-job';
import {statusView,researchJobKeys,ResearchScreen,type ResearchJob} from '../src/worker/research-screen';

const job=(over:Partial<ResearchJob>={}):ResearchJob=>({id:'job1',algorithm:2,phase:'complete',total:10,registered:10,page:2,pages:1,cursor:0,targets:4,checked:3,cached:0,failed:1,candidateCount:2,startedAt:Date.parse('2026-11-26T07:30:00Z'),updatedAt:0,message:'',rejected:{},pageAttempts:0,failureSample:[],...over});
const at=Date.parse('2026-11-26T07:45:00Z');// 15:45 Beijing

test('new full-market jobs need authorization unless a recent job of the same session can be reused',()=>{
 assert.deepEqual(screenJobDecision(undefined,{authorized:false,retry:false},at),{kind:'unauthorized'});
 assert.deepEqual(screenJobDecision(undefined,{authorized:true,retry:false},at),{kind:'start'});
 assert.deepEqual(screenJobDecision(job({phase:'history'}),{authorized:false,retry:false},at),{kind:'existing'},'a running job is shared with anyone');
 assert.deepEqual(screenJobDecision(job(),{authorized:true,retry:false},at),{kind:'existing'},'authorized callers reuse a job started 15 minutes ago');
 assert.deepEqual(screenJobDecision(job(),{authorized:false,retry:false},at+40*60000),{kind:'unauthorized'});
 assert.deepEqual(screenJobDecision(job(),{authorized:true,retry:false},at+40*60000),{kind:'start'});
 const beforeClose=job({startedAt:Date.parse('2026-11-26T06:50:00Z')});// 14:50, then asked at 15:05
 assert.deepEqual(screenJobDecision(beforeClose,{authorized:true,retry:false},Date.parse('2026-11-26T07:05:00Z')),{kind:'start'},'the close starts a new session');
 assert.deepEqual(screenJobDecision(job({phase:'paused'}),{authorized:false,retry:false},at),{kind:'resume'});
 assert.notEqual(sessionBucket(Date.parse('2026-11-26T06:59:00Z')),sessionBucket(Date.parse('2026-11-26T07:01:00Z')));
});
test('anonymous retries are bounded, rate limited and never start a full scan',()=>{
 assert.deepEqual(screenJobDecision(job(),{authorized:false,retry:true},at),{kind:'retry'});
 assert.deepEqual(screenJobDecision(job(),{authorized:false,retry:true,symbols:['300545.SZ']},at),{kind:'retry',symbols:['300545.SZ']});
 assert.deepEqual(screenJobDecision(job(),{authorized:false,retry:true},at,at-10000),{kind:'rate-limited',retryAfter:50});
 assert.deepEqual(screenJobDecision(job({failed:0}),{authorized:false,retry:true},at),{kind:'existing'});
 assert.deepEqual(screenJobDecision(undefined,{authorized:false,retry:true},at),{kind:'existing'});
 assert.deepEqual(parseScreenJobBody('{}'),{retry:false});assert.deepEqual(parseScreenJobBody(''),{retry:false});
 assert.deepEqual(parseScreenJobBody('{"retry":true}'),{retry:true});
 assert.deepEqual(parseScreenJobBody('{"retry":["300545.SZ","300545.SZ"]}'),{retry:true,symbols:['300545.SZ']});
 assert.ok('error' in parseScreenJobBody(JSON.stringify({retry:Array.from({length:MAX_RETRY_SYMBOLS+1},(_,i)=>String(300000+i)+'.SZ')})));
 assert.ok('error' in parseScreenJobBody('{"retry":["DROP TABLE"]}'));assert.ok('error' in parseScreenJobBody('{bad'));assert.ok('error' in parseScreenJobBody('x'.repeat(9000)));
});
test('status polls return progress, the full list when finished, or an incremental cursor',()=>{
 const running=job({phase:'cache'});
 assert.equal(statusView(running,{id:'job1',count:'5'}),'progress');
 assert.equal(statusView(running,{id:'job1',count:'0'}),'full');
 assert.equal(statusView(running,{}),'full');
 assert.equal(statusView(running,{id:'other',count:'5'}),'full');
 assert.deepEqual(statusView(running,{id:'job1',count:'5',since:'3'}),{since:3});
 assert.equal(statusView(job(),{id:'job1',count:'2'}),'full','a finished job returns its full list');
 assert.equal(statusView(running,{since:'-1',count:'4'}),'progress');
 assert.deepEqual(researchJobKeys({id:'j',pages:2,total:241,targets:9,cursor:9,resultCount:2,historyTotal:101}),['research:v1:j:universe:1','research:v1:j:universe:2','research:v1:j:liquid:0','research:v1:j:liquid:1','research:v1:j:targets:0','research:v1:j:result:0','research:v1:j:result:1','research:v1:j:deferred:0','research:v1:j:deferred:1','research:v1:j:pending:0','research:v1:j:pending:1']);
});

function storage(){const map=new Map<string,unknown>();let alarm:number|null=null;return {map,get:async<T>(k:string)=>structuredClone(map.get(k)) as T|undefined,put:async(k:string,v:unknown)=>{map.set(k,structuredClone(v));},delete:async(k:string)=>map.delete(k),list:async<T>({prefix,limit=1000}:{prefix:string;limit?:number})=>new Map([...map.entries()].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a<b?-1:1).slice(0,limit)) as Map<string,T>,setAlarm:async(t:number)=>{alarm=t;},getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;}};}
test('the Worker route enforces the screen-job contract end to end',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:at});
 const s=storage(),coordinator=new MarketScanner({storage:s,blockConcurrencyWhile:async<T>(fn:()=>Promise<T>)=>fn()} as never,{} as never);
 const session='S'.repeat(43);
 const ns={idFromName:(n:string)=>n,get:(n:unknown)=>({fetch:async(r:Request)=>n==='accounts:v1'?Response.json((await r.json() as {token:string}).token===session?{account:{id:'a',email:'a@b.co',username:'a'}}:{error:'登录已过期'},{status:(await r.clone().json().catch(()=>({})) as {token?:string}).token===session?200:401}):coordinator.fetch(r)})};
 const env={MARKET_SCANNER:ns,SCREEN_JOB_TOKEN:'operator-token-0123456789'} as never;
 const post=(body:unknown,token?:string)=>worker.fetch(new Request('https://guanlan.nzs.workers.dev/api/desk/screen-job',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:typeof body==='string'?body:JSON.stringify(body)}),env);
 try{
  const denied=await post({});assert.equal(denied.status,401);assert.deepEqual(await denied.json(),{error:'登录后可发起全市场扫描',code:'AUTH_REQUIRED'});
  assert.equal(denied.headers.get('cache-control'),'no-store');
  assert.equal((await post({},'wrong-token')).status,401);
  const created=await post({},'operator-token-0123456789');assert.equal(created.status,200);const id=(await created.json() as any).job.id;
  const shared=await post({});assert.equal(shared.status,200);assert.equal((await shared.json() as any).job.id,id,'anonymous callers join the running job');
  const viaSession=await post({},session);assert.equal((await viaSession.json() as any).job.id,id,'a running job is never duplicated');
  assert.equal((await post({retry:['nope']})).status,400);
  const progress=await(await worker.fetch(new Request('https://guanlan.nzs.workers.dev/api/desk/screen-job?id='+id+'&count=3'),env)).json() as any;
  assert.equal(progress.job.id,id);assert.equal('candidates' in progress,false);
  const delta=await(await worker.fetch(new Request('https://guanlan.nzs.workers.dev/api/desk/screen-job?id='+id+'&since=0'),env)).json() as any;
  assert.deepEqual([delta.since,delta.next,delta.candidates],[0,0,[]]);
  // Finish the job with one failure: an anonymous retry is allowed once a minute.
  const stored=s.map.get('research:v1:job') as ResearchJob;s.map.set('research:v1:job',{...stored,phase:'complete',failed:1,finishedAt:Date.now(),resultCount:1});
  s.map.set('research:v1:'+id+':result:0',{candidates:[],failed:[{symbol:'300545.SZ',name:'x',price:1,changePercent:0,amount:3e8,turnover:1}]});
  const retried=await post({retry:true});assert.equal(retried.status,200);assert.equal((await retried.json() as any).job.retryOf,id);
  s.map.set('research:v1:job',{...(s.map.get('research:v1:job') as ResearchJob),phase:'complete',failed:1});
  const limited=await post({retry:true});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);assert.equal((await limited.json() as any).code,'RATE_LIMITED');
 }finally{ctx.mock.timers.reset();}
});
test('replaced jobs are archived and unreferenced job keys are cleaned up',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:at});
 try{
  const s=storage();
  s.map.set('research:v1:archive:old',job({id:'old',pages:1,resultCount:1,targets:1,total:1}));s.map.set('research:v1:old:universe:1',{items:[]});s.map.set('research:v1:old:result:0',{candidates:[]});
  s.map.set('research:v1:job',job({id:'prev',phase:'complete',checked:1}));s.map.set('research:v1:prev:result:0',{candidates:[]});
  await new ResearchScreen(s).start();
  assert.equal(s.map.has('research:v1:old:universe:1'),false);assert.equal(s.map.has('research:v1:archive:old'),false);
  assert.equal(s.map.has('research:v1:prev:result:0'),true,'the previous report stays readable');
 }finally{ctx.mock.timers.reset();}
});
