import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionReview} from '../src/shared/session-review';
import {parseUSQuotes} from '../src/worker/session-review';
import type {Snapshot} from '../src/shared/desk-types';
const quote={symbol:'300545.SZ',name:'样本',asOf:'2026-10-28T15:00:01+08:00',stale:false,price:22,previous:21,high:23,low:20,bids:[{price:22,volume:800}],asks:[{price:22.01,volume:200}]} as Snapshot;
test('closing analysis distinguishes post-close news, prior news and the actual US session timestamp',()=>{
 const now=new Date('2026-10-28T08:00:00Z'),base={id:'a',source:'来源',category:'all',url:'https://example.test/a',originalTitle:''};
 const r=sessionReview(quote,{now,news:[{...base,title:'收盘前消息',publishedAt:'2026-10-28T06:00:00Z'},{...base,id:'b',title:'盘后消息',publishedAt:'2026-10-28T07:10:00Z'},{...base,id:'c',title:'未来消息',publishedAt:'2026-10-28T09:00:00Z'}],us:[{symbol:'QQQ',name:'QQQ',price:1,changePercent:1,asOf:'2026-10-27T20:00:01Z',localTime:'2026-10-27 16:00:01',source:'Source'}]});
 assert.equal(r.mode,'closing');assert.equal(r.closingVerified,true);assert.equal(r.evidence.find(e=>e.label==='盘后新消息')?.items?.[0].title,'盘后消息');assert.equal(r.evidence.find(e=>e.label==='盘后新消息')?.items?.length,1);assert.ok(r.evidence.some(e=>e.label==='收盘前已知消息'));assert.match(r.evidence.find(e=>e.label.includes('美股'))!.detail,/早于A股/);
 const old=sessionReview({...quote,asOf:'2026-10-28T14:59:00+08:00'},{now});assert.equal(old.closingVerified,false);assert.match(old.title,/待核验/);
});
test('intraday book imbalance is a snapshot observation rather than aggressive flow or licensed L2',()=>{
 const r=sessionReview({...quote,asOf:'2026-10-28T10:00:00+08:00'},{now:new Date('2026-10-28T02:00:10Z')});assert.equal(r.mode,'intraday');assert.match(r.evidence[0].detail,/80.0%/);assert.match(r.evidence[0].detail,/不等于主动成交/);assert.match(r.evidence[0].source,/非授权/);
});
test('US source local timestamps use New York daylight and standard time and reject future quotes',()=>{
 const wire=(date:string)=>{const f=Array(36).fill('');f[1]='QQQ';f[3]='100';f[30]=date;f[32]='1.25';return 'v_usQQQ="'+f.join('~')+'";';};
 assert.equal(parseUSQuotes(wire('2026-10-27 16:00:01'),new Date('2026-10-28T08:00:00Z'))[0].asOf,'2026-10-27T20:00:01.000Z');assert.equal(parseUSQuotes(wire('2026-01-20 16:00:01'),new Date('2026-01-21T08:00:00Z'))[0].asOf,'2026-01-20T21:00:01.000Z');assert.deepEqual(parseUSQuotes(wire('2026-10-29 16:00:01'),new Date('2026-10-28T08:00:00Z')),[]);
});
