import type {RankedStock,Pool} from '../shared/market-overview';
import type {ChipBar} from '../shared/market-models';
type Row=Record<string,unknown>;
const n=(v:unknown)=>v===null||v===''||v===undefined||!Number.isFinite(Number(v))?null:Number(v);
const stamp=(source:string,sourceUrl:string)=>({source,sourceUrl,available:true,fetchedAt:new Date().toISOString()});
async function get(url:string,timeout=6500,signal?:AbortSignal){signal?.throwIfAborted();const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:url.includes('sina')?'https://finance.sina.com.cn/':'https://quote.eastmoney.com/'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});if(!r.ok)throw new Error('数据源 HTTP '+r.status);return r;}
function symbol(code:string,market?:unknown){return code+'.'+(market===1||/^6/.test(code)?'SH':market===0||/^[03]/.test(code)?'SZ':'BJ');}
export async function gainers(){
 const url='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?'+new URLSearchParams({page:'1',num:'80',sort:'changepercent',asc:'0',node:'hs_a',symbol:'',_s_r_a:'page'});
 const rows=JSON.parse(new TextDecoder('gbk').decode(await (await get(url)).arrayBuffer())) as Row[];
 if(!Array.isArray(rows)||!rows.length)throw new Error('涨幅榜源暂无数据');
 const items=rows.filter(r=>/^(sh|sz|bj)\d{6}$/.test(String(r.symbol))).map(r=>({symbol:String(r.symbol).slice(2)+'.'+String(r.symbol).slice(0,2).toUpperCase(),name:String(r.name),price:n(r.trade),changePercent:n(r.changepercent),amount:n(r.amount),turnover:n(r.turnoverratio)}));
 return {...stamp('新浪全市场涨幅前80公开快照',url),items,date:null,scope:'源包含沪深北股票，按涨幅降序，非全市场上涨家数；来源未提供交易日期。'};
}
export async function marketPools(date:string,signal?:AbortSignal){
 const definitions=[['up','getTopicZTPool','fbt:asc'],['down','getTopicDTPool','fund:asc'],['broken','getTopicZBPool','fbt:asc'],['yesterday','getYesterdayZTPool','zs:desc']] as const;
 const pools={} as Record<'up'|'down'|'broken'|'yesterday',Pool>;
 await Promise.all(definitions.map(async([key,endpoint,sort])=>{
  try{
   const url='https://push2ex.eastmoney.com/'+endpoint+'?'+new URLSearchParams({ut:'7eea3edcaed734bea9cbfc24409ed989',dpt:'wz.ztzt',Pageindex:'0',pagesize:'10000',sort,date:date.replaceAll('-','')});
   const data=(await (await get(url,4500,signal)).json() as {data?:{pool?:Row[];qdate?:number;tc?:number}}).data;
   if(!data||!Array.isArray(data.pool)||String(data.qdate)!==date.replaceAll('-',''))throw new Error('此交易日尚无可核验的池数据');
   const unique=new Map<string,RankedStock>();
   for(const r of data.pool){const code=String(r.c);if(!/^\d{6}$/.test(code))continue;unique.set(code,{symbol:symbol(code,r.m),name:String(r.n),price:n(r.p)===null?null:Number(r.p)/1000,changePercent:n(r.zdp),amount:n(r.amount),turnover:n(r.hs),industry:String(r.hybk||''),date});}
   if(n(data.tc)!==null&&data.pool.length!==Number(data.tc))throw new Error('来源股票池未完整返回');
   pools[key]={available:true,items:[...unique.values()].sort((a,b)=>(b.changePercent??-Infinity)-(a.changePercent??-Infinity)),total:unique.size,date};
  }catch(e){pools[key]={available:false,items:[],total:null,date,reason:e instanceof Error?e.message:'来源暂不可用'};}
 }));
 return {...stamp('东方财富公开涨跌停池','https://quote.eastmoney.com/ztb/detail#type=ztgc'),date,pools,notice:'东财股票池口径；不等于沪深北全市场涨跌家数。昨日涨停为上一交易日涨停股在所选交易日的表现。'};
}
export async function dragon(end:string){
 const d=new Date(end+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-7);const start=d.toISOString().slice(0,10);
 const base='https://datacenter-web.eastmoney.com/api/data/v1/get?',params={reportName:'RPT_DAILYBILLBOARD_DETAILSNEW',columns:'ALL',sortColumns:'TRADE_DATE,SECURITY_CODE',sortTypes:'-1,1',pageSize:'500',filter:`(TRADE_DATE>='${start}')(TRADE_DATE<='${end}')`};
 const unique=new Map<string,RankedStock>();let pages=1,complete=false;
 for(let page=1;page<=Math.min(pages,8);page++){
  const payload=await (await get(base+new URLSearchParams({...params,pageNumber:String(page)}))).json() as {result?:{pages?:number;data?:Row[]}};
  if(!payload.result||!Array.isArray(payload.result.data))throw new Error('龙虎榜暂未披露或来源不可用');
  pages=Number(payload.result.pages)||1;
  for(const r of payload.result.data){const code=String(r.SECURITY_CODE),date=String(r.TRADE_DATE).slice(0,10);if(!/^\d{6}$/.test(code)||date<start||date>end)continue;
   const key=symbol(code),old=unique.get(key);if(!old)unique.set(key,{symbol:key,name:String(r.SECURITY_NAME_ABBR),price:n(r.CLOSE_PRICE),changePercent:n(r.CHANGE_RATE),amount:null,turnover:n(r.TURNOVERRATE),date,reason:String(r.EXPLANATION||''),net:n(r.BILLBOARD_NET_AMT)});
  }
  if(page>=pages){complete=true;break;}
 }
 const items=[...unique.values()];return {...stamp('东方财富龙虎榜披露汇总',base+new URLSearchParams(params)),start,end,latestDate:items[0]?.date||null,items,complete,notice:'最近8个自然日内最近一次上榜；榜单披露价不是实时价，多条上榜原因不重复累加净额。'};
}
export async function chips(raw:string){
 const code=raw.slice(0,6),secid=(raw.endsWith('.SH')?'1':raw.endsWith('.BJ')?'0':'0')+'.'+code;
 const url='https://push2his.eastmoney.com/api/qt/stock/kline/get?'+new URLSearchParams({secid,klt:'101',fqt:'1',beg:'0',end:'20500101',lmt:'500',fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'});
 const payload=await (await get(url,4500)).json() as {data?:{klines?:string[]}};
 const bars:ChipBar[]=(payload.data?.klines||[]).map(line=>{const r=line.split(',');return {time:r[0],open:Number(r[1]),close:Number(r[2]),high:Number(r[3]),low:Number(r[4]),volume:Number(r[5]),turnover:Number(r[10])};}).filter(c=>/^\d{4}-\d{2}-\d{2}$/.test(c.time)&&[c.open,c.high,c.low,c.close,c.volume,c.turnover].every(Number.isFinite)&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.turnover>=0);
 if(bars.length<30)throw new Error('历史换手率源暂不可用');
 return {...stamp('东方财富前复权日线与历史换手率',url),symbol:raw,bars,basis:'historical-turnover' as const};
}
