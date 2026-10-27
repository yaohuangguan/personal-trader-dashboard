import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patternMatches,recentLimitUps,evaluateScreen,parseScreenOptions,DEFAULT_SCREEN} from '../src/shared/pattern-screen';
import type {Candle} from '../src/shared/types';
import type {Snapshot} from '../src/shared/desk-types';
const now=new Date('2025-09-13T08:00:00Z');
function flat(n=250):Candle[]{return Array.from({length:n},(_,i)=>({time:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:99.9,close:100,high:100.3,low:99.7,volume:100000}));}
function append(rows:Candle[],bar:Partial<Candle>){return [...rows,{...rows.at(-1)!,time:new Date(Date.parse(rows.at(-1)!.time)+86400000).toISOString().slice(0,10),...bar}];}
function snapshot(bars:Candle[]):Snapshot{const last=bars.at(-1)!;return {symbol:'600123.SH',name:'活跃样本',price:last.close,previous:bars.at(-2)!.close,open:last.open,high:last.high,low:last.low,change:null,changePercent:null,volume:last.volume,amount:2e8,turnover:10,pe:null,pb:null,marketCap:300e8,floatCap:last.close*1e8,volumeRatio:2,limitUp:null,limitDown:null,asOf:last.time+'T15:00:00+08:00',bids:[],asks:[],session:'closed',stale:false,volumeUnit:'手'};}
test('multi-line launch crosses MA60, while a doji or unconfirmed future bar does not',()=>{
 const bars=append(flat(),{open:99,close:106,high:106.5,low:98.8,volume:240000});assert.ok(patternMatches(bars,now).some(p=>p.mode==='multi'));assert.ok(patternMatches(bars,now).some(p=>p.mode==='spider'));
 assert.ok(!patternMatches(bars.map((b,i)=>i===bars.length-1?{...b,open:106}:b),now).some(p=>p.mode==='multi'));
 const future=append(bars,{open:106,close:108,high:109,low:105});assert.deepEqual(patternMatches(future.slice(0,bars.length),now),patternMatches(bars,now));
});
test('beauty shoulder requires small, lower-volume consolidation above launch midpoint',()=>{
 let bars=append(flat(),{open:100,close:105,high:106,low:99,volume:220000});for(let i=0;i<4;i++)bars=append(bars,{open:105+i*.1,close:105.2+i*.1,high:106,low:104.8,volume:70000});
 assert.ok(patternMatches(bars,now).some(p=>p.mode==='beauty'));
 const failed=bars.map((b,i)=>i===bars.length-2?{...b,low:101}:b);assert.ok(!patternMatches(failed,now).some(p=>p.mode==='beauty'));
});
test('cannon requires an up-down-up sequence with the last close above both preceding highs',()=>{
 let bars=append(flat(),{open:100,close:105,high:106,low:99,volume:150000});bars=append(bars,{open:104,close:102,high:105,low:100,volume:80000});bars=append(bars,{open:103,close:107,high:108,low:102,volume:200000});assert.ok(patternMatches(bars,now).some(p=>p.mode==='cannon'));
 assert.ok(!patternMatches(bars.map((b,i)=>i===bars.length-1?{...b,close:105}:b),now).some(p=>p.mode==='cannon'));
});
test('liquidity floor applies at exactly 200 million, with stale/unaligned/unknown data excluded',()=>{
 const bars=append(flat(),{open:99,close:106,high:106.5,low:98.8,volume:240000}),quote=snapshot(bars),options={...DEFAULT_SCREEN,modes:['multi' as const],activity:false};
 const run=(patch:Partial<Snapshot>={})=>evaluateScreen({bars,raw:bars,quote:{...quote,...patch},provider:'test',options,now});assert.ok(run().candidate);assert.equal(run({amount:2e8-1}).candidate,null);assert.equal(run({amount:null}).candidate,null);assert.equal(run({stale:true}).candidate,null);assert.equal(run({marketCap:1001e8}).candidate,null);assert.equal(run({price:999}).candidate,null);
 assert.match(run().candidate!.chip.notice,/固定回推/);assert.ok(run().candidate!.chip.concentration90<15);
});
test('a tightened concentration threshold and poorly replaced chips do not pass',()=>{
 const wide=flat().map((b,i)=>({...b,open:50+i,close:51+i,high:53+i,low:49+i}));const q=snapshot(wide);const r=evaluateScreen({bars:wide,raw:wide,quote:q,provider:'test',options:{...DEFAULT_SCREEN,activity:false,concentration:1,modes:['bullish']},now});assert.equal(r.candidate,null);
 const bars=append(flat(),{open:99,close:106,high:107,low:99,volume:240000}),quiet={...snapshot(bars),floatCap:106*1e14};const noCoverage=evaluateScreen({bars,raw:bars,quote:quiet,provider:'test',options:{...DEFAULT_SCREEN,modes:['multi'],activity:false},now});assert.match(noCoverage.reason||'',/筹码模型样本/);
});
test('closing-limit estimation honors board rates, one-cent rounding and excludes ST/new-listing labels',()=>{
 const base=flat(15);const main=append(base,{open:104,close:110,high:110,low:104});assert.deepEqual(recentLimitUps(main,'600123.SH','正常'),[main.at(-1)!.time]);assert.equal(recentLimitUps(main,'300123.SZ','正常').length,0);assert.equal(recentLimitUps(main,'600123.SH','ST测试').length,0);
 const chinext=append(base,{open:110,close:120,high:120,low:110});assert.equal(recentLimitUps(chinext,'300123.SZ','正常').length,1);assert.equal(recentLimitUps(chinext,'300123.SZ','C新股').length,0);
});
test('screen options preserve compulsory concentration caps and reject unknown modes',()=>{
 assert.throws(()=>parseScreenOptions(new URLSearchParams('concentration=21')));assert.throws(()=>parseScreenOptions(new URLSearchParams('modes=magic')));assert.equal(parseScreenOptions(new URLSearchParams()).maxMarketCap,1000e8);
});

test('independent modes use OR, while an optional recent-limit condition applies to every result',()=>{
 const bars=append(flat(),{open:99,close:106,high:107,low:99,volume:240000}),quote=snapshot(bars);
 const run=(modes:('multi'|'cannon')[],recentLimitUp=false)=>evaluateScreen({bars,raw:bars,quote,provider:'test',options:{...DEFAULT_SCREEN,modes,activity:false,recentLimitUp},now});
 const combined=run(['multi','cannon']);
 assert.deepEqual(combined.candidate?.patterns.map(p=>p.mode),['multi']);
 assert.ok(run(['multi']).candidate);
 assert.equal(run(['cannon']).candidate,null);
 assert.match(run(['multi','cannon'],true).reason||'',/未检出收盘涨停/);
});

test('STAR daily volumes in shares and ordinary daily volumes in lots produce the same chip model',()=>{
 const bars=append(flat(),{open:99,close:106,high:107,low:99,volume:240000}),q=snapshot(bars),options={...DEFAULT_SCREEN,modes:['multi' as const],activity:false};
 const ordinary=evaluateScreen({bars,raw:bars,quote:q,provider:'Tencent',options,now});const shares=bars.map(c=>({...c,volume:c.volume*100}));
 const star=evaluateScreen({bars:shares,raw:shares,quote:{...q,symbol:'688123.SH'},provider:'Tencent',options,now});assert.equal(star.candidate?.chip.concentration90,ordinary.candidate?.chip.concentration90);assert.ok(star.candidate);
});
