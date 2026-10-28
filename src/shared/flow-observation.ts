import type {Tick,TickPayload} from './desk-types';

export type FlowCluster={side:'B'|'S';start:string;end:string;count:number;amount:number;priceChange:number};
export type FlowObservation=ReturnType<typeof observeFlow>;
const seconds=(clock:string)=>{const m=/^(\d{2}):(\d{2}):(\d{2})$/.exec(clock);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):-1;};
const continuous=(s:number)=>s>=34200&&s<41400||s>=46800&&s<53820;
const sum=(rows:Tick[])=>rows.reduce((v,r)=>v+r.amount,0);

/** Public ~3s aggregates cannot identify the parent order or the owner of funds. */
export function observeFlow(payload:Pick<TickPayload,'items'|'date'>,dayAmount:number|null=null,quoteDate?:string){
 const rows=[...new Map(payload.items.filter(r=>continuous(seconds(r.time))&&r.amount>0&&r.volume>0&&r.price>0&&Number.isFinite(r.amount)&&Number.isFinite(r.price)).map(r=>[r.sequence,r])).values()].sort((a,b)=>seconds(a.time)-seconds(b.time)||a.sequence-b.sequence);
 const total=sum(rows),buy=sum(rows.filter(r=>r.side==='B')),sell=sum(rows.filter(r=>r.side==='S')),known=buy+sell;
 const duration=rows.reduce((v,r,i)=>{const gap=i?seconds(r.time)-seconds(rows[i-1].time):0;return v+(gap>0&&gap<=30?gap:0);},0);
 const enough=rows.length>=40&&duration>=300&&total>0&&known/total>=.8;
 const change=rows.length>1?(rows.at(-1)!.price/rows[0].price-1)*100:null;
 const clusters:FlowCluster[]=[];
 for(let i=0;i<rows.length;i++){
  const first=rows[i];if(first.side==='M'||first.amount>200000)continue;
  let j=i+1;
  for(;j<rows.length;j++){const r=rows[j];if(r.side!==first.side||r.amount>200000||seconds(r.time)-seconds(first.time)>30||seconds(r.time)-seconds(rows[j-1].time)>6||Math.abs(r.price/first.price-1)>.003)break;}
  const run=rows.slice(i,j),combined=sum(run),mean=run.reduce((v,r)=>v+r.volume,0)/run.length;
  const cv=Math.sqrt(run.reduce((v,r)=>v+(r.volume-mean)**2,0)/run.length)/mean;
  if(run.length>=5&&combined>=300000&&cv<=.35){clusters.push({side:first.side as 'B'|'S',start:first.time,end:run.at(-1)!.time,count:run.length,amount:combined,priceChange:(run.at(-1)!.price/first.price-1)*100});i=j-1;}
 }
 const buckets=[{name:'<5万',min:0,max:50000},{name:'5–20万',min:50000,max:200000},{name:'20–100万',min:200000,max:1000000},{name:'≥100万',min:1000000,max:Infinity}].map((b,i)=>{
  const subset=rows.filter(r=>r.amount>=b.min&&(i===3||r.amount<b.max));return{name:b.name,count:subset.length,buy:sum(subset.filter(r=>r.side==='B')),sell:sum(subset.filter(r=>r.side==='S')),neutral:sum(subset.filter(r=>r.side==='M'))};
 });
 const buyShare=known?buy/known:null;
 let stance:'positive'|'negative'|'neutral'='neutral',label='样本内多空分歧',explanation='主动方向与价格未形成明显背离，等待后续量价确认。';
 if(!enough){label='样本不足，暂不判断';explanation='至少需要40条、5分钟连续竞价样本且方向识别覆盖≥80%，不把缺失数据当作零流入。';}
 else if(buyShare!>=.6&&change!<=.15){stance='negative';label='买盘密集，价格推进不足';explanation='主动买额占优但价格停滞或回落，存在上方抛压／卖方承接；可能是派发，也可能是换手，不能据此认定主力出货。';}
 else if(buyShare!<=.4&&change!>=-.15){stance='positive';label='卖盘密集，价格仍有承接';explanation='主动卖额占优而价格保持，可能有被动买盘承接；需后续放量上攻确认，不能直接等同主力吸筹。';}
 else if(buyShare!>=.6&&change!>.15){stance='positive';label='样本买盘与价格同向';explanation='主动买额与价格同步增强，关注后续能否持续、突破后是否守住支撑。';}
 else if(buyShare!<=.4&&change!<-.15){stance='negative';label='样本卖压与价格同向';explanation='主动卖额占优且价格回落，承接偏弱；结合关键均线、箱体下沿复核风险。';}
 const coverage=quoteDate===payload.date&&dayAmount&&dayAmount>0&&total<=dayAmount*1.02?Math.min(1,total/dayAmount):null;
 return {version:'public-flow-v1',date:payload.date,available:rows.length>0,enough,start:rows[0]?.time||null,end:rows.at(-1)?.time||null,count:rows.length,amount:total,buy,sell,neutral:total-known,knownShare:total?known/total:null,buyShare,coverage,priceChange:change,buckets,clusters,stance,label,explanation,
  methodology:'连续竞价样本；拆单特征要求同向连续≥5条、间隔≤6秒、30秒内、每条≤20万元、合计≥30万元、量的变异系数≤0.35、价格偏离≤0.3%。仅为研究阈值，未经收益率校准。',
  notice:'公开约3秒聚合分笔，无法还原原始订单、账户或同一主力。这里是样本特征估算，不是暗盘实际资金净额，不外推全天；集合竞价和尾盘集合竞价已剔除。'};
}
