import {classicShapes,multiLineEvidence,type MultiLineEvidence} from './shape-rules';
import {analyzeStrategy} from './strategy';
import type {Candle} from './types';
import type {Snapshot} from './desk-types';
import {sma} from './chart-indicators';
import {analyzeGuide,type GuideAnalysis} from './guide-analysis';
import type {StockCharacter} from './stock-character';
import {stockCharacter} from './stock-character';
import {chipDistribution,type ChipBar} from './market-models';
export const SCREEN_MODES={bloom:'五线开花',bullish:'多头排列',multi:'一阳多线',strongmulti:'强力一阳多线',beauty:'美人肩',spider:'金蜘蛛',cannon:'多方炮',limitup:'近10日涨停'} as const;
export type ScreenMode=keyof typeof SCREEN_MODES;
export type PatternMatch={mode:ScreenMode|'setup';label:string;reasons:string[]};
export type MultiFilters={lines:4|5;require60:boolean;middle:boolean;dispersion:number;volume20:number;volume5:number;gain:number;closeLocation:number};
export const DEFAULT_MULTI:MultiFilters={lines:4,require60:false,middle:false,dispersion:10,volume20:1.2,volume5:0,gain:3,closeLocation:.7};
export type ScreenOptions={modes:ScreenMode[];concentration:number;recentLimitUp:boolean;maxMarketCap:number|null;activity:boolean;auto?:boolean;multi?:MultiFilters};
export function passesMulti(e:MultiLineEvidence|undefined|null,mode:string,filters:MultiFilters=DEFAULT_MULTI){return !!e&&e.version===2&&e.normal&&(mode!=='strongmulti'||e.strong)&&e.lines>=filters.lines&&(!filters.require60||e.includes60)&&(!filters.middle||e.middleOffset<=.25)&&e.dispersion<filters.dispersion&&e.volume20>=filters.volume20&&e.volume5>=filters.volume5&&e.gain>=filters.gain&&e.closeLocation>=filters.closeLocation;}
export function multiParams(filters?:MultiFilters):Record<string,string>{return filters?{multiLines:String(filters.lines),multi60:filters.require60?'1':'0',multiMiddle:filters.middle?'1':'0',multiDense:String(filters.dispersion),multiVolume:String(filters.volume20),multiVolume5:String(filters.volume5),multiGain:String(filters.gain),multiClose:String(filters.closeLocation)}:{};}
export const DEFAULT_SCREEN:ScreenOptions={modes:['bloom'],concentration:20,recentLimitUp:false,maxMarketCap:1000e8,activity:true};
export type CandidateRanking={score:number;label:string;parts:{label:string;score:number;max:number;reason:string}[];warnings:string[];notice:string};
export function rankCandidate(bars:Candle[],guide:GuideAnalysis,character:StockCharacter|null,matches:PatternMatch[],concentration:number):CandidateRanking{
 const last=bars.at(-1)!,previous=bars.at(-2)!,mean=bars.slice(-21,-1).reduce((n,b)=>n+b.volume,0)/20,ratio=mean>0?last.volume/mean:0;
 const ma20=bars.slice(-20).reduce((n,b)=>n+b.close,0)/20,location=last.high>last.low?(last.close-last.low)/(last.high-last.low):.5;
 const warnings:string[]=[],gain=(last.close/previous.close-1)*100;
 let volume= gain>0?(ratio>=1.2&&ratio<=3?12:ratio>=.8&&ratio<1.2?8:ratio>3?7:4):ratio>1.5?0:4;
 if(gain<0&&ratio>1.5)warnings.push('放量回落，资金承接仍需确认');
 if(last.close/ma20>1.15){volume=Math.max(0,volume-6);warnings.push('偏离20日均线超过15%，留意追高风险');}
 const pv=Math.round(Math.min(30,volume+location*10+(last.close>=ma20?8:0)));
 const weights:Record<string,number>={bloom:guide.event?.state==='confirmed'?30:25,strongmulti:30,multi:26,beauty:24,spider:23,cannon:22,bullish:20,limitup:14,setup:12};
 const shape=Math.max(0,...matches.map(m=>weights[m.mode]||0)),activity=character?Math.round(Math.min(20,character.score*.2)):0;
 const chip=Math.round(Math.max(0,Math.min(20,20-concentration*.5)));
 const parts=[{label:'量价承接',score:pv,max:30,reason:`相对前20日均量${ratio.toFixed(2)}倍；收盘位于当日区间${Math.round(location*100)}%`},{label:'形态结构',score:shape,max:30,reason:matches.map(m=>m.label).join('、')+'；相关形态取最高项，不重复加分'},{label:'股性弹性',score:activity,max:20,reason:character?character.label:'缺少股性样本，不加分'},{label:'筹码集中',score:chip,max:20,reason:`90%模型集中度${concentration.toFixed(2)}%，越低越集中`}];
 let score=parts.reduce((n,p)=>n+p.score,0);if(character?.quiet||character?.weakFollow){score=Math.min(score,49);warnings.push('低弹性或突破延续偏弱，综合分最高49');}
 return {score,label:score>=75?'优先复核':score>=60?'重点观察':'等待确认',parts,warnings,notice:'量价30、形态30、股性20、筹码20；形态互不要求同时满足。观察优先级，非上涨概率；新闻、业绩与板块催化仍需复核。'};
}
export function parseScreenOptions(params:URLSearchParams):ScreenOptions{
 const modes=(params.get('modes')||DEFAULT_SCREEN.modes.join(',')).split(',');if(!modes.length||modes.some(m=>!Object.hasOwn(SCREEN_MODES,m)))throw new Error('无效形态模式');
 const concentration=Number(params.get('concentration')||20),cap=params.get('maxCap')??'1000';if(!Number.isFinite(concentration)||concentration<1||concentration>20)throw new Error('筹码集中度上限须在1–20%');
 if(cap!==''&&(!Number.isFinite(Number(cap))||Number(cap)<1||Number(cap)>100000))throw new Error('无效市值上限');
 const value=(key:string,def:number,min:number,max:number)=>{const n=Number(params.get(key)??def);if(!Number.isFinite(n)||n<min||n>max)throw new Error('无效一阳多线筛选参数：'+key);return n;};
 const lines=value('multiLines',4,4,5);if(!Number.isInteger(lines))throw new Error('穿线数量仅支持4或5');
 const multi:MultiFilters={lines:lines as 4|5,require60:params.get('multi60')==='1',middle:params.get('multiMiddle')==='1',dispersion:value('multiDense',10,1,10),volume20:value('multiVolume',1.2,1.2,10),volume5:value('multiVolume5',0,0,10),gain:value('multiGain',3,3,20),closeLocation:value('multiClose',.7,.7,1)};
 return {modes:modes as ScreenMode[],concentration,recentLimitUp:params.get('recentLimitUp')==='1',maxMarketCap:cap===''?null:Number(cap)*1e8,activity:params.get('activity')!=='0',auto:params.get('strategy')==='auto',multi};
}
const average=(rows:Candle[])=>rows.length?rows.reduce((s,c)=>s+c.volume,0)/rows.length:0;
export function patternMatches(bars:Candle[],now=new Date(),analysis?:GuideAnalysis):PatternMatch[]{
 if(bars.length<65)return [];const last=bars.at(-1)!,prev=bars.at(-2)!,n=bars.length,out:PatternMatch[]=[];
 const map=Object.fromEntries([5,10,20,30,60].map(p=>[p,new Map(sma(bars,p).map(v=>[v.time,v.value]))])),ma=(p:number,i=n-1)=>map[p].get(bars[i]?.time)||0;
 const volume=average(bars.slice(-21,-1)),ratio=volume>0?last.volume/volume:0,gain=(last.close/prev.close-1)*100;
 const add=(mode:ScreenMode,reasons:string[])=>out.push({mode,label:SCREEN_MODES[mode],reasons});
 const g=analysis||analyzeGuide(bars,{now});if(g.currentLaunch||['确认观察','开花确认'].includes(g.stage))add('bloom',[g.stage,`粘合 ${g.adhesionPct?.toFixed(2)}%；放量穿线与后续确认按指南固定五线核验`]);
 if([5,10,20,30].every((p,i)=>ma(p)>ma([10,20,30,60][i]))&&[5,10,20,30,60].every(p=>ma(p)>ma(p,n-6))&&last.close>=ma(5))add('bullish',['MA5 > MA10 > MA20 > MA30 > MA60，五线较5根前抬升','收盘不低于MA5；90%筹码集中度上限20%']);
 const atr=bars.slice(-21,-1).reduce((v,b,k)=>v+Math.max(b.high-b.low,Math.abs(b.high-bars[n-22+k].close),Math.abs(b.low-bars[n-22+k].close)),0)/20;
 for(const hit of classicShapes(bars,n-1,ma,atr,ratio))if(hit.kind!=='pointer')add(hit.kind,[hit.detail]);
 if(multiLineEvidence(bars)?.strong)add('strongmulti',['至少四线且含MA60；密集线束居实体中轴，大阳放量并收近高点；后续排列另行确认']);
 return out;
}
/** Raw prices only. These are explicitly rule-estimated closing limits, not an exchange flag. */
export function recentLimitUps(bars:Candle[],symbol:string,name:string){
 if(bars.length<12||/^(N|C)|ST|退/i.test(name))return [];
 const rate=symbol.endsWith('.BJ')?.3:/^(300|301|688|689)/.test(symbol)?.2:.1;
 return bars.slice(-10).filter(c=>{const i=bars.indexOf(c),p=bars[i-1];if(!p||p.close<=0)return false;const upper=Math.floor(p.close*(1+rate)*100+0.500001)/100;return Math.abs(c.close-upper)<.005&&c.high>=upper-.005;}).map(c=>c.time);
}
export function evaluateScreen(input:{bars:Candle[];raw:Candle[];quote:Snapshot;chipBars?:ChipBar[];provider:string;options:ScreenOptions;volumeUnit?:'股'|'手';now?:Date}){
 const {bars,raw,quote:q,options:o}=input,clock=input.now||new Date(),last=bars.at(-1),date=last?.time,rejected=(reason:string)=>({candidate:null,reason,asOf:date});
 if(date&&(clock.getTime()-Date.parse(date+'T00:00:00Z')>7*86400000||Date.parse(date+'T00:00:00Z')>clock.getTime()+86400000))return rejected('日线过期或日期无效');
 if(!last||q.stale||q.asOf.slice(0,10)!==date||bars.some((c,i)=>![c.open,c.close,c.high,c.low,c.volume].every(Number.isFinite)||c.low<=0||c.high<Math.max(c.close,c.open)||c.low>Math.min(c.open,c.close)||c.volume<0||i>0&&c.time<=bars[i-1].time))return rejected('日线与快照缺失、无效或日期不一致');
 if(bars.length<65)return rejected('历史样本不足65根，暂不参加形态筛选');
 if(Math.abs(last.close/q.price-1)>.005)return rejected('日线与快照价格未对齐');
 if(q.amount===null||q.amount<2e8)return rejected('成交额不足2亿元');
 if(o.maxMarketCap!==null&&(q.marketCap===null||q.marketCap>o.maxMarketCap))return rejected('超过市值上限或市值待核验');
 const multiLine=multiLineEvidence(bars),guide=analyzeGuide(bars,{now:input.now}),limits=raw.at(-1)?.time===date?recentLimitUps(guide.provisional?raw.slice(0,-1):raw,q.symbol,q.name):[],matches=patternMatches(bars,input.now,guide).filter(m=>(o.auto||o.modes.includes(m.mode as ScreenMode))&&(!['multi','strongmulti'].includes(m.mode)||passesMulti(multiLine,m.mode,o.multi)));
 if((o.auto||o.modes.includes('limitup'))&&limits.length)matches.push({mode:'limitup',label:SCREEN_MODES.limitup,reasons:[`最近10根日线收盘涨停形态：${limits.join('、')}`]});
 if(o.auto&&!matches.length&&guide.adhesionPct!==null&&guide.adhesionPct<5&&guide.bias60!==null&&guide.bias60>=0&&guide.bias60<8&&last.close>=last.open){matches.push({mode:'setup',label:'量价蓄势',reasons:['五线粘合<5%、价格守住MA60且乖离<8%，阳线保持承接','尚未满足启动确认，作为量价蓄势候选排序']});}
 if(!matches.length)return rejected('未命中所选形态');
 const character=stockCharacter(bars,date!);if(o.activity&&(!character||character.quiet||character.weakFollow))return rejected('低弹性或历史突破延续偏弱');if(o.recentLimitUp&&!limits.length)return rejected('近10根日线未检出收盘涨停形态');
 const shares=q.floatCap&&q.price>0?q.floatCap/q.price:0,multiplier=(input.volumeUnit??(/^68[89]/.test(q.symbol)?'股':'手'))==='手'?100:1;
 const historical=input.chipBars?.filter(c=>c.time<=date!);const hasHistorical=!!historical?.length&&historical.at(-1)?.time===date;
 const chipBars=hasHistorical?historical!:shares>0?bars.map(c=>({...c,turnover:c.volume*multiplier/shares*100})):[];
 const chips=chipDistribution(chipBars,date);if(!chips||chips.days<120||chips.initialWeight>.2)return rejected('筹码模型样本或换手覆盖不足');
 const matched=matches.filter(m=>chips.concentration90<Math.min(o.concentration,['multi','strongmulti'].includes(m.mode)?15:20));if(!matched.length)return rejected('90%筹码集中度不满足上限');
 const bucket=guide.stage==='开花确认'?'开花确认':guide.currentLaunch||guide.event?.state==='pending'?'启动待确认':guide.pullback?'回踩观察':guide.adhesionPct!==null&&guide.adhesionPct<5?'粘合蓄势':'形态候选';
 const ranking=rankCandidate(bars,guide,character,matched,chips.concentration90);
 return {reason:null,asOf:date,candidate:{multiLine,ranking,advice:(()=>{const s=analyzeStrategy(bars,{symbol:q.symbol,amount:q.amount,now:clock});const {parts,followUp,checks,setup,metrics,...brief}=s.plan;return {...brief,notice:s.method};})(),symbol:q.symbol,name:q.name,price:q.price,changePercent:q.changePercent,amount:q.amount,turnover:q.turnover,marketCap:q.marketCap,bucket,stage:guide.stage,asOf:date,provider:input.provider,adhesion:guide.adhesionPct,bias60:guide.bias60,volumeRatio:guide.volumeRatio,passed:guide.rules.filter(r=>r.required&&r.state==='pass').length,required:guide.rules.filter(r=>r.required).length,risks:[...guide.risks,...(character?.warnings||[])],reasons:matched.flatMap(m=>[m.label,...m.reasons]),eventDate:guide.event?.date??null,provisional:guide.provisional,character,patterns:matched,limitUpDates:limits,limitUpMethod:'未复权收盘价按10%/20%/30%价格限制及分币四舍五入估算；非交易所涨停标志，除权参考价变化可能影响判断',chip:{concentration90:chips.concentration90,range90:chips.range90,initialWeight:chips.initialWeight,days:chips.days,basis:hasHistorical?'historical-turnover':'current-float-estimate',notice:hasHistorical?'历史换手率筹码模型，非真实持仓':'当前流通盘固定回推历史换手率，含股本变化误差；筹码为模型估算'}}};
}
