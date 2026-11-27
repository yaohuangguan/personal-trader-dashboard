import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {universe,quotes} from '../../src/worker/desk-data';
import {fetchScreenDaily,extendHistory,backoffDelay,type DayData} from '../../src/worker/pattern-screen';
import {sinaBeijingDaily} from '../../src/worker/research';
import {evaluateScreen,SCREEN_MODES,DEFAULT_SCREEN} from '../../src/shared/pattern-screen';
import {decideCloseRun,reconcileUniverse,isWeekend,type CloseRunDecision} from '../../src/shared/close-schedule';
import type {CloseReport} from '../../src/shared/close-report';
import {isClosingSnapshot} from '../../src/shared/close-report';
import type {ScreenCandidate} from '../../src/shared/screening';
import type {Snapshot} from '../../src/shared/desk-types';

const started=Date.now(),cache='node_modules/.cache/atlas-close';await mkdir(cache,{recursive:true});
const base=process.env.SCREEN_WORKER_URL||'https://guanlan.nzs.workers.dev',token=process.env.SCREEN_JOB_TOKEN;
const force=process.env.FORCE_PUBLISH==='1';
async function pool<T,R>(items:T[],limit:number,fn:(item:T,index:number)=>Promise<R>){let cursor=0;const out:R[]=Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;out[i]=await fn(items[i],i);}}));return out;}
/** Three attempts with jittered exponential backoff, so parallel workers do not retry in lockstep. */
async function retry<T>(fn:()=>Promise<T>){let error:unknown;for(let n=0;n<3;n++){try{return await fn();}catch(e){error=e;if(n<2)await new Promise(r=>setTimeout(r,backoffDelay(n+1)));}}throw error;}
async function summary(line:string){if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,line+'\n').catch(()=>{});}
/** GitHub annotations make skipped or failed weekday runs visible instead of a silent green check. */
async function annotate(level:CloseRunDecision['level'],message:string){console.log(`::${level}::${message}`);await summary(`- **${level}**: ${message}`);}

