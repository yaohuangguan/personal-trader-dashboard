import {chartStudy} from '../src/shared/chart-study';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseUSQuotes,parseUSHistory,usHistory} from '../src/worker/us-market';
import {historyPage} from '../src/worker/chart-history';
import {marketClock,newYorkTimestamp} from '../src/shared/market-clock';
import {computeJSON} from '../src/shared/local-study';
import {mergeHistoryPage} from '../src/shared/chart-history';

function quoteText(time='2026-11-04 15:32:04'){
 const fields=Array(70).fill('');
 Object.assign(fields,{2:'NVDA.OQ',3:'202.22',4:'206.69',5:'203.50',6:'104496267',30:time,31:'-4.47',32:'-2.16',33:'206.79',34:'200.94',35:'USD',37:'21299551802',38:'.43',39:'25.52',46:'Nvidia Corporation'});
 return 'v_usNVDA="'+fields.join('~')+'";';
}
test('US quotes preserve USD turnover, share volume and the New York trading date',()=>{
 const quote=parseUSQuotes(quoteText(),new Date('2026-11-04T20:32:30Z'))[0];
 assert.equal(quote.wire,'usNVDA.OQ');assert.equal(quote.volumeUnit,'股');
 assert.equal(quote.volume,104496267);assert.equal(quote.amount,21299551802);
 assert.equal(quote.asOf,'2026-11-04T15:32:04-05:00');assert.equal(quote.session,'trading');assert.equal(quote.stale,false);
 assert.equal(quote.limitUp,null);assert.equal(quote.limitDown,null);assert.deepEqual(quote.bids,[]);
 assert.equal(parseUSQuotes(quoteText(),new Date('2026-11-04T20:40:00Z'))[0].stale,true);
});
test('New York timestamps and unfinished bars respect daylight saving and US close',()=>{
 assert.equal(newYorkTimestamp('2026-07-10 15:30:00'),'2026-07-10T19:30:00.000Z');
 assert.equal(newYorkTimestamp('2026-11-04 15:30:00'),'2026-11-04T20:30:00.000Z');
 assert.equal(marketClock(new Date('2026-11-04T20:30:00Z'),'NVDA').date,'2026-11-04');
 assert.equal(marketClock(new Date('2026-11-04T20:30:00Z'),'300545.SZ').date,'2026-11-05');
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/002472-20261020.json',import.meta.url),'utf8'));
 const candles=fixture.candles;
 const day=candles.at(-1).time;
 const result=chartStudy(candles,{symbol:'NVDA',maPeriods:[5,13,20,30,60,120,250],now:new Date(day+'T19:30:00Z')});
 assert.equal(result.strategy!.plan.provisional,true);
 const closed=chartStudy(candles,{symbol:'NVDA',maPeriods:[5,13,20,30,60,120,250],now:new Date(day+'T21:30:00Z')});
 assert.equal(closed.strategy!.plan.provisional,false);
 assert.ok(result.patternMarks.length>0);assert.ok(result.indicatorMarks.length>0);
 assert.ok(result.patternMarks.every((m:{label:string})=>!m.label.includes('涨停')));
});
test('US history resolves the exchange suffix and uses the US adjusted endpoint for every period',async()=>{
 const original=globalThis.fetch,calls:string[]=[];
 globalThis.fetch=async input=>{
  const url=String(input);calls.push(url);
  if(url.includes('qt.gtimg.cn'))return new Response(quoteText());
  assert.ok(url.includes('/usfqkline/get?param=usNVDA.OQ,'));
  const period=url.split('usNVDA.OQ,')[1].split(',')[0];
  return Response.json({data:{'usNVDA.OQ':{['qfq'+period]:[['2024-06-07','119.39','120.51','121.31','117.65','41238580'],['2024-06-10','120','121.41','122.72','116.65','314162650']]}}});
 };
 try{
  for(const period of ['day','week','month']){
   const data=await usHistory('NVDA',period,'2024-06-10');
   assert.equal(data.candles[0].close,120.51);assert.equal(data.volumeUnit,'股');
   const page=await historyPage('NVDA',period,'2024-06-10');
   assert.deepEqual(mergeHistoryPage([data.candles[1]],page),data.candles);
  }
  assert.ok(calls.every(url=>!url.includes('usNVDA,day')));
 }finally{globalThis.fetch=original;}
});
test('unadjusted, malformed and duplicate US history fails instead of creating split-induced patterns',()=>{
 const raw=[['2024-06-07','1197.7','1208.88','1216.92','1180.22','41238580']];
 assert.throws(()=>parseUSHistory({day:raw},'day'),/incomplete/);
 assert.throws(()=>parseUSHistory({qfqday:[],day:raw},'day'),/incomplete/);
 assert.throws(()=>parseUSHistory({qfqday:[raw[0],raw[0]]},'day'),/Invalid/);
 assert.throws(()=>parseUSHistory({qfqday:[['2024-06-07','','120','121','119','1']]},'day'),/Invalid/);
});
