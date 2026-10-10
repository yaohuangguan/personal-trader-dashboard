import { CATALOG, SECTORS } from '../shared/catalog';
import type { MarketPayload, NewsItem } from '../shared/types';

export interface DBStatement {
 bind(...values:(string|number|null)[]):DBStatement;
 first<T=unknown>():Promise<T|null>;
 all<T=unknown>():Promise<{results:T[]}>;
 run():Promise<unknown>;
}
export interface D1Database {
 prepare(query:string):DBStatement;
 batch(statements:DBStatement[]):Promise<unknown>;
}
export type EventRecord = NewsItem & {
 firstSeenAt:string; lastSeenAt:string; sightings:number; tickers:string[]; sectors:string[]; evidenceStage:string;
};
const iso=()=>new Date().toISOString();
export const readSafeNumber=(raw:string|null,fallback:number,max:number)=>Math.max(1,Math.min(max,Number(raw)||fallback));

export function relatedTickers(title:string):string[] {
 const lower=title.toLowerCase();
 return CATALOG.filter(x=>{
  const symbol=x.symbol.toLowerCase();
  // Avoid matching short common English words or numeric fragments by accident.
  const tickerMatch=symbol.length>=3 && /^[a-z]+$/.test(symbol)
   ?new RegExp('(^|[^a-z0-9])'+symbol+'([^a-z0-9]|$)','i').test(title)
   :false;
  return tickerMatch || (x.name.length>=4 && lower.includes(x.name.toLowerCase()));
 }).map(x=>x.symbol).slice(0,12);
}
export function linkedSectors(item:NewsItem):{id:string;reason:string}[]{
 const lower=item.title.toLowerCase();
 return SECTORS.flatMap(s=>{
  const match=s.words.find(word=>lower.includes(word.toLowerCase()));
  if(item.category===s.id)return [{id:s.id,reason:'Topic feed: '+s.name}];
  return match?[{id:s.id,reason:'Headline keyword: '+match}]:[];
 });
}
export function stableArticleKey(item:NewsItem):string {
 let url=item.url;
 try {
  const u=new URL(item.url);
  url=u.hostname.toLowerCase()+u.pathname.replace(/\/$/,'');
 }catch{}
 return [item.source.toLowerCase().trim(),url,item.title.trim().toLowerCase().replace(/\s+/g,' ')].join('|');
}
export async function eventId(item:NewsItem):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableArticleKey(item)));
 return Array.from(new Uint8Array(digest).slice(0,18),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function persistScan(db:D1Database,articles:NewsItem[],warnings:string[]):Promise<{newEvents:number;observed:number;warnings:number;at:string}>{
 const now=iso();
 const prepared=await Promise.all(articles.filter(x=>x.title&&x.url.startsWith('https://')).slice(0,200).map(async item=>({
  item,id:await eventId(item),sectors:linkedSectors(item),tickers:relatedTickers(item.title)
 })));
 const unique=Array.from(new Map(prepared.map(x=>[x.id,x])).values());
 const existing=new Set<string>();
 // SQLite bound-argument limit differs by runtime. Chunk queries conservatively.
 for(let i=0;i<unique.length;i+=75){
  const ids=unique.slice(i,i+75).map(x=>x.id);
  const rows=await db.prepare('SELECT id FROM intel_events WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all<{id:string}>();
  for(const row of rows.results)existing.add(row.id);
 }
 const inserts:DBStatement[]=[];
 for(const {item,id,sectors,tickers} of unique){
  inserts.push(db.prepare(
   'INSERT INTO intel_events(id,title,original_title,source,url,category,published_at,first_seen_at,last_seen_at,sightings,tickers_json,evidence_stage) '+
   "VALUES (?,?,?,?,?,?,?,?,?,1,?,'media_lead') ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, sightings=intel_events.sightings+1"
  ).bind(id,item.title,item.originalTitle||item.title,item.source,item.url,item.category,item.publishedAt,now,now,JSON.stringify(tickers)));
  for(const link of sectors){
   inserts.push(db.prepare('INSERT OR IGNORE INTO intel_sector_links(event_id,sector_id,reason) VALUES (?,?,?)').bind(id,link.id,link.reason));
  }
 }
 // D1 batch provides atomic statements and avoids request-per-row overhead.
 for(let i=0;i<inserts.length;i+=80)await db.batch(inserts.slice(i,i+80));
 const fresh=unique.filter(x=>!existing.has(x.id)).length;
 const runId=now+'-'+crypto.randomUUID().slice(0,8);
 await db.prepare('INSERT INTO intel_scan_runs(id,started_at,finished_at,new_events,seen_events,warning_count,warnings_json) VALUES (?,?,?,?,?,?,?)')
  .bind(runId,now,iso(),fresh,unique.length,warnings.length,JSON.stringify(warnings.slice(0,20))).run();
 return {newEvents:fresh,observed:unique.length,warnings:warnings.length,at:now};
}
type RawEvent = {
 id:string;title:string;original_title:string;source:string;url:string;category:string;
 published_at:string|null;first_seen_at:string;last_seen_at:string;sightings:number;tickers_json:string;evidence_stage:string;
 sectors:string|null;
};
function toEvent(row:RawEvent):EventRecord {
 let tickers:string[]=[];
 try{tickers=JSON.parse(row.tickers_json) as string[];}catch{}
 return {id:row.id,title:row.title,originalTitle:row.original_title,source:row.source,url:row.url,category:row.category,
  publishedAt:row.published_at,firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,sightings:row.sightings,
  tickers,evidenceStage:row.evidence_stage,sectors:(row.sectors||'').split(',').filter(Boolean)};
}
const selected='e.id,e.title,e.original_title,e.source,e.url,e.category,e.published_at,e.first_seen_at,e.last_seen_at,e.sightings,e.tickers_json,e.evidence_stage,GROUP_CONCAT(DISTINCT l.sector_id) AS sectors';
export async function listEvents(db:D1Database,opts:{category:string;limit:number;onlyNew?:boolean;symbol?:string}):Promise<EventRecord[]>{
 const where:string[]=[];const args:(string|number)[]=[];
 if(opts.category!=='all'){
  if(opts.category==='world'||opts.category==='macro'){where.push('e.category=?');args.push(opts.category);}
  else {where.push('l.sector_id=?');args.push(opts.category);}
 }
 if(opts.onlyNew){where.push('e.first_seen_at >= ?');args.push(new Date(Date.now()-86400000).toISOString());}
 if(opts.symbol){where.push('e.tickers_json LIKE ?');args.push('%"'+opts.symbol+'"%');}
 const sql='SELECT '+selected+' FROM intel_events e LEFT JOIN intel_sector_links l ON e.id=l.event_id '+
 (where.length?'WHERE '+where.join(' AND '):'')+' GROUP BY e.id ORDER BY e.first_seen_at DESC LIMIT ?';
 const result=await db.prepare(sql).bind(...args,opts.limit).all<RawEvent>();
 return result.results.map(toEvent);
}
export async function intelSummary(db:D1Database){
 const [latest,new24,sectors,lastRun]=await Promise.all([
  db.prepare('SELECT COUNT(*) AS total FROM intel_events').first<{total:number}>(),
  db.prepare("SELECT COUNT(*) AS total FROM intel_events WHERE first_seen_at >= ?").bind(new Date(Date.now()-86400000).toISOString()).first<{total:number}>(),
  db.prepare('SELECT sector_id,COUNT(*) AS total FROM intel_sector_links GROUP BY sector_id ORDER BY total DESC').all<{sector_id:string;total:number}>(),
  db.prepare('SELECT started_at,finished_at,new_events,seen_events,warning_count,warnings_json FROM intel_scan_runs ORDER BY finished_at DESC LIMIT 1').first()
 ]);
 return {total:latest?.total||0,new24h:new24?.total||0,sectors:sectors.results,lastRun,stored:true};
}
export async function readSnapshot(db:D1Database,symbol:string):Promise<(MarketPayload&{fetchedAt?:string;stale?:boolean})|null>{
 const row=await db.prepare('SELECT payload_json,fetched_at FROM market_snapshots WHERE symbol=?').bind(symbol).first<{payload_json:string;fetched_at:string}>();
 if(!row)return null;
 try{
  const data=JSON.parse(row.payload_json) as MarketPayload;
  return {...data,stale:Date.now()-Date.parse(row.fetched_at)>36*3600000,fetchedAt:row.fetched_at,
   notice:data.notice+' | Last successful fetch '+row.fetched_at};
 }catch{return null;}
}
export async function saveSnapshot(db:D1Database,market:MarketPayload):Promise<void>{
 await db.prepare(
  'INSERT INTO market_snapshots(symbol,payload_json,fetched_at,as_of,provider) VALUES (?,?,?,?,?) '+
  'ON CONFLICT(symbol) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,as_of=excluded.as_of,provider=excluded.provider'
 ).bind(market.symbol,JSON.stringify(market),iso(),market.asOf||'',market.provider).run();
}
