import {test} from 'node:test';
import assert from 'node:assert/strict';
import {f10} from '../src/worker/f10';
test('F10 keeps statement publication dates, ownership denominators and per-source failures',async()=>{
 const saved=globalThis.fetch;
 globalThis.fetch=async input=>{const u=new URL(String(input));let data:unknown={};
 if(u.pathname.includes('CompanySurvey'))data={jbzl:[{SECUCODE:'300031.SZ',ORG_NAME:'宝通科技'}]};
 if(u.pathname.includes('ShareholderResearch'))data={gdrs:[{SECUCODE:'300031.SZ',END_DATE:'2026-06-30',HOLDER_TOTAL_NUM:100}],sdgd:[{SECUCODE:'300031.SZ',END_DATE:'2026-06-30',HOLDER_NAME:'A',HOLDER_RANK:1,HOLD_NUM:500,HOLD_NUM_RATIO:10}],sdltgd:[{SECUCODE:'300031.SZ',END_DATE:'2026-06-30',HOLDER_NAME:'A',HOLDER_RANK:1,HOLD_NUM:300,FREE_HOLDNUM_RATIO:15},{SECUCODE:'600000.SH',END_DATE:'2026-06-30',HOLDER_NAME:'wrong'}]};
 if(u.hostname==='quotes.sina.cn')data={result:{data:{report_list:{'20260630':{publish_date:'20260801',rCurrency:'CNY',rType:'合并期末',data:[{item_title:'营业收入',item_value:'100000000',item_tongbi:.15},{item_title:'归属于母公司所有者的净利润',item_value:10000,item_tongbi:null}]},'20990630':{publish_date:'20990801',data:[{item_title:'未来收入',item_value:999}]}}}}};
 return new Response(JSON.stringify(data),{status:200});};
 try{const d=await f10('300031.SZ');assert.equal(d.statements.length,3);assert.equal(d.statements[0].published,'2026-08-01');assert.equal(d.statements[0].items[0].growth,15);assert.equal(d.financials[0].revenue,100000000);assert.equal(d.majorHolders[0].ratio,10);assert.equal(d.floatHolders.length,1);assert.equal(d.floatHolders[0].ratio,15);assert.ok(d.warnings.length>0);}finally{globalThis.fetch=saved;}
});
