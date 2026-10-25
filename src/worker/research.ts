import type { Candle, NewsItem } from '../shared/types';
import { CATALOG } from '../shared/catalog';
export type ResearchEnv = {FMP_API_KEY?:string; SEC_USER_AGENT?:string};
const numeric=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const fixed=(s:string)=>/^[A-Z0-9.^-]{1,18}$/.test(s);

async function requestData(url:string,headers:HeadersInit={},timeout=11000){
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(timeout)});
 if(!r.ok)throw new Error('Provider returned HTTP '+r.status);
 return r.json();
}
export function validateDailyBars(bars:Candle[],limit=500):Candle[]{
 const byDate=new Map<string,Candle>();
 for(const c of bars){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(c.time))continue;
  if(![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite))continue;
  if(c.low<=0||c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0)continue;
  if(Date.parse(c.time+'T00:00:00Z')>Date.now()+86400000)continue;
  byDate.set(c.time,c);
 }
 return Array.from(byDate.values()).sort((a,b)=>a.time.localeCompare(b.time)).slice(-limit);
}
export async function fmpDaily(symbol:string,key:string):Promise<{candles:Candle[];url:string}> {
 if(!fixed(symbol))throw new Error('Invalid symbol');
 const from=new Date(Date.now()-880*86400000).toISOString().slice(0,10);
 const to=new Date().toISOString().slice(0,10);
 const endpoint='https://financialmodelingprep.com/stable/historical-price-eod/full';
 const payload=await requestData(endpoint+'?symbol='+encodeURIComponent(symbol)+'&from='+from+'&to='+to+'&apikey='+encodeURIComponent(key));
 if(!Array.isArray(payload))throw new Error('FMP returned no daily history (check plan entitlement)');
 const bars=validateDailyBars(payload.map((x:Record<string,unknown>)=>({
  time:String(x.date||''),open:numeric(x.open),high:numeric(x.high),low:numeric(x.low),close:numeric(x.close),volume:numeric(x.volume)
 })));
 if(bars.length<2)throw new Error('FMP history contains fewer than 2 valid trading days');
 return {candles:bars,url:'https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-full'};
}
export async function yahooDaily(symbol:string):Promise<{candles:Candle[];url:string}>{
 if(!fixed(symbol))throw new Error('Invalid symbol');
 // Unofficial, rate-limited Yahoo chart API: research-only best effort; do not circumvent 429.
 const endpoint='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol);
 const result=await requestData(endpoint+'?range=2y&interval=1d',{accept:'application/json'},8500) as
  {chart?:{result?:{timestamp?:number[];meta?:{exchangeTimezoneName?:string};indicators?:{quote?:Array<{open?:Array<number|null>;high?:Array<number|null>;low?:Array<number|null>;close?:Array<number|null>;volume?:Array<number|null>}>}}[]}};
 const body=result.chart?.result?.[0];
 if(!body?.timestamp?.length||!body.indicators?.quote?.[0])throw new Error('Yahoo daily OHLCV unavailable');
 const q=body.indicators.quote[0];
 const timezone=body.meta?.exchangeTimezoneName||'UTC';
 const bars=body.timestamp.map((t,i)=>({
  time:new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t*1000)),
  open:numeric(q.open?.[i]),high:numeric(q.high?.[i]),low:numeric(q.low?.[i]),
  close:numeric(q.close?.[i]),volume:numeric(q.volume?.[i])
 }));
 const candles=validateDailyBars(bars);
 if(candles.length<2)throw new Error('Yahoo returned no valid OHLCV');
 return {candles,url:'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/history/'};
}
export type EarningsEvent = {symbol:string;date:string;time:string|null;epsEstimated:number|null;epsActual:number|null;sourceUrl:string;source:'FMP';status:'scheduled'|'reported'};
export async function earningsCalendar(symbol:string,env:ResearchEnv):Promise<{available:boolean;items:EarningsEvent[];reason:string;provider:string}>{
 if(!env.FMP_API_KEY)return {available:false,items:[],reason:'需要配置具有 earnings-calendar 权限的 FMP API Key；不提供猜测日期。',provider:'Financial Modeling Prep'};
 if(!fixed(symbol))throw new Error('Invalid symbol');
 const from=new Date(Date.now()-35*86400000).toISOString().slice(0,10),to=new Date(Date.now()+110*86400000).toISOString().slice(0,10);
 const endpoint='https://financialmodelingprep.com/stable/earnings-calendar';
 const rows=await requestData(endpoint+'?from='+from+'&to='+to+'&apikey='+encodeURIComponent(env.FMP_API_KEY)) as Record<string,unknown>[];
 if(!Array.isArray(rows))throw new Error('FMP calendar unavailable for subscription plan');
 const items=rows.filter(x=>String(x.symbol).toUpperCase()===symbol).map(x=>({
  symbol,date:String(x.date||''),time:typeof x.time==='string'?x.time:null,
  epsEstimated:x.epsEstimated==null?null:numeric(x.epsEstimated),
  epsActual:x.epsActual==null?null:numeric(x.epsActual),source:'FMP' as const,
  status:x.epsActual==null?'scheduled' as const:'reported' as const,
  sourceUrl:'https://site.financialmodelingprep.com/developer/docs/stable/earnings-calendar'
 })).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 return {available:true,items,reason:items.length?'仅显示供应商已列出的日期；计划可能变动。':'授权接口未列出此证券在查询窗口内的财报日期。',provider:'Financial Modeling Prep'};
}
type SECRecent = {form?:string[];filingDate?:string[];accessionNumber?:string[];primaryDocument?:string[];reportDate?:string[]};
export async function officialFilings(symbol:string,env:ResearchEnv):Promise<{
 available:boolean;provider:string;sourceUrl:string;notice:string;
 items:{form:string;date:string;reportDate:string|null;url:string;title?:string;artCode?:string}[];
}>{
 if(/\.(SZ|SH)$/.test(symbol)){
  const code=symbol.slice(0,6);
  const endpoint='https://np-anotice-stock.eastmoney.com/api/security/ann';
  const result=await requestData(endpoint+'?sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web&stock_list='+code,{},12000) as
   {data?:{list?:Array<{art_code?:string;notice_date?:string;title?:string;columns?:Array<{column_name?:string}>}>}};
  const announcements=(result.data?.list||[]).filter(x=>x.art_code&&x.notice_date&&x.title).map(x=>({
   form:x.columns?.[0]?.column_name||'公告',date:x.notice_date!.slice(0,10),reportDate:null,
   title:x.title!,artCode:x.art_code!,
   url:'https://data.eastmoney.com/notices/detail/'+code+'/'+x.art_code+'.html'
  }));
  return {available:true,provider:'东方财富公开公告索引（非官方交易所接口）',
   sourceUrl:'https://www.cninfo.com.cn/new/index',
   notice:'公告来自东方财富第三方索引；正文和 PDF 可进一步查询，原始公告请到巨潮资讯或交易所核验。',items:announcements};
 }
 if(!env.SEC_USER_AGENT||env.SEC_USER_AGENT.includes('example.com'))return {
  available:false,provider:'SEC EDGAR',sourceUrl:'https://www.sec.gov/edgar/search/',
  notice:'配置 SEC_USER_AGENT（含可联系邮箱）后可读取官方 10-K、10-Q、8-K 披露历史。',items:[]
 };
 const headers={'User-Agent':env.SEC_USER_AGENT,'Accept':'application/json'};
 const index=await requestData('https://www.sec.gov/files/company_tickers.json',headers,12000) as Record<string,{ticker:string;cik_str:number}>;
 const company=Object.values(index).find(x=>x.ticker?.toUpperCase()===symbol);
 if(!company)return {available:false,provider:'SEC EDGAR',sourceUrl:'https://www.sec.gov/edgar/search/',
  notice:'未在 SEC 找到该证券的 CIK。',items:[]};
 const cik=String(company.cik_str).padStart(10,'0');
 const data=await requestData('https://data.sec.gov/submissions/CIK'+cik+'.json',headers,12000) as {filings?:{recent?:SECRecent}};
 const recent=data.filings?.recent||{},items: {form:string;date:string;reportDate:string|null;url:string}[]=[];
 for(let i=0;i<(recent.form?.length||0);i++){
  const form=recent.form?.[i]||'';
  if(!['10-K','10-Q','8-K','20-F','6-K'].includes(form))continue;
  const accession=recent.accessionNumber?.[i]||'',doc=recent.primaryDocument?.[i]||'';
  if(!accession||!doc)continue;
  items.push({form,date:recent.filingDate?.[i]||'',reportDate:recent.reportDate?.[i]||null,
   url:'https://www.sec.gov/Archives/edgar/data/'+company.cik_str+'/'+accession.replace(/-/g,'')+'/'+encodeURIComponent(doc)});
  if(items.length>=20)break;
 }
 return {available:true,provider:'SEC EDGAR',sourceUrl:'https://www.sec.gov/edgar/browse/?CIK='+cik,
  notice:'SEC 官方披露日期，不是下一次财报发布日期预测。',items};
}
export async function companyNews(symbol:string,items:NewsItem[]):Promise<{items:NewsItem[];source:'stored'|'index';notice:string}>{
 const company=CATALOG.find(c=>c.symbol===symbol),name=company?.name.toLowerCase();
 const narrow=items.filter(item=>{
  const title=item.title.toLowerCase();
  const matchName=!!name && name.length>=4 && title.includes(name);
  const matchTicker=symbol.length>=3 && /^[A-Z]+$/.test(symbol)
   && new RegExp('(^|[^a-z0-9])'+symbol.toLowerCase()+'([^a-z0-9]|$)').test(title);
  return matchName||matchTicker;
 });
 return {items:narrow.slice(0,25),source:'stored',notice:'只匹配已入库标题中的证券代码/公司名称；可能漏报，同名公司需要手动核验。'};
}

