import type {Snapshot} from './desk-types';
export type CandidateReference={symbol:string;asOf:string;price:number|null;riskReference?:{date:string;rawClose:number;stop:number|null}};
export type CandidateNow={symbol:string;price:number|null;changePercent:number|null;asOf:string|null;fresh:boolean;label:string;tone:'bull'|'bear'|'neutral';reason:string;structureDate:string};
export function candidateNow(c:CandidateReference,q:Snapshot|undefined,now=new Date()):CandidateNow{
 const result:CandidateNow={symbol:c.symbol,price:null,changePercent:null,asOf:null,fresh:false,label:'当前行情待核验',tone:'neutral',reason:'保留结构评分，当前报价缺失，历史价格不当作实时行情。',structureDate:c.asOf};
 if(!q||q.symbol!==c.symbol||!Number.isFinite(q.price)||q.price<=0||!Number.isFinite(Date.parse(q.asOf)))return result;
 result.price=q.price;result.changePercent=q.changePercent;result.asOf=q.asOf;
 const age=now.getTime()-Date.parse(q.asOf),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now);
 const current=age>=-60000&&age<=4*86400000&&!q.stale&&(q.session==='closed'?true:q.asOf.slice(0,10)===today&&(q.session==='break'||age<=180000));
 if(!current){result.label='报价已过期';result.reason='报价时间 '+q.asOf+'，不据此判断当前买点；结构分保留原日期。';return result;}
 result.fresh=true;
 const ref=c.riskReference,quoteDate=q.asOf.slice(0,10),sameBasis=!!ref&&Number.isFinite(ref.rawClose)&&ref.rawClose>0&&(ref.date===quoteDate||Math.abs(q.previous/ref.rawClose-1)<.005)&&Math.abs(Date.parse(quoteDate)-Date.parse(ref.date))<=4*86400000;
 if(sameBasis&&ref!.stop!=null&&Number.isFinite(ref!.stop)&&q.price<ref!.stop){result.label='失守结构防守位';result.tone='bear';result.reason='当前 '+q.price.toFixed(2)+' 低于原结构防守位 '+ref!.stop!.toFixed(2)+'；昨收高分不能沿用为当前买入依据。';}
 else if((q.volumeRatio??0)>=1.5&&q.open!=null&&q.price<q.open&&(q.changePercent??0)<-1){result.label='放量走弱 · 先防守';result.tone='bear';result.reason='当前低于今开，跌幅 '+(q.changePercent??0).toFixed(2)+'%，量比 '+q.volumeRatio!.toFixed(2)+'；需核验支撑，不能照搬昨收建议。';}
 else if((q.changePercent??0)<0&&(q.volumeRatio??99)<.85){result.label='缩量回踩 · 承接待确认';result.tone='neutral';result.reason='今日回落且量比低于0.85；不因变绿直接淘汰，也不因缩量直接认定买点，等待止跌与关键位承接。';}
 else if((q.volumeRatio??0)>=1.2&&q.open!=null&&q.price>q.open&&(q.changePercent??0)>0){result.label='量价转强 · 核验追高风险';result.tone='bull';result.reason='当前高于今开且量比 '+q.volumeRatio!.toFixed(2)+'；结构分不变，还需核验突破位、偏离幅度与买入区间。';}
 else{result.label=q.session==='closed'?'最新收盘 · 结构待复核':'震荡观察 · 等待确认';result.reason='当前涨跌 '+(q.changePercent??0).toFixed(2)+'%；单凭红绿不能决定优劣，结构评分截至 '+c.asOf+'，当前买点需看量价承接。';}
 return result;
}
