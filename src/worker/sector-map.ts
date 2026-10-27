import {memo,num,flash} from './desk-data';
export type HeatSector={code:string;name:string;count:number;changePercent:number;amount:number|null;leader:string;leaderSymbol:string|null;leaderChange:number|null;mainNet:number|null};
const valid=/^SN:(?:gn_[A-Za-z0-9_]{1,40}|new_[a-z0-9]{2,20})$/;
const wireSymbol=(wire:string)=>/^(sh|sz|bj)\d{6}$/.test(wire)?wire.slice(2)+'.'+wire.slice(0,2).toUpperCase():null;
async function get(url:string){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://finance.sina.com.cn/'},signal:AbortSignal.timeout(6500)});if(!r.ok)throw new Error('板块来源 HTTP '+r.status);return new TextDecoder('gbk').decode(await r.arrayBuffer());}
export function parseConceptMap(text:string,kind:'concept'|'industry'):HeatSector[]{
 const start=text.indexOf('{');if(start<0)throw new Error('概念板块格式异常');
 const raw=JSON.parse(text.slice(start).trim().replace(/;$/,'')) as Record<string,string>;
 return Object.values(raw).map(value=>{const r=value.split(','),code='SN:'+r[0],count=num(r[2]),change=num(r[5]);
  if(!valid.test(code)||kind==='concept'&&!r[0].startsWith('gn_')||kind==='industry'&&!r[0].startsWith('new_')||!r[1]||count===null||count<1||change===null)throw new Error('板块分类或字段异常');
  return {code,name:r[1],count,changePercent:change,amount:num(r[7]),leader:r[12]||'',leaderSymbol:wireSymbol(r[8]),leaderChange:num(r[9]),mainNet:null};
 }).sort((a,b)=>b.changePercent-a.changePercent);
}
export async function sectorMap(kind:'concept'|'industry'){
 const url=kind==='concept'?'https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php?param=class':'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php';
 const items=parseConceptMap(await get(url),kind);if(!items.length)throw new Error('板块来源暂无数据');
 return {available:true,kind,items,source:kind==='concept'?'新浪概念板块全分类':'新浪行业板块全分类',sourceUrl:url,fetchedAt:new Date().toISOString(),tradingDate:null,notice:'来源未提供交易日期；涨幅为来源板块口径，面积按成交额。不同概念成分有重叠，成交额不能相加当作全市场总量。资金净额未提供，不补成零。'};
}
export async function sectorDetail(code:string){
 if(!valid.test(code))throw new Error('无效概念或行业代码');const node=code.slice(3);
 const maps=await memo('heat:'+ (node.startsWith('gn_')?'concept':'industry'),90,()=>sectorMap(node.startsWith('gn_')?'concept':'industry'));
 const board=maps.items.find(s=>s.code===code);if(!board)throw new Error('板块已不在当前来源分类中');
 const countUrl='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?'+new URLSearchParams({node});
 const count=num(JSON.parse(await get(countUrl)));if(count===null||count<1||count>1000)throw new Error('板块成分数量异常');
 const all:Record<string,unknown>[]=[];
 for(let page=1;page<=Math.ceil(count/80);page+=4){const pages=await Promise.all(Array.from({length:Math.min(4,Math.ceil(count/80)-page+1)},(_,i)=>page+i).map(async page=>{
  const url='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?'+new URLSearchParams({page:String(page),num:'80',sort:'changepercent',asc:'0',node,symbol:''});const data=JSON.parse(await get(url));if(!Array.isArray(data))throw new Error('板块成分格式异常');return data as Record<string,unknown>[];
 }));all.push(...pages.flat());}
 const members=[...new Map(all.filter(r=>wireSymbol(String(r.symbol))).map(r=>[String(r.symbol),{symbol:wireSymbol(String(r.symbol))!,name:String(r.name),price:num(r.trade),changePercent:num(r.changepercent),amount:num(r.amount),turnover:num(r.turnoverratio)}])).values()];
 const active=members.filter(s=>s.changePercent!==null&&s.amount!==null&&s.amount>0),up=active.filter(s=>s.changePercent!>0).length,down=active.filter(s=>s.changePercent!<0).length,complete=members.length===count;
 const positiveShare=complete&&active.length?up/active.length:null;
 const breadth={total:count,covered:members.length,active:active.length,up,down,flat:active.length-up-down,complete,positiveShare};
 const related=maps.items.filter(s=>s.code!==code&&s.leaderSymbol&&s.leaderSymbol===board.leaderSymbol).slice(0,8);
 return {available:true,board,members:members.sort((a,b)=>(b.changePercent||0)-(a.changePercent||0)),breadth,related,source:maps.source,sourceUrl:countUrl,fetchedAt:new Date().toISOString(),tradingDate:null,
  state:positiveShare===null?'覆盖不足，待核验':positiveShare>=.65?'上涨扩散':positiveShare<=.35?'多数走弱':'板块分化',
  outlook:positiveShare===null?'未取得完整有效成分，不判断整体强弱。':positiveShare>=.65?'当前上涨家数占比≥65%，观察领涨股能否维持、强势是否向更多成分扩散；占比回落至50%以下时降低评价。':positiveShare<=.35?'当前上涨家数占比≤35%，先观察止跌和承接；少数龙头上涨不代表板块整体走强。':'当前涨跌分歧明显，优先对比龙头与中位成分，不把单股脉冲当作板块行情。',
  notice:(board.count!==count?'分类快照成分数'+board.count+'与成分接口'+count+'不一致；扩散统计采用已读取的成分接口全量。':'')+'65%/35%为观察阈值，不是预测。相关概念仅表示当前领涨股相同，不代表统计相关性或未来涨幅。来源未提供完整交易日期，需核验个股行情。资金净额缺失保持为空。'};
}
export async function sectorNews(code:string){
 const maps=await memo('heat:concept',90,()=>sectorMap('concept')),board=maps.items.find(s=>s.code===code);if(!board)return {available:true,items:[]};
 const aliases=board.name.match(/机器/)?['机器人','人形','减速器','丝杠']:board.name.match(/药/)?['创新药','医药','生物','临床']: [board.name.replace(/概念$/,'')];
 const news=await memo('flash',45,flash);return {...news,items:news.items.filter(n=>aliases.some(k=>n.title.includes(k)||n.summary?.includes(k))).slice(0,8),notice:'按主题关键词匹配公开快讯，不代表已确认的个股催化。'};
}
