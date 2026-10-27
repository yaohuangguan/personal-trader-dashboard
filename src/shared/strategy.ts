import type {Candle} from './types';
import {stockCharacter} from './stock-character';
import type {TradeMarker} from './guide-action';
export const STRATEGY_VERSION='结构量价 v2.0';
export type StrategyPlan={kind:'breakout'|'multi'|'retest'|'prepare'|'wait'|'manage'|'exit';label:string;action:string;direction:'bullish'|'bearish'|'neutral';score:number;provisional:boolean;asOf:string|null;entry:[number,number]|null;stop:number|null;targets:number[];riskPct:number|null;reasons:string[];checks:{label:string;pass:boolean;detail:string}[];warnings:string[]};
export type StrategySignal=TradeMarker&{kind:string;stop?:number;target?:number;entryZone?:[number,number];confirmed:true};
export type StrategyAnalysis={version:string;plan:StrategyPlan;signals:StrategySignal[];riskStops:{time:string;price:number}[];method:string};
const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const median=(a:number[])=>{const sorted=[...a].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:0;};
const blank=(asOf:string|null,provisional:boolean):StrategyPlan=>({kind:'wait',label:'等待有效结构',action:'观望',direction:'neutral',score:0,provisional,asOf,entry:null,stop:null,targets:[],riskPct:null,reasons:[],checks:[],warnings:[]});
/** Causal daily structure signals; signal dates are observations, never claimed fills. */
export function analyzeStrategy(input:Candle[],options:{now?:Date;symbol?:string;amount?:number|null}={}):StrategyAnalysis{
 const now=options.now||new Date(),clock=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now),part=(key:string)=>clock.find(p=>p.type===key)?.value||'',today=`${part('year')}-${part('month')}-${part('day')}`,minute=Number(part('hour'))*60+Number(part('minute'));
 const rows=input.filter(c=>c.time<=today).slice().sort((a,b)=>a.time.localeCompare(b.time));
 const provisional=rows.at(-1)?.time===today&&minute<900,signals:StrategySignal[]=[],riskStops:{time:string;price:number}[]=[];
 let plan=blank(rows.at(-1)?.time||null,!!provisional);
 const valid=rows.every((c,i)=>/^\d{4}-\d{2}-\d{2}$/.test(c.time)&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.volume>=0&&(!i||c.time>rows[i-1].time));
 if(!valid||rows.length<65||!rows.at(-1)?.volume){plan.reasons=['需要至少65根有效的日线；缺失数据不产生买卖点。'];return {version:STRATEGY_VERSION,plan,signals,riskStops,method:'仅使用观察时刻已存在的数据。'};}
 const ma=(period:number,i:number)=>i+1>=period?mean(rows.slice(i-period+1,i+1).map(c=>c.close)):null;
 let position:{index:number;reference:number;stop:number;peak:number;target:number;trimmed:boolean}|null=null,lastBreak:{index:number;level:number;volume:number;low:number}|null=null;
 for(let i=64;i<rows.length;i++){
  const c=rows[i],prev=rows[i-1],prior=rows.slice(i-20,i),vol=mean(prior.map(c=>c.volume)),med=median(prior.map(c=>c.volume));
  const atr=mean(prior.map((b,j)=>Math.max(b.high-b.low,Math.abs(b.high-rows[i-21+j].close),Math.abs(b.low-rows[i-21+j].close))));
  if(!(atr>0&&vol>0&&c.volume>0))continue;
  const m60=ma(60,i)!,slope=ma(60,i-5),environment=c.close>=m60&&slope!==null&&m60/slope>=.99;
  const priorMas=[5,10,20,30,60].map(p=>ma(p,i-1)!),compression=(Math.max(...priorMas)/Math.min(...priorMas)-1)*100;
  const high=Math.max(...prior.map(b=>b.high)),rangeLow=Math.min(...prior.map(b=>b.low)),location=c.high>c.low?(c.close-c.low)/(c.high-c.low):0;
  const ratio=c.volume/vol,relativeMedian=med>0?c.volume/med:0,gain=(c.close/prev.close-1)*100;
  const localProvisional=i===rows.length-1&&!!provisional;
  const bullishBody=c.close>c.open,volumePass=ratio>=1.5&&relativeMedian>=1.4,closePass=location>=.7;
  const crosses=[5,10,20,30,60].filter(p=>{const value=ma(p,i)!;return c.open<=value&&c.close>value;});
  const multi=bullishBody&&gain>=2&&crosses.length>=3&&crosses.includes(60)&&compression<5;
  const breakout=c.close>high+.1*atr&&prev.close<=high&&bullishBody&&(compression<5||mean(prior.slice(-5).map(b=>b.high-b.low))<atr*.9);
  const retest:boolean=!!lastBreak&&i-lastBreak.index>=2&&i-lastBreak.index<=10&&rows.slice(lastBreak.index+1,i).every(b=>b.low>=lastBreak!.level-.4*atr)&&mean(rows.slice(i-2,i).map(b=>b.volume))<=lastBreak.volume*.75&&c.low<=Math.max(ma(10,i)!,lastBreak.level)+.5*atr&&c.close>prev.high+.05*atr&&bullishBody&&c.volume>=prev.volume*1.1;
  let current=blank(c.time,localProvisional);current.score=Math.round(Number(environment)*20+Math.min(20,ratio/1.5*20)+location*15+Number(compression<5)*15+Number(bullishBody)*10+Number(c.close>ma(20,i)!)*20);
  current.checks=[{label:'结构环境',pass:environment,detail:'价格守住MA60，60日线近5根未明显下弯'},{label:'突破参与',pass:volumePass,detail:`前20均量${ratio.toFixed(2)}倍 / 中位量${relativeMedian.toFixed(2)}倍`},{label:'收盘承接',pass:closePass,detail:`收盘位于当日区间${Math.round(location*100)}%`},{label:'前序蓄势',pass:compression<5,detail:`前一日核心五线离散${compression.toFixed(2)}%`}];
  if(position){
   if(!localProvisional)riskStops.push({time:c.time,price:position.stop});
   // Stops use only yesterday's ratcheted value; today's high cannot raise today's stop.
   const stopHit=c.low<=position.stop,distribution=gain<-.5&&ratio>=1.8&&location<.3&&c.close<prev.low,failedBreak=lastBreak&&i-lastBreak.index<=5&&c.close<lastBreak.level-.25*atr;
   if(stopHit||distribution||failedBreak){const reason=stopHit?'价格触及先前设定的结构/ATR失效价':distribution?'放量下跌、收近低点且跌破前一日低点': '突破后5根内跌回关键位下方，突破失败';current={...current,kind:'exit',label:'结构退出',action:localProvisional?'减仓 / 风险预警':'卖出',direction:'bearish',stop:position.stop,reasons:[reason,'适用于该结构的已有持仓；空仓视为回避。']};
    if(!localProvisional){signals.push({time:c.time,side:'sell',price:c.close,label:'卖 · 结构失效',reason,kind:'exit',confirmed:true});position=null;}
   }else{
    const peak=Math.max(position.peak,c.high),newStop=Math.max(position.stop,Math.min(peak-2.2*atr,c.close-.15*atr));
    current={...current,kind:'manage',label:'持仓结构跟踪',action:c.high>=position.target&&!position.trimmed?'减仓 / 锁定部分收益':'持有 / 观察',direction:'bullish',entry:[position.reference,position.reference],stop:position.stop,targets:[position.target],riskPct:Math.max(0,(c.close-position.stop)/c.close*100),reasons:['结构失效价只上移、不下移；以昨日生效价检查今日风险。','2R为风险收益计划线，不是目标价格预测。']};
    if(!localProvisional){position.peak=peak;position.stop=newStop;if(c.high>=position.target)position.trimmed=true;}
   }
  }else if(environment&&((breakout||multi)&&volumePass&&closePass||retest&&closePass)){
   const type=retest?'retest':multi?'multi':'breakout',level:number=retest?Math.max(lastBreak!.level,ma(10,i)!):multi?Math.max(...priorMas):high;
   const zone:[number,number]=[level+.05*atr,level+.85*atr],stop=Math.min(c.low,level)-.15*atr,risk=c.close-stop,priorResistance=Math.max(...rows.slice(Math.max(0,i-120),i).map(b=>b.high)),reward=priorResistance>c.close+.2*atr?(priorResistance-c.close)/risk:2;
   const character=stockCharacter(rows.slice(0,i+1),c.time),active=!!character&&!character.quiet&&!character.weakFollow,notChasing=c.close>=zone[0]&&c.close<=zone[1]&&risk/c.close<=.08,room=reward>=1.8;
   current={...current,kind:type,label:type==='retest'?'缩量回踩承接':type==='multi'?'一阳多线启动':'蓄势关键位突破',action:localProvisional?'盘中预警':active&&notChasing&&room?'买入观察':'等待回踩',direction:'bullish',entry:zone,stop,targets:[c.close+2*risk,c.close+3*risk],riskPct:risk/c.close*100,reasons:[retest?'启动后的缩量回踩守住关键位，再次转强':multi?'阳线穿过至少三条核心均线并越过MA60，成交参与和收盘承接达标':'前序蓄势后突破此前20根高点，放量与收盘承接同时达标','先核验入场区间、失效价与上方空间，不等均线交叉后才观察。'],checks:[...current.checks,{label:'股性延续',pass:active,detail:character?.label||'样本不足'},{label:'不追高',pass:notChasing,detail:'价格处于计划区间，结构风险不超过8%'},{label:'上方空间',pass:room,detail:`此前120根阻力与计划风险比${reward.toFixed(2)}R`}],warnings:[...(!active?['低弹性或历史延续偏弱，停止给出买入建议']:[]),...(!notChasing?['已偏离低风险计划区，等待回踩']:[]),...(!room?['上方历史阻力过近，风险收益不足']:[])]};
   if(!localProvisional){if(!retest)lastBreak={index:i,level,volume:c.volume,low:c.low};if(active&&notChasing&&room){signals.push({time:c.time,side:'buy',price:c.close,label:'买 · '+current.label,reason:current.reasons[0],kind:type,stop,target:current.targets[0],entryZone:zone,confirmed:true});position={index:i,reference:c.close,stop,peak:c.high,target:current.targets[0],trimmed:false};}}
  }else{
   const near=c.close>=high-.7*atr&&c.close<=high&&compression<5&&environment;
   current={...current,kind:near?'prepare':'wait',label:near?'接近关键位 · 提前关注':!environment?'趋势环境未通过':'等待量价触发',action:'观望',direction:!environment?'bearish':'neutral',entry:near?[high+.1*atr,high+.85*atr]:null,stop:near?rangeLow-.15*atr:null,reasons:[near?'前序均线粘合、价格靠近此前20根高点，尚未突破；先加入观察，等待参与量和承接。':!environment?'价格或MA60方向不支持当前顺势方案，先等待结构改善。':'尚未满足突破或回踩承接组合；金叉和死叉不单独产生买卖建议。']};
  }
  if(localProvisional){current.provisional=true;current.warnings.push('盘中量价和关键位仍会变化；不将预警画成已确认买卖点。');if(current.action==='买入观察')current.action='盘中预警';}
  if(i===rows.length-1){if(options.amount!==undefined&&(options.amount===null||options.amount<2e8)&&current.action==='买入观察'){current.action='观望';current.warnings.push(options.amount===null?'本交易日成交额尚无法核验，买入条件待确认。':'本交易日成交额不足2亿元，未通过流动性底线。');const last=signals.at(-1);if(last?.time===c.time&&last.side==='buy')signals.pop();}plan=current;}
 }
 return {version:STRATEGY_VERSION,plan,signals,riskStops,method:'量价与关键位触发，MA用于结构环境，不以金叉/死叉直接买卖。日线信号为收盘观察，非成交记录；盘中只预警。历史持仓为规则跟踪，不代表实际账户持仓；涨跌停、滑点及T+1在回测中另行约束。'};
}
