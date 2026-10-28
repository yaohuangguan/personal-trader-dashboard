import {filterReport} from '../../shared/close-report';
import {DEFAULT_SCREEN,multiParams,type ScreenOptions} from '../../shared/pattern-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuotesPayload } from '../../shared/desk-types';
import type { UniverseItem, UniversePage, ScreenCandidate } from '../../shared/screening';

export type ScanScope = 'quick' | 'all' | 'watchlist';
export type ScanState = { schema: 2; sharedCandidates?:ScreenCandidate[];options:ScreenOptions;rejected:Record<string,number>; scope: ScanScope; phase: 'idle' | 'universe' | 'scanning' | 'paused' | 'complete'; universe: UniverseItem[]; total: number; nextPage: number; universeComplete: boolean; targets: UniverseItem[]; cursor: number; candidates: ScreenCandidate[]; failed: string[]; failedReasons: Record<string,string>; historyElapsedMs: number; insufficient: number; excludeST: boolean; minAmount: number; startedAt: number; updatedAt: number; elapsedMs: number; message: string };
const blank = (): ScanState => ({ schema: 2,options:DEFAULT_SCREEN,rejected:{}, scope: 'quick', phase: 'idle', universe: [], total: 0, nextPage: 1, universeComplete: false, targets: [], cursor: 0, candidates: [], failed: [], failedReasons: {}, historyElapsedMs: 0, insufficient: 0, excludeST: true, minAmount: 2e8, startedAt: 0, updatedAt: 0, elapsedMs: 0, message: '' });
const KEY = 'pattern-screen-v2';
async function storage(action: 'read' | 'write', value?: ScanState): Promise<ScanState | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('atlas-screener', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('sessions');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('sessions', action === 'read' ? 'readonly' : 'readwrite');
      const request = action === 'read' ? tx.objectStore('sessions').get(KEY) : tx.objectStore('sessions').put(value, KEY);
      let saved: ScanState | undefined;
      request.onsuccess = () => { if (action === 'read') saved = request.result as ScanState; };
      tx.oncomplete = () => { db.close(); resolve(saved); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
function quickTargets(items: UniverseItem[], excludeST: boolean, minAmount: number) {
  const eligible = items.filter(s => s.price !== null && s.price > 0 && (!excludeST || !/ST|退/i.test(s.name)) && s.amount !== null && s.amount >= minAmount);
  return [...eligible].sort((a,b)=>(b.turnover??0)-(a.turnover??0)||Math.abs(b.changePercent??0)-Math.abs(a.changePercent??0)).slice(0,200);
}
export function useScreener() {
  const [state, setState] = useState<ScanState>(blank), [hydrated, setHydrated] = useState(false), [storageError, setStorageError] = useState('');
  const current = useRef(state), control = useRef<AbortController | null>(null), worker = useRef<Worker | null>(null), mounted = useRef(true);
  const publish = useCallback((value: ScanState) => { current.current = value; if (mounted.current) setState(value); }, []);
  const save = useCallback(async (value: ScanState) => { try { await storage('write', value); } catch { if (mounted.current) setStorageError('浏览器存储不可用；当前结果仍可查看，请导出保存，关页后可能无法续扫。'); } }, []);
  const pause = useCallback(() => { control.current?.abort(); const value = current.current; if (['universe', 'scanning'].includes(value.phase)) { const paused = { ...value, phase: 'paused' as const, updatedAt: Date.now(), message: '已暂停，可继续；结果保存在当前浏览器。' }; publish(paused); void save(paused); } }, [publish, save]);
  useEffect(() => {
    mounted.current = true;
    void storage('read').then(saved => {
      if (!mounted.current) return;
      if (saved?.schema === 2 && Array.isArray(saved.universe) && saved.universe.length <= 8000 && Array.isArray(saved.targets) && saved.targets.length <= 8000 && Array.isArray(saved.candidates) && saved.cursor >= 0 && saved.cursor <= saved.targets.length) publish({ ...blank(), ...saved, phase: ['universe', 'scanning'].includes(saved.phase) ? 'paused' : saved.phase });
    }).catch(() => { if (mounted.current) setStorageError('此浏览器暂不能保存扫描进度，建议完成后导出候选。'); }).finally(() => { if (mounted.current) setHydrated(true); });
    const hidden = () => { if (document.hidden) pause(); };
    const offline = () => pause();
    document.addEventListener('visibilitychange', hidden); window.addEventListener('offline', offline);
    return () => { pause(); mounted.current = false; worker.current?.terminate(); worker.current = null; document.removeEventListener('visibilitychange', hidden); window.removeEventListener('offline', offline); };
  }, [pause, publish]);
  const run = useCallback(async (initial: ScanState) => {
    if (control.current || document.hidden || !navigator.onLine) return;
    const ac = new AbortController(); control.current = ac;
    let active = { ...initial }, segmentStart = performance.now(), previousElapsed = initial.elapsedMs, historyStart: number | null = initial.universeComplete ? performance.now() : null, previousHistory = initial.historyElapsedMs || 0, consecutiveFailures = 0;
    const update = (changes: Partial<ScanState>) => { active = { ...active, ...changes, updatedAt: Date.now(), elapsedMs: previousElapsed + performance.now() - segmentStart, historyElapsedMs: previousHistory + (historyStart === null ? 0 : performance.now() - historyStart) }; publish(active); };
    const fetchJson = async <T,>(url: string) => { const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([ac.signal, AbortSignal.timeout(35000)]) }); const result = await response.json(); if (!response.ok || result.available === false || result.error) throw new Error(String(result.reason || result.error || '数据暂不可用') + (result.details ? '：' + String(result.details).replace(/(api[_-]?key|token|secret)=[^ &]+/gi,'$1=[redacted]').slice(0,240) : '')); return result as T; };
    try {
      if(active.scope!=='watchlist'){
        const response=await fetch('/api/desk/screen-job',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.any([ac.signal,AbortSignal.timeout(12000)])});
        if(!response.ok)throw new Error('服务端扫描任务暂不可用');
        type Job={phase:string;cursor:number;targets:number;total:number;registered:number;message:string;id:string;candidateCount:number;rejected:Record<string,number>;failureSample:{symbol:string;reason:string}[]};
        let result=await response.json() as {job:Job;candidates:ScreenCandidate[]};
        while(!ac.signal.aborted){const job=result.job;
          update({phase:job.phase==='screening'?'scanning':job.phase==='quotes'?'universe':job.phase as ScanState['phase'],cursor:job.cursor,total:job.total,universeComplete:job.phase!=='universe',targets:Array.from({length:job.targets},()=>({symbol:'',name:'',price:null,changePercent:null,amount:null,turnover:null})),sharedCandidates:result.candidates??active.sharedCandidates,candidates:filterReport({candidates:result.candidates??active.sharedCandidates??[]},active.options),rejected:job.rejected,failed:job.failureSample.map(f=>f.symbol),failedReasons:Object.fromEntries(job.failureSample.map(f=>[f.symbol,f.reason])),message:job.message+' · 关闭页面后服务端继续处理'});
          await save(active);if(['complete','paused'].includes(job.phase))return;
          await new Promise<void>((resolve,reject)=>{const id=setTimeout(resolve,2000);ac.signal.addEventListener('abort',()=>{clearTimeout(id);reject(ac.signal.reason);},{once:true});});
          result=await fetchJson('/api/desk/screen-job?id='+encodeURIComponent(job.id)+'&count='+job.candidateCount);
        }
        return;
      }
      if (!active.universeComplete) {
        update({ phase: 'universe', message: '正在分页读取沪深北证券池，尚未声称全市场覆盖。' });
        for (let page=active.nextPage;page<=100&&!ac.signal.aborted;page=active.nextPage){
          const pages=await Promise.all(Array.from({length:Math.min(4,101-page,active.total?Math.max(1,Math.ceil(active.total/80)-page+1):1)},(_,i)=>fetchJson<UniversePage>('/api/desk/universe?page='+(page+i))));
          ac.signal.throwIfAborted();let universe=active.universe,complete=false,nextPage=page;
          for(const result of pages){universe=[...new Map([...universe,...result.items].map(r=>[r.symbol,r])).values()];nextPage=result.page+1;if((result.sourceRows??result.items.length)<result.pageSize||universe.length>=result.total){complete=true;break;}}
          update({universe,total:pages[0].total,nextPage,universeComplete:complete});await save(active);if(complete)break;
          if(page+4>100)throw new Error('证券池超过已验证范围，进度已保留');
        }
      }
      if (ac.signal.aborted) return;
      if (historyStart === null) historyStart = performance.now();
      if (active.scope === 'watchlist' && !active.targets.length && !active.cursor && active.universe.length) {
        update({phase:'universe',message:'正在核验自选快照与名称。'});
        const batch=await fetchJson<QuotesPayload>('/api/desk/quotes?symbols='+active.universe.map(s=>s.symbol).join(','));
        const book=new Map(batch.items.map(q=>[q.symbol,q]));
        update({universe:active.universe.map(s=>{const q=book.get(s.symbol);return {...s,name:q?.name||s.name,price:q?.price??null,changePercent:q?.changePercent??null,amount:q?.amount??null,turnover:q?.turnover??null};})});
      }
      if (!active.targets.length && !active.cursor) update({ targets: active.universe.filter(s => (active.scope === 'watchlist' || s.price !== null && s.price > 0) && (!active.excludeST || !/ST|退/i.test(s.name)) && (s.amount || 0) >= 2e8) });
      update({ phase: 'scanning', message: '使用原始日线逐只核验，已命中候选会持续显示。' });
      for(let index=active.cursor;index<active.targets.length;index+=4){
        ac.signal.throwIfAborted();const batch=active.targets.slice(index,index+4),params=new URLSearchParams({...multiParams(active.options.multi),symbols:batch.map(s=>s.symbol).join(','),modes:active.options.modes.join(','),strategy:active.options.auto?'auto':'patterns',concentration:String(active.options.concentration),recentLimitUp:active.options.recentLimitUp?'1':'0',maxCap:active.options.maxMarketCap===null?'':String(active.options.maxMarketCap/1e8),activity:active.options.activity?'1':'0'});
        try{
          const output=await fetchJson<{items:{symbol:string;candidate:ScreenCandidate|null;reason?:string;unverified?:boolean}[]}>('/api/desk/screen-batch?'+params);ac.signal.throwIfAborted();
          for(const item of output.items){
            if(item.unverified){consecutiveFailures++;update({failed:[...new Set([...active.failed,item.symbol])],failedReasons:{...active.failedReasons,[item.symbol]:item.reason||'来源失败'}});}
            else{consecutiveFailures=0;if(item.candidate)update({candidates:[...active.candidates.filter(c=>c.symbol!==item.symbol),item.candidate]});else if(item.reason)update({rejected:{...active.rejected,[item.reason]:(active.rejected[item.reason]||0)+1}});}
          }
        }catch(error){if(ac.signal.aborted)throw error;consecutiveFailures+=batch.length;const reason=error instanceof Error?error.message:'来源失败';update({failed:[...new Set([...active.failed,...batch.map(s=>s.symbol)])],failedReasons:{...active.failedReasons,...Object.fromEntries(batch.map(s=>[s.symbol,reason]))}});}
        update({cursor:index+batch.length,message:'每批并行核验4只，收盘任务按交易日期复用历史缓存。 '});await save(active);
        if(consecutiveFailures>=5){update({phase:'paused',message:'来源连续失败，已暂停并保留进度；失败不等于没有形态。'});return;}
      }
      update({ phase: 'complete', message: '当前范围已处理完毕；失败标的和样本不足标的单独列出，未视为通过或全覆盖。' });
    } catch (error) {
      update({ phase: 'paused', message: ac.signal.aborted ? '扫描已暂停，可继续。' : error instanceof Error ? error.message + '，进度已保留。' : '扫描暂不可用，进度已保留。' });
    } finally {
      if (ac.signal.aborted && ['universe', 'scanning'].includes(active.phase)) update({ phase: 'paused' });
      await save(active); control.current = null;
    }
  }, [publish, save]);
  const start = useCallback((scope: ScanScope, watchlist: string[], excludeST: boolean, minAmount: number, options:ScreenOptions=DEFAULT_SCREEN) => {
    if (!hydrated || control.current) return;
    const initial = { ...blank(), scope, excludeST, minAmount:Math.max(2e8,minAmount),options, startedAt: Date.now() };
    if (scope === 'watchlist') { initial.universe = watchlist.filter(s => /^\d{6}\.(SH|SZ|BJ)$/.test(s)).map(symbol => ({ symbol, name: symbol, price: null, changePercent: null, amount: null, turnover: null })); initial.total = initial.universe.length; initial.universeComplete = true; initial.minAmount = 2e8; }
    publish(initial); void run(initial);
  }, [hydrated, publish, run]);
  const resume = useCallback(() => { void run(current.current); }, [run]);
  return { state, hydrated, storageError, start, pause, resume, busy: ['universe', 'scanning'].includes(state.phase) };
}
