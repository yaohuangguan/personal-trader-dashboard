import {test} from 'node:test';import assert from 'node:assert/strict';
import {ResearchScreen,patchSession} from '../src/worker/research-screen';
import {parseConceptMap} from '../src/worker/sector-map';
function storage(){const map=new Map<string,unknown>();let alarm:number|null=null;return {map,get:async<T>(k:string)=>structuredClone(map.get(k)) as T|undefined,put:async(k:string,v:unknown)=>{const size=Buffer.byteLength(JSON.stringify(v));assert.ok(size<128000,'single DO value must stay below limit');map.set(k,structuredClone(v));},getAlarm:async()=>alarm,setAlarm:async(t:number)=>{alarm=t;}};}
test('concept data is kept separate from industries and preserves missing fund flow',()=>{
 const rows={gn_cxy:'gn_cxy,创新药,100,10,0,2.3,100,300000000,sz300031,5,10,0,宝通科技',gn_robot:'gn_robot,机器人概念,45,10,0,-1,100,500000000,sz300545,3,20,0,联得装备'};
 const result=parseConceptMap('var a='+JSON.stringify(rows)+';','concept');assert.equal(result.length,2);assert.equal(result[0].name,'创新药');assert.equal(result[0].mainNet,null);assert.equal(result[0].leaderSymbol,'300031.SZ');assert.throws(()=>parseConceptMap(JSON.stringify(rows),'industry'));
});
test('one durable job coalesces callers, prefilters liquidity, retains failures and reuses verified histories',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-27T07:30:00Z')});
 const original=globalThis.fetch;let historyCalls=0,fail=true;
 globalThis.fetch=async input=>{const url=new URL(String(input));
  if(url.pathname.includes('getHQNodeStockCount'))return Response.json('3');
  if(url.pathname.includes('getHQNodeData'))return Response.json([{symbol:'sz300031',name:'测试候选',trade:10,amount:3e8},{symbol:'sz300545',name:'失败样本',trade:10,amount:3e8},{symbol:'sz300001',name:'成交不足',trade:10,amount:1e8}]);
  if(url.hostname.includes('qt.gtimg.cn')){return new Response(['300031','300545','300001'].map(code=>{const f=Array(89).fill('');Object.assign(f,{1:'测试',3:'10',4:'10',5:'10',6:'500000',30:'20261027150000',32:'0',33:'10.1',34:'9.9',37:code==='300001'?'10000':'30000',44:'10',45:'20'});return 'v_sz'+code+'="'+f.join('~')+'";';}).join(''));}
  if(!url.searchParams.get('param'))throw new Error('timeout');
  historyCalls++;const wire=url.searchParams.get('param')!.split(',')[0];if(fail&&wire==='sz300545')throw new Error('timeout');
  const fields=Array(89).fill('');Object.assign(fields,{1:'测试',3:'10',4:'10',5:'10',6:'500000',30:'20261027150000',32:'0',33:'10.1',34:'9.9',37:'30000',44:'10',45:'20'});
  const bars=Array.from({length:150},(_,i)=>[new Date(Date.UTC(2026,5,i)).toISOString().slice(0,10),'10','10','10.1','9.9','500000']);
  const last=['2026-10-27','10','10','10.1','9.9','500000'];bars[bars.length-1]=last;
  return Response.json({data:{[wire]:{day:bars,qfqday:bars,qt:{[wire]:fields}}}});
 };
 try{
  const s=storage(),a=new ResearchScreen(s),b=new ResearchScreen(s);
  const first=await a.start(),same=await b.start();assert.equal(first.job?.id,same.job?.id);assert.equal(historyCalls,0,'start returns before upstream I/O');
  await a.step();await a.step();let result=await a.read();assert.equal(result.job?.targets,2);assert.equal(result.job?.rejected['成交额不足2亿元'],1);
  for(let i=0;i<5;i++){await a.step();}result=await a.read();assert.equal(result.job?.phase,'complete');assert.equal(result.job?.checked,1);assert.equal(result.job?.failed,1);assert.match(result.job!.failureSample[0].reason,/超时/);
  const calls=historyCalls;fail=false;ctx.mock.timers.tick(121000);await b.start();for(let i=0;i<5;i++){await b.step();}result=await b.read();assert.equal(result.job?.cached,1);assert.equal(historyCalls-calls,2,'only the previously failed stock downloads history again');
 }finally{globalThis.fetch=original;ctx.mock.timers.reset();}
});

test('same-session updates use real OHLCV, preserve history, and reject changed prior-close bases',()=>{
 const data={provider:'fixture',candles:[{time:'2026-10-26',open:10,high:11,low:9,close:10,volume:100},{time:'2026-10-27',open:10,high:11,low:9.5,close:10.5,volume:50}]};
 const quote={asOf:'2026-10-27T14:00:00+08:00',stale:false,previous:10,open:10,high:11.5,low:9.5,price:11,volume:80,volumeUnit:'手'} as any;
 const result=patchSession(data,quote,'手');assert.equal(result?.candles[1].close,11);assert.equal(result?.candles[1].volume,80);assert.deepEqual(result?.candles[0],data.candles[0]);
 assert.equal(patchSession(data,{...quote,previous:8},'手'),null);assert.equal(patchSession(data,{...quote,asOf:'2026-10-28T14:00:00+08:00'},'手'),null);assert.equal(patchSession(data,{...quote,volume:10},'手'),null);
});

test('history circuit breaker retains unresolved stocks and a retry includes the unprocessed queue',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-27T06:00:00Z')});const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('timeout');};
 try{const s=storage(),job={id:'circuit',algorithm:2,resultCount:0,phase:'history',total:32,registered:32,page:2,pages:1,cursor:0,targets:32,checked:0,cached:0,failed:0,candidateCount:0,startedAt:Date.now(),updatedAt:Date.now(),message:'',rejected:{},pageAttempts:0,failureSample:[],historyTotal:32,historyCursor:0};
  const targets=Array.from({length:32},(_,i)=>({symbol:String(300100+i)+'.SZ',name:'fixture',price:10,amount:3e8,changePercent:0,turnover:1,snapshot:{asOf:'2026-10-27T14:00:00+08:00'}}));
  await s.put('research:v1:job',job);await s.put('research:v1:circuit:pending:0',targets);const scan=new ResearchScreen(s);await scan.step();await scan.step();await scan.step();
  const paused=await scan.read();assert.equal(paused.job?.phase,'paused');assert.equal(paused.job?.failed,32,'failed display includes the remaining queue');assert.equal(paused.job?.cursor,24);
  const retry=await scan.start(true);assert.equal(retry.job?.targets,32);assert.equal(retry.job?.retryOf,'circuit');
 }finally{globalThis.fetch=original;ctx.mock.timers.reset();}
});
