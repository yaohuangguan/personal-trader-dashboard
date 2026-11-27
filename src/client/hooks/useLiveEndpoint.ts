import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, readJson } from '../http';
import { nextEndpointDelay, shouldRefetchOnResume } from './live-policy';

type LiveState<T> = { data: T | null; loading: boolean; error: string; updatedAt: number };

export function useLiveEndpoint<T>(url: string | null, intervalMs = 0, enabled = true) {
  const [state, setState] = useState<LiveState<T>>({ data: null, loading: !!url, error: '', updatedAt: 0 });
  const [revision, setRevision] = useState(0);
  const previousUrl = useRef<string | null>(null), latest = useRef(state);
  latest.current = state;
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const lastRevision = useRef(revision);
  useEffect(() => {
    const changed = previousUrl.current !== url;
    previousUrl.current = url;
    const manual = !changed && lastRevision.current !== revision;
    lastRevision.current = revision;
    // A changed URL always loads below, so it is loading even when auto-refresh is disabled.
    if (changed) setState({ data: null, loading: !!url, error: '', updatedAt: 0 });
    if (!url) return;
    let disposed = false, running = false, timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null, nextInterval = intervalMs;
    const load = async (showLoading = false) => {
      if (disposed || running || document.hidden || !navigator.onLine) return;
      running = true;
      // Manual refresh keeps the previous data visible but shows progress.
      if (showLoading) setState(old => ({ ...old, loading: true }));
      controller = new AbortController();
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; controller?.abort(); }, /analysis|trend|history|chips|market-pools|dragon|earnings/.test(url) ? 30000 : 15000);
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { accept: 'application/json' } });
        const body = await readJson<{ available?: boolean; reason?: string; error?: string }>(response);
        if (body?.available === false) throw new Error(body.reason || body.error || '数据暂不可用');
        if (!disposed) setState({ data: body as T, loading: false, error: '', updatedAt: Date.now() });
        nextInterval = nextEndpointDelay(intervalMs, body);
      } catch (error) {
        if (!disposed && (timedOut || !controller.signal.aborted)) setState(old => ({ ...old, loading: false, error: timedOut ? '请求超时，请稍后刷新' : errorText(error) }));
      } finally {
        clearTimeout(deadline);
        running = false;
        if (!disposed && enabled && intervalMs) timer = setTimeout(load, nextInterval || intervalMs);
      }
    };
    const resume = () => {
      if (!enabled || document.hidden || !navigator.onLine) return;
      const s = latest.current;
      if (!shouldRefetchOnResume({ intervalMs, updatedAt: s.updatedAt, hasData: s.data !== null, hasError: !!s.error, now: Date.now() })) return;
      clearTimeout(timer); void load();
    };
    const manualRefresh = () => { clearTimeout(timer); void load(true); };
    window.addEventListener('atlas:refresh', manualRefresh);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    if (enabled || changed || manual) void load(manual);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('atlas:refresh', manualRefresh); };
  }, [url, intervalMs, enabled, revision]);
  const matches = previousUrl.current === url;
  return { ...state, data: matches ? state.data : null, loading: matches ? state.loading : !!url, error: matches ? state.error : '', refresh };
}
