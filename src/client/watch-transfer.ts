import {readJson} from './http';
import {validWatch,type WatchState} from '../shared/watch-sync';
import {planWatchImport,parseWatchTransfer,serializeWatchTransfer,type WatchTransfer} from '../shared/watch-transfer';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const watchKey='atlas.watchlist.v1',groupKey='atlas.watch.groups.v1';
export function readLocalWatch(storage:Store=localStorage):WatchState{
 const state={watchlist:JSON.parse(storage.getItem(watchKey)||'[]'),groups:JSON.parse(storage.getItem(groupKey)||'[]')};
 if(!validWatch(state))throw new Error('本机自选资料格式无效');return state;
}
export function importLocalWatch(incoming:WatchTransfer,storage:Store=localStorage,announce=()=>{
 window.dispatchEvent(new Event('atlas:watch-cloud'));window.dispatchEvent(new Event('atlas:watch-local'));
}){
 const plan=planWatchImport(readLocalWatch(storage),incoming),before=[watchKey,groupKey].map(k=>[k,storage.getItem(k)] as const);
 try{storage.setItem(groupKey,JSON.stringify(plan.state.groups));storage.setItem(watchKey,JSON.stringify(plan.state.watchlist));}
 catch(error){for(const [k,v] of before)try{if(v===null)storage.removeItem(k);else storage.setItem(k,v);}catch{/* A disabled store must not cause an unhandled recovery error. */}throw error;}
 announce();return plan;
}
/** Share codes: an 8-character snapshot of stocks and groups that anyone can import for 30 days. */
export const SHARE_CODE_PATTERN=/^[A-HJKMNP-Z2-9]{4}-?[A-HJKMNP-Z2-9]{4}$/i;
async function shareRequest(path:string,init?:RequestInit){const r=await fetch(path,{...init,signal:AbortSignal.timeout(15000)});const data=await readJson<any>(r);if(!r.ok)throw new Error(data.error||'分享码服务暂不可用');return data;}
export async function createShareCode(storage:Store=localStorage):Promise<{code:string;expiresAt:string;count:number}>{
 return shareRequest('/api/watch-share',{method:'POST',headers:{'content-type':'application/json'},body:serializeWatchTransfer(readLocalWatch(storage))});
}
export async function readShareCode(code:string):Promise<WatchTransfer>{
 const clean=code.trim();if(!SHARE_CODE_PATTERN.test(clean.replace(/\s/g,'')))throw new Error('分享码格式无效');
 const packet=parseWatchTransfer(JSON.stringify(await shareRequest('/api/watch-share/'+encodeURIComponent(clean.replace(/\s/g,'')))));
 if(!packet.watchlist.length)throw new Error('分享码中没有自选股票');return packet;
}
