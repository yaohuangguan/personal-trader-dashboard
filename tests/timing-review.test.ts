import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeStrategy} from '../src/shared/strategy';
import {reviewTrade} from '../src/shared/trade-review';
import {patternMarks,reviewedPatternMarks} from '../src/shared/pattern-marks';
import type {Candle} from '../src/shared/types';
import type {Snapshot} from '../src/shared/desk-types';
const day=(i:number)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10);
const close=(b:Candle[])=>new Date(b.at(-1)!.time+'T08:01:00Z');
function setup():Candle[]{const b=Array.from({length:80},(_,i)=>{const c=i<55?10+.3*Math.sin(i*2):10;return {time:day(i),open:c,close:c,high:c+.2,low:c-.2,volume:10000};});b[79]={time:day(79),open:10.12,high:10.47,low:10.12,close:10.42,volume:30000};return b;}
function append(b:Candle[],v:Omit<Candle,'time'>){b.push({time:day(b.length),...v});}
function quote(b:Candle[]):Snapshot{const c=b.at(-1)!,previous=b.at(-2)!.close;return {symbol:'300001.SZ',name:'Fixture',price:c.close,previous,asOf:c.time+'T15:05:00+08:00',stale:false,amount:3e8,turnover:8,open:c.open,high:c.high,low:c.low,volume:c.volume,volumeUnit:'手',session:'closed',change:c.close-previous,changePercent:(c.close/previous-1)*100,pe:20,pb:2,marketCap:1e10,floatCap:8e9,volumeRatio:2,limitUp:c.close*1.2,limitDown:c.close*.8,bids:[],asks:[{price:c.close+.01,volume:100}]};}

test('a pullback without demand is watched; a later volume-backed reclaim gets a new timing assessment',()=>{
 const b=setup();assert.ok(analyzeStrategy(b,{now:close(b)}).signals.some(s=>s.side==='buy'));
 append(b,{open:10.4,high:10.45,low:10.25,close:10.3,volume:9000});
 const pull=analyzeStrategy(b,{now:close(b)});assert.equal(pull.plan.phase,'pullback');assert.ok(pull.plan.score<70);assert.doesNotMatch(pull.plan.flat.action,/买入/);assert.equal(pull.episodes[0].follow.length,1);
 append(b,{open:10.3,high:10.6,low:10.28,close:10.55,volume:18000});
 const rebound=analyzeStrategy(b,{now:close(b)});assert.equal(rebound.plan.kind,'retest');assert.equal(rebound.plan.phase,'turning');assert.equal(rebound.plan.flat.action,'买入观察');assert.equal(rebound.episodes[0].follow.length,2);
});

test('shrinking-volume support failure exits the old plan and a later recovery is not permanently blacklisted',()=>{
 const b=setup(),initial=analyzeStrategy(b,{now:close(b)}).signals;
 append(b,{open:10.35,high:10.38,low:9.55,close:9.6,volume:6000});
 const broken=analyzeStrategy(b,{now:close(b)});assert.ok(broken.plan.exitRisk>=70);assert.match(broken.plan.holding.action,/卖出|减仓/);assert.equal(broken.episodes[0].failedAt,b.at(-1)!.time);assert.ok(broken.signals.some(s=>s.side==='sell'));assert.deepEqual(broken.signals.filter(s=>s.time<=day(79)),initial);
 for(let i=0;i<8;i++)append(b,{open:9.65,high:9.8,low:9.5,close:9.65,volume:7000});
 append(b,{open:9.65,high:10.5,low:9.6,close:10.45,volume:35000});
 const repaired=analyzeStrategy(b,{now:close(b)});assert.notEqual(repaired.plan.phase,'broken');assert.notEqual(repaired.plan.phase,'downward');assert.equal(repaired.episodes.find(e=>e.setup.date===day(79))?.failedAt,day(80));assert.ok(repaired.plan.setup!.date>day(80));
});

