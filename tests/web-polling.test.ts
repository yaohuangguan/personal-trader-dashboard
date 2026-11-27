import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patchSession} from '../src/shared/patch-session';
import {pollPlan,type PollerEntry} from '../src/client/keyed-poller';
import type {Snapshot} from '../src/shared/desk-types';

const quote=(over:Partial<Snapshot>={}):Snapshot=>({symbol:'300545.SZ',name:'联得装备',price:18.5,previous:17.97,open:18.2,high:19.34,low:17.84,change:.53,changePercent:2.95,volume:71727,amount:1.3e8,turnover:5.78,pe:null,pb:null,marketCap:null,floatCap:null,volumeRatio:null,limitUp:null,limitDown:null,asOf:'2026-11-26T15:00:00+08:00',bids:[],asks:[],session:'closed',stale:false,volumeUnit:'手',...over});

test('a repeated quote with the same OHLCV keeps the candle array identity',async()=>{
 const data={provider:'test',candles:[{time:'2026-11-25',open:17.5,high:18,low:17.4,close:17.97,volume:60000},{time:'2026-11-26',open:18.2,high:19.34,low:17.84,close:18.5,volume:71727}]};
 const same=patchSession(data,quote(),'手');
 assert.equal(same,data,'unchanged session bar returns the input object');
 const moved=patchSession(data,quote({price:18.6,high:19.34,volume:72000}),'手');
 assert.notEqual(moved,data);assert.equal(moved?.candles.at(-1)?.close,18.6);assert.equal(moved?.candles[0],data.candles[0]);
});
test('the quote store keeps unchanged snapshot objects',async()=>{
 const {mergeQuotes}=await import('../src/client/quote-store');
 const a=quote(),b=quote({symbol:'NVDA',name:'NVIDIA'});
 const first=mergeQuotes(new Map(),[a,b]);assert.ok(first.changed);
 const again=mergeQuotes(first.quotes,[{...a},{...b}]);
 assert.equal(again.changed,false);assert.equal(again.quotes,first.quotes);
 const tick=mergeQuotes(first.quotes,[{...a,price:18.6},{...b}]);
 assert.ok(tick.changed);assert.equal(tick.quotes.get('NVDA'),b);assert.notEqual(tick.quotes.get('300545.SZ'),a);
});
test('the shared poller requests only stale keys and sleeps until the next one is due',()=>{
 const now=1_000_000,entries=new Map<string,PollerEntry>([
  ['fresh',{hasValue:true,staleAt:now+40000,retryAt:0,inflight:false}],
  ['stale',{hasValue:true,staleAt:now-1,retryAt:0,inflight:false}],
  ['new',{hasValue:false,staleAt:0,retryAt:0,inflight:false}],
  ['failing',{hasValue:false,staleAt:0,retryAt:now+60000,inflight:false}],
  ['busy',{hasValue:false,staleAt:0,retryAt:0,inflight:true}],
 ]);
 const plan=pollPlan(entries,now);
 assert.deepEqual(plan.due.sort(),['new','stale']);
 entries.delete('stale');entries.delete('new');
 assert.deepEqual(pollPlan(entries,now),{due:[],delay:40000});
 assert.equal(pollPlan(new Map(),now).delay,300000);
});
