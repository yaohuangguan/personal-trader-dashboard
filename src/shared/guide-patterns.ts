import {FIBONACCI_MA,maPeriods,maRole} from './ma-system';
import type {Candle} from './types';
import type {PatternMark} from './pattern-marks';
import {sma,macd,kdj,bollinger,rsi,parabolicSar} from './chart-indicators';
import {closedPeriodCandles} from './guide-analysis';
import {classicShapes} from './shape-rules';

export const GUIDE_PATTERN_COVERAGE=[
 {chapter:'03 / 04 / 06 / 12',group:'均线与中继',items:['均线编织','黄金开花 / 海底捞月','空中加油','金蟾蜍','死亡开花 / 断头铡刀','金蜘蛛','回头望月','老鸭头','美人肩'],requirement:'同源日线；海底捞月另需250线历史'},
 {chapter:'07',group:'单根与组合K线',items:['射击之星','吊颈线','锤头线','倒锤头','乌云盖顶','穿头破脚','刺透形态','旭日东升','黄昏之星','三只乌鸦','早晨之星','红三兵'],requirement:'必须核验前序上涨 / 下跌背景，不单看蜡烛外形'},
 {chapter:'07',group:'价格结构',items:['M头 / 双顶','头肩顶','W底 / 双底','头肩底','顶部岛形反转','底部岛形反转','圆弧底'],requirement:'右侧摆点形成后才识别；颈线突破标在确认日'},
 {chapter:'05 / 08 / 09 / 21 / 23 / 24',group:'动能、量价与风控',items:['MACD水上金叉','MACD将死不死','MACD零轴共振','MACD红柱扩张','MACD喇叭口','KDJ高位钝化','J跌破80','BOLL收口','BOLL张口','RSI站上50','RSI顶背离','BBI上穿 / 下破','SAR转向','量堆换手','凹洞量后放量','六类量价关系','时空窗口突破','支撑假跌破后收复','MA5 / MA20失守','高位放量阴线','价格与MACD背离'],requirement:'指标协同是辅助证据，不把每个指标交叉当买卖点'},
 {chapter:'14',group:'周月专项',items:['周线屠龙刀','月线突破30月线','月线缩量回踩30月线'],requirement:'仅在对应周 / 月K展示，未收盘周期不确认'},
 {chapter:'10 / 11 / 13 / 22',group:'需要额外证据',items:['逐笔扫单 / 撤单 / 委托队列','竞价撤单与最后突袭','真实筹码锁仓 / 转移','实际仓位与账户级止损'],requirement:'授权逐笔与竞价序列、真实筹码或账户数据尚未接入；不会从OHLCV代填',unavailable:true},
] as const;
type Pivot={i:number;value:number};
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
/** Guide observations use a completed prefix. Chart density is a separate rendering concern. */
export function guidePatternMarks(input:Candle[],now=new Date(),unit:'day'|'week'|'month'='day',selectedPeriods?:number[]):PatternMark[]{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now),minute=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hour12:false}).format(now))*60+Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',minute:'2-digit'}).format(now));
 const bars=unit==='day'?input.filter(b=>b.time<=day):closedPeriodCandles(input,unit,now),out:PatternMark[]=[];
 if(bars.some((b,i)=>![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||i>0&&b.time<=bars[i-1].time))return [];
 const selected=maPeriods(selectedPeriods),periods=[...new Set([3,5,6,10,12,13,20,24,30,60,120,250,...selected,...FIBONACCI_MA])],mas=new Map(periods.map(n=>[n,new Map(sma(bars,n).map(p=>[p.time,p.value]))]));
 const ma=(p:number,i:number)=>mas.get(selectedPeriods&&[5,10,13,20,30,60,120,250].includes(p)?maRole(selected,p):p)?.get(bars[i]?.time)??NaN,md=new Map(macd(bars).map(p=>[p.time,p])),kd=new Map(kdj(bars).map(p=>[p.time,p])),bb=new Map(bollinger(bars).map(p=>[p.time,p])),rs=new Map(rsi(bars).map(p=>[p.time,p.value])),sar=new Map(parabolicSar(bars).map(p=>[p.time,p.value]));
 const highs:Pivot[]=[],lows:Pivot[]=[],last=new Map<string,number>(),vsum=[0];bars.forEach((b,i)=>vsum.push(vsum[i]+b.volume));
 let launch:{i:number;low:number}|null=null,shoulder:{launch:string;seen:number;high:number;low:number}|null=null;
 const extreme=(from:number,to:number,key:'low'|'high')=>{let j=from;for(let k=from+1;k<to;k++)if(key==='low'?bars[k].low<bars[j].low:bars[k].high>bars[j].high)j=k;return {i:j,value:bars[j][key]};};
 for(let i=20;i<bars.length;i++){
  const b=bars[i],p=bars[i-1],a=bars[i-2],base=(vsum[i]-vsum[i-20])/20,ratio=base>0?b.volume/base:0,atr=mean(bars.slice(i-20,i).map((c,k)=>Math.max(c.high-c.low,Math.abs(c.high-(bars[i-21+k]?.close??c.open)),Math.abs(c.low-(bars[i-21+k]?.close??c.open)))));
  if(!(atr>0))continue;
  const body=b.close-b.open,abs=Math.abs(body),range=b.high-b.low,upper=b.high-Math.max(b.open,b.close),lower=Math.min(b.open,b.close)-b.low,location=range?(b.close-b.low)/range:.5,gain=(b.close/p.close-1)*100;
  const prior=bars.slice(i-20,i),priorHigh=Math.max(...prior.map(c=>c.high)),priorLow=Math.min(...prior.map(c=>c.low)),advance=(p.close/bars[i-11].close-1)*100,highContext=(advance>=18||p.close/ma(20,i-1)-1>.12)&&p.close>=priorHigh-atr*1.5,lowContext=advance<=-6&&p.close<=priorLow+atr*1.5;
  const provisional=unit==='day'&&b.time===day&&minute<900;
  const emit=(kind:string,label:string,detail:string,bull=true,priority=65,spacing=8,anchorTime?:string,chartVisible=true)=>{if(i-(last.get(kind)??-999)<spacing)return;out.push({time:b.time,kind,label,detail,direction:['braid','boll-squeeze','vp-flat','volume-pile'].includes(kind)?'neutral':bull?'bullish':'bearish',position:bull?'below':'above',priority,provisional,status:'observation',anchorTime,chartVisible});if(!provisional)last.set(kind,i);};
  const small=abs<=atr*.35&&range>=atr*.65,prevBody=p.close-p.open,firstBody=a.close-a.open;
  if(highContext&&small&&upper>=Math.max(abs*2,range*.55)&&lower<range*.2)emit('shooting-star','射击之星','前序上涨后出现小实体长上影；为受阻观察，不把长上影自动解释为仙人指路。',false,80);
  if(highContext&&small&&lower>=Math.max(abs*2,range*.55)&&upper<range*.2)emit('hanging-man','吊颈线','前序上涨后的长下影小实体；需要后续承接核验，不能仅凭下影认定见底。',false,72);
  if(lowContext&&small&&lower>=Math.max(abs*2,range*.55)&&upper<range*.2&&ratio>=.8)emit('hammer','锤头线','前序下跌后出现长下影、小实体；只是企稳候选，需后续收复与量能。',true,68);
  if(lowContext&&small&&upper>=Math.max(abs*2,range*.55)&&lower<range*.2&&ratio>=.8)emit('inverted-hammer','倒锤头','前序下跌后的小实体长上影；区别于上升初段的仙人指路，未证明反转。',true,65);
  const engulfBear=body<-.6*atr&&prevBody>.4*atr&&b.open>=p.close&&b.close<=p.open,engulfBull=body>.6*atr&&prevBody<-.4*atr&&b.open<=p.close&&b.close>=p.open;
  if(highContext&&engulfBear&&ratio>=1.2)emit('bear-engulf','穿头破脚 · 阴包阳','上涨背景下实体吞没前阳且放量；优先复核支撑与退出风险。',false,91);
  else if(highContext&&prevBody>.6*atr&&body<-.6*atr&&b.open>p.high&&b.close<(p.open+p.close)/2&&b.close>p.open&&ratio>=1.2)emit('dark-cloud','乌云盖顶','上涨背景下高开阴线收进前阳半位以下，尚未完全吞没。',false,84);
  if(lowContext&&engulfBull&&ratio>=1.3&&location>=.65)emit('bull-engulf','旭日东升 · 阳包阴','下跌背景下阳线实体吞没前阴并放量；仍须核验上方阻力。',true,86);
  else if(lowContext&&prevBody<-.6*atr&&body>.6*atr&&b.open<p.low&&b.close>(p.open+p.close)/2&&b.close<p.open&&ratio>=1.3)emit('piercing','刺透形态','下跌背景下低开阳线收进前阴半位以上，尚未完全吞没。',true,80);
  const firstContext=(a.close/bars[i-12].close-1)*100,star=Math.abs(prevBody)<=.25*atr;
  if(firstContext>=6&&firstBody>.6*atr&&star&&Math.min(p.open,p.close)>a.close&&body<-.6*atr&&b.close<(a.open+a.close)/2&&ratio>=1.2)emit('evening-star','黄昏之星','前序上涨、首阳后跳空小实体、末阴跌回首阳半位以下。',false,90);
  if(firstContext<=-6&&firstBody<-.6*atr&&star&&Math.max(p.open,p.close)<a.close&&body>.6*atr&&b.close>(a.open+a.close)/2&&ratio>=1.3)emit('morning-star','早晨之星','前序下跌、首阴后跳空小实体、末阳收复首阴半位。',true,88);
  const trio=bars.slice(i-2,i+1),threeDown=trio.every(c=>c.close<c.open&&c.open-c.close>=.4*atr),threeUp=trio.every(c=>c.close>c.open&&c.close-c.open>=.25*atr&&c.close-c.open<=1.2*atr);
  if(firstContext>=6&&threeDown&&a.close>p.close&&p.close>b.close&&p.open<=a.open&&p.open>=a.close&&b.open<=p.open&&b.open>=p.close&&location<=.3)emit('three-crows','三只乌鸦','上涨背景下三根有实体阴线逐步走低，开盘落在前实体范围；区别于普通阴跌。',false,87);
  if(firstContext<=-4&&threeUp&&a.close<p.close&&p.close<b.close&&p.open>=a.open&&p.open<=a.close&&b.open>=p.open&&b.open<=p.close&&location>=.7&&ratio>=1.1)emit('three-soldiers','红三兵','下跌或低位背景下三根适度实体阳线重心上移，末根收近高位。',true,78);

  // A pivot is known only after two bars on its right. Labels stay on the later neckline break.
  const j=i-2;
  if(j>=2&&bars[j].high>bars[j-1].high&&[j-2,j-1,j+1,j+2].every(k=>bars[j].high>=bars[k].high))highs.push({i:j,value:bars[j].high});
  if(j>=2&&bars[j].low<bars[j-1].low&&[j-2,j-1,j+1,j+2].every(k=>bars[j].low<=bars[k].low))lows.push({i:j,value:bars[j].low});
  const h=highs.slice(-3),l=lows.slice(-3);
  for(const [points,top] of [[h,true],[l,false]] as const){
   if(points.length<2)continue;const [x,y]=points.slice(-2),distance=y.i-x.i;
   const entryContext=x.i>=10?(x.value/bars[x.i-10].close-1):0;
   if(distance>=5&&distance<=40&&i-y.i<=20&&(top?entryContext>.05:entryContext<-.05)&&Math.abs(x.value-y.value)<=Math.max(atr*.8,x.value*.025)){
    const neck=extreme(x.i+1,y.i,top?'low':'high').value,depth=top?Math.min(x.value,y.value)-neck:neck-Math.max(x.value,y.value);
    const crossed=top?p.close>=neck&&b.close<neck-.15*atr:p.close<=neck&&b.close>neck+.15*atr;
    if(depth>=2*atr&&crossed&&ratio>=(top?1.2:1.5)&& (top?body<-.5*atr:body>.5*atr))emit(top?'double-top':'double-bottom',top?'M头 · 颈线失守':'W底 · 颈线突破',`两次已确认摆点间隔${distance}根；当前收盘${top?'跌破':'突破'}颈线${neck.toFixed(2)}，不把确认回画到早先极值。`,!top,94,15,bars[x.i].time);
   }
   if(points.length<3)continue;const [left,head,right]=points;
   const before=left.i>=10?left.value/bars[left.i-10].close-1:0;
   if(!(top?before>.05:before<-.05)||head.i-left.i<4||right.i-head.i<4||right.i-left.i>70||i-right.i>20||Math.abs(left.value-right.value)>1.2*atr||!(top?head.value>Math.max(left.value,right.value)+.8*atr:head.value<Math.min(left.value,right.value)-.8*atr))continue;
   const n1=extreme(left.i+1,head.i,top?'low':'high'),n2=extreme(head.i+1,right.i,top?'low':'high'),slope=(n2.value-n1.value)/(n2.i-n1.i),neck=n2.value+slope*(i-n2.i),previousNeck=neck-slope;
   if((top?p.close>=previousNeck&&b.close<neck-.15*atr:p.close<=previousNeck&&b.close>neck+.15*atr)&&ratio>=(top?1.2:1.5)&&Math.abs(body)>.5*atr)emit(top?'head-shoulders-top':'head-shoulders-bottom',top?'头肩顶 · 颈线失守':'头肩底 · 颈线突破',`三处右侧已确认摆点及两处颈线拐点；当前${top?'失守':'突破'}投影颈线${neck.toFixed(2)}。`,!top,96,20,bars[left.i].time);
  }
  for(let d=2;d<=6;d++){
   const start=i-d,first=bars[start],island=bars.slice(start,i),islandLow=Math.min(...island.map(c=>c.low)),islandHigh=Math.max(...island.map(c=>c.high));
   if(first.low>bars[start-1].high+.15*atr&&b.high<islandLow-.15*atr&&ratio>=1.2){emit('island-top','顶部岛形反转','此前向上缺口后，当前向下缺口与孤岛区完全分离；按复权价格核验双缺口。',false,96,15,first.time);break;}
   if(first.high<bars[start-1].low-.15*atr&&b.low>islandHigh+.15*atr&&ratio>=1.3){emit('island-bottom','底部岛形反转','此前向下缺口后，当前向上缺口与孤岛区完全分离。',true,94,15,first.time);break;}
  }
  if(i>=64){
   const m5=ma(5,i),m10=ma(10,i),m20=ma(20,i),m60=ma(60,i),core=[5,10,20,30,60].map(n=>ma(n,i)),tight=(Math.max(...core)/Math.min(...core)-1)*100,up=m5>m10&&m10>m20&&m20>m60,impulse=body>.6*atr&&location>=.7&&ratio>=1.5;
   if(launch&&b.close<launch.low-.15*atr)launch=null;
   if(launch&&[13,21,34].includes(i-launch.i)&&impulse&&b.close>priorHigh+.1*atr)emit('space-time','时空窗口突破 · D'+(i-launch.i),`距已知启动${i-launch.i}根，当前才放量突破前20根高点；时间窗口本身不预测涨跌。`,true,82,8,bars[launch.i].time);
   if(shoulder&&i-shoulder.seen<=8&&b.low>=shoulder.low-.2*atr&&b.close>shoulder.high+.1*atr&&p.close<=shoulder.high&&b.close>m20&&impulse){emit('beauty-breakout','美人肩 · 放量突破',`${shoulder.launch}启动后的窄幅缩量肩部已形成，当前才放量突破肩部高点。`,true,94,12,shoulder.launch);if(!provisional)shoulder=null;}
   if(shoulder&&(b.close<shoulder.low-.2*atr||i-shoulder.seen>8))shoulder=null;
   for(const hit of classicShapes(bars,i,(p,j)=>mas.get(p)?.get(bars[j]?.time)??NaN,atr,ratio,selectedPeriods)){
    if(hit.kind==='multi'&&!provisional)launch={i,low:b.low};
    if(hit.kind==='beauty'&&!provisional){const from=bars.findIndex(c=>c.time===hit.anchorTime)+1,recent=bars.slice(from,i+1);shoulder={launch:hit.anchorTime!,seen:i,high:Math.max(...recent.map(c=>c.high)),low:Math.min(...recent.map(c=>c.low))};}
   }
   if(gain<=-3&&body<-.8*atr&&ratio>=1.5&&[5,10,20,30,60].filter(n=>b.open>=ma(n,i)&&b.close<ma(n,i)).length>=3)emit('death-bloom','死亡开花 · 断头铡刀','放量阴线实体切断至少三条核心均线；风控观察不推定资金身份。',false,99,7);
   if(i>=255&&impulse&&ma(250,i)/ma(250,i-5)>=.999&&ma(250,i-5)<=ma(250,i-20)&&m5>m10&&m10>m20&&b.close>m60&&p.close<=ma(60,i-1)&&tight<8)emit('golden-bloom','黄金开花 · 海底捞月','250线由下行转近平，中短线多头，当前放量收复60线；长期背景已核验。',true,94,15);
   const pulls=bars.slice(i-4,i),pullBase=mean(pulls.map(c=>c.volume)),touch60=pulls.some((c,k)=>c.low<=ma(60,i-4+k)+.5*atr)&&pulls.every((c,k)=>c.close>=ma(60,i-4+k)-.1*atr);
   if(impulse&&m60>ma(60,i-5)&&priorHigh>m60*1.12&&touch60&&pullBase<base*.8&&b.close>p.high)emit('air-refuel','空中加油 · 60线再起','原有上升背景、缩量回踩60线且收盘守住，当前放量转强。',true,92,12);
   if(pulls.slice(-3).every(c=>c.close<c.open)&&pulls[1].volume>pulls[2].volume&&pulls[2].volume>pulls[3].volume&&m5>m10&&m10>m20&&ma(5,i-1)>ma(5,i-4)&&ma(10,i-1)>ma(10,i-4)&&body>.6*atr&&b.close>Math.max(...pulls.slice(-3).map(c=>c.open),m5,m10)&&ratio>=1.3)emit('looking-back','回头望月','上行5/10线背景，前三根缩量阴线后，当前放量阳线反包并收复5/10线。',true,91,10);
   if(h.length>=2){const [left,right]=h.slice(-2),valley=extreme(left.i+1,right.i,'low');if(right.i-left.i>=5&&right.i-left.i<=35&&i-right.i<=10&&m60>ma(60,i-5)&&valley.value>=ma(60,valley.i)&&Math.abs(left.value-right.value)<=1.5*atr&&p.close<=Math.max(left.value,right.value)&&b.close>Math.max(left.value,right.value)+.1*atr&&impulse)emit('golden-toad','金蟾蜍 · 右眼突破','上行60线之上形成两个已确认小高点，谷底未失守60线，当前放量越过双高点。',true,90,15,bars[left.i].time);}
   const necks=Array.from({length:Math.min(32,i-65)},(_,k)=>i-8-k).filter(n=>ma(5,n)>ma(60,n)&&ma(10,n)>ma(60,n)&&(ma(5,n-1)<=ma(60,n-1)||ma(10,n-1)<=ma(60,n-1)));
   if(necks.length&&impulse&&m60>=ma(60,i-5)&&m5>m10&&ma(5,i-1)<=ma(10,i-1)&&b.close>Math.max(...bars.slice(i-5,i).map(c=>c.high))){const n=necks[0],peak=Math.max(...bars.slice(n,i-4).map(c=>c.high)),hold=bars.slice(i-5,i).every((c,k)=>c.close>=ma(60,i-5+k)-.1*atr),dry=bars.slice(i-5,i).some(c=>c.volume<base*.6);if(peak>m60*1.08&&hold&&dry)emit('old-duck','老鸭头 · 鸭嘴再启','先有5/10线上穿60线的鸭颈，冲高回踩且有地量，60线未失守，当前再次金叉放量突破。',true,94,20,bars[n].time);}
   if(i>=120&&[30,60].some(short=>[120,250].some(long=>i>=long+20&&Array.from({length:15},(_,k)=>i-k).filter(n=>(ma(short,n)-ma(long,n))*(ma(short,n-1)-ma(long,n-1))<0).length>=3))&&tight<4&&ratio<.8)emit('braid','均线编织 · 密集震荡','30/60与120/250在近15根至少三次换位且核心线密集；反复交叉并非反复买卖。',true,42,15);
   if(i>=60){const chunks=Array.from({length:6},(_,k)=>mean(bars.slice(i-60+k*10,i-50+k*10).map(c=>c.close)));if(chunks[0]>Math.min(chunks[2],chunks[3])*1.08&&Math.abs(chunks[2]/chunks[3]-1)<.04&&chunks[3]<chunks[4]&&chunks[4]<chunks[5]&&chunks[0]>chunks[1]&&chunks[1]>chunks[2]&&m20>ma(20,i-5)&&b.close>priorHigh+.1*atr&&p.close<=priorHigh&&impulse)emit('rounding-bottom','圆弧底 · 右侧突破','60根分段均价先降、底部趋平、再逐步抬升，当前放量突破前20根区间；只描述右侧可核验结构。',true,90,25);}
   const previous20=ma(20,i-1),previous5=ma(5,i-1);
   if(p.close>=previous20&&b.close<m20-.3*atr&&body<-.5*atr)emit('ma20-loss','MA20支撑失守','收盘由20线上方跌至20线下方且超过0.3ATR；是风险证据，须结合既定失效价。',false,90,6);
   if(up&&p.close>=previous5&&b.close<m5-.25*atr&&body<-.5*atr)emit('ma5-loss','MA5动能减弱','原多头环境中收盘失守5线且超过0.25ATR；不把所有微小穿线都画成卖点。',false,75,6);
   const under=bars.slice(i-4,i).filter((c,k)=>c.close<ma(20,i-4+k));
   if(under.length>=1&&under.length<=3&&p.close<previous20&&impulse&&b.close>m20+.15*atr&&b.close>p.high)emit('bear-trap-reclaim','假跌破后放量收复','近期1–3根失守20线，当前放量阳线收复并越过前高；收复发生前保留原风控事件。',true,90,10);
   if(highContext&&body<-.9*atr&&ratio>=2&&location<.25)emit('high-volume-bear','高位放量长阴','前序上涨后放量长阴收近低位；描述抛压变化，不推定是机构派发。',false,97,8);
  }
  const m=md.get(b.time),mp=md.get(p.time),m2=md.get(a.time),k=kd.get(b.time),kp=kd.get(p.time),band=bb.get(b.time),pb=bb.get(p.time),r=rs.get(b.time),rp=rs.get(p.time);
  if(i>=35&&m&&mp&&m2){
   if(m.dif>m.dea&&mp.dif<=mp.dea&&m.dif>=0&&body>0&&ratio>=1.2)emit('macd-water-cross','MACD水上金叉','DIF/DEA于零轴上方完成上穿，并有阳线和参与量配合；指标协同，不等同于买点。',true,48,8);
   if(m.histogram>0&&mp.histogram>0&&m2.histogram>0&&mp.histogram<m2.histogram&&m.histogram>mp.histogram*1.3&&mp.histogram<Math.max(atr*.08,m2.histogram*.6)&&b.close>ma(20,i))emit('macd-near-miss','MACD将死不死','红柱明显收敛后未转负再次扩张，价格仍守20线；只使用已发生的指标路径。',true,52,10);
   if(Math.abs(m.dif)<atr*.15&&Math.abs(m.dea)<atr*.15&&m.histogram>0&&mp.histogram<=0&&body>0&&ratio>=1.3)emit('macd-zero','MACD零轴共振','零轴附近交汇后动能转正，量价同向；幅度阈值按ATR归一化。',true,50,10);
   if(m.histogram>mp.histogram&&mp.histogram>m2.histogram&&m2.histogram>0&&m.histogram>atr*.1&&b.close>p.close)emit('macd-red-expansion','MACD红柱扩张','连续三根正柱增强且价格同步抬升。',true,35,10);
   if(m.histogram>atr*.25&&m.histogram>mp.histogram*1.5&&mp.histogram>0&&m.dif>mp.dif&&m.dea>mp.dea)emit('macd-open','MACD喇叭口','DIF、DEA同向上行，差值显著扩大；不把喇叭口独立当入场条件。',true,40,10);
   if(b.close>priorHigh&&m.histogram>0&&m.histogram<Math.max(...prior.map(c=>md.get(c.time)?.histogram||0))*.7&&ratio>=1.2)emit('macd-divergence','价格新高 · MACD未跟随','价格突破前20根高点，MACD柱显著低于该段峰值；动能背离风险候选。',false,73,10);
  }
  if(k&&kp){if(k.j>=100&&kp.j>=100&&(kd.get(a.time)?.j??0)<100&&b.close>ma(20,i))emit('kdj-passivation','KDJ高位钝化','连续两根J值≥100且价格守20线；高位本身不自动构成卖出。',true,35,12);if(k.j<80&&kp.j>=80&&Math.max(...bars.slice(i-5,i).map(c=>kd.get(c.time)?.j??0))>=100)emit('kdj-loss80','J值跌破80','近5根曾高位钝化，当前J跌回80以下；需结合价量与持仓防线复核。',false,73,8);}
  if(band&&pb&&band.mid>0){const bw=(band.upper-band.lower)/band.mid,old=bars.slice(Math.max(19,i-60),i).map(c=>bb.get(c.time)).filter((v):v is NonNullable<typeof v>=>!!v).map(v=>(v.upper-v.lower)/v.mid);if(old.length>=40&&bw<=Math.min(...old)*1.05&&ratio<.8)emit('boll-squeeze','BOLL收口','带宽接近此前60根低位且量能偏低；收口不预先判定突破方向。',true,35,20);if(bw>(pb.upper-pb.lower)/pb.mid*1.2&&b.close>band.upper&&ratio>=1.5)emit('boll-expansion','BOLL向上张口','带宽较前一根扩大20%以上，价格上破上轨且放量；仍检查追高风险。',true,48,10);}
  if(r!==undefined&&rp!==undefined&&r>50&&rp<=50&&body>.4*atr&&ratio>=1.2)emit('rsi50','RSI站上50','RSI14穿越中轴并有阳线参与量支持。',true,35,8);
  if(h.length>=2&&r!==undefined){const [x,y]=h.slice(-2),old=rs.get(bars[x.i].time),current=rs.get(bars[y.i].time);if(i===y.i+2&&y.value>x.value+.2*atr&&old!==undefined&&current!==undefined&&current<old-5&&old>=65)emit('rsi-divergence','RSI顶背离候选','右侧高点现已确认，价格峰值抬升而RSI低至少5点；标在当前确认日。',false,80,12,bars[y.i].time);}
  if(i>=25){const bbi=mean([3,6,12,24].map(n=>ma(n,i))),old=mean([3,6,12,24].map(n=>ma(n,i-1)));if(p.close<=old&&b.close>bbi+.2*atr&&body>.5*atr&&ratio>=1.2)emit('bbi-up','BBI上穿','收盘越过3/6/12/24均线平均值且有实体及参与量。',true,38,8);if(p.close>=old&&b.close<bbi-.2*atr&&body<-.5*atr)emit('bbi-down','BBI下破','收盘跌破多空平衡线且超过0.2ATR；作为风险证据。',false,58,8);}
  const sv=sar.get(b.time),sp=sar.get(p.time);if(sv!==undefined&&sp!==undefined&&p.close>=sp&&b.close<sv&&body<-.3*atr)emit('sar-down','SAR向下转向','SAR由价格下方翻到上方，原上涨防守结构改变；实际退出以预设计划核验。',false,72,8);
  if(sv!==undefined&&sp!==undefined&&p.close<=sp&&b.close>sv&&body>.5*atr&&ratio>=1.2)emit('sar-up','SAR向上转向','SAR由价格上方翻到下方，作为修复辅助证据。',true,42,8);
  if(ratio>=1.5&&gain>=2)emit('vp-up','量增价涨',`前20根相对量${ratio.toFixed(2)}倍，涨幅${gain.toFixed(2)}%；需结合所处价格位置。`,true,30,8);
  if(ratio<=.75&&gain>=2&&b.close>ma(20,i))emit('vp-dry-up','量缩价涨','价格上涨而参与量低于20根均量75%；不直接推定为锁仓。',true,25,10);
  if(highContext&&ratio>=2&&upper>=.6*atr&&location<.45&&b.high>p.high&&gain<5)emit('high-volume-rejection','放量冲高回落','上涨背景中放量冲高、上影显著且最新价回落至振幅下部；盘中须继续核验承接，收盘前可以失效。',false,88,5);
  if(ratio>=2&&Math.abs(gain)<.5&&highContext)emit('vp-stall','量大滞涨','上涨背景中相对量≥2倍而涨幅绝对值不足0.5%；需要复核承接。',false,78,8);
  if(ratio>=1.5&&gain<=-2)emit('vp-down','量增价跌','下跌伴随相对量≥1.5倍；抛压偏强，复核支撑是否失效。',false,65,8);
  if(ratio<=.75&&gain<=-2)emit('vp-dry-down','缩量回落 · 承接待核验','缩量跌幅≥2%；既可能回踩也可能承接衰退，不直接命名洗盘。',false,30,10);
  if(ratio<=.6&&Math.abs(gain)<.5)emit('vp-flat','量缩价平','相对量≤0.6倍、涨跌幅绝对值不足0.5%；等待方向与承接。',true,20,15);
  if(i>=25&&bars.slice(i-3,i).every(c=>c.volume<base*.6)&&ratio>=2&&gain>=2&&body>.6*atr&&location>=.7)emit('volume-cavity','凹洞量后放量','连续三根地量后当前实际量≥20根均量2倍并主动上涨；不外推盘中全天量。',true,80,12);
  if(i>=40){const recent=bars.slice(i-10,i),older=mean(bars.slice(i-30,i-10).map(c=>c.volume));if((Math.max(...recent.map(c=>c.high))/Math.min(...recent.map(c=>c.low))-1)<.12&&recent.filter(c=>c.close>c.open&&c.volume>older*1.5).length>=4&&mean(recent.map(c=>c.volume))>older*1.3)emit('volume-pile','窄幅量堆换手','前10根区间较窄、至少四根阳线显著放量；仅描述换手，无法从此证明吸筹。',true,50,15);}
  if(unit==='week'&&i>=64&&ma(5,i)>ma(10,i)&&ma(5,i-1)<=ma(10,i-1)&&Math.abs(ma(30,i)/ma(60,i)-1)<.02&&ma(30,i)/ma(30,i-5)>=.999&&ma(60,i)/ma(60,i-5)>=.999)emit('weekly-dragon','周线屠龙刀','已收盘周线5/10金叉，30/60粘合小于2%且接近走平；只在周K标注。',true,99,5);
  if(unit==='month'&&i>=31){if(p.close<=ma(30,i-1)&&b.close>ma(30,i)&&b.volume>p.volume&&body>0)emit('monthly-launch','月线放量突破30月线','已收盘月线放量收复30月线；后续回踩需独立核验。',true,98,3);if(a.close<=ma(30,i-2)&&p.close>ma(30,i-1)&&p.volume>a.volume&&b.low>=ma(30,i)&&b.close>=ma(30,i)&&b.volume<p.volume)emit('monthly-retest','月线缩量回踩30月线','前月放量上破30月线，本月已收盘且缩量回踩不破。',true,99,3);}
 }
 return selectedPeriods?out.map(m=>({...m,detail:`当前图表MA${selected.join('/')}；`+m.detail})):out;
}
