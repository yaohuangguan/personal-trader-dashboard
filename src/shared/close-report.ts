import type {ScreenCandidate} from './screening';
import type {ScreenOptions} from './pattern-screen';
import type {Snapshot} from './desk-types';
export type CloseReport={id:string;date:string;generatedAt:number;total:number;eligible:number;checked:number;failed:number;failureSample:{symbol:string;reason:string}[];rejected:Record<string,number>;candidates:ScreenCandidate[];complete:boolean;source:string;elapsedMs:number;cacheHits:number};
export type CloseManifest=Omit<CloseReport,'candidates'>&{chunks:number;count:number};
export function isClosingSnapshot(q:Snapshot|undefined,date:string){return !!q&&!q.stale&&q.asOf.slice(0,10)===date&&q.asOf.slice(11,16)>='15:00'&&q.asOf.slice(11,16)<='23:59'&&Number.isFinite(Date.parse(q.asOf));}
export function filterReport(report:Pick<CloseReport,'candidates'>,options:ScreenOptions){
 return report.candidates.filter(c=>c.amount!==null&&c.amount>=2e8&&c.chip&&c.chip.concentration90<options.concentration&&(!options.activity||!!c.character&&!c.character.quiet&&!c.character.weakFollow)&&(options.maxMarketCap===null||c.marketCap!=null&&c.marketCap<=options.maxMarketCap)&&(!options.recentLimitUp||!!c.limitUpDates?.length)&&(options.auto||c.patterns?.some(p=>options.modes.includes(p.mode as never)&&c.chip!.concentration90<(p.mode==='multi'?15:20)))).sort((a,b)=>(b.ranking?.score??0)-(a.ranking?.score??0)||(a.chip?.concentration90??99)-(b.chip?.concentration90??99));
}
