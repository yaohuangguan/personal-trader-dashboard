import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMinuteBars,aggregate120} from '../src/shared/minute-bars';
import {bollinger,rsi,parabolicSar} from '../src/shared/chart-indicators';
import {analyzeGuide} from '../src/shared/guide-analysis';
import {stockCharacter} from '../src/shared/stock-character';
import {guideScore} from '../src/shared/guide-score';
import {guideAction,guideTradeMarkers} from '../src/shared/guide-action';
import {newsLink,readNewsLink} from '../src/shared/news-link';
import {parseTencentSearch,mergeSearch} from '../src/worker/market-search';
import type {Candle} from '../src/shared/types';
const now=new Date('2026-10-26T08:00:00Z');
const row=(t:string)=>[t,'10','11','12','9','100'];
const flat=(n=100):Candle[]=>Array.from({length:n},(_,i)=>({time:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:99.9,high:100.2,low:99.8,close:100,volume:1000}));
function setup(){const bars=flat();for(const [close,volume] of [[106,2200],[107,1800],[108,1800],[109,1800]]){const time=new Date(Date.parse(bars.at(-1)!.time)+86400000).toISOString().slice(0,10);bars.push({time,open:close===106?99:close-.5,close,high:close+.2,low:close===106?98.5:close-.8,volume});}return bars;}
test('minute timestamps retain distinct intraday bars, exclude future and reject invalid OHLC/session',()=>{
 const c=parseMinuteBars([row('202610261030'),row('202610261130'),row('202610271030')],now);assert.equal(c.length,2);assert.equal(c[0].time,'2026-10-26 10:30');
 assert.throws(()=>parseMinuteBars([row('202610261230')],now));assert.throws(()=>parseMinuteBars([['202610261030',10,15,12,9,100]],now));assert.throws(()=>parseMinuteBars([row('202610261030'),row('202610261030')],now));
});
test('120 minute candles never cross the lunch break/day or fabricate an incomplete pair',()=>{
 const input=parseMinuteBars(['202610261030','202610261130','202610261400','202610261500','202610271030'].map(row),new Date('2026-10-27T03:00:00Z'));
 const c=aggregate120(input);assert.equal(c.length,2);assert.equal(c[0].volume,200);assert.equal(c[1].time,'2026-10-26 15:00');assert.equal(aggregate120(input.slice(1,3)).length,0);
});
test('BOLL uses population deviation; RSI has warmup and bounded flat/rising/falling values; SAR is causal',()=>{
 const f=flat(40);assert.equal(bollinger(f).length,21);assert.deepEqual(bollinger(f)[0],{time:f[19].time,mid:100,upper:100,lower:100});assert.equal(rsi(f)[0].value,50);
 const rising=f.map((c,i)=>({...c,open:100+i,close:101+i,high:102+i,low:99+i}));assert.equal(rsi(rising)[0].value,100);assert.equal(rsi(rising.map((c,i)=>({...c,close:100-i})))[0].value,0);
 assert.deepEqual(parabolicSar(rising).slice(0,20),parabolicSar(rising.slice(0,21)));
});
test('quiet stocks cannot earn a high total or a buy; missing evidence pauses action',()=>{
 const g=analyzeGuide(flat(),{now}),c=stockCharacter(flat(),g.asOf!)!;assert.ok(guideScore(g,c).score!<=49);assert.equal(guideAction(g,c).action,'观望');assert.equal(guideScore(analyzeGuide(flat(20),{now}),null).score,null);
});
test('buy markers occur on the first confirmed close and survive a later failed setup without lookahead',()=>{
 const bars=setup(),g=analyzeGuide(bars,{now}),c=stockCharacter(bars,g.asOf!)!;assert.equal(g.event?.state,'confirmed');assert.equal(guideAction(g,{...c,score:100,active:true,breakouts:4,continuation:.75}).action,'强烈买入');
 const before=bars.slice(0,-1);assert.equal(guideTradeMarkers(before,analyzeGuide(before,{now})).length,0);
 const buy=guideTradeMarkers(bars,g);assert.ok(buy.some(p=>p.side==='buy'&&p.time===bars.at(-1)!.time));
 const failed=[...bars,{time:'2025-04-15',open:103,close:101,high:104,low:100,volume:2000}];const markers=guideTradeMarkers(failed,analyzeGuide(failed,{now}));assert.deepEqual(markers.filter(p=>p.side==='buy'),buy);assert.equal(markers.at(-1)?.side,'sell');
 const intraday=analyzeGuide(bars,{now:new Date(bars.at(-1)!.time+'T04:00:00Z')});assert.equal(guideAction(intraday,c).action,'观望');assert.equal(guideTradeMarkers(bars,intraday).length,0);
});
test('Unicode shared news links open site content and reject malformed / executable source URLs',()=>{
 const item={id:'a',title:'宝通科技：公告',source:'公开来源',url:'https://example.com/a',summary:'<b>中文摘要</b>',publishedAt:null,category:'all',originalTitle:'宝通科技：公告'};
 const link=new URL(newsLink(item));assert.equal(link.hostname,'personal-market-atlas.nzs.workers.dev');assert.equal(readNewsLink(link.searchParams.get('article')!)?.summary,'中文摘要');assert.equal(readNewsLink('bogus'),null);const bad=new URL(newsLink({...item,url:'javascript:alert(1)'}));assert.equal(readNewsLink(bad.searchParams.get('article')!),null);
});
test('pinyin initial search preserves real Chinese matches and removes synthetic US fallback',()=>{
 const found=parseTencentSearch('v_hint="sz~300031~宝通科技~btkj~GP-A";');assert.equal(found[0].symbol,'300031.SZ');assert.deepEqual(mergeSearch([{symbol:'BTKJ',name:'自定义代码 BTKJ',exchange:'US'}],found),found);
});