export async function tencentAshares(symbol:string):Promise<{candles:Candle[];url:string;name?:string}>{
 if(!/^\d{6}\.(SH|SZ)$/.test(symbol))throw new Error('Tencent adapter supports A shares only');
 const code=(symbol.endsWith('.SH')?'sh':'sz')+symbol.slice(0,6);
 const endpoint='https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
 const url=endpoint+'?param='+code+',day,,,500,qfq';
 const data=await requestData(url,{},10000) as {data?:Record<string,{qfqday?:string[][];day?:string[][];qt?:Record<string,string[]>}>};
 const rows=data.data?.[code]?.qfqday||data.data?.[code]?.day||[];
 const bars=validateDailyBars(rows.map(r=>({time:r[0],open:numeric(r[1]),close:numeric(r[2]),high:numeric(r[3]),low:numeric(r[4]),volume:numeric(r[5])})));
 if(bars.length<2)throw new Error('Tencent returned fewer than 2 valid daily bars');
 return {candles:bars,url:'https://gu.qq.com/'+code,name:data.data?.[code]?.qt?.[code]?.[1]};
}

export function headlineRiskTags(title:string):string[]{
 const rules:[RegExp,string][]=[
  [/业绩预告|业绩快报|年度报告|季度报告|半年度报告/,'业绩披露'],
  [/重大合同|中标|签订.*合同|订单/,'订单/合同'],
  [/回购/,'回购'],[/减持|增持|质押|股权转让/,'股权变动'],
  [/立案|处罚|监管措施|诉讼|仲裁|退市风险/,'风险事项'],
  [/并购|收购|资产重组/,'并购重组'],[/现金分红|利润分配/,'分红']
 ];
 return rules.filter(([pattern])=>pattern.test(title)).map(([,tag])=>tag);
}
export async function announcementDetail(artCode:string):Promise<{
 title:string;date:string;content:string;pdfUrl:string|null;tags:string[];provider:string;
}>{
 if(!/^AN\d{18}$/.test(artCode))throw new Error('Invalid announcement identifier');
 const endpoint='https://np-cnotice-stock.eastmoney.com/api/content/ann';
 const result=await requestData(endpoint+'?art_code='+artCode+'&client_source=web&page_index=1',{},12000) as
  {data?:{notice_title?:string;notice_date?:string;notice_content?:string;attach_url?:string}};
 const doc=result.data;
 if(!doc?.notice_title)throw new Error('Announcement content not available');
 const content=(doc.notice_content||'')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]*>/g,' ')
  .replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n')
  .slice(0,14000);
 return {title:doc.notice_title,date:(doc.notice_date||'').slice(0,10),content,pdfUrl:doc.attach_url?.startsWith('https://')?doc.attach_url:null,
  tags:headlineRiskTags(doc.notice_title),provider:'东方财富公告正文与附件（第三方索引）'};
}


