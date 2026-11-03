import {readLocalWatch,importLocalWatch} from '../src/client/watch-transfer';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseWatchTransfer,serializeWatchTransfer,planWatchImport,WATCH_TRANSFER_MAX_BYTES} from '../src/shared/watch-transfer';
const fixture=readFileSync(new URL('./fixtures/watch-transfer.json',import.meta.url),'utf8');
test('portable exports include only symbols and groups, excluding credentials and local IDs',()=>{
 const input={watchlist:['300031.SZ','AAPL'],groups:[{id:'private-id',name:'科技',symbols:['300031.SZ','AAPL']}],cloudSyncKey:'CANARY-CLOUD-SECRET',alerts:[{symbol:'NVDA'}]};
 const output=serializeWatchTransfer(input);
 assert.deepEqual(JSON.parse(output),{format:'guanlan-watchlist',version:1,watchlist:['300031.SZ','AAPL'],groups:[{name:'科技',symbols:['300031.SZ','AAPL']}]});
 assert.ok(!output.includes('CANARY')&&!output.includes('private-id')&&!output.includes('NVDA'));
 assert.deepEqual(parseWatchTransfer('\ufeff'+fixture),JSON.parse(fixture));
});
test('merge preserves recipient order, group IDs and is idempotent',()=>{
 const current={watchlist:['NVDA','300031.SZ'],groups:[{id:'mine',name:'科技',symbols:['NVDA']}]},copy=structuredClone(current);
 const r=planWatchImport(current,parseWatchTransfer(fixture),()=>'new-local');
 assert.deepEqual(r.state,{watchlist:['NVDA','300031.SZ','920571.BJ','AAPL','510300.SH'],groups:[{id:'mine',name:'科技',symbols:['NVDA','300031.SZ','AAPL']},{id:'new-local',name:'观察',symbols:['920571.BJ','510300.SH']}]});
 assert.equal(r.added,3);assert.equal(r.existing,1);assert.equal(r.groupsAdded,1);assert.equal(r.groupsMerged,1);assert.deepEqual(current,copy);
 const repeat=planWatchImport(r.state,parseWatchTransfer(fixture));assert.equal(repeat.added,0);assert.deepEqual(repeat.state,r.state);
});
test('capacity preserves existing data and reports skipped stocks and groups',()=>{
 const current={watchlist:Array.from({length:59},(_,i)=>'TEST'+i),groups:Array.from({length:20},(_,i)=>({id:'g'+i,name:'组'+i,symbols:[]}))};
 const r=planWatchImport(current,parseWatchTransfer(fixture));assert.equal(r.added,1);assert.equal(r.skipped,3);assert.equal(r.state.watchlist.at(-1),'300031.SZ');assert.equal(r.groupsSkipped,2);assert.deepEqual(r.state.groups,current.groups);
 const legacy={watchlist:Array.from({length:80},(_,i)=>'TEST'+i),groups:[]};assert.equal(planWatchImport(legacy,parseWatchTransfer(fixture)).state.watchlist.length,80);
});
test('legacy backups remain importable and duplicate named groups merge',()=>{
 assert.deepEqual(parseWatchTransfer('["AAPL","AAPL","300031.SZ"]').watchlist,['AAPL','300031.SZ']);
 assert.equal(parseWatchTransfer('{"watchlist":["AAPL"]}').groups.length,0);
 assert.deepEqual(parseWatchTransfer('["300031","aapl","510300"]').watchlist,['300031.SZ','AAPL','510300.SH']);
 const p=parseWatchTransfer(JSON.stringify({watchlist:['AAPL','NVDA'],groups:[{id:'ignored',name:' 科技 ',symbols:['AAPL'],cloudSyncKey:'CANARY'},{name:'科技',symbols:['NVDA']}],cloudSyncKey:'CANARY'}));
 assert.deepEqual(p.groups,[{name:'科技',symbols:['AAPL','NVDA']}]);assert.ok(!JSON.stringify(p).includes('CANARY'));
});
test('invalid versions, group references and excessive payloads are rejected',()=>{
 for(const value of ['{}','null','not json','{"format":"other","watchlist":[]}','{"format":"guanlan-watchlist","version":2,"watchlist":[]}','{"watchlist":[3]}','{"watchlist":["<script>"]}','{"watchlist":["AAPL"],"groups":[{"name":"科技","symbols":["NVDA"]}]}','{"watchlist":[],"groups":[{"name":"x\\u0000y","symbols":[]}]}',JSON.stringify({watchlist:Array(201).fill('AAPL')})])assert.throws(()=>parseWatchTransfer(value));
 assert.throws(()=>parseWatchTransfer(' '.repeat(WATCH_TRANSFER_MAX_BYTES+1)),/过大/);
 assert.throws(()=>parseWatchTransfer(JSON.stringify({watchlist:[],groups:Array.from({length:31},()=>({name:'科技',symbols:[]}))})),/30/);
});

test('browser import rolls back failed persistence and never changes credentials',()=>{
 const values=new Map<string,string>([['atlas.watchlist.v1','["NVDA"]'],['atlas.watch.groups.v1','[]'],['atlas.sync.token.v1','CANARY-CLOUD-SECRET']]);
 let announce=0,fail=true;
 const storage={getItem:(k:string)=>values.get(k)??null,removeItem:(k:string)=>{values.delete(k);},setItem:(k:string,v:string)=>{if(fail&&k==='atlas.watchlist.v1'){fail=false;throw new Error('quota');}values.set(k,v);}};
 assert.throws(()=>importLocalWatch(parseWatchTransfer(fixture),storage,()=>announce++),/quota/);
 assert.deepEqual(readLocalWatch(storage),{watchlist:['NVDA'],groups:[]});assert.equal(announce,0);
 const result=importLocalWatch(parseWatchTransfer(fixture),storage,()=>announce++);
 assert.equal(result.added,4);assert.equal(readLocalWatch(storage).groups.length,2);assert.equal(values.get('atlas.sync.token.v1'),'CANARY-CLOUD-SECRET');assert.equal(announce,1);
});
