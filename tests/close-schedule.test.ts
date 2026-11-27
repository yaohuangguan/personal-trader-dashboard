import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideCloseRun,reconcileUniverse,expectedReportDate,reportIsCurrent,reportIsStale,previousWeekday} from '../src/shared/close-schedule';
import {fetchScreenDaily,backoffDelay} from '../src/worker/pattern-screen';
import type {UniverseItem} from '../src/shared/screening';

const at=(iso:string)=>new Date(iso);
const close=(date:string,time='15:00:03')=>({asOf:`${date}T${time}+08:00`,stale:false});

test('a late GitHub run after Beijing midnight publishes the latest closed session once',()=>{
 // 2026-11-27 00:30 Beijing; the benchmark still shows Thursday's close.
 const now=at('2026-11-26T16:30:00Z');
 assert.deepEqual(decideCloseRun({benchmark:close('2026-11-26'),now,publishedDate:'2026-11-13'}),{action:'run',date:'2026-11-26',reason:'Publishing the latest closed session 2026-11-26 (Beijing date 2026-11-27).',level:'notice'});
 const done=decideCloseRun({benchmark:close('2026-11-26'),now,publishedDate:'2026-11-26'});
 assert.equal(done.action,'skip');assert.equal(done.level,'notice');
 assert.equal(decideCloseRun({benchmark:close('2026-11-26'),now,publishedDate:'2026-11-26',force:true}).action,'run');
 assert.equal(decideCloseRun({benchmark:close('2026-11-26'),now,publishedDate:null}).action,'run','unknown published report still builds');
});
test('same-day runs wait for 15:20 and warn when the previous session has no report',()=>{
 assert.equal(decideCloseRun({benchmark:close('2026-11-26'),now:at('2026-11-26T07:30:00Z'),publishedDate:'2026-11-25'}).action,'run');
 assert.equal(decideCloseRun({benchmark:close('2026-11-26'),now:at('2026-11-26T07:15:00Z'),publishedDate:'2026-11-25'}).action,'skip');
 const open=decideCloseRun({benchmark:close('2026-11-27','10:59:00'),now:at('2026-11-27T03:00:00Z'),publishedDate:'2026-11-26'});
 assert.deepEqual([open.action,open.level],['skip','notice']);
 const missing=decideCloseRun({benchmark:close('2026-11-27','10:59:00'),now:at('2026-11-27T03:00:00Z'),publishedDate:'2026-11-13'});
 assert.deepEqual([missing.action,missing.level],['skip','warning']);
});
test('holidays skip quietly while broken sources fail loudly',()=>{
 // 2026-10-01 (Thursday, holiday): Wednesday's report already exists.
 assert.equal(decideCloseRun({benchmark:close('2026-09-30'),now:at('2026-10-01T08:00:00Z'),publishedDate:'2026-09-30'}).action,'skip');
 const none=decideCloseRun({benchmark:undefined,now:at('2026-11-26T08:00:00Z'),publishedDate:'2026-11-25'});
 assert.deepEqual([none.action,none.level],['fail','error']);
 assert.equal(decideCloseRun({benchmark:close('2026-10-30'),now:at('2026-11-26T08:00:00Z'),publishedDate:null}).action,'fail','a month-old session is a source fault');
 assert.equal(decideCloseRun({benchmark:close('2026-11-25','10:00:00'),now:at('2026-11-26T08:00:00Z'),publishedDate:null}).action,'fail','a past intraday snapshot is not a verified close');
 assert.equal(decideCloseRun({benchmark:{...close('2026-11-25'),stale:true},now:at('2026-11-26T08:00:00Z'),publishedDate:null}).action,'fail');
});
test('universe count drift is tolerated within bounds and duplicates are removed',()=>{
 const rows=(n:number)=>Array.from({length:n},(_,i)=>({symbol:String(600000+i)+'.SH',name:'S'+i,price:1,changePercent:0,amount:3e8,turnover:1}) as UniverseItem);
 const paged=[...rows(5350),...rows(40)];
 const ok=reconcileUniverse(5341,paged);
 assert.deepEqual([ok.ok,ok.actual,ok.gap],[true,5350,9]);
 assert.equal(reconcileUniverse(5341,rows(5200)).ok,false);
 assert.equal(reconcileUniverse(0,rows(10)).ok,false);
});
test('expected report date follows the benchmark session rather than the calendar',()=>{
 const info={quoteDate:'2026-11-26',sessions:['2026-11-24','2026-11-25','2026-11-26']};
 assert.equal(expectedReportDate(info,at('2026-11-26T02:00:00Z')),'2026-11-25','during trading the previous session is expected');
 assert.equal(expectedReportDate(info,at('2026-11-26T09:00:00Z')),'2026-11-26');
 assert.equal(expectedReportDate(info,at('2026-11-26T16:30:00Z')),'2026-11-26','after midnight the closed session remains expected');
 assert.equal(expectedReportDate(info,at('2026-11-26T07:10:00Z'),900),'2026-11-26');
 assert.equal(expectedReportDate({quoteDate:'2026-09-30',sessions:['2026-09-30']},at('2026-10-02T08:00:00Z')),'2026-09-30','holidays keep the last session');
 assert.equal(expectedReportDate(null),null);
 assert.equal(expectedReportDate({quoteDate:'2026-10-01',sessions:[]},at('2026-11-26T08:00:00Z')),null);
 assert.equal(reportIsStale('2026-11-13','2026-11-26'),true);assert.equal(reportIsStale('2026-11-26','2026-11-26'),false);assert.equal(reportIsStale('2026-11-13',null),false);
 assert.equal(previousWeekday('2026-11-30'),'2026-11-27');
});
test('devices treat only the latest session report as current',()=>{
 assert.equal(reportIsCurrent('2026-11-26',at('2026-11-26T16:30:00Z'),'2026-11-26'),true);
 assert.equal(reportIsCurrent('2026-11-25',at('2026-11-26T07:20:00Z'),'2026-11-26'),false);
 assert.equal(reportIsCurrent('2026-11-26',at('2026-11-26T07:40:00Z'),'2026-11-25'),true,'a report newer than expected is current');
 assert.equal(reportIsCurrent('2026-11-26',at('2026-11-26T08:00:00Z')),true);
 assert.equal(reportIsCurrent('2026-11-25',at('2026-11-26T08:00:00Z')),false);
 assert.equal(reportIsCurrent('2026-11-26',at('2026-11-26T16:30:00Z')),true,'without session info, the previous weekday still counts before the next close');
 assert.equal(reportIsCurrent('2026-11-27',at('2026-11-28T02:00:00Z')),true);
 assert.equal(reportIsCurrent('2026-11-28',at('2026-11-27T02:00:00Z')),false);
});
test('unadjusted short windows also fall back to the canonical URL and transient errors back off',async()=>{
 const original=globalThis.fetch,calls:string[]=[];
 const rows=Array.from({length:130},(_,i)=>[new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),'10','10.5','11','9.5','1000']);
 globalThis.fetch=async input=>{calls.push(String(input));return calls.length===1?new Response('',{status:501}):Response.json({data:{sz300031:{day:rows}}});};
 try{const r=await fetchScreenDaily('300031.SZ',false,20);assert.equal(r.candles.length,20);assert.ok(calls[0].endsWith(',,,20,'));assert.ok(calls[1].endsWith(',,,500,'));}
 finally{globalThis.fetch=original;}
 const retried:string[]=[];globalThis.fetch=async input=>{retried.push(String(input));return retried.length<3?new Response('',{status:503}):Response.json({data:{sz300031:{day:rows}}});};
 try{const r=await fetchScreenDaily('300031.SZ',false,500);assert.equal(r.candles.length,130);assert.equal(retried.length,3);}
 finally{globalThis.fetch=original;}
 globalThis.fetch=async()=>new Response('',{status:503});
 try{const signal=AbortSignal.timeout(50),begun=Date.now();await assert.rejects(fetchScreenDaily('300031.SZ',false,500,signal));assert.ok(Date.now()-begun<1000,'backoff honours the abort signal');}
 finally{globalThis.fetch=original;}
 for(let i=0;i<4;i++){const d=backoffDelay(i,()=>0.5);assert.ok(d>=150*2**i&&d<=300*2**i);}
});
