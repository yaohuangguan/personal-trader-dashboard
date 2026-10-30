import {test} from 'node:test';
import assert from 'node:assert/strict';
import {earningsRow,reportPeriods,reportLabel} from '../src/shared/earnings';
import {earnings} from '../src/worker/earnings';
const row={SECUCODE:'920571.BJ',SECURITY_NAME_ABBR:'国航远洋',BOARD_NAME:'航运港口',REPORTDATE:'2026-09-30 00:00:00',NOTICE_DATE:'2026-10-29 00:00:00',TOTAL_OPERATE_INCOME:1014113188.79,PARENT_NETPROFIT:201343464.17,YSTZ:46.4279109347,SJLTZ:98070.64,BASIC_EPS:.3633,WEIGHTAVG_ROE:14.41,MGJYXJJE:.724231938062};
test('reported earnings preserve source percent and yuan units, missing values and losses',()=>{
 const r=earningsRow(row)!;assert.equal(r.symbol,'920571.BJ');assert.equal(r.profitGrowth,98070.64);assert.equal(r.profit,201343464.17);assert.equal(r.revenueGrowth,46.4279109347);
 const loss=earningsRow({...row,PARENT_NETPROFIT:'-120000000',SJLTZ:'-55.2',BASIC_EPS:null,MGJYXJJE:'-',YSTZ:''})!;
 assert.equal(loss.profit,-120000000);assert.equal(loss.profitGrowth,-55.2);assert.equal(loss.eps,null);assert.equal(loss.cashPerShare,null);assert.equal(loss.revenueGrowth,null);
 assert.equal(earningsRow({...row,SECUCODE:'NVDA'}),null);assert.equal(earningsRow({...row,REPORTDATE:'2026-09-99'}),null);
});
test('quarter controls use Beijing completed periods at year and quarter boundaries',()=>{
 assert.equal(reportLabel('2026-09-30'),'2026 三季报');
 assert.equal(reportPeriods(new Date('2026-01-01T00:00:00Z'))[0],'2025-12-31');
 assert.equal(reportPeriods(new Date('2026-03-30T16:00:00Z'))[0],'2026-03-31');
 assert.equal(reportPeriods(new Date('2026-03-30T15:59:59Z'))[0],'2025-12-31');
 assert.equal(new Set(reportPeriods()).size,8);
});
test('all-market earnings defaults to a single disclosed period and sorts before provider pagination',async()=>{
 const original=globalThis.fetch,requests:URL[]=[];
 globalThis.fetch=async input=>{const u=new URL(String(input));requests.push(u);return Response.json({success:true,result:{data:[row],count:4937,pages:124}});};
 try{
  const r=await earnings(new URLSearchParams(),new Date('2026-10-30T01:00:00Z'));
  assert.equal(r.period,'2026-09-30');assert.equal(r.total,4937);assert.equal(r.pageSize,40);assert.equal(r.pages,124);assert.equal(r.sort,'profitGrowth');assert.equal(r.items[0].symbol,'920571.BJ');
  assert.match(requests[1].searchParams.get('filter')!,/REPORTDATE='2026-09-30'/);assert.match(requests[1].searchParams.get('filter')!,/SECURITY_TYPE_CODE="058001001"/);assert.match(requests[1].searchParams.get('filter')!,/NOTICE_DATE<=/);
  assert.equal(requests[1].searchParams.get('sortColumns'),'SJLTZ,SECURITY_CODE');assert.equal(requests[1].searchParams.get('sortTypes'),'-1,1');assert.equal(requests[1].searchParams.get('pageSize'),'40');
  const page=await earnings(new URLSearchParams({page:'2',sort:'revenueGrowth',order:'asc',q:'国航远洋'}),new Date('2026-10-30T01:00:00Z'));
  assert.equal(page.page,2);assert.equal(requests.at(-1)!.searchParams.get('pageNumber'),'2');assert.equal(requests.at(-1)!.searchParams.get('sortColumns'),'YSTZ,SECURITY_CODE');assert.match(requests.at(-1)!.searchParams.get('filter')!,/SECURITY_NAME_ABBR="国航远洋"/);
 }finally{globalThis.fetch=original;}
});
test('invalid filters and future periods are rejected before any source request',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not fetch');};
 try{for(const p of [{period:'2027-03-31'},{page:'0'},{page:'NaN'},{q:'x")or(1=1'},{sort:'__proto__'},{period:'2026-09-31'}])await assert.rejects(()=>earnings(new URLSearchParams(p),new Date('2026-10-30')),RangeError);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('only the explicit provider no-data code becomes an empty search result',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async input=>new URL(String(input)).searchParams.get('pageSize')==='1'?Response.json({success:true,result:{data:[row],count:1,pages:1}}):Response.json({success:false,code:9201,message:'返回数据为空',result:null});
  const empty=await earnings(new URLSearchParams({q:'这家公司不存在'}),new Date('2026-10-30'));
  assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);
  globalThis.fetch=async()=>Response.json({success:false,code:9501,message:'参数不支持',result:null});
  await assert.rejects(()=>earnings(new URLSearchParams({q:'另一家公司'}),new Date('2026-10-30')),/财报披露源暂不可用/);
 }finally{globalThis.fetch=original;}
});
test('source errors and mixed report periods never masquerade as an empty or successful earnings ranking',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async input=>{const p=new URL(String(input)).searchParams;return Response.json({success:true,result:{data:[p.get('pageSize')==='1'?row:{...row,REPORTDATE:'2026-06-30'}],count:1,pages:1}});};
  await assert.rejects(()=>earnings(new URLSearchParams(),new Date('2026-10-29T00:00:00Z')),/报告期不一致/);
  globalThis.fetch=async()=>new Response('outage',{status:503});
  await assert.rejects(()=>earnings(new URLSearchParams(),new Date('2026-10-28T00:00:00Z')),/财报披露源暂不可用/);
 }finally{globalThis.fetch=original;}
});
