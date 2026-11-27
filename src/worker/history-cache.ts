import type {MarketPayload} from '../shared/types';
/** Retain the last successful public history separately from short-lived compute results. */
export async function historicalSnapshot(origin:string,symbol:string,load:()=>Promise<MarketPayload>){
 const edge=typeof caches!=='undefined'?(caches as CacheStorage&{default?:Cache}).default:undefined,key=new Request(new URL('/__history/v1/'+encodeURIComponent(symbol),origin));
 let previous:{savedAt:number;market:MarketPayload}|undefined;
 try{const response=await edge?.match(key);if(response)previous=await response.json() as typeof previous;}catch{}
 if(previous&&Date.now()-previous.savedAt<60000)return previous.market;
 try{const market=await load();if(!market.candles.length)throw Error('Empty history');try{await edge?.put(key,Response.json({savedAt:Date.now(),market},{headers:{'cache-control':'public, max-age=86400'}}));}catch{}return market;}
 catch(error){if(previous&&Date.now()-previous.savedAt<86400000)return {...previous.market,stale:true,notice:previous.market.notice+'；历史源更新失败，显示上次成功历史，须核验日期。'};throw error;}
}

const remembered=new Map<string,number>();
const LAST_GOOD_MS=3*86400000,REMEMBER_EVERY_MS=10*60000;
/**
 * Market history with a last-good fallback: successful loads are copied to the edge (at most every
 * 10 minutes per symbol and isolate, after the response via waitUntil); when every provider fails,
 * the last successful history up to 3 days old is returned marked stale.
 */
export async function lastGoodMarket(origin:string,symbol:string,load:()=>Promise<MarketPayload>,ctx?:{waitUntil(task:Promise<unknown>):void}):Promise<MarketPayload>{
 const edge=typeof caches!=='undefined'?(caches as CacheStorage&{default?:Cache}).default:undefined,key=new Request(new URL('/__history/v1/'+encodeURIComponent(symbol),origin));
 try{
  const market=await load();
  if(edge&&market.candles.length&&!market.stale&&Date.now()-(remembered.get(symbol)||0)>REMEMBER_EVERY_MS){
   remembered.set(symbol,Date.now());if(remembered.size>500)remembered.clear();
   const put=edge.put(key,Response.json({savedAt:Date.now(),market},{headers:{'cache-control':'public, max-age=259200'}})).catch(()=>{});
   if(ctx)ctx.waitUntil(put);else await put;
  }
  return market;
 }catch(error){
  let previous:{savedAt:number;market:MarketPayload}|undefined;
  try{const hit=await edge?.match(key);if(hit)previous=await hit.json() as typeof previous;}catch{}
  if(previous&&Date.now()-previous.savedAt<LAST_GOOD_MS)return {...previous.market,stale:true,notice:previous.market.notice+'；所有历史源本次均未成功，显示'+new Date(previous.savedAt).toISOString().slice(0,16).replace('T',' ')+'(UTC)保存的上次成功历史，须核验日期。'};
  throw error;
 }
}
