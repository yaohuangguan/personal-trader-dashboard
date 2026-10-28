import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWatchOps,watchDiff,emptyWatch,type WatchState} from '../src/shared/watch-sync';
import {watchVault,watchSyncRoute} from '../src/worker/watch-sync';
test('offline edits merge independent devices without reviving removed symbols',()=>{
 const base:WatchState={watchlist:['300545.SZ','002472.SZ'],groups:[{id:'robot',name:'机器人',symbols:['300545.SZ','002472.SZ']}]};
 const a=structuredClone(base);a.watchlist=a.watchlist.filter(s=>s!=='300545.SZ');a.groups[0].symbols=['002472.SZ'];
 const b=structuredClone(base);b.watchlist.push('603278.SH');b.groups[0].symbols.push('603278.SH');
 const remote=applyWatchOps(applyWatchOps(base,watchDiff(base,a)),watchDiff(base,b));
 assert.deepEqual(remote.watchlist,['002472.SZ','603278.SH']);assert.deepEqual(remote.groups[0].symbols,['002472.SZ','603278.SH']);
 assert.deepEqual(applyWatchOps(remote,watchDiff(base,base)),remote);
});
test('group membership merges concurrent edits and a stale edit cannot resurrect a deleted group',()=>{
 const base:WatchState={watchlist:['AAPL','NVDA','MU'],groups:[{id:'tech',name:'科技',symbols:['AAPL']}]};
 const a=structuredClone(base),b=structuredClone(base);a.groups[0].symbols.push('NVDA');b.groups[0].symbols.push('MU');
 const merged=applyWatchOps(applyWatchOps(base,watchDiff(base,a)),watchDiff(base,b));assert.deepEqual(merged.groups[0].symbols,['AAPL','NVDA','MU']);
 assert.equal(applyWatchOps({...base,groups:[]},watchDiff(base,b)).groups.length,0);
});
test('vault serializes durable revisions and repeated delivery is idempotent',async()=>{
 const data=new Map<string,unknown>(),store={get:async<T>(k:string)=>data.get(k) as T|undefined,put:async<T>(k:string,v:T)=>{data.set(k,v);}};
 const request=(body:object,create=false)=>new Request('https://internal/cloud-watch'+(create?'?create':''),{method:'POST',body:JSON.stringify(body)});
 await watchVault(request({},true),store);
 const body={id:'test-operation-0001',baseRevision:0,ops:watchDiff(emptyWatch(),{watchlist:['002472.SZ'],groups:[]})};
 const a=await(await watchVault(request(body),store)).json() as {revision:number;state:WatchState};assert.equal(a.revision,1);assert.deepEqual(a.state.watchlist,['002472.SZ']);
 const b=await(await watchVault(request(body),store)).json() as {revision:number};assert.equal(b.revision,1);
 assert.equal((await watchSyncRoute(new Request('https://guanlan.nzs.workers.dev/api/watch-sync'),{idFromName:()=>'',get:()=>({fetch:async()=>new Response()})} as never))!.status,401);
});
