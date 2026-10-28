import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const arg=(key:string)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.split('=').slice(1).join('=');
if(!arg('data')||!arg('baseline'))throw new Error('Pass --data=absolute-snapshot-directory --baseline=absolute-a49cef4-checkout --split=holdout|development');
const {chartStudy:oldStudy}=await import(pathToFileURL(resolve(arg('baseline')!,'src/shared/chart-study.ts')).href);
import {chartStudy as newStudy} from '../src/shared/chart-study';
import {analyzeTrendRegimes} from '../src/shared/trend-regime';
import {CLASSIC_MA,FIBONACCI_MA} from '../src/shared/ma-system';
const dir=pathToFileURL(resolve(arg('data')!)+ '/'),manifest=JSON.parse(readFileSync(new URL('manifest-results.json',dir),'utf8')),split=arg('split')||'holdout',frozenHash=createHash('sha256').update(readFileSync(new URL('../src/shared/trend-regime.ts',import.meta.url))).digest('hex');
const rows:any[]=[],causalChecks:any[]=[],preservation:any[]=[];
for(const m of manifest.filter((m:any)=>m.split===split&&m.available)){
 const data=JSON.parse(readFileSync(new URL(m.symbol+'.json',dir),'utf8')),bars=data.candles,indices=new Map(bars.map((b:any,i:number)=>[b.time,i]));
 for(const ma of [CLASSIC_MA,FIBONACCI_MA]){
  const opts={symbol:m.symbol,name:data.name,maPeriods:ma,now:new Date('2026-10-28T08:00:00Z')},start=performance.now(),old=oldStudy(bars,opts),next=newStudy(bars,opts),newMs=performance.now()-start,regime=analyzeTrendRegimes(bars,opts),baseIdentity=(m:any)=>m.time+':'+m.kind+':'+m.label,oldPatterns=old.patternMarks.filter(m=>!m.kind.startsWith('trend-')&&m.kind!=='box-range'),actual=new Set(next.patternMarks.map(baseIdentity));
  preservation.push({symbol:m.symbol,ma:ma.join(','),legacyPatterns:oldPatterns.length,preserved:oldPatterns.filter(m=>actual.has(baseIdentity(m))).length,buySellIdentical:JSON.stringify(old.tradeMarkers)===JSON.stringify(next.tradeMarkers),confirmedSignalsIdentical:JSON.stringify(old.strategy?.signals)===JSON.stringify(next.strategy?.signals),newRiskEvents:next.patternMarks.filter(m=>m.kind==='guillotine'||m.kind==='gap-reversal-loss').length});
  for(const end of [120,220,320,420,bars.length-1]){
   if(end>=bars.length)continue;const part=analyzeTrendRegimes(bars.slice(0,end),{...opts,now:new Date(bars[end-1].time+'T08:00:00Z')});assert.deepEqual(part.marks,regime.marks.filter(m=>m.time<=bars[end-1].time));
   const partChart=newStudy(bars.slice(0,end),{...opts,now:new Date(bars[end-1].time+'T08:00:00Z')});assert.deepEqual(partChart.patternMarks.filter(m=>!m.provisional),next.patternMarks.filter(m=>m.time<=bars[end-1].time&&!m.provisional));
   causalChecks.push({symbol:m.symbol,ma:ma.join(','),end,unchanged:true});
  }
  function stats(marks:any[],type:string){for(const mark of marks){const index=indices.get(mark.time) as number;if(index===undefined||index<250)continue;const side=mark.regime==='down'?-1:1,horizon=mark.trendScale==='swing'?20:5,nextStart=marks.find(m=>m.time>mark.time&&m.trendScale===mark.trendScale&&m.regime!==mark.regime),nextIndex=nextStart?indices.get(nextStart.time) as number:undefined,prefix=bars.slice(Math.max(0,index-(mark.trendScale==='swing'?29:9)),index+1),path=prefix.slice(1).reduce((s:number,b:any,i:number)=>s+Math.abs(b.close-prefix[i].close),0),eff=path?Math.abs(prefix.at(-1).close-prefix[0].close)/path:0;
   const after=bars.slice(index+1,index+horizon+1),complete=after.length===horizon,price=bars[index].close;
   rows.push({symbol:m.symbol,ma:ma.join(','),type,scale:mark.trendScale||'legacy-up',regime:mark.regime||'up',date:mark.time,label:mark.label,efficiency10:eff,futureBars:after.length,complete,forwardDirectionReturn:complete?side*(after.at(-1).close/price-1)*100:null,adverseExcursion:after.length?Math.min(0,...after.map((b:any)=>side===1?(b.low/price-1)*100:(1-b.high/price)*100)):null,oppositeWithin5:nextIndex!==undefined&&nextIndex-index<=5});
  }}
  stats(old.patternMarks.filter(m=>m.kind==='trend-start'),'old');stats(regime.marks.filter(m=>m.kind==='trend-start'),'new');
  console.log(JSON.stringify({symbol:m.symbol,ma:ma===CLASSIC_MA?'classic':'fib',states:regime.regimes.map(r=>r.direction),trendEvents:regime.marks.length,newComputeAndOldMs:Math.round(newMs)}));
 }
}
const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const summaries=[];
for(const type of ['old','new'])for(const scale of type==='old'?['legacy-up']:['short','swing'])for(const direction of type==='old'?['up']:['up','down']){const group=rows.filter(r=>r.type===type&&r.scale===scale&&r.regime===direction),complete=group.filter(r=>r.complete);summaries.push({type,scale,direction,events:group.length,complete:complete.length,directionalFollowThrough:complete.length?complete.filter(r=>r.forwardDirectionReturn>0).length/complete.length:null,meanDirectionalReturn:mean(complete.map(r=>r.forwardDirectionReturn)),meanAdverseExcursion:mean(complete.map(r=>r.adverseExcursion)),oppositeWithin5:group.filter(r=>r.oppositeWithin5).length,lowEfficiencyStarts:group.filter(r=>r.efficiency10<.2).length});}
const output={protocol:'trend-regime-v2-20261029',split,ruleSha256:frozenHash,stockCount:manifest.filter((m:any)=>m.split===split).length,available:manifest.filter((m:any)=>m.split===split&&m.available).length,unavailable:manifest.filter((m:any)=>m.split===split&&!m.available),summaries,preservation,causalChecks,events:rows,limitations:'Fixed sector-diverse convenience sample, not random full-market or future live testing. Forward statistics are descriptive, not labelled detection accuracy, winning probabilities or evidence of an executable strategy. Two MA systems on same stock are correlated; events overlap. Does not include trading costs, price-limit fills, delistings or independent fund/sector histories.'};
writeFileSync(new URL(split+'-report.json',dir),JSON.stringify(output,null,2));console.log(JSON.stringify({split,ruleSha256:frozenHash,summaries,preservation:preservation.filter(p=>!p.buySellIdentical||p.preserved!==p.legacyPatterns),causalChecks:causalChecks.length}));
