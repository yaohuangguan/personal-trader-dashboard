import type {F10Payload} from '../shared/f10-types';
type Row=Record<string,unknown>;
const text=(v:unknown)=>typeof v==='string'?v.replace(/<[^>]*>/g,'').trim():'';
const num=(v:unknown)=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const date=(v:unknown)=>text(v).slice(0,10);
async function get(url:string){let failure:unknown;for(const endpoint of [url,...(url.includes('emweb.securities.')?[url.replace('emweb.securities.','emweb.')]:[])]){try{const r=await fetch(endpoint,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://emweb.securities.eastmoney.com/'},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('F10 HTTP '+r.status);return await r.json() as Record<string,Row[]|{data:Row[]}>;}catch(e){failure=e;}}throw failure;}
export async function f10(symbol:string):Promise<F10Payload>{
 const code=symbol.slice(-2)+symbol.slice(0,6),base='https://emweb.securities.eastmoney.com/PC_HSF10/';
 const urls=[base+'CompanySurvey/PageAjax?code='+code,'https://datacenter-web.eastmoney.com/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_DMSK_FN_INCOME',columns:'SECUCODE,REPORT_DATE,NOTICE_DATE,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,TOI_RATIO,PARENT_NETPROFIT_RATIO',filter:`(SECUCODE="${symbol}")`,sortColumns:'REPORT_DATE',sortTypes:'-1',pageSize:'8',pageNumber:'1'}),base+'BusinessAnalysis/PageAjax?code='+code,base+'ShareholderResearch/PageAjax?code='+code];
 const result=await Promise.allSettled(urls.map(get));const warnings:string[]=[],sources:{label:string;url:string}[]=[];
 const labels=['公司概况','利润表','主营构成','股东户数'];
 const read=(i:number,key:string):Row[]=>{const r=result[i];if(r.status==='rejected'){warnings.push(labels[i]+'：来源暂不可用');return [];}
  const raw=key==='result'?(r.value.result as {data:Row[]})?.data:r.value[key];
  if(!Array.isArray(raw)||!raw.length){warnings.push(labels[i]+'：当前源暂无记录');return [];}
  const rows=raw.filter(r=>!r.SECUCODE||r.SECUCODE===symbol);if(rows.length!==raw.length){warnings.push(labels[i]+'：证券代码不一致');return [];}
  sources.push({label:labels[i],url:urls[i]});return rows;
 };
 const profileRows=read(0,'jbzl'),profileRow=profileRows[0],raw=result[0].status==='fulfilled'?result[0].value:null,issuance=Array.isArray(raw?.fxxg)?raw.fxxg[0]:null;
 const financials=read(1,'result').filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(date(r.REPORT_DATE))&&date(r.NOTICE_DATE)<=new Date().toISOString().slice(0,10)).map(r=>({date:date(r.REPORT_DATE),published:date(r.NOTICE_DATE),revenue:num(r.TOTAL_OPERATE_INCOME),profit:num(r.PARENT_NETPROFIT),revenueGrowth:num(r.TOI_RATIO),profitGrowth:num(r.PARENT_NETPROFIT_RATIO)}));
 const business=read(2,'zygcfx').map(r=>({date:date(r.REPORT_DATE),kind:text(r.MAINOP_TYPE),name:text(r.ITEM_NAME),revenue:num(r.MAIN_BUSINESS_INCOME),ratio:num(r.MBI_RATIO),margin:num(r.GROSS_RPOFIT_RATIO)}));
 const holders=read(3,'gdrs').slice(0,8).map(r=>({date:date(r.END_DATE),count:num(r.HOLDER_TOTAL_NUM),change:num(r.TOTAL_NUM_RATIO),average:num(r.AVG_FREE_SHARES)}));
 if(!profileRow&&!financials.length&&!business.length&&!holders.length)throw new Error('F10资料暂不可用，请稍后重试');
 return {source:'东方财富 F10 / 财务披露汇总',sourceUrl:urls[0],fetchedAt:new Date().toISOString(),available:true,symbol,profile:profileRow?{name:text(profileRow.ORG_NAME),industry:text(profileRow.EM2016)||text(profileRow.INDUSTRYCSRC1),business:text(profileRow.BUSINESS_SCOPE),description:text(profileRow.ORG_PROFILE),listing:date(issuance?.LISTING_DATE),founded:date(issuance?.FOUND_DATE),chairman:text(profileRow.CHAIRMAN),employees:num(profileRow.EMP_NUM),province:text(profileRow.PROVINCE)}:null,financials,business,holders,warnings,sources};
}
