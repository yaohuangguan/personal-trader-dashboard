import type {IntradayPoint} from './desk-types';
import {sessionMinute} from './intraday-axis';
export function intradayStudy(points:IntradayPoint[],previous:number|null){
 const valid=[...new Map(points.filter(p=>sessionMinute(p.clock)!==null&&p.price>0&&Number.isFinite(p.price)).map(p=>[p.clock,p])).values()].sort((a,b)=>a.time-b.time);
 let fast=valid[0]?.price||0,slow=fast,dea=0;
 return valid.map((p,i)=>{fast+=2/13*(p.price-fast);slow+=2/27*(p.price-slow);const dif=fast-slow;dea+=.2*(dif-dea);return{...p,rising:p.price>=(i?valid[i-1].price:previous||p.price),dif,dea,histogram:2*(dif-dea),warmup:i<33};});
}
export const isMarketIndex=(symbol:string)=>/^(000\d{3}\.SH|399\d{3}\.SZ|899050\.BJ)$/.test(symbol);
