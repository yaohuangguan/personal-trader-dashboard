import {analyzeGuide} from './guide-analysis';
import {stockCharacter} from './stock-character';
import {guideAction} from './guide-action';
import type {Candle} from './types';
import type {Snapshot,IntradayPayload} from './desk-types';
import {beijingParts} from './monitor';
import {marketSession} from './desk-types';

export type TrendDimension={key:string;weight:number;score:number|null;value:number|null;unit:string};
export type DailyTrend={operation:ReturnType<typeof guideAction>|null;available:boolean;date:string|null;asOf:string|null;current:boolean;provisional:boolean;score:number|null;label:string;coveredWeight:number;dimensions:TrendDimension[];observations:string[];observationsEn:string[];risks:string[];risksEn:string[];levels:{support:number|null;resistance:number|null;vwap:number|null};volumeRatio:number|null;source:string;method:string};
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
const valid=(c:Candle)=>/^\d{4}-\d{2}-\d{2}$/.test(c.time)&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.volume>=0;
const pct=(n:number)=>`${n>=0?'+':''}${n.toFixed(2)}%`;
export function dailyTrend(input:Candle[],options:{symbol:string;quote?:Snapshot;benchmark?:Snapshot;intraday?:IntradayPayload;volumeUnit?:'股'|'手';source?:string;now?:Date}):DailyTrend{
 const now=options.now||new Date(),clock=beijingParts(now),candles=input.filter(c=>valid(c)&&c.time<=clock.date).sort((a,b)=>a.time.localeCompare(b.time));
 const result:DailyTrend={operation:null,available:false,date:null,asOf:null,current:false,provisional:false,score:null,label:'数据不足',coveredWeight:0,dimensions:[],observations:[],observationsEn:[],risks:[],risksEn:[],levels:{support:null,resistance:null,vwap:null},volumeRatio:null,source:options.source||'公开日线',method:'观察强弱分，不是涨跌概率。涨跌相对历史ATR占25%，日内位置占20%，开盘后表现占20%，相对沪深300占25%，相对分时均价占10%。缺项不补分，按已覆盖权重归一化。量能单独说明，不外推全天量。'};
 let last=candles.at(-1),q=options.quote;
 if(q){const stamp=Date.parse(q.asOf),date=q.asOf.slice(0,10);if(q.symbol!==options.symbol||!Number.isFinite(stamp)||stamp>now.getTime()+60000||date>clock.date||q.stale||date<(last?.time||date)||date===clock.date&&marketSession(now)==='trading'&&now.getTime()-stamp>120000){result.risks.push('快照过期或日期无效，使用可核验日线');q=undefined;}}
 if(q&&q.open!=null&&q.high!=null&&q.low!=null&&q.volume!=null){
  const prev=candles.filter(c=>c.time<q!.asOf.slice(0,10)).at(-1);
  if(prev&&q.previous>0&&Math.abs(prev.close/q.previous-1)<=.005){const bar={time:q.asOf.slice(0,10),open:q.open,high:q.high,low:q.low,close:q.price,volume:q.volume*(q.volumeUnit==='手'?100:1)/(options.volumeUnit==='手'?100:1)};if(valid(bar)){last=bar;result.asOf=q.asOf;result.source+=' / 公开快照';}}
  else {q=undefined;result.risks.push('复权日线与快照昨收不一致，快照不参加评分');}
 }
 if(!last)return finishTrend(result);
 const prior=candles.filter(c=>c.time<last!.time),prev=prior.at(-1);
 result.available=true;result.date=last.time;result.asOf??=last.time;result.current=last.time===clock.date;result.provisional=result.current&&clock.minute<900;
 result.levels={support:last.low,resistance:last.high,vwap:null};
 if(!result.current)result.risks.push('当前展示最近可核验交易日，不是今日实时走势');
 if(!prev||prior.length<21||last.volume<=0){result.risks.push('至少需要21根前序有效日线与非零成交量');return finishTrend(result);}
 const atr=prior.slice(-20).reduce((n,c,i)=>n+Math.max(c.high-c.low,Math.abs(c.high-prior[prior.length-21+i].close),Math.abs(c.low-prior[prior.length-21+i].close)),0)/20;
 const move=last.close/prev.close*100-100,fromOpen=last.close/last.open*100-100,location=last.high===last.low?null:(last.close-last.low)/(last.high-last.low);
 const benchmark=options.benchmark,bm=benchmark&&benchmark.symbol==='000300.SH'&&benchmark.asOf.slice(0,10)===last.time&&!benchmark.stale&&Date.parse(benchmark.asOf)<=now.getTime()+60000&&(!result.current||marketSession(now)!=='trading'||now.getTime()-Date.parse(benchmark.asOf)<=120000)?benchmark:null;
 const relative=bm&&bm.changePercent!=null?move-bm.changePercent:null;
 const feed=options.intraday,points=feed?.date===last.time?feed.points.filter(p=>p.time<=now.getTime()/1000&&Number.isFinite(p.price)&&p.price>0&&p.volume>0):[];
 // Minute volumes are incremental; do not sum cumulative volume or mix lots with shares.
 const freshPoints=points.length&&(!result.current||marketSession(now)!=='trading'||now.getTime()/1000-points.at(-1)!.time<=120);
 const vwap=freshPoints?points.reduce((n,p)=>n+p.price*p.volume,0)/points.reduce((n,p)=>n+p.volume,0):null;
 result.levels.vwap=vwap;
 result.dimensions=[
  {key:'涨跌动能',weight:25,score:atr>0?clamp(50+(last.close-prev.close)/atr*25):null,value:move,unit:'%'},
  {key:'日内位置',weight:20,score:location===null?null:location*100,value:location===null?null:location*100,unit:'%'},
  {key:'开盘后表现',weight:20,score:atr>0?clamp(50+(last.close-last.open)/atr*25):null,value:fromOpen,unit:'%'},
  {key:'相对沪深300',weight:25,score:relative===null?null:clamp(50+relative*10),value:relative,unit:'pct'},
  {key:'分时均价',weight:10,score:vwap===null||atr<=0?null:clamp(50+(last.close-vwap)/atr*50),value:vwap,unit:''},
 ];
 result.coveredWeight=result.dimensions.reduce((n,d)=>n+(d.score===null?0:d.weight),0);
 result.score=result.coveredWeight?Math.round(result.dimensions.reduce((n,d)=>n+(d.score??0)*d.weight,0)/result.coveredWeight):null;
 result.available=result.score!==null;
 result.label=result.score===null?'数据不足':result.score>=75?'强势':result.score>=60?'偏强':result.score>=40?'震荡':result.score>=25?'偏弱':'弱势';
 result.observations.push(`涨跌 ${pct(move)}；开盘后 ${pct(fromOpen)}`,location===null?'一字价格，日内位置不计分':`现价位于当日振幅的 ${(location*100).toFixed(0)}% 位置`,relative===null?'同期大盘缺失，相对强弱未计分':`较沪深300 ${relative>=0?'强':'弱'} ${Math.abs(relative).toFixed(2)} 个百分点`);
 if(vwap!==null)result.observations.push(`现价${last.close>=vwap?'高于':'低于'}分时价量均价估算 ${vwap.toFixed(2)}`);
 const average=prior.slice(-20).reduce((n,c)=>n+c.volume,0)/20;
 result.volumeRatio=average>0?last.volume/average:null;
 if(result.volumeRatio!==null)result.observations.push(`已发生累计量为前20日均量的 ${result.volumeRatio.toFixed(2)} 倍${result.provisional?'；盘中未外推全天量':''}`);
 if(result.coveredWeight<100)result.risks.push(`评分依据覆盖 ${result.coveredWeight}/100 权重，缺项已列出`);
 if(location!==null&&location<.4&&move>0)result.risks.push('上涨但离日内高点较远，留意回落');
 if(move<0&&(result.volumeRatio??0)>=1.5)result.risks.push('下跌且累计量已超过前20日均量1.5倍');
 if(last.high===last.low)result.risks.push('一字价格不能说明交易流动性');
 if(result.provisional)result.risks.push('盘中评分随行情变化，等待收盘复核');
 const actionBars=[...prior,last];result.operation=guideAction(analyzeGuide(actionBars,{now}),stockCharacter(actionBars,last.time));
 return finishTrend(result);
}