// 1. Cheap checks first: benchmark session and the report already being served.
async function publishedReportDate():Promise<string|null|undefined>{
 try{
  const r=await fetch(base+'/api/desk/close-report?view=summary',{headers:{'User-Agent':'MarketAtlas-Close-Job',accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const body=await r.json() as {report?:{date?:string}|null};return body.report?.date??null;
 }catch(e){await annotate('warning','Could not read the published report ('+(e instanceof Error?e.message:String(e))+'); building anyway.');return undefined;}
}
const [benchmark,published]=await Promise.all([retry(()=>quotes(['000001.SH'])).then(r=>r.items.find(q=>q.symbol==='000001.SH')).catch(()=>undefined),publishedReportDate()]);
const decision=decideCloseRun({benchmark,publishedDate:published??null,force});
console.log(JSON.stringify({decision,benchmarkAsOf:benchmark?.asOf??null,published:published??null}));
if(decision.action!=='run'){
 await annotate(decision.level,decision.reason);
 // Weekday failures exit non-zero so the run is red; weekend probes only warn.
 if(decision.action==='fail'&&!isWeekend())process.exit(1);
 process.exit(0);
}
const date=decision.date!;await summary(`Closing report for **${date}** (${decision.reason})`);

// 2. Universe: page until the source ends; tolerate a small registered/actual drift and record it.
const first=await retry(()=>universe(1)),pageCount=Math.ceil(first.total/first.pageSize),pages=[first,...await pool(Array.from({length:Math.max(0,pageCount-1)},(_,i)=>i+2),4,p=>retry(()=>universe(p)))];
for(let p=pages.length+1;p<=100&&(pages.at(-1)!.sourceRows>=first.pageSize);p++)pages.push(await retry(()=>universe(p)));
const reconciled=reconcileUniverse(first.total,pages.flatMap(p=>p.items));
if(!reconciled.ok)throw new Error(`证券池实际${reconciled.actual}，登记${reconciled.registered}，差额超过${reconciled.tolerance}，不发布不完整名单`);
if(reconciled.gap)await annotate('notice',`Universe drift: registered ${reconciled.registered}, paged ${reconciled.actual} (gap ${reconciled.gap}); recorded in the report.`);
const all=reconciled.items;

// 3. Same-day snapshots and liquidity prefilter.
const rejected:Record<string,number>={},reject=(key:string)=>rejected[key]=(rejected[key]||0)+1;
const stockPool=all.filter(s=>{if(/ST|退/i.test(s.name)){reject('排除ST与退市名称');return false;}return true;});
const batches=Array.from({length:Math.ceil(stockPool.length/60)},(_,i)=>stockPool.slice(i*60,i*60+60));const snapshots=new Map<string,Snapshot>(),failures:{symbol:string;reason:string}[]=[];
await pool(batches,4,async batch=>{try{const feed=await retry(()=>quotes(batch.map(s=>s.symbol)));for(const q of feed.items)if(q.asOf.slice(0,10)===date)snapshots.set(q.symbol,q);}catch{/* Missing quotes are explicitly recorded below. */}});
const targets=stockPool.filter(s=>{const q=snapshots.get(s.symbol);if(!isClosingSnapshot(q,date)){failures.push({symbol:s.symbol,reason:'缺少同交易日15:00以后的收盘快照'});return false;}if(q!.amount===null||q!.amount<2e8){reject('成交额不足2亿元');return false;}if(/ST|退|^(N|C)/i.test(q!.name)){reject('ST、退市或新股价格限制待核验');return false;}return true;});
console.log(JSON.stringify({date,total:all.length,registered:reconciled.registered,liquid:targets.length,snapshotFailures:failures.length}));

// 4. Pattern evaluation with incremental adjusted history from the Actions cache.
let checked=0,cacheHits=0;const candidates:ScreenCandidate[]=[];const options={...DEFAULT_SCREEN,modes:Object.keys(SCREEN_MODES) as (keyof typeof SCREEN_MODES)[],auto:true,activity:false,maxMarketCap:null};
await pool(targets,8,async(stock,index)=>{
 const q=snapshots.get(stock.symbol)!;try{
  let previous:{adjusted:DayData;raw:DayData}|null=null;try{previous=JSON.parse(await readFile(join(cache,stock.symbol+'.json'),'utf8'));}catch{}
  let adjusted:DayData,raw:DayData,unit:'手'|'股'=/^68[89]/.test(stock.symbol)?'股':'手';
  if(stock.symbol.endsWith('.BJ')){const b=await retry(()=>sinaBeijingDaily(stock.symbol,500));adjusted={candles:b.candles,provider:'新浪北交所未复权日线'};raw=adjusted;unit='股';}
  else{
   const recent=await retry(()=>fetchScreenDaily(stock.symbol,true,previous?3:500));let merged=previous?extendHistory(previous.adjusted.candles,recent.candles):null;
   if(previous&&merged){adjusted={...recent,candles:merged};cacheHits++;}else adjusted=previous?await retry(()=>fetchScreenDaily(stock.symbol,true,500)):recent;
   raw=await retry(()=>fetchScreenDaily(stock.symbol,false,20));
  }
  adjusted.candles=adjusted.candles.filter(c=>c.time<=date);raw.candles=raw.candles.filter(c=>c.time<=date);
  const out=evaluateScreen({bars:adjusted.candles,raw:raw.candles,quote:q,volumeUnit:unit,provider:adjusted.provider,options,now:new Date(date+'T16:30:00+08:00')});
  if(out.candidate){if(stock.symbol.endsWith('.BJ'))out.candidate.risks.push('北交所未复权历史，除权除息可能影响形态');candidates.push(out.candidate as ScreenCandidate);}else reject(out.reason||'未命中');
  await writeFile(join(cache,stock.symbol+'.json'),JSON.stringify({adjusted,raw}));checked++;
 }catch(e){failures.push({symbol:stock.symbol,reason:e instanceof Error?e.message:'历史来源失败'});}
 if(index%100===0)console.log(`Processed ${checked}/${targets.length}; candidates ${candidates.length}`);
});
candidates.sort((a,b)=>(b.ranking?.score||0)-(a.ranking?.score||0)||(a.chip?.concentration90||99)-(b.chip?.concentration90||99));
const report:CloseReport={id:date+'-'+(process.env.GITHUB_RUN_ID||Date.now()),date,generatedAt:Date.now(),total:all.length,eligible:checked+failures.length,checked,failed:failures.length,failureSample:failures.slice(0,60),rejected,candidates,complete:failures.length===0,source:'新浪全证券名单 / 腾讯同日快照、前复权与未复权日线 / 新浪北交所',elapsedMs:Date.now()-started,cacheHits,universe:{registered:reconciled.registered,actual:reconciled.actual,gap:reconciled.gap}};
await mkdir('close-report',{recursive:true});await writeFile('close-report/report.json',JSON.stringify(report));console.log(JSON.stringify({...report,candidates:candidates.length}));
if(report.eligible&&report.failed/report.eligible>.05)await annotate('warning',`${report.failed}/${report.eligible} eligible stocks failed source verification; sample: ${failures.slice(0,3).map(f=>f.symbol+' '+f.reason).join('; ')}`);

// 5. Publish bounded chunks, then the atomic manifest.
if(!token)throw new Error('SCREEN_JOB_TOKEN missing; report saved but not published');
async function publish(action:string,body:unknown){const r=await fetch(base+'/api/close-report/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json','User-Agent':'MarketAtlas-Close-Job'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Report publish '+r.status+': '+await r.text());}
const chunks:ScreenCandidate[][]=[];let chunk:ScreenCandidate[]=[];for(const c of candidates){if(chunk.length&&(chunk.length>=20||Buffer.byteLength(JSON.stringify([...chunk,c]))>90000)){chunks.push(chunk);chunk=[];}chunk.push(c);}if(chunk.length)chunks.push(chunk);
await pool(chunks,3,(chunk,index)=>retry(()=>publish('chunk',{id:report.id,index,candidates:chunk})));
const {candidates:_,...metadata}=report;await retry(()=>publish('publish',{...metadata,chunks:chunks.length,count:candidates.length}));
console.log('Published shared closing report.');await summary(`Published **${report.id}**: ${candidates.length} candidates, ${report.checked} checked, ${report.failed} failed.`);
