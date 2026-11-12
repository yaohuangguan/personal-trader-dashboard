import {isUSStock,marketClock} from '../shared/market-clock';
import type {ExtendedSession,ExtendedQuote,ExtendedPayload} from '../shared/extended-quote';

type Row=Record<string,unknown>;
const number=(value:unknown):number|null=>{
 const raw=value&&typeof value==='object'?(value as Row).raw:value;
 return typeof raw==='number'&&Number.isFinite(raw)?raw:null;
};
const prefixes:Record<ExtendedSession,string>={pre:'preMarket',post:'postMarket',overnight:'overnightMarket'};

/** Read only serialized public quote data. Never execute page scripts or use formatted percentages. */
export function parseExtendedPage(html:string,symbol:string,now=new Date()):ExtendedPayload{
 let quote:Row|undefined;
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/type=["']application\/json["']/i.test(match[1])||!match[2].includes('quoteResponse'))continue;
  try{
   const envelope=JSON.parse(match[2]);
   if(envelope.status!==200||typeof envelope.body!=='string')continue;
   const rows=JSON.parse(envelope.body)?.quoteResponse?.result;
   if(Array.isArray(rows))quote=rows.find((r:Row)=>r.symbol===symbol)||quote;
  }catch{/* Other embedded page data is unrelated to quotes. */}
 }
 if(!quote||quote.currency!=='USD'||quote.exchangeTimezoneName!=='America/New_York')throw new Error('Extended quote source returned no matching USD quote');
 const regular=number(quote.regularMarketPrice),previous=number(quote.regularMarketPreviousClose),regularTime=number(quote.regularMarketTime);
 if(!regular||regular<=0||!previous||previous<=0||!regularTime||regularTime*1000>now.getTime()+60000)throw new Error('Extended quote reference is unavailable');
 const regularDate=marketClock(new Date(regularTime*1000),symbol).date;
 const quotes:Partial<Record<ExtendedSession,ExtendedQuote>>={};
 for(const session of Object.keys(prefixes) as ExtendedSession[]){
  const prefix=prefixes[session],price=number(quote[prefix+'Price']),time=number(quote[prefix+'Time']);
  if(!price||price<=0||!time||time*1000>now.getTime()+60000||now.getTime()-time*1000>7*86400000)continue;
  const at=new Date(time*1000),clock=marketClock(at,symbol),minute=clock.minute;
  // Reject a mismatched field instead of relabeling another session's price.
  if(session==='pre'&&!(minute>=240&&minute<570)||session==='post'&&!(minute>=780&&minute<=1200)||session==='overnight'&&!(minute>=1200||minute<240))continue;
  const reference=session==='pre'&&clock.date===regularDate&&time<regularTime?previous:regular;
  const change=price-reference;
  quotes[session]={session,price,reference,change,changePercent:change/reference*100,asOf:at.toISOString(),stale:now.getTime()-time*1000>20*60000,source:session==='overnight'?'Yahoo Finance / Blue Ocean ATS':'Yahoo Finance'};
 }
 const state=String(quote.marketState),activeSession:ExtendedSession|null=state==='PRE'?'pre':state==='POST'?'post':state==='OVERNIGHT'?'overnight':null;
 // The provider state accounts for holidays and shortened sessions. Closed markets
 // may retain the last extended trade, but never an earlier premarket observation.
 const latest=Object.values(quotes).filter(q=>Date.parse(q.asOf)>regularTime*1000).sort((a,b)=>Date.parse(b.asOf)-Date.parse(a.asOf))[0];
 const candidate=activeSession?quotes[activeSession]:state==='REGULAR'?undefined:latest;
 const current=candidate&&Date.parse(candidate.asOf)>regularTime*1000?candidate:null;
 return {symbol,available:true,source:'Yahoo Finance public quotes',sourceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/',fetchedAt:now.toISOString(),activeSession,current,quotes};
}

export async function extendedQuote(symbol:string,now=new Date()):Promise<ExtendedPayload>{
 if(!isUSStock(symbol))throw new RangeError('Invalid US stock symbol');
 // Yahoo uses a dash for US share classes (Tencent uses a dot).
 const ticker=symbol.replace('.','-'),url='https://finance.yahoo.com/quote/'+encodeURIComponent(ticker)+'/';
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Accept:'text/html'},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Extended quote source HTTP '+response.status);
 const html=await response.text();
 if(html.length>2500000)throw new Error('Extended quote source response too large');
 return {...parseExtendedPage(html,ticker,now),symbol,sourceUrl:url};
}
