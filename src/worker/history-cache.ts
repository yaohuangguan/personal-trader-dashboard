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
