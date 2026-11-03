import {validWatch,type WatchState} from '../shared/watch-sync';
import {planWatchImport,type WatchTransfer} from '../shared/watch-transfer';
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