/** Public BJ daily history: raw prices, explicitly not forward adjusted. */
async function sinaRawDaily(symbol:string,count=500):Promise<{candles:Candle[];url:string}> {
 if(!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol))throw new Error('Invalid Chinese symbol');
 const wire=symbol.slice(-2).toLowerCase()+symbol.slice(0,6),name='_'+wire+'_240_'+count;
 const url='https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20'+name+'=/CN_MarketData.getKLineData?symbol='+wire+'&scale=240&ma=no&datalen='+count;
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://finance.sina.com.cn/'},signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw new Error('Sina daily HTTP '+response.status);
 const text=await response.text(),match=new RegExp('var '+name+'=\\((\\[[\\s\\S]*?\\])\\);?\\s*$').exec(text);
 if(!match)throw new Error('Sina daily response format changed');
 const rows=JSON.parse(match[1]) as Record<string,unknown>[];
 if(!Array.isArray(rows))throw new Error('Sina returned no daily rows');
 const candles=validateDailyBars(rows.map(r=>({time:String(r.day||'').slice(0,10),open:numeric(r.open),close:numeric(r.close),high:numeric(r.high),low:numeric(r.low),volume:numeric(r.volume)})),count);
 if(candles.length<2)throw new Error('Sina daily history unavailable');
 return {candles,url};
}


