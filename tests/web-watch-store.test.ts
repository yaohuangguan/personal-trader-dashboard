import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyLocalWatchOp,sanitizeGroups,sanitizeWatchlist,type LocalWatch} from '../src/client/watch-ops';
import {isArrayOf,isBookmark,isBoolean,isStringArray,parseStored} from '../src/client/storage';
import {watchDiff} from '../src/shared/watch-sync';

test('edits from a stale tab are applied to the fresh stored list and never erase another tab\'s additions',()=>{
 const base:LocalWatch={watchlist:['300545.SZ','NVDA'],groups:[{id:'g1',name:'AI',symbols:['NVDA']}]};
 // Tab A adds X; storage now holds it. Tab B still renders `base` and removes NVDA.
 const afterTabA=applyLocalWatchOp(base,{kind:'add',symbol:'600519.SH'});
 const afterTabB=applyLocalWatchOp(afterTabA,{kind:'remove',symbol:'NVDA'});
 assert.deepEqual(afterTabB.watchlist,['600519.SH','300545.SZ']);
 assert.deepEqual(afterTabB.groups[0].symbols,[]);
 // The cloud diff therefore contains no 'remove 600519.SH'.
 const ops=watchDiff(base,afterTabB);
 assert.ok(!ops.some(op=>op.kind==='remove'&&op.symbol==='600519.SH'));
 assert.ok(ops.some(op=>op.kind==='remove'&&op.symbol==='NVDA'));
});
test('group edits from two tabs merge instead of overwriting each other',()=>{
 let state:LocalWatch={watchlist:['A1','B2'],groups:[]};
 state=applyLocalWatchOp(state,{kind:'group-create',id:'g1',name:'one'});
 state=applyLocalWatchOp(state,{kind:'group-create',id:'g2',name:'two'});
 state=applyLocalWatchOp(state,{kind:'group-member',id:'g1',symbol:'A1',member:true});
 state=applyLocalWatchOp(state,{kind:'group-member',id:'g2',symbol:'B2',member:true});
 assert.deepEqual(state.groups.map(g=>[g.id,g.symbols]),[['g1',['A1']],['g2',['B2']]]);
 assert.equal(applyLocalWatchOp(state,{kind:'group-create',id:'g3',name:'one'}),state,'duplicate names are rejected');
 assert.equal(applyLocalWatchOp(state,{kind:'group-member',id:'g1',symbol:'ZZZ',member:true}),state,'only watched symbols join groups');
 state=applyLocalWatchOp(state,{kind:'group-rename',id:'g1',name:'renamed'});assert.equal(state.groups[0].name,'renamed');
 state=applyLocalWatchOp(state,{kind:'group-delete',id:'g2'});assert.deepEqual(state.groups.map(g=>g.id),['g1']);
});
test('toggle respects the 60-stock cap and unchanged edits keep identity',()=>{
 const full:LocalWatch={watchlist:Array.from({length:60},(_,i)=>'S'+i),groups:[]};
 assert.equal(applyLocalWatchOp(full,{kind:'toggle',symbol:'NEW'}),full);
 assert.equal(applyLocalWatchOp(full,{kind:'toggle',symbol:'S3'}).watchlist.length,59);
 const small:LocalWatch={watchlist:['A1'],groups:[]};
 assert.equal(applyLocalWatchOp(small,{kind:'remove',symbol:'B2'}),small);
 assert.deepEqual(applyLocalWatchOp(small,{kind:'toggle',symbol:'B2'}).watchlist,['B2','A1']);
});
test('stored values are shape-checked before use',()=>{
 assert.equal(sanitizeWatchlist(null),null);
 assert.equal(sanitizeWatchlist({a:1}),null);
 assert.deepEqual(sanitizeWatchlist(['A1',3,'A1','<bad>','300545.SZ']),['A1','300545.SZ']);
 assert.deepEqual(sanitizeGroups([{id:'g',name:'n',symbols:['A1',null]},{id:1},null,'x']),[{id:'g',name:'n',symbols:['A1']}]);
 assert.deepEqual(parseStored('null',['D'],isStringArray),['D']);
 assert.deepEqual(parseStored('{"0":"A"}',['D'],isStringArray),['D']);
 assert.deepEqual(parseStored('not json',['D'],isStringArray),['D']);
 assert.deepEqual(parseStored(null,['D'],isStringArray),['D']);
 assert.equal(parseStored('"yes"',false,isBoolean),false);
 assert.deepEqual(parseStored('[{"url":"u","title":"t","id":"1"},{"url":1}]',[],isArrayOf(isBookmark)),[]);
});
