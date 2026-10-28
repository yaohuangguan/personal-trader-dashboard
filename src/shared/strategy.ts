import {patternMarks,type PatternMark} from './pattern-marks';
import {indicatorMarks} from './indicator-marks';
import {CLASSIC_MA,maPeriods,maRole} from './ma-system';
import type {Candle} from './types';
import {stockCharacter} from './stock-character';
import {macd} from './chart-indicators';
import type {TradeMarker} from './guide-action';
export const STRATEGY_VERSION='形态量价 v4.0';
export type Stance={action:string;reason:string};
export type StrategySetup={date:string;index:number;kind:'multi'|'breakout'|'recovery'|'pattern';level:number;high:number;low:number;midpoint:number;volume:number;crossed:number;attempts:number;brokenAt:string|null};
export type StrategyPart={label:string;score:number;max:number;reason:string};
export type FollowBar={date:string;day:number;close:number;volume20:number;volumeLaunch:number;adhesion:number;state:string;supportHeld:boolean};
export type SetupEpisode={setup:StrategySetup;failedAt:string|null;follow:FollowBar[]};
export type TimingMetrics={atr:number;volume20:number;volume5:number;volumeLaunch:number|null;pullbackVolume:number|null;closeLocation:number;bias60:number;bias20:number;trigger:number;age:number|null;volumeLabel:string;volumeDetail:string;momentum:string;support:number|null};
export type StrategyPlan={kind:'breakout'|'multi'|'retest'|'recovery'|'pattern'|'prepare'|'wait'|'manage'|'exit';label:string;action:string;direction:'bullish'|'bearish'|'neutral';score:number;structureScore:number;exitRisk:number;phase:string;flat:Stance;holding:Stance;setup:StrategySetup|null;followUp:SetupEpisode|null;holdingStop:number|null;metrics:TimingMetrics|null;patternEvidence:PatternMark[];maPeriods:number[];parts:StrategyPart[];provisional:boolean;asOf:string|null;entry:[number,number]|null;stop:number|null;targets:number[];riskPct:number|null;reasons:string[];checks:{label:string;pass:boolean;detail:string}[];warnings:string[]};
export type StrategySignal=TradeMarker&{kind:string;stop?:number;target?:number;entryZone?:[number,number];confirmed:true};
export type StrategyAnalysis={version:string;plan:StrategyPlan;signals:StrategySignal[];riskStops:{time:string;price:number}[];timeline:{date:string;phase:string;label:string;reason:string}[];episodes:SetupEpisode[];method:string};
const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const clamp=(n:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
const blank=(asOf:string|null,provisional:boolean):StrategyPlan=>({kind:'wait',label:'等待有效结构',action:'观望',direction:'neutral',score:0,structureScore:0,exitRisk:0,phase:'base',flat:{action:'观望',reason:'等待有效量价证据。'},holding:{action:'核验支撑',reason:'尚不能建立有效的结构风控计划。'},setup:null,followUp:null,holdingStop:null,metrics:null,patternEvidence:[],maPeriods:[...CLASSIC_MA],parts:[],provisional,asOf,entry:null,stop:null,targets:[],riskPct:null,reasons:[],checks:[],warnings:[]});
/** Prefix-only observations. A broken plan can be replaced by a separately dated recovery. */
export function analyzeStrategy(input:Candle[],options:{now?:Date;symbol?:string;amount?:number|null;maPeriods?:number[];name?:string}={}):StrategyAnalysis{
 const now=options.now||new Date(),clock=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now),part=(key:string)=>clock.find(p=>p.type===key)?.value||'',today=`${part('year')}-${part('month')}-${part('day')}`,minute=Number(part('hour'))*60+Number(part('minute'));
 const rows=input.filter(c=>c.time<=today).slice().sort((a,b)=>a.time.localeCompare(b.time));
 const provisional=rows.at(-1)?.time===today&&minute<900,signals:StrategySignal[]=[],riskStops:{time:string;price:number}[]=[],timeline:StrategyAnalysis['timeline']=[],episodes:SetupEpisode[]=[];
 let plan=blank(rows.at(-1)?.time||null,!!provisional);
 const method='量价结构信号只使用当时已知日线；回踩不等于买点，破位后允许新证据建立修复计划。买点分衡量当前入场条件，结构质量与退出风险单列，均非收益概率。初始失效价参考启动实体半位与ATR，回踩转强参考已发生的回踩低点；2R/3R是风险预算刻度，不能视为预测目标。盘中仅预警。形态识别与量价、动能、位置和风控共用同一因果链，单独形态不代表买卖。历史标记不含未保存的当时板块、资金和情绪，不能冒充完整综合决策或真实持仓。';
 const valid=rows.every((c,i)=>/^\d{4}-\d{2}-\d{2}$/.test(c.time)&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.volume>=0&&(!i||c.time>rows[i-1].time));
 if(!valid||options.maPeriods!==undefined&&maPeriods(options.maPeriods).length<2||rows.length<65||!rows.at(-1)?.volume){plan.reasons=['需要至少65根有效的日线；缺失数据不产生买卖点。'];return {version:STRATEGY_VERSION,plan,signals,riskStops,timeline,episodes,method};}
 const sums=[0],volumes=[0],ranges=[0];
 rows.forEach((c,i)=>{sums.push(sums[i]+c.close);volumes.push(volumes[i]+c.volume);ranges.push(ranges[i]+Math.max(c.high-c.low,Math.abs(c.high-(rows[i-1]?.close??c.open)),Math.abs(c.low-(rows[i-1]?.close??c.open))));});
 const selected=maPeriods(options.maPeriods),rawMA=(p:number,i:number)=>i+1>=p?(sums[i+1]-sums[i+1-p])/p:NaN,ma=(p:number,i:number)=>rawMA(maRole(selected,p),i);
 const shapeMap=new Map<string,PatternMark[]>(),indicatorMap=new Map<string,ReturnType<typeof indicatorMarks>>();
 for(const mark of patternMarks(rows,now,{symbol:options.symbol,name:options.name,maPeriods:selected}))shapeMap.set(mark.time,[...(shapeMap.get(mark.time)||[]),mark]);
 for(const mark of indicatorMarks(rows,now))indicatorMap.set(mark.time,[...(indicatorMap.get(mark.time)||[]),mark]);
 const entryShapes=new Set(['multi','spider','cannon','pointer-confirmed','double-bottom','head-shoulders-bottom','rounding-bottom','old-duck','bear-trap-reclaim','morning-star','bull-engulf','breakout','reclaim','island-bottom','beauty-breakout']);
 const riskShapes=new Set(['bear-engulf','dark-cloud','evening-star','three-crows','double-top','head-shoulders-top','island-top','death-bloom','high-volume-bear','ma20-loss']);
 const hist=new Map(macd(rows).map(p=>[p.time,p.histogram]));
 let setup:StrategySetup|null=null,position:{reference:number;stop:number;peak:number;target:number;trimmed:boolean}|null=null;
 const attempts:number[]=[];let lastPhase='';
 for(let i=64;i<rows.length;i++){
  const c=rows[i],prev=rows[i-1],prior=rows.slice(i-20,i),atr=(ranges[i]-ranges[i-20])/20,base=(volumes[i]-volumes[i-20])/20,base5=(volumes[i]-volumes[i-5])/5;
  if(!(atr>0&&base>0&&c.volume>0))continue;
  const localProvisional=i===rows.length-1&&!!provisional,ratio=c.volume/base,ratio5=c.volume/base5,gain=(c.close/prev.close-1)*100;
  const m5=ma(5,i),m13=ma(13,i),m20=ma(20,i),m60=ma(60,i),slope=m60/ma(60,i-5)-1,bias60=(c.close/m60-1)*100,bias20=(c.close/m20-1)*100;
  const priorMas=[...new Set([5,10,20,30,60].map(p=>maRole(selected,p)))].map(p=>rawMA(p,i-1)),compression=(Math.max(...priorMas)/Math.min(...priorMas)-1)*100;
  const high=Math.max(...prior.map(b=>b.high)),rangeLow=Math.min(...prior.map(b=>b.low)),location=c.high>c.low?(c.close-c.low)/(c.high-c.low):.5,body=(c.close-c.open)/atr;
  const bullish=c.close>c.open,environment=c.close>=m60-.25*atr&&slope>=-.01;
  const crosses=priorMas.filter(v=>c.open<=v&&c.close>v).length;
  const impulse=bullish&&gain>=2&&body>=.55&&location>=.65&&(ratio>=1.4||ratio5>=1.7);
  const evidence=shapeMap.get(c.time)||[],oscillators=indicatorMap.get(c.time)||[],entryEvidence=evidence.filter(m=>entryShapes.has(m.kind)&&m.chartVisible!==false&&m.status!=='candidate'),riskEvidence=evidence.filter(m=>riskShapes.has(m.kind)&&m.status!=='candidate');
  const multi=entryEvidence.some(m=>m.kind==='multi'),patternTrigger=impulse&&entryEvidence.some(m=>m.kind!=='multi'&&m.kind!=='breakout')&&c.close>Math.max(m5,m13)&&c.close>prev.high+.03*atr;
  const topDivergence=oscillators.some(m=>m.kind==='top-divergence'),bottomDivergence=oscillators.some(m=>m.kind==='bottom-divergence');
  const breakout=impulse&&c.close>high+.08*atr&&prev.close<=high&&(compression<7||mean(prior.slice(-5).map(b=>b.high-b.low))<atr*.9);
  const shortReclaim=bullish&&c.close>m5&&c.close>m13&&prev.close<Math.max(ma(5,i-1),ma(13,i-1))&&rows.slice(i-5,i).filter((b,j)=>b.close<ma(13,i-5+j)).length>=2;
  const recovery:boolean=impulse&&shortReclaim&&c.close>=m20&&(!setup||setup.brokenAt!==null||i-setup.index>10);
  if(setup&&!setup.brokenAt&&i>setup.index&&(c.close<setup.low-.15*atr||c.close<setup.midpoint-.25*atr&&c.close<m20-.4*atr))setup=Object.assign({},setup,{brokenAt:c.time});
  const startsEpisode:boolean=(multi||breakout||recovery||patternTrigger)&&(!setup||setup.brokenAt!==null||i-setup.index>=8||multi&&i-setup.index>=3);
  if(startsEpisode&&!localProvisional){
   const kind:StrategySetup['kind']=multi?'multi':recovery?'recovery':patternTrigger?'pattern':'breakout';attempts.push(i);
   setup={date:c.time,index:i,kind,level:kind==='breakout'?high:kind==='recovery'?Math.max(ma(5,i-1),ma(13,i-1),ma(20,i-1)):Math.max(c.open,...priorMas.filter(v=>v<c.close)),high:c.high,low:c.low,midpoint:(c.open+c.close)/2,volume:c.volume,crossed:crosses,attempts:attempts.filter(n=>i-n<=40).length,brokenAt:null};
   episodes.push({setup:{...setup},failedAt:null,follow:[]});
  }
  const forming=startsEpisode&&localProvisional;
  const activeSetup:StrategySetup|null=forming?{date:c.time,index:i,kind:multi?'multi':recovery?'recovery':patternTrigger?'pattern':'breakout',level:multi?Math.max(c.open,...priorMas.filter(v=>v<c.close)):recovery?Math.max(ma(5,i-1),ma(13,i-1),ma(20,i-1)):high,high:c.high,low:c.low,midpoint:(c.open+c.close)/2,volume:c.volume,crossed:crosses,attempts:attempts.filter(n=>i-n<=40).length+1,brokenAt:null}:setup&&i-setup.index<=60?setup:null;
  const age=activeSetup?i-activeSetup.index:null,broken=!!activeSetup?.brokenAt;
  const core=[5,10,20,30,60].map(p=>ma(p,i)),upFan=core.every((v,k)=>!k||core[k-1]>v)&&[5,10,20].every(p=>ma(p,i)>ma(p,i-2)),downFan=core.every((v,k)=>!k||core[k-1]<v)&&[5,10,20].every(p=>ma(p,i)<ma(p,i-2));
  const adhesion=(Math.max(...core)/Math.min(...core)-1)*100;
  if(!localProvisional)for(const episode of episodes){const day=i-episode.setup.index;if(day<1||day>10)continue;const held=!(c.close<episode.setup.low-.15*atr||c.close<episode.setup.midpoint-.25*atr&&c.close<m20-.4*atr);if(!held&&!episode.failedAt)episode.failedAt=c.time;episode.follow.push({date:c.time,day,close:c.close,volume20:ratio,volumeLaunch:c.volume/episode.setup.volume,adhesion,state:!held?'失守启动支撑':episode.failedAt?'失效后的修复观察':downFan?'向下发散':upFan?'多头发散':adhesion<3?'均线密集': '均线交织 / 分歧',supportHeld:held});}
  const after=activeSetup?rows.slice(activeSetup.index+1,i):[],declines=after.filter((b,j)=>b.close<(j?after[j-1].close:rows[activeSetup!.index].close));
  const pullbackVolume=activeSetup&&declines.length?mean(declines.map(b=>b.volume))/activeSetup.volume:null;
  const recentHigh=activeSetup?Math.max(activeSetup.high,...after.map(b=>b.high)):high;
  const support=activeSetup?Math.max(activeSetup.midpoint,Math.min(m13,activeSetup.level)):null;
  const touch=activeSetup&&age!==null&&age>0&&c.low<=Math.max(support!,m13)+.6*atr;
  const h=hist.get(c.time)??0,h1=hist.get(prev.time)??0,h2=hist.get(rows[i-2].time)??0;
  const momentumImproving=h>h1&&h1>=h2||h>0&&c.close>m13;
  const momentum=h>0&&h>h1?'动能扩张':momentumImproving?'动能修复':h<h1?'动能走弱':'动能分歧';
  const rebound=!!activeSetup&&!broken&&age!==null&&age>=1&&age<=20&&declines.length>0&&bullish&&body>=.45&&location>=.68&&c.close>m5&&c.close>m13&&(c.close>prev.high+.03*atr||shortReclaim)&&c.volume>=prev.volume*1.1&&(ratio5>=1.2||ratio>=1.2);
  const stalled=!!activeSetup&&age!==null&&age>=4&&recentHigh<activeSetup.high+.4*atr&&!rebound;
  const extended=bias60>25||bias20>16||!!activeSetup&&c.close>activeSetup.level+3*atr;
  const volLaunch=activeSetup?c.volume/activeSetup.volume:null;
  let volumeLabel:string,volumeDetail:string;
  if(c.close<prev.close&&ratio>=1.5&&location<.35){volumeLabel='放量下跌 · 承接偏弱';volumeDetail=`当日量为前20日均量${ratio.toFixed(2)}倍，收盘/最新价位于振幅${Math.round(location*100)}%；不能仅因回踩就买入。`;}
  else if(c.close<prev.close&&ratio<.85&&!localProvisional){volumeLabel='缩量回落 · 等待转强';volumeDetail='抛压可能减轻，但缩量阴跌同样可能失去承接；需要收复短均线、价格转强和参与量恢复。';}
  else if(rebound||impulse){volumeLabel='放量转强 · 核验位置';volumeDetail=`已发生量为20日均量${ratio.toFixed(2)}倍、5日均量${ratio5.toFixed(2)}倍；量能支持仍须结合入场位置和失效价。`;}
  else if(localProvisional&&ratio<1){volumeLabel='盘中量未完成';volumeDetail='当前累计量不能直接判为全天缩量；仅用已发生量，不外推收盘量。';}
  else if(touch){volumeLabel='回踩分歧 · 尚待承接';volumeDetail=`相对启动日量${(volLaunch??0).toFixed(2)}倍、20日均量${ratio.toFixed(2)}倍；缩量是相对概念，需核验是否仍有抛压。`;}
  else {volumeLabel='量价待配合';volumeDetail=`20日相对量${ratio.toFixed(2)}倍；单独放量不代表看多，结合收盘位置与方向。`;}
  const trigger=rebound?Math.max(prev.high,m5,m13):activeSetup?.level??high;
  const zone:[number,number]=[trigger-.05*atr,trigger+.85*atr];
  const pivot=rebound?Math.min(...rows.slice(Math.max(activeSetup!.index+1,i-5),i+1).map(b=>b.low)):activeSetup?Math.max(activeSetup.midpoint-.1*atr,Math.min(c.low,activeSetup.level)):rangeLow;
  const stop=pivot-.15*atr,risk=c.close-stop,riskPct=risk/c.close*100;
  const resistance=Math.max(...rows.slice(Math.max(0,i-120),i).map(b=>b.high)),reward=resistance>c.close+.2*atr?(resistance-c.close)/Math.max(risk,.001):2;
  const safeZone=c.close>=zone[0]&&c.close<=zone[1]&&riskPct>0&&riskPct<=8,room=reward>=1.8;
  const hasTrigger=(!!activeSetup&&age===0&&(multi||breakout||recovery||patternTrigger)||rebound)&&location>=.68;
  const character=(hasTrigger||i===rows.length-1)?stockCharacter(rows.slice(0,i+1),c.time):null;
  const active=character?!character.quiet&&!character.weakFollow:true;
  const parts:StrategyPart[]=[
   {label:'结构准备',max:20,score:Math.round(activeSetup&&!broken?12+clamp((10-compression)/10)*5+Math.min(3,activeSetup.attempts):0),reason:activeSetup?`${activeSetup.date} ${activeSetup.kind==='recovery'?'破位后收复':activeSetup.kind==='multi'?'放量穿线观察':'箱体突破'}；近40根有${activeSetup.attempts}次试探，次数不是成功保证。`:'尚无可跟踪的量价启动结构。'},
   {label:'承接与量能',max:20,score:Math.round(rebound?20:impulse?17:touch&&c.close>=support!&&location>=.5?10:c.close<prev.close&&location<.35?3:7),reason:volumeLabel+'；'+volumeDetail+(entryEvidence.length?'；形态证据：'+entryEvidence.map(m=>m.label).join('、'):'')},
   {label:'动能与短线修复',max:20,score:Math.round((momentumImproving?10:3)+(c.close>m13?6:0)+(ma(5,i)>ma(5,i-2)?4:0)),reason:`${momentum}；${c.close>m13?'守住':'尚未收复'}MA13。`},
   {label:'入场位置',max:20,score:extended?0:safeZone?20:Math.round(12*clamp(1-Math.max(0,c.close-zone[1])/atr/2)),reason:extended?`距MA60 ${bias60.toFixed(2)}%、距MA20 ${bias20.toFixed(2)}%，新买入位置与结构质量分开评价。`:`观察区${zone.map(v=>v.toFixed(2)).join('–')}；当前${safeZone?'处于':'偏离'}计划区。`},
   {label:'股性与风险空间',max:20,score:Math.round((active?8:2)+(room?6:0)+(riskPct>0&&riskPct<=8?6:0)),reason:`${character?.label||'历史弹性随触发核验'}；结构风险${riskPct.toFixed(2)}%，${resistance>c.close+.2*atr?'历史阻力空间'+reward.toFixed(2)+'R':'上方缺少可识别历史阻力，2R仅是计划刻度'}。`},
  ];
  let score=parts.reduce((n,p)=>n+p.score,0);
  if(!hasTrigger)score=Math.min(score,59);if(touch&&!rebound)score=Math.min(score,49);if(stalled)score=Math.min(score,45);if(broken)score=Math.min(score,25);if(extended)score=Math.min(score,35);if(!active||!room||!safeZone)score=Math.min(score,64);
  const eligible=hasTrigger&&riskEvidence.length===0&&!(topDivergence&&location<.6)&&environment&&active&&safeZone&&room&&!broken&&!extended&&score>=70;
  const phase=downFan?'downward':broken?'broken':extended?'extension':rebound?'turning':stalled?'stalled':touch?'pullback':activeSetup&&age===0?'launch':activeSetup?.kind==='recovery'?'repair':activeSetup?'tracking':'base';
  const label=({downward:'向下开花 · 风控优先',broken:'当前结构破位',extension:'主升延续 · 入场位置偏高',turning:'回踩后放量转强',stalled:'回踩后未及时转强',pullback:'回踩观察 · 承接待核验',launch:activeSetup?.kind==='recovery'?'放量收复 · 新修复计划':activeSetup?.kind==='multi'?'一阳多线启动':activeSetup?.kind==='pattern'?'形态放量确认':'箱体放量突破',repair:'均线修复观察',tracking:upFan?'多头发散 · 趋势跟踪':age!==null&&age>10?'较长整理 · 重新评估':'启动结构持续跟踪',base:'蓄势观察 · 等待触发'} as Record<string,string>)[phase];
  const flat:Stance=broken?{action:'回避 / 等待修复',reason:'本段支撑已经失守，旧买入计划失效；之后若有新的放量收复证据，再建立新计划。'}:extended?{action:'不追高 / 等待新买点',reason:'结构可能仍强，但价格远离低风险入场区；当前上涨不能倒推早先就是买点。'}:forming?{action:'盘中预警',reason:'盘中已出现量价启动迹象；仍须核验入场区间和风险，等待收盘，不将预警当成成交。'}:eligible?{action:localProvisional?'盘中预警':'买入观察',reason:rebound?'回踩后出现主动放量转强，收复短均线；入场区间、失效价和上方空间同时可核验。':'量价启动与入场位置通过本地核验；继续结合板块、市场情绪和资金信息复核。'}:touch||stalled?{action:'观望 / 等承接转强',reason:stalled?'回踩后迟迟没有有效阳线和量能恢复，时间消耗使原计划降级，先看重新转强或支撑失守。':'碰到均线或缩量本身不足以买入；等待收复短均线、有效阳线和参与量恢复。'}:{action:'观望',reason:hasTrigger?'出现量价触发，但位置、风险空间或趋势环境仍有未通过项。':'等待价格结构、参与量和动能形成配合；均线交叉不是单独的买卖依据。'};
  let exitRisk=Math.round((broken?55:0)+(c.close<m13?12:0)+(h<h1?10:0)+(c.close<prev.close&&ratio>=1.5&&location<.35?25:0)+(stalled?12:0)+(extended?15:0)+(riskEvidence.length?20:0)+(topDivergence?10:0));
  let holding:Stance=broken?{action:localProvisional?'减仓 / 破位预警':'卖出 / 结构风控',reason:'针对已有持仓：本段结构已破坏；低成交量跌破同样需要风控，不能自动解释为洗盘。'}:exitRisk>=40?{action:'减仓观察 / 收紧风控',reason:'承接或动能出现恶化，优先检查既定失效价；未实际持仓者不执行卖出。'}:{action:extended?'持有观察 / 保护利润':'持有观察',reason:extended?'价格扩张提高回撤风险，但高乖离本身不等于立即卖出；看动能、放量滞涨和支撑失守。':'仍需跟踪短均线与结构支撑；成交额、板块与资金证据在综合研判中核验。'};
  const priorHoldingStop=position?.stop??Math.min(prev.close-.1*atr,Math.max(ma(13,i-1)-.35*atr,Math.min(...rows.slice(i-3,i).map(b=>b.low))-.15*atr));
  if(downFan){score=Math.min(score,25);exitRisk=Math.max(exitRisk,80);flat.action='回避 / 等待结构修复';flat.reason='核心均线呈空头次序且短线斜率向下，当前先控制向下发散风险；新的放量修复可另建计划。';holding={action:localProvisional?'减仓 / 向下发散预警':'卖出 / 结构风控',reason:'核心均线向下发散；针对已有持仓，执行既定风险线，避免把阴跌持续解释为正常回踩。'};}
  else if(c.close<priorHoldingStop&&c.close<prev.low){exitRisk=Math.max(exitRisk,70);holding={action:localProvisional?'减仓 / 支撑失守预警':'减仓 / 支撑失守',reason:`价格跌至上一交易日已可计算的防守线${priorHoldingStop.toFixed(2)}下方，优先处理持仓风险；后续修复须重新确认。`};}
  if(riskEvidence.length&&c.close<m5&&location<.5){exitRisk=Math.max(exitRisk,60);holding={action:'减仓 / 形态风险',reason:riskEvidence.map(m=>m.label).join('、')+'与价格转弱同时出现，优先核验先前生效的风险线。'};}
  let exitedToday=false;
  if(position){
   if(!localProvisional)riskStops.push({time:c.time,price:position.stop});
   const stopHit=c.low<=position.stop,distribution=gain<-.5&&ratio>=1.8&&location<.3&&c.close<prev.low;
   const shapeExit=riskEvidence.length>0&&c.close<m13&&c.close<prev.low&&ratio>=1.3;
   if(stopHit||distribution||broken||shapeExit){
    const reason=stopHit?'价格触及先前生效的结构/ATR失效价':distribution?'放量下跌、收近低点并跌破前一日低点':shapeExit?'风险形态与放量失守短线支撑共振：'+riskEvidence.map(m=>m.label).join('、'):'收盘失守本段结构支撑';
    holding={action:localProvisional?'减仓 / 风控预警':'卖出',reason};exitRisk=Math.max(exitRisk,85);
    if(!localProvisional){signals.push({time:c.time,side:'sell',price:stopHit?Math.min(c.open,position.stop):c.close,label:stopHit?'卖 · 风险线触及':'卖 · 结构失效',reason,kind:'exit',confirmed:true});position=null;exitedToday=true;}
   }else if(!localProvisional){
    const peak=Math.max(position.peak,c.high);
    if(c.high>=position.target&&!position.trimmed)holding={action:'减仓 / 保护部分收益',reason:'规则跟踪达到原计划2R；并非价格预测，也不代表实际持仓已成交。'};
    position.peak=peak;position.stop=Math.max(position.stop,Math.min(peak-2.2*atr,c.close-.15*atr));if(c.high>=position.target)position.trimmed=true;
   }
  }
  const current:StrategyPlan={...blank(c.time,localProvisional),kind:broken?'exit':rebound?'retest':activeSetup?.kind??'wait',label,action:flat.action,direction:broken||downFan?'bearish':eligible?'bullish':'neutral',score,structureScore:Math.round(clamp((activeSetup&&!broken?35:5)+(c.close>m20?20:0)+(c.close>m60?15:0)+(momentumImproving?15:3)+(active?10:0)+(activeSetup?.attempts?Math.min(5,activeSetup.attempts*2):0),0,100)),exitRisk:clamp(exitRisk,0,100),phase,flat,holding,setup:activeSetup?{...activeSetup}:null,metrics:{atr,volume20:ratio,volume5:ratio5,volumeLaunch:volLaunch,pullbackVolume,closeLocation:location,bias60,bias20,trigger,age,volumeLabel,volumeDetail,momentum,support},parts,entry:activeSetup?zone:null,stop:activeSetup?stop:null,patternEvidence:evidence,maPeriods:selected,targets:activeSetup&&risk>0&&safeZone&&!extended&&!broken?[c.close+2*risk,c.close+3*risk]:[],riskPct:activeSetup?riskPct:null,reasons:[flat.reason,holding.reason],checks:[{label:'结构环境',pass:environment,detail:`MA60五根变化${(slope*100).toFixed(2)}%；当前${c.close>=m60?'在':'低于'}MA60。`},{label:'主动承接',pass:hasTrigger,detail:volumeLabel+'；'+momentum},{label:'入场位置',pass:safeZone&&!extended,detail:`观察区${zone.map(v=>v.toFixed(2)).join('–')}；距MA60 ${bias60.toFixed(2)}%。`},{label:'风险收益',pass:room&&riskPct>0&&riskPct<=8,detail:`失效价${stop.toFixed(2)}；结构风险${riskPct.toFixed(2)}%，${resistance>c.close+.2*atr?'阻力空间'+reward.toFixed(2)+'R':'上方无可识别历史阻力，2R仅为计划'}。`}],warnings:[]};
  current.holdingStop=priorHoldingStop;
  if(bottomDivergence)current.warnings.push('底背离仅提示动能衰减，仍需价格与量能转强；不提前标买。');
  if(topDivergence)current.warnings.push('确认顶背离：结合价格破位核验退出，不因背离单独清仓。');
  if(riskEvidence.length)current.warnings.push('风险形态：'+riskEvidence.map(m=>m.label).join('、'));
  if(entryEvidence.length)current.reasons.push('触发形态：'+entryEvidence.map(m=>m.label).join('、')+'；买点还需量价、位置、股性和风险空间同时通过。');
  current.followUp=episodes.at(-1)??null;
  if(downFan)current.structureScore=Math.min(current.structureScore,35);
  if(localProvisional)current.warnings.push('当前日线未完成，盘中只预警；不外推全天量，也不画已确认买点。');
  if(!active)current.warnings.push('历史低弹性或延续偏弱，当前形态需要更充分的参与和承接证据。');
  if(extended)current.warnings.push('结构质量与当前买入时机不同：主升可以很强，当前位置仍可能不适合追入。');
  if(eligible&&!localProvisional&&!position&&!exitedToday&&!downFan){signals.push({time:c.time,side:'buy',price:c.close,label:'买 · '+(entryEvidence[0]?.label||label),reason:flat.reason+(entryEvidence.length?' 触发：'+entryEvidence.map(m=>m.label).join('、')+'。':''),kind:rebound?'retest':activeSetup!.kind,stop,target:current.targets[0],entryZone:zone,confirmed:true});position={reference:c.close,stop,peak:c.high,target:current.targets[0],trimmed:false};}
  if(i===rows.length-1){
   if(options.amount!==undefined&&(options.amount===null||options.amount<2e8)&&current.flat.action==='买入观察'){
    current.score=Math.min(current.score,49);current.action='观望';current.flat={action:'观望',reason:options.amount===null?'当日成交额无法核验，流动性条件待确认。':'当日成交额不足2亿元，未通过流动性底线。'};current.reasons[0]=current.flat.reason;current.warnings.push(current.flat.reason);const last=signals.at(-1);if(last?.time===c.time&&last.side==='buy')signals.pop();
   }
   plan=current;
  }
  if(!localProvisional&&phase!==lastPhase){timeline.push({date:c.time,phase,label,reason:flat.reason});lastPhase=phase;}
 }
 return {version:STRATEGY_VERSION,plan,signals,riskStops,timeline,episodes:episodes.slice(-6),method};
}
