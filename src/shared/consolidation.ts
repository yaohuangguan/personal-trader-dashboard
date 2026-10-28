import type {Candle} from './types';
import type {PatternMark} from './pattern-marks';
/** Each dated snapshot uses only its prefix; a later extension never rewrites an earlier box. */
export function consolidationMarks(bars:Candle[],now=new Date()):PatternMark[]{
 const cn=new Date(now.getTime()+28800000),today=cn.toISOString().slice(0,10),forming=cn.getUTCHours()<15,out:PatternMark[]=[];
 let box:{from:string;high:number;low:number}|null=null,cooldown=0;
 const touches=(rows:Candle[],test:(b:Candle)=>boolean)=>{let count=0,last=-5;rows.forEach((b,i)=>{if(test(b)&&i-last>=3){count++;last=i;}});return count;};
 for(let i=20;i<bars.length&&bars[i].time<=today;i++){
  const b=bars[i],prior=bars.slice(i-20,i),atr=prior.reduce((n,c,k)=>n+Math.max(c.high-c.low,Math.abs(c.high-(bars[i-21+k]?.close??c.open)),Math.abs(c.low-(bars[i-21+k]?.close??c.open))),0)/20;
  const provisional=b.time===today&&forming;if(!(atr>0))continue;
  if(box&&(b.close>box.high+.15*atr||b.close<box.low-.15*atr)){
   const up=b.close>box.high;out.push({time:b.time,kind:'box-break',label:up?'箱体向上突破':'箱体向下破位',direction:up?'bullish':'bearish',position:up?'below':'above',priority:89,provisional,status:provisional?'candidate':'confirmed',anchorTime:box.from,detail:`${provisional?'当前价':'收盘价'}${up?'超过箱顶':'跌破箱底'}${(up?box.high:box.low).toFixed(2)}并超过0.15ATR；${provisional?'盘中边界突破可撤销。':'仍结合量能、动能和后续承接，不单凭突破买卖。'}`});
   if(!provisional){box=null;cooldown=i+5;}continue;
  }
  if(!box&&i>=cooldown){
   const high=Math.max(...prior.map(r=>r.high)),low=Math.min(...prior.map(r=>r.low)),height=high-low;
   if(height>0&&height/low<=.18&&height<=8*atr&&Math.abs(prior.at(-1)!.close-prior[0].close)<=height*.4&&touches(prior,r=>r.high>=high-height*.2)>=2&&touches(prior,r=>r.low<=low+height*.2)>=2&&b.close>=low-.15*atr&&b.close<=high+.15*atr)box={from:prior[0].time,high,low};
  }
  if(box)out.push({time:b.time,kind:'box-range',label:'箱体震荡',direction:'neutral',position:'above',priority:25,provisional,chartVisible:false,status:'observation',anchorTime:box.from,range:{from:box.from,to:b.time,low:box.low,high:box.high},detail:`至${b.time}已观察到至少20根价格区间及上下沿各两次分隔触碰，箱底${box.low.toFixed(2)}、箱顶${box.high.toFixed(2)}；边界由已发生数据确定，箱体不等同吸筹。`});
 }
 return out;
}
export function visiblePatternRanges(marks:PatternMark[],bars:Candle[],from:number,to:number,limit=3){
 const index=new Map(bars.map((b,i)=>[b.time,i])),boxes=new Map<string,PatternMark>();
 const modern=marks.some(m=>m.kind==='box-range'&&(index.get(m.knownAt||m.time)??Infinity)<=to);
 for(const m of marks){if(!m.range||modern&&m.kind!=='box-range'||(index.get(m.knownAt||m.time)??Infinity)>to)continue;const a=index.get(m.range.from),b=index.get(m.range.to);if(a===undefined||b===undefined||b<from||a>to)continue;const key=m.anchorTime||m.range.from,old=boxes.get(key);if(!old||m.time>=old.time)boxes.set(key,m);}
 return [...boxes.values()].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,limit);
}
