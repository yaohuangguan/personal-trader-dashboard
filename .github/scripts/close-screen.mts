import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {universe,quotes} from '../../src/worker/desk-data';
import {fetchScreenDaily,extendHistory,type DayData} from '../../src/worker/pattern-screen';
import {sinaBeijingDaily} from '../../src/worker/research';
import {evaluateScreen,SCREEN_MODES,DEFAULT_SCREEN} from '../../src/shared/pattern-screen';
import {beijingParts} from '../../src/shared/monitor';
import type {CloseReport} from '../../src/shared/close-report';
import type {ScreenCandidate,UniverseItem} from '../../src/shared/screening';
import type {Snapshot} from '../../src/shared/desk-types';

const started=Date.now(),cache='node_modules/.cache/atlas-close';await mkdir(cache,{recursive:true});
async function pool<T,R>(items:T[],limit:number,fn:(item:T,index:number)=>Promise<R>){let cursor=0;const out:R[]=Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;out[i]=await fn(items[i],i);}}));return out;}
async function retry<T>(fn:()=>Promise<T>){let error:unknown;for(let n=0;n<3;n++){try{return await fn();}catch(e){error=e;await new Promise(r=>setTimeout(r,500*(n+1)));}}throw error;}
const first=await retry(()=>universe(1)),pages=await pool(Array.from({length:Math.ceil(first.total/first.pageSize)-1},(_,i)=>i+2),4,p=>retry(()=>universe(p)));
const all=[...new Map([first,...pages].flatMap(p=>p.items).map(s=>[s.symbol,s])).values()];if(all.length!==first.total)throw new Error(`证券池实际${all.length}，登记${first.total}，不发布不完整名单`);
const benchmark=(await retry(()=>quotes(['000001.SH']))).items[0];if(!benchmark)throw new Error('缺少大盘交易日期');const date=benchmark.asOf.slice(0,10),today=beijingParts().date;
if(date!==today&&process.env.ALLOW_PREVIOUS_CLOSE!=='1'){console.log('No current-day market close; holiday or unavailable source. Skipped.');process.exit(0);}
if(date===today&&beijingParts().minute<920){console.log('Market is still open. No closing report published.');process.exit(0);}
const rejected:Record<string,number>={},reject=(key:string)=>rejected[key]=(rejected[key]||0)+1;
const stockPool=all.filter(s=>{if(/ST|退/i.test(s.name)){reject('排除ST与退市名称');return false;}return true;});
const batches=Array.from({length:Math.ceil(stockPool.length/60)},(_,i)=>stockPool.slice(i*60,i*60+60));const snapshots=new Map<string,Snapshot>(),failures:{symbol:string;reason:string}[]=[];
await pool(batches,4,async batch=>{try{const feed=await retry(()=>quotes(batch.map(s=>s.symbol)));for(const q of feed.items)if(q.asOf.slice(0,10)===date)snapshots.set(q.symbol,q);}catch{/* Missing quotes are explicitly recorded below. */}});
const targets=stockPool.filter(s=>{const q=snapshots.get(s.symbol);if(!q){failures.push({symbol:s.symbol,reason:'缺少同交易日快照'});return false;}if(q.amount===null||q.amount<2e8){reject('成交额不足2亿元');return false;}if(/ST|退|^(N|C)/i.test(q.name)){reject('ST、退市或新股价格限制待核验');return false;}return true;});
console.log(JSON.stringify({date,total:all.length,liquid:targets.length,snapshotFailures:failures.length}));
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
const report:CloseReport={id:date+'-'+(process.env.GITHUB_RUN_ID||Date.now()),date,generatedAt:Date.now(),total:all.length,eligible:checked+failures.length,checked,failed:failures.length,failureSample:failures.slice(0,60),rejected,candidates,complete:failures.length===0,source:'新浪全证券名单 / 腾讯同日快照、前复权与未复权日线 / 新浪北交所',elapsedMs:Date.now()-started,cacheHits};
await mkdir('close-report',{recursive:true});await writeFile('close-report/report.json',JSON.stringify(report));console.log(JSON.stringify({...report,candidates:candidates.length}));
const base=process.env.SCREEN_WORKER_URL||'https://personal-market-atlas.nzs.workers.dev',token=process.env.SCREEN_JOB_TOKEN;
if(!token)throw new Error('SCREEN_JOB_TOKEN missing; report saved but not published');
async function publish(action:string,body:unknown){const r=await fetch(base+'/api/close-report/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json','User-Agent':'MarketAtlas-Close-Job'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Report publish '+r.status+': '+await r.text());}
const chunks:ScreenCandidate[][]=[];let chunk:ScreenCandidate[]=[];for(const c of candidates){if(chunk.length&&(chunk.length>=20||Buffer.byteLength(JSON.stringify([...chunk,c]))>90000)){chunks.push(chunk);chunk=[];}chunk.push(c);}if(chunk.length)chunks.push(chunk);
await pool(chunks,3,(chunk,index)=>retry(()=>publish('chunk',{id:report.id,index,candidates:chunk})));
const {candidates:_,...metadata}=report;await retry(()=>publish('publish',{...metadata,chunks:chunks.length,count:candidates.length}));console.log('Published shared closing report.');
