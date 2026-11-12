export type ExtendedSession = 'pre' | 'post' | 'overnight';
export const EXTENDED_LABELS:Record<ExtendedSession,string> = {pre:'盘前',post:'盘后',overnight:'夜盘 24h'};
export type ExtendedQuote = {
 session:ExtendedSession;price:number;change:number;changePercent:number;reference:number;
 asOf:string;stale:boolean;source:string;
};
export type ExtendedPayload = {
 symbol:string;available:true;source:string;sourceUrl:string;fetchedAt:string;
 activeSession:ExtendedSession|null;current:ExtendedQuote|null;
 quotes:Partial<Record<ExtendedSession,ExtendedQuote>>;
};
