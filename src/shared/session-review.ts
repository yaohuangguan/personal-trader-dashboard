import type {Snapshot,SectorsPayload,FlowPayload} from './desk-types';
import type {NewsItem} from './types';
import {beijingParts} from './monitor';
export type OverseasQuote={symbol:string;name:string;price:number;changePercent:number;asOf:string;localTime:string;source:string};
export type SessionEvidence={label:string;status:'available'|'missing'|'unverified';asOf:string|null;source:string;detail:string;items?:{title:string;url:string;publishedAt:string|null;source:string}[]};
export type SessionReview={mode:'intraday'|'closing';title:string;asOf:string;quoteAsOf:string|null;closingVerified:boolean;summary:string;evidence:SessionEvidence[];conditions:string[];notice:string};
export function sessionReview(q:Snapshot|undefined,input:{now?:Date;benchmark?:Snapshot;boards?:SectorsPayload;flow?:FlowPayload;news?:NewsItem[];us?:OverseasQuote[]}={}):SessionReview{
 const now=input.now||new Date(),clock=beijingParts(now),mode=clock.minute>=900?'closing':'intraday',day=q?.asOf.slice(0,10)||clock.date,cutoff=Date.parse(day+'T15:00:00+08:00');
 const usable=!!q&&!q.stale&&Number.isFinite(Date.parse(q.asOf))&&Date.parse(q.asOf)<=now.getTime()+60000&&day===clock.date;
 const closingVerified=usable&&q!.asOf.slice(11,16)>='15:00'&&mode==='closing',evidence:SessionEvidence[]=[];
 const title=mode==='closing'?(closingVerified?'当日收盘分析':'收盘分析 · 快照待核验'):'当日盘中分析';
 const valid=(levels:Snapshot['bids'])=>levels.filter(l=>l.price!==null&&l.price>0&&l.volume!==null&&l.volume>0),bids=usable?valid(q!.bids):[],asks=usable?valid(q!.asks):[],bid=bids.reduce((n,l)=>n+l.volume!,0),ask=asks.reduce((n,l)=>n+l.volume!,0),sum=bid+ask;
 evidence.push({label:mode==='closing'?'收盘后可见五档快照':'当前五档盘口',status:usable&&sum>0?'available':'missing',asOf:q?.asOf||null,source:'腾讯公开五档，非授权Level-2',detail:usable&&sum>0?`${bid&&ask?'买方挂单量占比'+(bid/sum*100).toFixed(1)+'%，卖方'+(ask/sum*100).toFixed(1)+'%':'仅取得单侧有效挂单，无法评价两侧承接'}；${bids.length&&asks.length?'买卖一价差'+(asks[0].price!-bids[0].price!).toFixed(2)+'。':''}${mode==='closing'?'这是来源时间的可见快照，不能复原15:00竞价或全天盘口。':'挂单可随时撤销，占比不等于主动成交方向。'}`:'缺少同日有效五档，不从K线猜测盘口承接。'});
 const bm=input.benchmark,market=usable&&bm&&!bm.stale&&bm.asOf.slice(0,10)===day;
 evidence.push({label:'同期大盘联动',status:market?'available':'missing',asOf:bm?.asOf||null,source:'腾讯指数快照',detail:market?`${bm!.name} ${bm!.changePercent??'—'}%；个股${q!.changePercent??'—'}%。价格相对表现仍需结合实际量能。`:'同期指数尚未核验。'});
 const boards=input.boards?.boards||[],dated=boards.filter(b=>b.asOf&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(b.asOf))===day);
 evidence.push({label:'板块与概念联动',status:dated.length?'available':boards.length?'unverified':'missing',asOf:dated[0]?.asOf||null,source:input.boards?.source||'板块来源',detail:dated.length?dated.slice(0,5).map(b=>b.name+' '+(b.changePercent===null?'—':b.changePercent.toFixed(2)+'%')).join('；')+'。板块指数不等于全成分扩散。':boards.length?'板块记录没有可核验的同日日期，不作为当日联动证据。':'板块来源暂不可用。'});
 const flow=input.flow,point=flow?.points.at(-1),flowDay=point?.time.match(/^\d{4}-\d{2}-\d{2}/)?.[0],flowCurrent=flowDay===day&&point?.main!==null&&point?.main!==undefined;
 evidence.push({label:'资金参与估算',status:flowCurrent?'available':point?'unverified':'missing',asOf:point?.time||null,source:flow?.source||'资金流来源',detail:flowCurrent?`${flow?.mainLabel||'公开资金净额'} ${(point!.main!/1e8).toFixed(2)}亿元；估算不能证明主力持仓。`:point?'最近资金记录日期不属于当前交易日，不冒充实时资金。':'暂无可核验资金数据。'});
 const news=(input.news||[]).filter(n=>n.publishedAt&&Number.isFinite(Date.parse(n.publishedAt))&&Date.parse(n.publishedAt)<=now.getTime()&&Date.parse(n.publishedAt)>=Date.parse(day+'T00:00:00+08:00')).sort((a,b)=>(b.publishedAt||'').localeCompare(a.publishedAt||''));
 const after=news.filter(n=>Date.parse(n.publishedAt!)>=cutoff),before=news.filter(n=>Date.parse(n.publishedAt!)<cutoff);
 const selected=(mode==='closing'?after:before).slice(0,6);
 evidence.push({label:mode==='closing'?'盘后新消息':'盘中相关消息',status:selected.length?'available':'missing',asOf:selected[0]?.publishedAt||null,source:[...new Set(selected.map(n=>n.source))].join(' / ')||'个股资讯与宏观快讯',detail:selected.length?`${selected.length}条带发布时间的${mode==='closing'?'15:00以后':'盘中'}消息线索；不把标题关联当成影响已经兑现。`:(mode==='closing'?'尚未取得今日15:00以后的可核验相关消息；未用盘前旧闻替代。':'尚未取得可核验的盘中相关消息。'),items:selected.map(({title,url,publishedAt,source})=>({title,url,publishedAt,source}))});
 if(mode==='closing'){
  const us=(input.us||[]).filter(u=>Number.isFinite(Date.parse(u.asOf))&&Date.parse(u.asOf)<=now.getTime()+60000&&now.getTime()-Date.parse(u.asOf)<5*86400000);
  evidence.push({label:'美股相关与跨市场样本',status:us.length?'available':'missing',asOf:us[0]?.asOf||null,source:'腾讯美股公开快照；标注纽约来源时间',detail:us.length?us.map(u=>`${u.name} ${u.changePercent>=0?'+':''}${u.changePercent.toFixed(2)}%（纽约${u.localTime}）`).join('；')+'。这是最近可核验美股行情，可能早于A股本次收盘；不当作尚未发生的今晚美股。':'美股来源暂不可用或已过期；没有编造海外联动。'});
  if(before.length)evidence.push({label:'收盘前已知消息',status:'available',asOf:before[0].publishedAt,source:'带发布时间的资讯',detail:'以下消息发生在收盘前，单独列示，不包装为盘后新催化。',items:before.slice(0,3).map(({title,url,publishedAt,source})=>({title,url,publishedAt,source}))});
 }
 const available=evidence.filter(e=>e.status==='available').length;
 return {mode,title,asOf:now.toISOString(),quoteAsOf:q?.asOf||null,closingVerified,summary:`${mode==='closing'?(closingVerified?'收盘快照已核验':'收盘快照尚待核验'):'盘中观察随快照更新'}；${available}/${evidence.length}项背景可用。盘口、板块、消息和海外样本分别列示。`,evidence,conditions:[q?.low&&q?.high?`后续关注${q.low.toFixed(2)}附近支撑与${q.high.toFixed(2)}附近压力；这只是本交易日区间，突破需重新核验量能。`:'先补齐同源行情，避免用旧数据形成当前行动结论。',mode==='closing'?'下一交易时段结合开盘承接、板块扩散和夜间新信息重新评估；盘后材料不能保证次日高低开。':'五档挂单与真实成交分开看，关键价位以持续成交和分时量能核验。'],notice:'走势强弱分继续只描述已发生价格表现；消息不靠标题自动赋予看多/看空。未授权逐笔、撤单、队列与竞价数据不作推断。'};
}
