import {chineseSymbol,intraday,memo,num,parseTickPage,peers,eastmoney} from './desk-data';
import {emptyAuctionSegments,parseAuctionTrends} from '../shared/auction';
import {sessionMinute} from '../shared/intraday-axis';
import type {IntradayPoint} from '../shared/desk-types';
async function text(url:string){const r=url.includes('eastmoney.com')?await eastmoney(url,3500):await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://gu.qq.com/'},signal:AbortSignal.timeout(3500)});if(!r.ok)throw Error('数据源 HTTP '+r.status);return r.text();}
const trendsURL=(secid:string)=>'https://push2his.eastmoney.com/api/qt/stock/trends2/get?'+new URLSearchParams({secid,fields1:'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',fields2:'f51,f52,f53,f54,f55,f56,f57,f58',ndays:'1',iscr:'1',iscca:'1'});
export async function auction(raw:string){
 const {symbol,secid,wire}=chineseSymbol(raw),sourceUrl=trendsURL(secid),fetchedAt=new Date().toISOString();
 if(/^(000\d{3}\.SH|399\d{3}\.SZ|899050\.BJ)$/.test(symbol))return {symbol,date:null,segments:emptyAuctionSegments(),available:false,source:'交易时段说明',sourceUrl:'https://www.sse.com.cn/',fetchedAt,notice:'指数本身不参与股票集合竞价；请在成分股查看竞价。'};
 try{
  const r=JSON.parse(await text(sourceUrl)) as {data?:{trends?:string[];preClose?:number}};
  const records=r.data?.trends;if(!records?.length)throw Error('竞价源未返回时间序列');
  const date=records.at(-1)!.slice(0,10),segments=parseAuctionTrends(records.filter(v=>v.slice(0,10)===date));
  if(!segments.some(s=>s.points.length))throw Error('竞价时段尚无可用记录');
  return {symbol,date,segments,available:true,source:'东方财富公开竞价/分时',sourceUrl,fetchedAt,volumeUnit:'手',notice:'公开快照，非Level-2；虚拟撮合量与实际成交量分别显示。'};
 }catch{
  const segments=emptyAuctionSegments(),warnings:string[]=['竞价参考价序列源暂不可用；以下仅展示独立核验到的撮合结果或成交样本。'];
  const feed=await memo('intraday'+symbol,15,()=>intraday(symbol));
  if(!symbol.endsWith('.BJ')&&!/^(000\d{3}\.SH|399\d{3}\.SZ)$/.test(symbol)){
   try{
    const base='https://stock.gtimg.cn/data/index.php?appn=detail&c='+wire;
    const listing=await text(base+'&action=pages'),m=new RegExp('v_detail_time_'+wire+'=\\[(\\d{8}),"([^"]*)"\\]').exec(listing);
    if(m&&m[1]===feed.date?.replaceAll('-','')){
     const first=parseTickPage(await text(base+'&action=data&p=0'),wire,0);
     for(const p of first.filter(p=>p.time>='09:25:00'&&p.time<'09:30:00'))segments[0].points.push({clock:'09:25',sourceClock:p.time,price:p.price,volume:p.volume,amount:p.amount,indicative:false});
     const page=m[2].split('|').length-1;
     const tail=page===0?first:parseTickPage(await text(base+'&action=data&p='+page),wire,page);
     for(const p of tail.filter(p=>p.time>='15:05:00'&&p.time<='15:30:59'))segments[2].points.push({clock:p.time.slice(0,5),sourceClock:p.time,price:p.price,volume:p.volume,amount:p.amount,indicative:false});
     if(segments[2].points.length)segments[2].notice+=' 当前仅最后一页成交样本，不是盘后全量或累计成交。';
    }
   }catch{warnings.push('开盘撮合分笔暂不可核验。');}
  }
  // Normal closing minutes are observations, not invented indicative auction quotes.
  for(const p of feed.points.filter(p=>p.clock>='14:57'&&p.clock<='15:00'))segments[1].points.push({clock:p.clock,sourceClock:p.clock,price:p.price,volume:feed.volumeUnit==='股'?p.volume/100:p.volume,amount:null,indicative:false,observation:true});
  return {symbol,date:feed.date,segments,available:segments.some(s=>s.points.length),source:'腾讯公开分笔/分钟快照',sourceUrl:'https://gu.qq.com/',fetchedAt,volumeUnit:'手',warnings,notice:'不将09:30连续交易成交量当竞价，不估算撤单、虚拟未匹配量。盘后固定价样本缺失时不补零。'};
 }
}
/** Official board line first; bounded same-board equal-weight sample if unavailable. */
export async function sectorIntraday(code:string,name:string){
 const fetchedAt=new Date().toISOString();
 if(/^BK\d{4,6}$/.test(code))try{
  const sourceUrl=trendsURL('90.'+code),r=JSON.parse(await text(sourceUrl)) as {data?:{trends?:string[];preClose?:number}};
  const records=r.data?.trends,previous=num(r.data?.preClose);
  if(!records?.length||!previous||previous<=0)throw Error('板块分时缺少昨收');
  const date=records.at(-1)!.slice(0,10),points=records.filter(r=>r.slice(0,10)===date).flatMap(row=>{const f=row.split(','),clock=f[0].slice(11,16),price=num(f[2]);return sessionMinute(clock)!==null&&price&&price>0?[{time:Date.parse(date+'T'+clock+':00+08:00')/1000,clock,price,volume:0,cumulativeVolume:0,amount:null}]:[];});
  if(!points.length)throw Error('板块分时尚无成交');
  return {symbol:code,name,date,previous,points,available:true,source:'东方财富板块指数',sourceUrl,fetchedAt,classification:'official'};
 }catch{/* A sample is explicitly distinguished from an official index. */}
 const members=await memo('overlay-members:'+code+':'+name,300,()=>peers(code,name));
 const related='related' in members&&members.related;
 const symbols=[...new Set(members.items.map(p=>p.symbol))].slice(0,6);
 const results=await Promise.allSettled(symbols.map(s=>memo('overlay-minute:'+s,60,()=>intraday(s))));
 const feeds=results.filter((r):r is PromiseFulfilledResult<Awaited<ReturnType<typeof intraday>>>=>(r.status==='fulfilled')).map(r=>r.value).filter(r=>(r.previous||0)>0&&r.points.length);
 const dates=feeds.map(r=>r.date).sort(),date=dates.at(-1),same=feeds.filter(r=>r.date===date);
 if(same.length<3||!date)throw Error('同交易日板块成分样本不足3只，暂不叠加');
 const grouped=new Map<string,{time:number;values:number[]}>();
 for(const feed of same)for(const p of feed.points){if(sessionMinute(p.clock)===null)continue;const item=grouped.get(p.clock)||{time:p.time,values:[]};item.values.push(p.price/feed.previous!*100);grouped.set(p.clock,item);}
 const points:IntradayPoint[]=[...grouped].filter(([,v])=>v.values.length>=Math.max(3,Math.ceil(same.length*.7))).map(([clock,v])=>({time:v.time,clock,price:v.values.reduce((a,b)=>a+b,0)/v.values.length,volume:0,cumulativeVolume:0,amount:null})).sort((a,b)=>a.time-b.time);
 if(!points.length)throw Error('板块成分同时段覆盖不足，暂不叠加');
 return {symbol:code,name:(('resolvedName' in members&&members.resolvedName)||name)+(related?' · 相关分类样本':' · 样本等权'),date,previous:100,points,available:true,source:'腾讯成分股分时 · 等权观测',sourceUrl:'https://gu.qq.com/',fetchedAt,classification:related?'related-sample':'sample',sampleCount:same.length,requestedCount:symbols.length,notice:(related?'原板块不可用，此处为新浪相关分类参考，非原板块指数。':'')+`${same.length}/${symbols.length}只样本，以各自昨收归一后等权，非官方板块指数；不填补缺失分钟。`};
}


export async function indexEqual(raw:string){
 const {symbol}=chineseSymbol(raw),nodes:Record<string,string>={'000001.SH':'sh_a','399001.SZ':'sz_a','399006.SZ':'cyb','000300.SH':'hs300','000688.SH':'kcb','899050.BJ':'bj_a'};
 const node=nodes[symbol];if(!node)throw Error('不支持的指数');
 const memberURL='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?'+new URLSearchParams({node,page:'1',num:'80',sort:'symbol',asc:'1'});
 const list=await memo('index-yellow-members:'+symbol,3600,async()=>{
  const r=await fetch(memberURL,{headers:{Referer:'https://finance.sina.com.cn/'},signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw Error('指数成分来源 HTTP '+r.status);
  const rows=JSON.parse(new TextDecoder('gbk').decode(await r.arrayBuffer())) as {symbol:string}[];
  if(!Array.isArray(rows))throw Error('指数成分格式不可用');
  const codes=rows.filter(r=>/^(sh|sz|bj)\d{6}$/.test(r.symbol)).map(r=>r.symbol.slice(2)+'.'+r.symbol.slice(0,2).toUpperCase());
  return [...new Set(Array.from({length:6},(_,i)=>codes[Math.floor(i*Math.max(0,codes.length-1)/5)]))].filter(Boolean);
 });
 if(list.length<3)throw Error('同源成分样本不足');
 const results=await Promise.allSettled(list.map(s=>memo('overlay-minute:'+s,90,()=>intraday(s))));
 const feeds=results.filter((r):r is PromiseFulfilledResult<Awaited<ReturnType<typeof intraday>>>=>(r.status==='fulfilled')).map(r=>r.value).filter(r=>(r.previous||0)>0&&r.points.length);
 const date=feeds.map(r=>r.date).sort().at(-1),same=feeds.filter(r=>r.date===date);
 if(!date||same.length<3)throw Error('同交易日样本不足，黄线暂不可用');
 const grouped=new Map<string,{time:number;values:number[]}>();
 for(const f of same)for(const p of f.points){if(sessionMinute(p.clock)===null)continue;const item=grouped.get(p.clock)||{time:p.time,values:[]};item.values.push(p.price/f.previous!*100);grouped.set(p.clock,item);}
 const points:IntradayPoint[]=[...grouped].filter(([,v])=>v.values.length>=Math.max(3,Math.ceil(same.length*.8))).map(([clock,v])=>({clock,time:v.time,price:v.values.reduce((s,v)=>s+v,0)/v.values.length,volume:0,cumulativeVolume:0,amount:null})).sort((a,b)=>a.time-b.time);
 return{available:points.length>0,symbol,date,previous:100,points,sampleCount:same.length,name:'成分样本等权（'+same.length+'只）',source:'新浪成分名单／腾讯或东方财富分时',sourceUrl:memberURL,fetchedAt:new Date().toISOString(),classification:'sample-equal',notice:'黄线为当前成分名单页中分散选取的'+same.length+'只股票等权涨跌参考，不是全成分不加权指数；来源不齐时不补假线。'};
}
