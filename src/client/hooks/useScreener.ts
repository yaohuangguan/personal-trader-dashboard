import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuotesPayload } from '../../shared/desk-types';
import type { MarketPayload } from '../../shared/types';
import type { UniverseItem, UniversePage, ScreenCandidate } from '../../shared/screening';

export type ScanScope = 'quick' | 'all' | 'watchlist';
export type ScanState = { schema: 1; scope: ScanScope; phase: 'idle' | 'universe' | 'scanning' | 'paused' | 'complete'; universe: UniverseItem[]; total: number; nextPage: number; universeComplete: boolean; targets: UniverseItem[]; cursor: number; candidates: ScreenCandidate[]; failed: string[]; failedReasons: Record<string,string>; historyElapsedMs: number; insufficient: number; excludeST: boolean; minAmount: number; startedAt: number; updatedAt: number; elapsedMs: number; message: string };
const blank = (): ScanState => ({ schema: 1, scope: 'quick', phase: 'idle', universe: [], total: 0, nextPage: 1, universeComplete: false, targets: [], cursor: 0, candidates: [], failed: [], failedReasons: {}, historyElapsedMs: 0, insufficient: 0, excludeST: true, minAmount: 2e8, startedAt: 0, updatedAt: 0, elapsedMs: 0, message: '' });
const KEY = 'guide-v10.4-session';
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
function rest(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Paused', 'AbortError')); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
function quickTargets(items: UniverseItem[], excludeST: boolean, minAmount: number) {
  const eligible = items.filter(s => s.price !== null && s.price > 0 && (!excludeST || !/ST|退/i.test(s.name)) && s.amount !== null && s.amount >= minAmount);
  const calm = eligible.filter(s => s.changePercent !== null && Math.abs(s.changePercent) <= 2).sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 100);
  const momentum = eligible.filter(s => !calm.some(c => c.symbol === s.symbol)).sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0)).slice(0, 200 - calm.length);
  return [...calm, ...momentum];
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
      if (saved?.schema === 1 && Array.isArray(saved.universe) && saved.universe.length <= 8000 && Array.isArray(saved.targets) && saved.targets.length <= 8000 && Array.isArray(saved.candidates) && saved.cursor >= 0 && saved.cursor <= saved.targets.length) publish({ ...blank(), ...saved, phase: ['universe', 'scanning'].includes(saved.phase) ? 'paused' : saved.phase });
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
    const fetchJson = async <T,>(url: string) => { const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([ac.signal, AbortSignal.timeout(18000)]) }); const result = await response.json(); if (!response.ok || result.available === false || result.error) throw new Error(String(result.reason || result.error || '数据暂不可用') + (result.details ? '：' + String(result.details).replace(/(api[_-]?key|token|secret)=[^ &]+/gi,'$1=[redacted]').slice(0,240) : '')); return result as T; };
    try {
      if (!active.universeComplete) {
        update({ phase: 'universe', message: '正在分页读取沪深北证券池，尚未声称全市场覆盖。' });
        for (let page = active.nextPage; !ac.signal.aborted; page++) {
          const result = await fetchJson<UniversePage>('/api/desk/universe?page=' + page);
          const universe = [...new Map([...active.universe, ...result.items].map(r => [r.symbol, r])).values()];
          update({ universe, total: result.total, nextPage: page + 1 });
          if ((result.sourceRows ?? result.items.length) < result.pageSize) { update({ universeComplete: true }); break; }
          if (page >= 100) throw new Error('证券池超过已验证的8000条范围，停止并保留已读进度');
          if (page % 4 === 0) await save(active);
          await rest(900, ac.signal);
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
      if (!active.targets.length && !active.cursor) update({ targets: active.scope === 'quick' ? quickTargets(active.universe, active.excludeST, active.minAmount) : active.universe.filter(s => (active.scope === 'watchlist' || s.price !== null && s.price > 0) && (!active.excludeST || !/ST|退/i.test(s.name)) && (active.scope === 'all' || active.minAmount === 0 || (s.amount || 0) >= active.minAmount)) });
      update({ phase: 'scanning', message: '使用原始日线逐只核验，已命中候选会持续显示。' });
      if (!worker.current) worker.current = new Worker(new URL('../workers/screener-worker.ts', import.meta.url), { type: 'module' });
      for (let index = active.cursor; index < active.targets.length; index++) {
        ac.signal.throwIfAborted();
        const stock = active.targets[index];
        try {
          const market = await fetchJson<MarketPayload>('/api/market?symbol=' + stock.symbol);
          if (!Array.isArray(market.candles) || !market.candles.length) throw new Error('缺少原始日线');
          if (market.stale || !market.asOf || Date.now() - Date.parse(market.asOf + 'T00:00:00Z') > 7 * 86400000) throw new Error('日线超过7天或来源标记过期');
          const output = await new Promise<{ candidate: ScreenCandidate | null; insufficient: boolean; invalid: boolean }>((resolve, reject) => {
            const id = crypto.randomUUID(), w = worker.current!;
            const clean = () => { w.removeEventListener('message', receive); w.removeEventListener('error', failed); ac.signal.removeEventListener('abort', stopped); };
            const receive = (event: MessageEvent) => { if (event.data.id !== id) return; clean(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data); };
            const failed = () => { clean(); reject(new Error('形态计算器加载失败')); };
            const stopped = () => { clean(); reject(new DOMException('Paused', 'AbortError')); };
            w.addEventListener('message', receive); w.addEventListener('error', failed); ac.signal.addEventListener('abort', stopped, { once: true }); w.postMessage({ id, stock, market });
          });
          if (output.invalid) throw new Error('日线格式无效');
          consecutiveFailures = 0;
          update({ cursor: index + 1, candidates: output.candidate ? [...active.candidates.filter(c => c.symbol !== stock.symbol), output.candidate] : active.candidates, insufficient: active.insufficient + Number(output.insufficient) });
        } catch (error) {
          if (ac.signal.aborted) throw error;
          consecutiveFailures++;
          const reason=error instanceof Error?error.message:'日线不可用';
          update({ cursor: index + 1, failed: [...new Set([...active.failed, stock.symbol])], failedReasons:{...active.failedReasons,[stock.symbol]:reason}, message: stock.symbol + ' 日线不可用，已单独记为未完成。' });
          if (consecutiveFailures >= 5) {update({phase:'paused',message:'连续5只日线请求失败，已暂停并保存进度；稍后可继续，失败标的保留原因，不视为形态未命中。'});return;}
        }
        if (index % 8 === 0) await save(active);
        await rest(900, ac.signal);
      }
      update({ phase: 'complete', message: '当前范围已处理完毕；失败标的和样本不足标的单独列出，未视为通过或全覆盖。' });
    } catch (error) {
      update({ phase: 'paused', message: ac.signal.aborted ? '扫描已暂停，可继续。' : error instanceof Error ? error.message + '，进度已保留。' : '扫描暂不可用，进度已保留。' });
    } finally {
      if (ac.signal.aborted && ['universe', 'scanning'].includes(active.phase)) update({ phase: 'paused' });
      await save(active); control.current = null;
    }
  }, [publish, save]);
  const start = useCallback((scope: ScanScope, watchlist: string[], excludeST: boolean, minAmount: number) => {
    if (!hydrated || control.current) return;
    const initial = { ...blank(), scope, excludeST, minAmount, startedAt: Date.now() };
    if (scope === 'watchlist') { initial.universe = watchlist.filter(s => /^\d{6}\.(SH|SZ|BJ)$/.test(s)).map(symbol => ({ symbol, name: symbol, price: null, changePercent: null, amount: null, turnover: null })); initial.total = initial.universe.length; initial.universeComplete = true; initial.minAmount = 0; }
    publish(initial); void run(initial);
  }, [hydrated, publish, run]);
  const resume = useCallback(() => { void run(current.current); }, [run]);
  return { state, hydrated, storageError, start, pause, resume, busy: ['universe', 'scanning'].includes(state.phase) };
}