export async function sinaBeijingDaily(symbol:string,count=500):Promise<{candles:Candle[];url:string}> {
 if(!/^\d{6}\.BJ$/.test(symbol))throw new Error('Invalid Beijing symbol');
 return sinaRawDaily(symbol,count);
}
export function parseSinaFactors(text:string,wire:string):{date:string;factor:number}[] {
 if(!/^(sh|sz)\d{6}$/.test(wire))throw new Error('Invalid factor symbol');
 const match=new RegExp('^\\s*var\\s+'+wire+'qfq\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;?\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)*$').exec(text);
 if(!match)throw new Error('Sina factor response format changed');
 const payload=JSON.parse(match[1]) as {data?:{d:string;f:string}[]};
 if(!Array.isArray(payload.data)||!payload.data.length||payload.data.length>1000)throw new Error('Sina adjustment factors unavailable');
 const rows=payload.data.map(row=>({date:row.d,factor:Number(row.f)}));
 if(rows.some(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||!Number.isFinite(r.factor)||r.factor<=0))throw new Error('Invalid Sina adjustment factor');
 return rows.sort((a,b)=>a.date.localeCompare(b.date));
}
export function applySinaFactors(candles:Candle[],factors:{date:string;factor:number}[]):Candle[] {
 const rows=candles.map(c=>{const factor=[...factors].reverse().find(f=>f.date<=c.time)?.factor;if(!factor)throw new Error('Missing historical adjustment factor');return {...c,open:c.open/factor,high:c.high/factor,low:c.low/factor,close:c.close/factor};});
 return validateDailyBars(rows,candles.length);
}
export async function sinaAdjustedDaily(symbol:string,count=500):Promise<{candles:Candle[];url:string}> {
 if(!/^\d{6}\.(SH|SZ)$/.test(symbol)||symbol.startsWith('000')&&symbol.endsWith('.SH')||symbol.startsWith('399')&&symbol.endsWith('.SZ'))throw new Error('Sina adjusted adapter supports Chinese equities');
 const raw=await sinaRawDaily(symbol,count),wire=symbol.slice(-2).toLowerCase()+symbol.slice(0,6);
 const url='https://finance.sina.com.cn/realstock/company/'+wire+'/qfq.js';
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://finance.sina.com.cn/'},signal:AbortSignal.timeout(6000)});
 if(!response.ok)throw new Error('Sina factors HTTP '+response.status);
 const factors=parseSinaFactors(await response.text(),wire),candles=applySinaFactors(raw.candles,factors);
 if(candles.length!==raw.candles.length)throw new Error('Adjustment produced invalid historical rows');
 return {candles,url:raw.url};
}
