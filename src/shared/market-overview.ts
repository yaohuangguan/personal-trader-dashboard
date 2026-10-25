import type {SourceStamp} from './desk-types';
export type RankedStock={symbol:string;name:string;price:number|null;changePercent:number|null;amount:number|null;turnover:number|null;date?:string;reason?:string;net?:number|null;industry?:string};
export type GainersPayload=SourceStamp&{items:RankedStock[];date:null;scope:string};
export type Pool={available:boolean;items:RankedStock[];total:number|null;date:string;reason?:string};
export type PoolsPayload=SourceStamp&{date:string;pools:Record<'up'|'down'|'broken'|'yesterday',Pool>};
export type DragonPayload=SourceStamp&{start:string;end:string;latestDate:string|null;items:RankedStock[];complete:boolean};
export type ChipsPayload=SourceStamp&{symbol:string;bars:(import('./market-models').ChipBar)[];basis:'historical-turnover'};
