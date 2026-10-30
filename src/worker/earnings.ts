import {earningsRow,reportPeriods,earningsSorts,type EarningsPayload,type EarningsSort} from '../shared/earnings';
import {eastmoney,memo} from './desk-data';
type Result={success?:boolean;code?:number;message?:string;result?:{data:Record<string,unknown>[];count:number;pages:number}|null};
const fields='SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,REPORTDATE,NOTICE_DATE,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,YSTZ,SJLTZ,BASIC_EPS,WEIGHTAVG_ROE,BOARD_NAME,MGJYXJJE';
const sortFields:Record<EarningsSort,string>={profitGrowth:'SJLTZ',revenueGrowth:'YSTZ',profit:'PARENT_NETPROFIT',revenue:'TOTAL_OPERATE_INCOME',disclosed:'NOTICE_DATE'};
async function get(parameters:Record<string,string>,allowEmpty=false){
 let failure:unknown;
 for(const host of ['datacenter-web.eastmoney.com','datacenter.eastmoney.com'])try{
  const url='https://'+host+'/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_LICO_FN_CPD',columns:fields,source:'WEB',client:'WEB',...parameters});
  const data=await (await eastmoney(url,4500)).json() as Result;
  if(allowEmpty&&data.success===false&&data.code===9201&&data.result===null)return {data:[],count:0,pages:0};
  if(data.success===false||!data.result||!Array.isArray(data.result.data)||!Number.isInteger(data.result.count)||data.result.count<0||!Number.isInteger(data.result.pages))throw new Error(data.message||'财报来源未返回可核验的列表');
  return data.result;
 }catch(error){failure=error;}
 throw new Error('财报披露源暂不可用：'+String(failure));
}
export async function earnings(params:URLSearchParams,now=new Date()):Promise<EarningsPayload>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const requested=params.get('period')||'latest',sort=(params.get('sort')||'profitGrowth') as EarningsSort,order=params.get('order')||'desc',page=Number(params.get('page')||'1'),query=(params.get('q')||'').trim();
 if(!Object.hasOwn(earningsSorts,sort)||!['asc','desc'].includes(order)||!Number.isInteger(page)||page<1||page>1000||query.length>30||!/^[\p{L}\d*（）().\-\s]*$/u.test(query)||requested!=='latest'&&(!/^20\d{2}-(03-31|06-30|09-30|12-31)$/.test(requested)||requested>today))throw new RangeError('财报筛选参数无效');
 const scope=`(SECURITY_TYPE_CODE="058001001")(NOTICE_DATE<='${today}')(REPORTDATE<='${today}')`;
 const latest=await memo('earnings-period:'+today,3600,async()=>{
  const r=await get({filter:scope,sortColumns:'REPORTDATE',sortTypes:'-1',pageSize:'1',pageNumber:'1'}),date=String(r.data[0]?.REPORTDATE||'').slice(0,10);
  if(!/^20\d{2}-(03-31|06-30|09-30|12-31)$/.test(date)||date>today)throw new Error('暂无可核验的最新财报期');return date;
 });
 const period=requested==='latest'?latest:requested;
 const search=!query?'':/^\d{6}$/.test(query)?`(SECURITY_CODE="${query}")`:`(SECURITY_NAME_ABBR="${query}")`;
 const result=await get({filter:scope+`(REPORTDATE='${period}')`+search,sortColumns:sortFields[sort]+',SECURITY_CODE',sortTypes:(order==='desc'?'-1':'1')+',1',pageSize:'40',pageNumber:String(page)},true);
 const items=result.data.map(earningsRow);
 if(items.some(r=>!r||r.period!==period||r.disclosed>today)||new Set(items.map(r=>r!.symbol)).size!==items.length)throw new Error('财报字段或报告期不一致，暂不展示混合口径数据');
 return {items:items as EarningsPayload['items'],period,periods:[...new Set([latest,...reportPeriods(now),period])].sort().reverse(),page,pageSize:40,pages:result.pages,total:result.count,sort,order:order as 'asc'|'desc',query,source:'东方财富 · 上市公司正式业绩报表',sourceUrl:'https://data.eastmoney.com/bbsj/'+period.replaceAll('-','').slice(0,6)+'.html',fetchedAt:now.toISOString(),notice:'沪深北 A 股同一报告期已披露报表；半年报和三季报为年初至期末累计，同比对比上年同期。增长率沿用来源口径，缺失值为 —；高增速可能受低基数影响，亏损与现金流需同时核验。未披露公司不纳入排行，不混入业绩预告。'};
}
