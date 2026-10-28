import {sessionReview,type OverseasQuote} from '../shared/session-review';
import type {Snapshot} from '../shared/desk-types';
import {beijingParts} from '../shared/monitor';
import {memo,sectors,fundFlow,stockNews,flash} from './desk-data';
function nyTime(local:string){
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(local))return null;
 const base=Date.parse(local.replace(' ','T')+'Z'),format=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 for(const offset of [4,5]){const d=new Date(base+offset*3600000);if(format.format(d)===local)return d.toISOString();}return null;
}
export function parseUSQuotes(text:string,now=new Date()):OverseasQuote[]{
 const out:OverseasQuote[]=[];
 for(const m of text.matchAll(/v_us([A-Z]{1,6})="([^"]*)"/g)){const f=m[2].split('~'),asOf=nyTime(f[30]||''),price=Number(f[3]),changePercent=Number(f[32]);if(!asOf||f[3]===''||f[32]===''||!Number.isFinite(price)||price<=0||!Number.isFinite(changePercent)||Date.parse(asOf)>now.getTime()+60000)continue;out.push({symbol:m[1],name:f[1],price,changePercent,asOf,localTime:f[30],source:'腾讯美股公开快照'});}return out;
}
async function usQuotes(symbols:string[]){const r=await fetch('https://qt.gtimg.cn/q='+symbols.map(s=>'us'+s).join(','),{headers:{Referer:'https://gu.qq.com/','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(4500)});if(!r.ok)throw new Error('美股来源不可用');return parseUSQuotes(new TextDecoder('gbk').decode(await r.arrayBuffer()));}
export async function loadSessionReview(q:Snapshot|undefined,benchmark?:Snapshot){
 const now=new Date(),closing=beijingParts(now).minute>=900;
 if(!q)return sessionReview(q,{now,benchmark});
 const [boards,flow,news,global,overseas]=await Promise.allSettled([memo('sectors'+q.symbol,90,()=>sectors(q.symbol,AbortSignal.timeout(4500))),memo('flow'+q.symbol,45,()=>fundFlow(q.symbol,AbortSignal.timeout(4500))),memo('stock-news'+q.symbol,120,()=>stockNews(q.symbol,AbortSignal.timeout(4500))),memo('flash',45,()=>flash(AbortSignal.timeout(4500))),closing?memo('us-context',120,()=>usQuotes(['SPY','QQQ','NVDA','MU','XBI','TSLA'])):Promise.resolve([])]);
 const boardData=boards.status==='fulfilled'?boards.value:undefined,names=boardData?.boards.map(b=>b.name).join(' ')||'';
 const symbols=['SPY','QQQ',...(/半导体|电子|光学|存储|算力/.test(names)?['NVDA','MU']:[]),...(/医药|生物|创新药/.test(names)?['XBI']:[]),...(/机器人|汽车|新能源/.test(names)?['TSLA']:[])];
 const us=overseas.status==='fulfilled'?overseas.value.filter(u=>symbols.includes(u.symbol)):undefined;
 const headlines=[...(news.status==='fulfilled'?news.value.items:[]),...(global.status==='fulfilled'?global.value.items.filter(n=>n.title.includes(q.name)||/美联储|央行|关税|利率|CPI|PMI|纳指|降息/.test(n.title)):[])];
 return sessionReview(q,{now,benchmark,boards:boardData,flow:flow.status==='fulfilled'?flow.value:undefined,news:headlines,us});
}
