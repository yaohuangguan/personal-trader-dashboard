import type {Candle,MarketPayload} from './types';
import type {Snapshot,FlowPayload,SectorsPayload} from './desk-types';
import type {PoolsPayload} from './market-overview';
import type {StrategyAnalysis,Stance} from './strategy';
import {aggregateDaily,marketSentiment} from './market-models';
import {analyzeGuideResonance,closedPeriodCandles} from './guide-analysis';
import type {PatternMark} from './pattern-marks';
export type DecisionPayload={market:MarketPayload;strategy:StrategyAnalysis;review?:TradeReview;patternMarks?:PatternMark[]};
export type ReviewEvidence={id:string;label:string;status:'available'|'missing'|'unverified';score:number|null;weight:number;direction:'bullish'|'bearish'|'neutral';detail:string;asOf:string|null;source:string};
export type TradeReview={version:string;asOf:string|null;current:boolean;qualityScore:number|null;entryScore:number|null;exitRisk:number;coverage:number;flat:Stance;holding:Stance;evidence:ReviewEvidence[];supports:string[];conflicts:string[];buyConditions:string[];sellConditions:string[];waitingFor:string[];summary:string;notice:string};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const avg=(values:number[])=>values.length?values.reduce((n,v)=>n+v,0)/values.length:0;
/** Synthesis has explicit missing evidence and vetoes; it never backdates today's market context. */
export function reviewTrade(strategy:StrategyAnalysis,bars:Candle[],input:{quote?:Snapshot;benchmarks?:Snapshot[];flow?:FlowPayload;sectors?:SectorsPayload;pools?:PoolsPayload;now?:Date}={}):TradeReview{
 const p=strategy.plan,q=input.quote,day=p.asOf,now=input.now||new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now);
 const aligned=!!p.metrics&&!!q&&!q.stale&&q.asOf.slice(0,10)===day&&day===today&&!!bars.length&&Math.abs(bars.at(-1)!.close/q.price-1)<.001;
 const evidence:ReviewEvidence[]=[];
 const add=(id:string,label:string,weight:number,value:number|null,detail:string,source:string,asOf:string|null=day,status?:ReviewEvidence['status'])=>{const score=value===null?null:Math.round(clamp(value)*weight);evidence.push({id,label,weight,score,status:status||(score===null?'missing':'available'),detail,asOf,source,direction:score===null?'neutral':score/weight>=.65?'bullish':score/weight<=.35?'bearish':'neutral'});};
 add('structure','结构准备与阶段',25,p.metrics?p.structureScore/100:null,`${p.label}；${p.setup?`${p.setup.date}起跟踪，近40根${p.setup.attempts}次量价试探`:'未检出近期有效启动'}。`,'同源日线');
 add('timing','入场位置与风险',20,p.metrics?p.score/100:null,p.flat.reason,'同源日线');
 add('momentum','动能与承接',10,p.metrics?(/扩张/.test(p.metrics.momentum)?.9:/修复/.test(p.metrics.momentum)?.7:/走弱/.test(p.metrics.momentum)?.2:.45):null,`${p.metrics?.momentum||'待核验'}；${p.metrics?.volumeLabel||'量能样本不足'}`,'MACD / 价量位置');
 const weeks=aggregateDaily(bars,'week'),months=aggregateDaily(bars,'month'),cycles=analyzeGuideResonance(weeks,months,now),closedWeeks=closedPeriodCandles(weeks,'week',now),w5=avg(closedWeeks.slice(-5).map(b=>b.close)),w10=avg(closedWeeks.slice(-10).map(b=>b.close));
 add('weekly','周线屠龙刀与趋势',10,cycles.weekly.ready?cycles.weekly.matched?1:w5>w10?.65:.25:null,cycles.weekly.ready?(cycles.weekly.matched?'已收盘周线满足屠龙刀口径；':'尚未满足完整屠龙刀；')+cycles.weekly.detail:'当前日线可聚合的已收盘周线不足65根。','同源日线聚合已收盘周线',cycles.weekly.asOf);
 add('monthly','月线背景',5,cycles.monthly.ready?cycles.monthly.matched?1:.4:null,cycles.monthly.ready?cycles.monthly.detail:'月线不足32根，不把缺失周期当作共振。','同源日线聚合已收盘月线',cycles.monthly.asOf);
 const benchmarks=(input.benchmarks||[]).filter(b=>!b.stale&&b.asOf.slice(0,10)===day&&b.changePercent!==null),market=benchmarks.length?avg(benchmarks.map(b=>b.changePercent!)):null;
 add('market','市场风险偏好',10,market===null?null:clamp(.5+market/5),market===null?'缺少同交易日可核验指数快照。':`${benchmarks.map(b=>b.name+' '+b.changePercent!.toFixed(2)+'%').join('；')}。指数样本不等于全市场上涨家数。`,'腾讯指数快照',benchmarks[0]?.asOf||null);
 const pools=input.pools?.date===day?input.pools.pools:undefined,broken=pools?.broken.available&&pools.up.available?pools.broken.items.filter(b=>!pools.up.items.some(u=>u.symbol===b.symbol)).length:null;
 const yesterday=pools?.yesterday.available?pools.yesterday.items.map(s=>s.changePercent).filter((n):n is number=>n!==null):[];
 const sentiment=pools?marketSentiment({up:pools.up.available?pools.up.total:null,down:pools.down.available?pools.down.total:null,broken,yesterdayMean:yesterday.length?avg(yesterday):null}):null;
 add('sentiment','涨停生态与市场情绪',5,sentiment?sentiment.score>=35&&sentiment.score<=80?.6+(sentiment.score-35)/112.5:sentiment.score<35?.2:.5:null,sentiment?`情绪观察指数${sentiment.score}/100；高热同样需要警惕分歧，不能只加买入分。`:'涨跌停池、炸板或昨日涨停溢价不完整；不补造情绪指数。','东财同交易日股票池',input.pools?.date||null);
 const boards=input.sectors?.boards||[],datedBoards=boards.filter(b=>b.asOf&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(b.asOf))===day&&b.changePercent!==null),boardChange=datedBoards.length?avg(datedBoards.map(b=>b.changePercent!)):null;
 add('sector','板块联动',5,boardChange===null?null:clamp(.5+boardChange/6),datedBoards.length?datedBoards.slice(0,3).map(b=>`${b.name} ${b.changePercent!.toFixed(2)}%`).join('；')+'。同日板块指数，不等于全成分扩散，相关板块成分可能重叠。':boards.length?boards.slice(0,3).map(b=>`${b.name} ${b.changePercent===null?'—':b.changePercent.toFixed(2)+'%'}`).join('；')+'。来源未提供可核验行情日期，本项不参与加分。':'当前板块归属或完整扩散证据未取得；个股放量不能替代板块走强。',input.sectors?.source||'板块来源',datedBoards[0]?.asOf||input.sectors?.fetchedAt||null,datedBoards.length?'available':boards.length?'unverified':'missing');
 const flow=input.flow,point=flow?.points.at(-1),flowDate=point?.time.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||null,net=point?.main;
 const flowCurrent=flowDate===day&&net!==null&&net!==undefined&&q?.amount!==null&&q?.amount!==undefined&&q.amount>0;
 add('flow','资金参与',5,flowCurrent?clamp(.5+net!/q!.amount! *2.5):null,point?`${flow?.mainLabel||'资金净额估算'} ${net==null?'未提供':(net/1e8).toFixed(2)+'亿元'}；日期${flowDate||'未独立核验'}。${flowCurrent?'同日估算仅作辅助，不等于真实主力持仓。':'历史/日期未核验资金不作为今日买入证据。'}`:'资金来源暂无可核验记录。',flow?.source||'公开资金流估算',point?.time||null,flowCurrent?'available':point?'unverified':'missing');
 const liquid=aligned&&q!.amount!==null&&q!.amount>=2e8;
 add('activity','成交活跃与可交易性',5,aligned&&q?.amount!==null?liquid?q!.turnover!==null&&q!.turnover!>30?.5:1:.2:null,q?`成交额${q.amount===null?'未提供':(q.amount/1e8).toFixed(2)+'亿'}；换手${q.turnover??'—'}%。过高换手增加分歧，不只视为利好。`:'缺少当前快照。','腾讯个股快照',q?.asOf||null);
 const covered=evidence.filter(e=>e.status==='available').reduce((n,e)=>n+e.weight,0),total=evidence.filter(e=>e.status==='available').reduce((n,e)=>n+(e.score||0),0),quality=covered?Math.round(total/covered*100):null;
 const flat={...p.flat},holding={...p.holding},supports=evidence.filter(e=>e.direction==='bullish'&&e.status==='available').map(e=>e.label+'：'+e.detail),conflicts=evidence.filter(e=>e.direction==='bearish'&&e.status==='available').map(e=>e.label+'：'+e.detail);
 const waitingFor=evidence.filter(e=>e.status!=='available').map(e=>e.label+'：'+e.detail);
 const linkedContext=evidence.some(e=>e.id==='market'&&e.status==='available')&&evidence.some(e=>['sector','flow','sentiment'].includes(e.id)&&e.status==='available');
 let entry=aligned?Math.min(p.score,Math.round(.65*p.score+.35*(quality||0))):null,exitRisk=p.exitRisk;
 const macroRisk=market!==null&&market<-1.5||sentiment!==null&&sentiment.score<30;
 const blocked=!!q&&q.limitUp!==null&&q.price>=q.limitUp-.005&&q.asks.every(a=>a.price===null||!a.volume);
 if(!aligned){flat.action='等待行情核验';flat.reason='日线与快照日期、价格或时效未对齐；当前买点不评分，不用旧K线给今日建议。';}
 else if(!liquid){entry=Math.min(entry!,49);if(!['broken','downward'].includes(p.phase)){flat.action='观察 / 流动性待达标';flat.reason='当前成交额尚未达到2亿元底线；盘中可能变化，先等待实际成交额达标及结构确认。';}conflicts.push('当前成交额不足2亿元或尚无法核验，未通过新入场流动性底线。');}
 else if(blocked){entry=Math.min(entry!,40);flat.action='不追封板 / 等可交易机会';flat.reason='当前涨停且公开卖盘无有效报价，不能把规则信号当作能够成交；等待真实可交易且风险可控的新位置。';}
 else if(macroRisk){entry=Math.min(entry!,55);exitRisk=Math.min(100,exitRisk+10);if(!['broken','downward'].includes(p.phase)){flat.action='降低进攻 / 等环境改善';flat.reason='个股证据需结合市场退潮风险；当前指数或涨停生态偏弱，优先降低进攻强度。';}conflicts.push('市场指数或涨停生态偏弱，进攻证据需要降级。');}
 else if(p.flat.action==='买入观察'&&(covered<70||!linkedContext)){flat.action='技术候选 / 补齐联动核验';flat.reason='量价触发已有依据，但板块、资金或市场证据覆盖不足，先作为技术候选，避免把缺失信息当利好。';}
 else if(p.flat.action==='买入观察'&&entry!==null&&entry>=85&&covered>=85){flat.action='强买入条件观察';flat.reason='量价转强、风险位置与多维证据较一致；仅在计划区间且实际可成交时考虑分批验证。';}
 const stop=p.holdingStop,zone=p.entry;
 const buyConditions=[zone?`仅在${zone.map(v=>v.toFixed(2)).join('–')}观察区评估，不把突破后任何价位都视为买点。`:'先出现新的放量转强或有效局部高点突破，再建立入场区。',p.metrics?`触发参考${p.metrics.trigger.toFixed(2)}；需核验收复MA5/13、主动阳线、参与量恢复和风险空间。`:'补足同源日线。','不同形态是可选路径，不要求一阳多线、二次启动、美人肩等同时出现。'];
 const sellConditions=[stop?`已有持仓防守参考${stop.toFixed(2)}（使用此前已收盘数据）；实际执行以预先设定的风控计划为准。`:'先明确实际持仓的失效价。','支撑失守或核心均线向下发散时优先风控；缩量跌破也不能无期限等待。','放量滞涨、收近低点且动能走弱时降低持仓强度；高乖离本身不等于马上清仓。'];
 return {version:'综合研判 v1',asOf:q?.asOf||day,current:aligned,qualityScore:quality,entryScore:entry,exitRisk,coverage:covered,flat,holding,evidence,supports,conflicts,buyConditions,sellConditions,waitingFor,summary:`${p.label}。空仓：${flat.action}；已有持仓：${holding.action}。`,notice:'综合分为可用证据的观察评价，覆盖权重单独列示；买点分、结构质量和退出风险含义不同。不是收益概率；没有当时板块/资金快照的历史形态不包装成完整综合买点。'};
}