function finishTrend(r:DailyTrend){
 const map:Record<string,string>={
 '快照过期或日期无效，使用可核验日线':'Snapshot is stale or invalid; using verifiable daily bars.',
 '复权日线与快照昨收不一致，快照不参加评分':'Adjusted history and snapshot previous close disagree; snapshot excluded.',
 '当前展示最近可核验交易日，不是今日实时走势':'Showing the latest verifiable historical session, not today’s live trend.',
 '至少需要21根前序有效日线与非零成交量':'Requires at least 21 prior valid daily bars and nonzero volume.',
 '上涨但离日内高点较远，留意回落':'Price is up but well below the session high; monitor the pullback.',
 '下跌且累计量已超过前20日均量1.5倍':'Price is down and observed volume exceeds 1.5× the prior 20-day average.',
 '一字价格不能说明交易流动性':'A single traded price does not establish liquidity.',
 '盘中评分随行情变化，等待收盘复核':'Intraday scores change with prices; review after the close.',
 '一字价格，日内位置不计分':'Single-price session; range position is not scored.',
 '同期大盘缺失，相对强弱未计分':'Matching benchmark is missing; relative strength is not scored.',
 };
 const translate=(v:string)=>map[v]||v
  .replace(/^涨跌 (.+)；开盘后 (.+)$/,'Session return $1; return since open $2')
  .replace(/^现价位于当日振幅的 (.+)% 位置$/,'Price is at $1% of the observed session range')
  .replace(/^较沪深300 强 (.+) 个百分点$/,'Outperformed CSI 300 by $1 percentage points')
  .replace(/^较沪深300 弱 (.+) 个百分点$/,'Underperformed CSI 300 by $1 percentage points')
  .replace(/^现价高于分时价量均价估算 (.+)$/,'Price is above the minute price/volume weighted estimate $1')
  .replace(/^现价低于分时价量均价估算 (.+)$/,'Price is below the minute price/volume weighted estimate $1')
  .replace(/^已发生累计量为前20日均量的 (.+) 倍；盘中未外推全天量$/,'Observed volume is $1× the prior 20-day average; no full-day projection')
  .replace(/^已发生累计量为前20日均量的 (.+) 倍$/,'Observed volume is $1× the prior 20-day average')
  .replace(/^评分依据覆盖 (.+)\/100 权重，缺项已列出$/,'Score coverage: $1/100 weight; missing inputs are listed');
 r.observationsEn=r.observations.map(translate);r.risksEn=r.risks.map(translate);return r;
}
