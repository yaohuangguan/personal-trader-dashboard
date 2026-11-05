export const WATCH_PHASES={all:'全部状态',launch:'放量启动',turning:'回踩转强',tracking:'趋势跟踪',extension:'高位延续',pullback:'回踩观察',stalled:'转强滞后',repair:'均线修复',base:'蓄势等待',broken:'结构破位',downward:'向下开花',pending:'待更新'} as const;
export type WatchPhase=keyof typeof WATCH_PHASES;
export type WatchInsightData={symbol:string;generatedAt:string;expiresAt:string;quoteStale?:boolean;trend:{score:number|null;label:string;date:string|null;current:boolean;provisional:boolean};operation:{action:string;label:string;phase:string;ready:boolean;score:number|null;reasons:string[]}|null;structure:{state:string;direction:string;period:string}};
export function insightFresh(data:WatchInsightData|undefined,now=Date.now()){
 return !!data&&!data.quoteStale&&Number.isFinite(Date.parse(data.generatedAt))&&now-Date.parse(data.generatedAt)<90000&&now>=Date.parse(data.generatedAt)-60000;
}
export function watchPhase(data:WatchInsightData|undefined,now=Date.now()):WatchPhase{
 const phase=data?.operation?.phase;
 return insightFresh(data,now)&&data?.operation?.ready&&phase&&phase!=='all'&&phase!=='pending'&&phase in WATCH_PHASES?phase as WatchPhase:'pending';
}
export function watchTrendScore(data:WatchInsightData|undefined,now=Date.now()){
 const score=data?.trend.score;
 return insightFresh(data,now)&&data?.trend.current&&typeof score==='number'&&Number.isFinite(score)?score:null;
}
export function rankWatch(symbols:string[],data:Record<string,WatchInsightData|undefined>,now=Date.now()){
 return [...symbols].sort((a,b)=>(watchTrendScore(data[b],now)??-1)-(watchTrendScore(data[a],now)??-1));
}