test('a strong but extended trend has a high structure assessment without a high current buy score',()=>{
 const b=setup();for(let i=0;i<6;i++){const p=b.at(-1)!.close;append(b,{open:p,low:p*.99,high:p*1.11,close:p*1.1,volume:40000});}
 const p=analyzeStrategy(b,{now:close(b)}).plan;assert.equal(p.phase,'extension');assert.ok(p.structureScore>=75);assert.ok(p.score<=35);assert.match(p.flat.action,/不追高/);assert.doesNotMatch(p.holding.action,/^卖出$/);
});

test('incomplete intraday bars do not complete follow-up days or create confirmed shape buys',()=>{
 const b=setup();append(b,{open:10.4,high:10.45,low:10.25,close:10.3,volume:2000});
 const now=new Date(b.at(-1)!.time+'T02:00:00Z'),s=analyzeStrategy(b,{now});assert.equal(s.plan.provisional,true);assert.equal(s.episodes[0].follow.length,0);assert.ok(s.signals.every(p=>p.time!==b.at(-1)!.time));assert.doesNotMatch(s.plan.metrics!.volumeLabel,/^缩量回落/);
});

test('missing context stays missing; stale quotes invalidate current timing and weak liquidity never softens a broken plan',()=>{
 const b=setup();append(b,{open:10.35,high:10.38,low:9.55,close:9.6,volume:6000});const now=close(b),s=analyzeStrategy(b,{now}),q=quote(b);
 const r=reviewTrade(s,b,{now,quote:{...q,amount:1e8}});assert.equal(r.current,true);assert.match(r.flat.action,/回避/);assert.ok(r.evidence.find(e=>e.id==='flow')?.score===null);assert.ok(r.coverage<100);
 const stale=reviewTrade(s,b,{now,quote:{...q,stale:true}});assert.equal(stale.entryScore,null);assert.match(stale.flat.action,/行情核验/);
});

test('later candles preserve all prior shape annotations and an unfinished mark is labeled provisional',()=>{
 const b=setup(),first=patternMarks(b,close(b));assert.ok(first.some(m=>m.time===day(79)));
 append(b,{open:10.4,high:10.5,low:10.2,close:10.4,volume:12000});assert.deepEqual(patternMarks(b,close(b)).filter(m=>m.time<=day(79)),first);
 const forming=patternMarks(b.slice(0,80),new Date(day(79)+'T02:00:00Z'));assert.ok(forming.filter(m=>m.time===day(79)).every(m=>m.provisional));
});

test('dated market context cannot be replaced by an undated sector or an old funds point',()=>{
 const b=setup(),now=close(b),q=quote(b),s=analyzeStrategy(b,{now}),stamp={source:'Test source',sourceUrl:'https://example.test',fetchedAt:now.toISOString()};
 const input={now,quote:q,benchmarks:[{...q,symbol:'000300.SH',name:'沪深300',changePercent:1}],flow:{...stamp,symbol:q.symbol,mainLabel:'资金估算',points:[{time:day(78),main:1e8}]},sectors:{...stamp,symbol:q.symbol,boards:[{code:'TEST',name:'概念样本',changePercent:3}]}};
 const r=reviewTrade(s,b,input as Parameters<typeof reviewTrade>[2]);
 assert.equal(r.evidence.find(e=>e.id==='flow')?.status,'unverified');assert.equal(r.evidence.find(e=>e.id==='sector')?.status,'unverified');assert.match(r.flat.action,/技术候选/);
});

test('stage annotations preserve prior failures and ineligible entries do not advertise a 2R target',()=>{
 const b=setup();append(b,{open:10.35,high:10.38,low:9.55,close:9.6,volume:6000});
 const s=analyzeStrategy(b,{now:close(b)}),first=reviewedPatternMarks(b,s,close(b));assert.ok(first.some(m=>m.kind==='stage-broken'));assert.deepEqual(s.plan.targets,[]);
 append(b,{open:9.6,high:9.7,low:9.3,close:9.4,volume:7000});
 const later=reviewedPatternMarks(b,analyzeStrategy(b,{now:close(b)}),close(b));assert.deepEqual(later.filter(m=>m.time<=day(80)),first);
});
