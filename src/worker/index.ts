import type { Candle, MarketPayload, NewsItem, NewsPayload, SearchItem, FundamentalsPayload, FinanceMetric } from '../shared/types';
import { CATALOG, SECTORS, NEWS_CATEGORIES, normalizeSymbol, searchLocal } from '../shared/catalog';

interface Env { ASSETS?:{fetch(request:Request):Promise<Response>}; SEC_USER_AGENT?:string; TWELVE_DATA_API_KEY?:string; APP_NAME?:string }
type CacheValue={until:number;body:unknown};
const memory=new Map<string,CacheValue>();
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':status===200?'public, max-age=30, s-maxage=90':'no-store','x-content-type-options':'nosniff'}});
const validSymbol=(s:string)=>/^[A-Z0-9^.-]{1,18}$/.test(s);
const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
function withTimeout(url:string, opts:RequestInit={},timeout=9000):Promise<Response>{
  return fetch(url,{...opts,signal:AbortSignal.timeout(timeout),headers:{'accept':'application/json, text/plain, text/xml, application/xml, */*',...(opts.headers||{})}});
}
async function cached<T>(key:string,ttl:number,fn:()=>Promise<T>):Promise<T>{
  const value=memory.get(key);if(value&&value.until>Date.now())return value.body as T;
  const result=await fn();if(memory.size>250)memory.clear();
  memory.set(key,{until:Date.now()+ttl*1000,body:result});return result;
}
function csv(text:string):Candle[]{
 const lines=text.trim().split(/\r?\n/),candles:Candle[]=[];
 if(!lines[0]?.startsWith('Date,'))throw new Error('Stooq returned no historical OHLCV data');
 for(const line of lines.slice(1)){
  const [time,o,h,l,c,v]=line.split(',');if(!/^\d{4}-\d{2}-\d{2}$/.test(time??''))continue;
  const item={time,open:num(o),high:num(h),low:num(l),close:num(c),volume:num(v)};
  if(item.open>0&&item.close>0&&item.high>0&&item.low>0)candles.push(item);
 }
 return candles.slice(-340);
}
async function stooq(symbol:string):Promise<{candles:Candle[];url:string}>{
 const t=symbol.toLowerCase()+'.us';
 const from=new Date(Date.now()-800*86400000).toISOString().slice(0,10).replace(/-/g,'');
 const to=new Date().toISOString().slice(0,10).replace(/-/g,'');
 const url='https://stooq.com/q/d/l/?s='+encodeURIComponent(t)+'&i=d&d1='+from+'&d2='+to;
 const res=await withTimeout(url,{headers:{accept:'text/csv'}},13000);
 if(!res.ok)throw new Error('Stooq HTTP '+res.status);
 return {candles:csv(await res.text()),url};
}
async function eastmoney(symbol:string):Promise<{candles:Candle[];url:string}>{
 const code=symbol.slice(0,6),exchange=symbol.endsWith('.SH')?'1':'0';
 const url='https://push2his.eastmoney.com/api/qt/stock/kline/get?secid='+exchange+'.'+code+'&klt=101&fqt=1&lmt=340&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56';
 const res=await withTimeout(url,{},12000);if(!res.ok)throw new Error('Eastmoney HTTP '+res.status);
 const payload=await res.json() as {data?:{klines?:string[]}};
 const candles=(payload.data?.klines??[]).map((line:string)=>{
   const [time,o,c,h,l,v]=line.split(',');
   return {time,open:num(o),high:num(h),low:num(l),close:num(c),volume:num(v)};
 }).filter(c=>c.time&&c.close>0&&c.high>0&&c.low>0).slice(-340);
 return {candles,url};
}
async function twelveData(symbol:string,key:string):Promise<{candles:Candle[];url:string}>{
 const endpoint='https://api.twelvedata.com/time_series';
 const url=endpoint+'?symbol='+encodeURIComponent(symbol)+'&interval=1day&outputsize=340&apikey='+encodeURIComponent(key);
 const res=await withTimeout(url,{},13000);if(!res.ok)throw new Error('Twelve Data HTTP '+res.status);
 const payload=await res.json() as {status?:string;message?:string;values?:Array<{datetime:string;open:string;high:string;low:string;close:string;volume?:string}>};
 if(payload.status==='error'||!payload.values)throw new Error(payload.message||'No Twelve Data candles');
 const candles=payload.values.map(v=>({time:v.datetime.slice(0,10),open:num(v.open),high:num(v.high),low:num(v.low),close:num(v.close),volume:num(v.volume)})).sort((a,b)=>a.time.localeCompare(b.time));
 return {candles,url:endpoint};
}
async function market(symbolRaw:string,env:Env):Promise<MarketPayload>{
 const symbol=normalizeSymbol(symbolRaw);if(!validSymbol(symbol))throw new Error('Invalid ticker');
 const cn=/^\d{6}\.(SH|SZ)$/.test(symbol);
 const known=CATALOG.find(c=>c.symbol===symbol);
 let source:{candles:Candle[];url:string}|null=null,provider='',notice='',failure='';
 // Configure a licensed provider for production-grade reliability; free feeds are research-grade only.
 if(env.TWELVE_DATA_API_KEY){
  try{source=await twelveData(symbol,env.TWELVE_DATA_API_KEY);provider='Twelve Data';notice='Provider daily candles. Exchange entitlements and delay depend on your plan.';}
  catch(e){failure=e instanceof Error?e.message:String(e);}
 }
 if(!source){
  source=cn?await eastmoney(symbol):await stooq(symbol);
  provider=cn?'东方财富（非官方公开历史行情接口）':'Stooq（日线历史行情）';
  notice='日线历史数据，非交易所实时或逐笔报价。'+(failure?' Licensed provider fallback: '+failure:'');
 }
 const candles=source.candles;
 if(candles.length===0)throw new Error('No historical candles for '+symbol+'. Verify exchange and provider availability.');
 const last=candles.at(-1)?.close??null,previous=candles.at(-2)?.close??null;
 return {symbol,displaySymbol:symbol,name:known?.name??symbol,exchange:known?.exchange??(cn?'CN':'US'),currency:cn?'CNY':'USD',
  candles,last,previous,change:last!==null&&previous!==null?last-previous:null,changePercent:last!==null&&previous?((last/previous)-1)*100:null,
  asOf:candles.at(-1)?.time??null,delayed:true,provider,sourceUrl:source.url,notice};
}
const feeds:Record<string,{q:string;lang:'en'|'zh'}>={
 world:{q:'(geopolitics OR war OR diplomacy OR global economy) when:2d',lang:'en'},
 macro:{q:'(Federal Reserve OR inflation OR interest rates OR central bank OR China economy) when:2d',lang:'en'},
 'ai-hardware':{q:'(NVIDIA OR HBM OR AI chips OR data centers OR optical transceiver) when:4d',lang:'en'},
 'ai-software':{q:'(OpenAI OR AI agents OR artificial intelligence enterprise software) when:4d',lang:'en'},
 robotics:{q:'(humanoid robots OR robotics OR Tesla Optimus) when:5d',lang:'en'},
 biotech:{q:'(FDA approval OR biotechnology clinical trial OR innovative drugs) when:5d',lang:'en'},
 space:{q:'(SpaceX OR Rocket Lab OR commercial space satellite) when:5d',lang:'en'},
 energy:{q:'(energy storage OR battery technology OR renewable energy) when:5d',lang:'en'},
 consumer:{q:'(retail sales OR consumer spending OR luxury earnings) when:5d',lang:'en'}
};
function decodeXml(text:string):string{
 return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,code:string)=>String.fromCodePoint(code.startsWith('x')?parseInt(code.slice(1),16):parseInt(code,10)))
 .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/<[^>]+>/g,'').trim();
}
function tag(block:string,name:string):string {
 const match=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));
 return match?decodeXml(match[1]):'';
}
function parseFeed(xml:string,category:string):NewsItem[]{
 const entries=Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)).slice(0,30);
 return entries.map((m,i)=>{
  const title=tag(m[1],'title'),link=tag(m[1],'link'),source=tag(m[1],'source');
  const cleanSource=source||title.split(' - ').at(-1)||'News';
  const headline=title.endsWith(' - '+cleanSource)?title.slice(0,-(cleanSource.length+3)):title;
  const time=Date.parse(tag(m[1],'pubDate'));
  return {id:category+'-'+String(time||0)+'-'+i,title:headline,source:cleanSource,url:link,publishedAt:Number.isFinite(time)?new Date(time).toISOString():null,category,originalTitle:title};
 }).filter(item=>item.title.length>5&&item.url.startsWith('https://'));
}
async function fetchNewsLane(category:string):Promise<NewsItem[]>{
 const f=feeds[category];if(!f)return [];
 const url='https://news.google.com/rss/search?q='+encodeURIComponent(f.q)+(f.lang==='zh'?'&hl=zh-CN&gl=CN&ceid=CN:zh-Hans':'&hl=en-US&gl=US&ceid=US:en');
 const res=await withTimeout(url,{headers:{accept:'application/rss+xml, application/xml, text/xml'}},11000);
 if(!res.ok)throw new Error('News RSS HTTP '+res.status);
 const xml=await res.text();if(!xml.includes('<rss'))throw new Error('News feed was not RSS');
 return parseFeed(xml,category);
}
async function news(category:string):Promise<NewsPayload>{
 const keys=category==='all'?Object.keys(feeds):[category];if(!keys.every(k=>feeds[k]))throw new Error('Unknown news category');
 const results=await Promise.allSettled(keys.map(k=>cached('feed:'+k,180,()=>fetchNewsLane(k))));
 const warnings:string[]=[],items:NewsItem[]=[];
 for(let i=0;i<results.length;i++){
  const r=results[i];if(r.status==='fulfilled')items.push(...r.value);
  else warnings.push(keys[i]+': '+String(r.reason instanceof Error?r.reason.message:r.reason));
 }
 const seen=new Set<string>();
 const dedup=items.sort((a,b)=>(b.publishedAt||'').localeCompare(a.publishedAt||'')).filter(x=>{
  const key=x.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'').slice(0,72);
  if(seen.has(key))return false;seen.add(key);return true;
 }).slice(0,category==='all'?90:45);
 return {items:dedup,category,fetchedAt:new Date().toISOString(),sources:keys,warnings};
}
async function financials(symbol:string,env:Env):Promise<FundamentalsPayload>{
 const sourceUrl='https://www.sec.gov/edgar/search/';
 if(/\.(SH|SZ)$/.test(symbol))return {symbol,available:false,provider:'巨潮资讯',sourceUrl:'https://www.cninfo.com.cn/',notice:'A股公告入口已提供；结构化财报接口需要授权数据源，目前未接入。'};
 if(!env.SEC_USER_AGENT || env.SEC_USER_AGENT.includes('example.com'))
  return {symbol,available:false,provider:'SEC EDGAR',sourceUrl,notice:'需配置 SEC_USER_AGENT（真实联系方式）才能访问官方 SEC XBRL 接口。'};
 const hdr={'User-Agent':env.SEC_USER_AGENT,'Accept-Encoding':'gzip, deflate','Accept':'application/json'};
 const listRes=await withTimeout('https://www.sec.gov/files/company_tickers.json',{headers:hdr},14000);
 if(!listRes.ok)throw new Error('SEC ticker index HTTP '+listRes.status);
 const list=await listRes.json() as Record<string,{ticker:string;cik_str:number;title:string}>;
 const company=Object.values(list).find(x=>x.ticker.toUpperCase()===symbol);
 if(!company)return {symbol,available:false,provider:'SEC EDGAR',sourceUrl,notice:'SEC 未找到该股票代码。'};
 const cik=String(company.cik_str).padStart(10,'0');
 const factsRes=await withTimeout('https://data.sec.gov/api/xbrl/companyfacts/CIK'+cik+'.json',{headers:hdr},14000);
 if(!factsRes.ok)throw new Error('SEC companyfacts HTTP '+factsRes.status);
 const data=await factsRes.json() as {facts?:{['us-gaap']?:Record<string,{units?:Record<string,Array<{fy?:number;fp?:string;form?:string;end?:string;start?:string;val:number;filed?:string}>>}>}};
 const gaap=data.facts?.['us-gaap']??{};
 function annual(tags:string[]):FinanceMetric[]{
  const found=tags.map(t=>gaap[t]).find(Boolean);
  const records=found?.units?.USD??[];
  const annuals=records.filter(x=>x.form==='10-K'&&x.fp==='FY'&&x.start&&x.end&&(Date.parse(x.end)-Date.parse(x.start)>300*86400000));
  const byYear=new Map<number,number>();
  for(const e of annuals.sort((a,b)=>(a.filed||'').localeCompare(b.filed||''))){
   const year=Number(e.end?.slice(0,4));if(year>2000&&year<2100)byYear.set(year,e.val);
  }
  return Array.from(byYear,([year,value])=>({year,value,unit:'USD'})).sort((a,b)=>a.year-b.year).slice(-6);
 }
 return {symbol,available:true,company:company.title,cik,provider:'SEC EDGAR XBRL',
  revenue:annual(['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']),
  netIncome:annual(['NetIncomeLoss']),sourceUrl:'https://www.sec.gov/edgar/browse/?CIK='+cik,
  notice:'US GAAP 10-K 年度数据，非实时财报。口径因公司披露项目而异；请以原始报告为准。'};
}
async function handle(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url),p=url.pathname;
 if(req.method!=='GET')return json({error:'Method not allowed'},405);
 if(p==='/api/health')return json({status:'ok',serverTime:new Date().toISOString(),providers:{us:'Stooq daily',cn:'Eastmoney daily (unofficial)',news:'Google News RSS',filings:'SEC EDGAR (configuration required)'},mode:'research-grade'});
 if(p==='/api/catalog')return json({items:CATALOG,sectors:SECTORS});
 if(p==='/api/search'){
  const q=(url.searchParams.get('q')||'').slice(0,80),local=searchLocal(q);
  if(!q.trim()||!env.TWELVE_DATA_API_KEY)return json({items:local});
  try{
   const api='https://api.twelvedata.com/symbol_search?symbol='+encodeURIComponent(q)+'&apikey='+encodeURIComponent(env.TWELVE_DATA_API_KEY);
   const r=await withTimeout(api,{},5000),data=await r.json() as {data?:Array<{symbol:string;instrument_name:string;exchange:string;country:string}>};
   const found:SearchItem[]=(data.data||[]).slice(0,10).map(x=>({symbol:x.symbol,name:x.instrument_name,exchange:x.exchange}));
   return json({items:[...local,...found.filter(x=>!local.some(y=>y.symbol===x.symbol))].slice(0,15)});
  }catch{return json({items:local});}
 }
 if(p==='/api/market'){
  const symbol=normalizeSymbol(url.searchParams.get('symbol')||'');
  if(!validSymbol(symbol))return json({error:'Ticker must be 1–18 characters: letters, digits, dot, hyphen or caret'},400);
  try{return json(await cached('market:'+symbol+':'+Boolean(env.TWELVE_DATA_API_KEY),240,()=>market(symbol,env)));}
  catch(e){return json({error:'Market data temporarily unavailable',details:e instanceof Error?e.message:String(e),symbol},502);}
 }
 if(p==='/api/news'){
  const category=url.searchParams.get('category')||'all';
  if(!NEWS_CATEGORIES.some(c=>c.id===category))return json({error:'Unknown topic'},400);
  try{return json(await cached('news:'+category,180,()=>news(category)));}
  catch(e){return json({error:'News feed unavailable',details:String(e)},502);}
 }
 if(p==='/api/fundamentals'){
  const symbol=normalizeSymbol(url.searchParams.get('symbol')||'');
  if(!validSymbol(symbol))return json({error:'Invalid ticker'},400);
  try{return json(await cached('sec:'+symbol,21600,()=>financials(symbol,env)));}
  catch(e){return json({error:'SEC fundamentals unavailable',details:e instanceof Error?e.message:String(e)},502);}
 }
 return json({error:'Unknown API path'},404);
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 try {
  if(new URL(request.url).pathname.startsWith('/api/'))return await handle(request,env);
  return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
 }catch(e){return json({error:'Unexpected server error',details:e instanceof Error?e.message:String(e)},500);}
}};
