import type {Candle} from './types';
export function stockCharacter(input:Candle[],asOf:string){
 const rows=input.filter(c=>c.time<=asOf&&c.close>0&&c.volume>=0).sort((a,b)=>a.time.localeCompare(b.time)).slice(-250);
 if(rows.length<65)return null;
 const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
 const last=rows.slice(-60),returns=last.slice(1).map((c,i)=>(c.close/last[i].close-1)*100);
 const avg=mean(returns),volatility=Math.sqrt(mean(returns.map(r=>(r-avg)**2)));
 const atr=mean(last.slice(-20).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-(last.at(-21+i)?.close??c.open)),Math.abs(c.low-(last.at(-21+i)?.close??c.open)))/c.close*100));
 const range=(Math.max(...last.map(c=>c.high))/Math.min(...last.map(c=>c.low))-1)*100;
 const impulseDays=returns.filter(r=>r>=5).length;
 const historicalBreakouts:{date:string;ret5:number}[]=[];
 // A breakout's following five bars must already exist. Overlapping events are skipped.
 for(let i=20;i<rows.length-5;i++){
  const prior=rows.slice(i-20,i),high=Math.max(...prior.map(c=>c.high)),baseVol=mean(prior.map(c=>c.volume));
  if(rows[i].close>high&&rows[i].volume>=baseVol*1.5){historicalBreakouts.push({date:rows[i].time,ret5:(rows[i+5].close/rows[i].close-1)*100});i+=5;}
 }
 const continuation=historicalBreakouts.length?historicalBreakouts.filter(r=>r.ret5>0).length/historicalBreakouts.length:null;
 const volumeBase=mean(rows.slice(-25,-5).map(c=>c.volume)),volumeExpansion=volumeBase>0?mean(rows.slice(-5).map(c=>c.volume))/volumeBase:null;
 const quiet=volatility<1.2&&atr<2.2&&impulseDays===0;
 const active=volatility>=2||impulseDays>=3;
 const weakFollow=historicalBreakouts.length>=3&&continuation!==null&&continuation<.4;
 const score=Math.round(Math.min(40,volatility*12)+Math.min(25,impulseDays*5)+Math.min(20,(volumeExpansion??0)*10)+(historicalBreakouts.length>=3&&continuation!==null?continuation*15:0));
 return {asOf,days:rows.length,volatility,atr,range,impulseDays,volumeExpansion,breakouts:historicalBreakouts.length,continuation,quiet,active,weakFollow,score,label:quiet?'低弹性 · 易持续横盘':active?'历史活跃': '中等弹性',warnings:[...(quiet?['近60日低波动且无5%脉冲，粘合可能继续横盘']:[]),...(weakFollow?['历史放量突破后5日延续较弱']:[])]};
}
export type StockCharacter=NonNullable<ReturnType<typeof stockCharacter>>;
