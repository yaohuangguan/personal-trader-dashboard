import {useSyncExternalStore} from 'react';
import {DEFAULT_WATCHLIST} from '../shared/catalog';
import {applyLocalWatchOp,sameWatch,sanitizeGroups,sanitizeWatchlist,type LocalWatch,type LocalWatchOp} from './watch-ops';
import {writeStored} from './storage';

/**
 * Single source of truth for the watchlist and groups in this tab. Other tabs' writes arrive through the
 * `storage` event, cloud merges through `atlas:watch-cloud`; every edit re-reads localStorage first.
 */
const WATCH_KEY='atlas.watchlist.v1',GROUPS_KEY='atlas.watch.groups.v1',BASE_KEY='atlas.sync.base.v1';
function raw(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function parse(text:string|null):unknown{if(text===null)return undefined;try{return JSON.parse(text);}catch{return null;}}

export function readWatch():LocalWatch{
 const stored=parse(raw(WATCH_KEY));
 let watchlist=stored===undefined?[...DEFAULT_WATCHLIST]:sanitizeWatchlist(stored);
 if(!watchlist){
  // Corrupt value ("null", object…): recover the last synced list instead of defaults, so the next
  // cloud sync does not read the corruption as "remove everything".
  const base=parse(raw(BASE_KEY)) as {state?:{watchlist?:unknown}}|null|undefined;
  watchlist=sanitizeWatchlist(base?.state?.watchlist)??[...DEFAULT_WATCHLIST];
  writeStored(WATCH_KEY,watchlist);
 }
 return {watchlist,groups:sanitizeGroups(parse(raw(GROUPS_KEY)))};
}

let snapshot=readWatch(),storageFailed=false;
const listeners=new Set<()=>void>();
function publish(next:LocalWatch){if(sameWatch(next,snapshot))return;snapshot=next;listeners.forEach(fn=>fn());}
const reload=()=>publish(readWatch());
window.addEventListener('storage',e=>{if(e.key===null||e.key===WATCH_KEY||e.key===GROUPS_KEY)reload();});
window.addEventListener('atlas:watch-cloud',reload);

/** Apply an edit to the freshest stored state. Returns false when nothing changed (e.g. list full). */
export function editWatch(op:LocalWatchOp):boolean{
 const fresh=readWatch(),next=applyLocalWatchOp(fresh,op);
 if(next===fresh){publish(fresh);return false;}
 const ok=(next.groups===fresh.groups||writeStored(GROUPS_KEY,next.groups))&&(next.watchlist===fresh.watchlist||writeStored(WATCH_KEY,next.watchlist));
 storageFailed=!ok;
 publish(next);
 if(ok)window.dispatchEvent(new Event('atlas:watch-local'));
 return true;
}
export const watchStorageFailed=()=>storageFailed;
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const useWatchState=()=>useSyncExternalStore(subscribe,()=>snapshot);
