import type {F10Payload,Statement,MajorHolder} from '../shared/f10-types';
type Row=Record<string,unknown>;
const text=(v:unknown)=>typeof v==='string'?v.replace(/<[^>]*>/g,'').trim():'';
const num=(v:unknown)=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const date=(v:unknown)=>text(v).slice(0,10);
async function get(url:string){let failure:unknown;for(const endpoint of [url,...(url.includes('emweb.securities.')?[url.replace('emweb.securities.','emweb.')]:[])]){try{const r=await fetch(endpoint,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://emweb.securities.eastmoney.com/'},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('F10 HTTP '+r.status);return await r.json() as Record<string,Row[]|{data:Row[]}>;}catch(e){failure=e;}}throw failure;}
export async function f10(symbol:string):Promise<F10Payload>{
 const code=symbol.slice(-2)+symbol.slice(0,6),base='https://emweb.securities.eastmoney.com/PC_HSF10/';
 const urls=[base+'CompanySurvey/PageAjax?code='+code,'https://datacenter-web.eastmoney.com/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_DMSK_FN_INCOME',columns:'SECUCODE,REPORT_DATE,NOTICE_DATE,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,TOI_RATIO,PARENT_NETPROFIT_RATIO',filter:`(SECUCODE="${symbol}")`,sortColumns:'REPORT_DATE',sortTypes:'-1',pageSize:'8',pageNumber:'1'}),base+'BusinessAnalysis/PageAjax?code='+code,base+'ShareholderResearch/PageAjax?code='+code];
 const statementSources=['fzb','lrb','llb'].map(kind=>'https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022?'+new URLSearchParams({paperCode:code.toLowerCase(),source:kind,type:'0',page:'1',num:'8'}));
 const [result,statementResult]=await Promise.all([Promise.allSettled(urls.map(get)),Promise.allSettled(statementSources.map(async(url,i)=>({url,i,data:await(await fetch(url,{signal:AbortSignal.timeout(6500)})).json() as {result?:{data?:{report_list?:Record<string,{publish_date?:string;rCurrency?:string;rType?:string;is_audit?:string;data?:Row[]}>}}}})))]);const warnings:string[]=[],sources:{label:string;url:string}[]=[];
 const labels=['公司概况','利润表','主营构成','股东户数'];
 const read=(i:number,key:string):Row[]=>{const r=result[i];if(r.status==='rejected'){warnings.push(labels[i]+'：来源暂不可用');return [];}
  const raw=key==='result'?(r.value.result as {data:Row[]})?.data:r.value[key];
  if(!Array.isArray(raw)||!raw.length){warnings.push(labels[i]+'：当前源暂无记录');return [];}
  const rows=raw.filter(r=>!r.SECUCODE||r.SECUCODE===symbol);if(rows.length!==raw.length){warnings.push(labels[i]+'：证券代码不一致');return [];}
  sources.push({label:labels[i],url:urls[i]});return rows;
 };
 const profileRows=read(0,'jbzl'),profileRow=profileRows[0],raw=result[0].status==='fulfilled'?result[0].value:null,issuance=Array.isArray(raw?.fxxg)?raw.fxxg[0]:null;
 const financials=read(1,'result').filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(date(r.REPORT_DATE))&&/^\d{4}-\d{2}-\d{2}$/.test(date(r.NOTICE_DATE))&&date(r.NOTICE_DATE)<=new Date().toISOString().slice(0,10)).map(r=>({date:date(r.REPORT_DATE),published:date(r.NOTICE_DATE),revenue:num(r.TOTAL_OPERATE_INCOME),profit:num(r.PARENT_NETPROFIT),revenueGrowth:num(r.TOI_RATIO),profitGrowth:num(r.PARENT_NETPROFIT_RATIO)}));
 const business=read(2,'zygcfx').map(r=>({date:date(r.REPORT_DATE),kind:text(r.MAINOP_TYPE),name:text(r.ITEM_NAME),revenue:num(r.MAIN_BUSINESS_INCOME),ratio:num(r.MBI_RATIO),margin:num(r.GROSS_RPOFIT_RATIO)}));
 const holders=read(3,'gdrs').slice(0,8).map(r=>({date:date(r.END_DATE),count:num(r.HOLDER_TOTAL_NUM),change:num(r.TOTAL_NUM_RATIO),average:num(r.AVG_FREE_SHARES)}));
 const today=new Date().toISOString().slice(0,10),normalDate=(v:unknown)=>{const t=text(v);return /^\d{8}$/.test(t)?t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8):date(t);};
 const statements:Statement[]=[];
 for(let i=0;i<statementResult.length;i++){const r=statementResult[i],label=['资产负债表','利润表','现金流量表'][i];if(r.status==='rejected'){warnings.push(label+'：新浪来源暂不可用');continue;}
 for(const [key,report] of Object.entries(r.value.data.result?.data?.report_list||{})){const period=normalDate(key),published=normalDate(report.publish_date);if(!published||published>today||period>today)continue;
 statements.push({kind:['fzb','lrb','llb'][i],label,date:period,published,currency:report.rCurrency||'未提供',scope:report.rType||'',audited:report.is_audit||'',items:(report.data||[]).map(r=>({name:text(r.item_title),value:num(r.item_value),growth:num(r.item_tongbi)===null?null:num(r.item_tongbi)!*100})).filter(r=>r.name&&r.value!==null)});}
 if(statements.some(s=>s.label===label))sources.push({label:'新浪'+label,url:statementSources[i]});else warnings.push(label+'：暂无已披露记录');}
 statements.sort((a,b)=>b.date.localeCompare(a.date));
 if(!financials.length){for(const r of statements.filter(s=>s.kind==='lrb')){const find=(pattern:RegExp)=>r.items.find(v=>pattern.test(v.name));const revenue=find(/^营业总收入$/)||find(/^营业收入$/),profit=find(/归属于母公司.*净利润/);financials.push({date:r.date,published:r.published,revenue:revenue?.value??null,profit:profit?.value??null,revenueGrowth:revenue?.growth??null,profitGrowth:profit?.growth??null});}}
 const holderRaw=result[3].status==='fulfilled'?result[3].value:{};
 const holderRows=(key:string):Row[]=>Array.isArray(holderRaw[key])?(holderRaw[key] as Row[]).filter(r=>r.SECUCODE===symbol&&date(r.END_DATE||r.REPORT_DATE)<=today):[];
 const mapHolder=(r:Row,floating=false):MajorHolder=>({date:date(r.END_DATE),rank:num(r.HOLDER_RANK)||0,name:text(r.HOLDER_NAME),shares:num(r.HOLD_NUM),ratio:num(floating?r.FREE_HOLDNUM_RATIO:r.HOLD_NUM_RATIO),change:text(r.HOLD_NUM_CHANGE),type:text(r.HOLDER_TYPE||r.SHARES_TYPE)});
 const majorHolders=holderRows('sdgd').map(r=>mapHolder(r)),floatHolders=holderRows('sdltgd').map(r=>mapHolder(r,true));
 const controllers=Array.isArray(holderRaw.sjkzr)?(holderRaw.sjkzr as Row[]).filter(r=>r.SECUCODE===symbol).map(r=>({name:text(r.HOLDER_NAME),ratio:num(r.HOLD_RATIO)})):[];
 const institutions=holderRows('jgcc').map(r=>({date:date(r.REPORT_DATE),type:text(r.ORG_TYPE),count:num(r.TOTAL_ORG_NUM),shares:num(r.TOTAL_FREE_SHARES),ratio:num(r.TOTAL_SHARES_RATIO)}));
 if(!profileRow&&!financials.length&&!business.length&&!holders.length&&!statements.length)throw new Error('F10资料暂不可用，请稍后重试');
 return {source:'东方财富 F10 / 新浪财务披露汇总',sourceUrl:urls[0],fetchedAt:new Date().toISOString(),available:true,symbol,profile:profileRow?{name:text(profileRow.ORG_NAME),industry:text(profileRow.EM2016)||text(profileRow.INDUSTRYCSRC1),business:text(profileRow.BUSINESS_SCOPE),description:text(profileRow.ORG_PROFILE),listing:date(issuance?.LISTING_DATE),founded:date(issuance?.FOUND_DATE),chairman:text(profileRow.CHAIRMAN),employees:num(profileRow.EMP_NUM),province:text(profileRow.PROVINCE)}:null,financials,business,holders,statements,majorHolders,floatHolders,controllers,institutions,warnings,sources};
}
