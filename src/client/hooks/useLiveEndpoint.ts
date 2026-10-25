import { useCallback, useEffect, useRef, useState } from 'react';

export function useLiveEndpoint<T>(url: string | null, intervalMs = 0, enabled = true) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string; updatedAt: number }>({ data: null, loading: !!url, error: '', updatedAt: 0 });
  const [revision, setRevision] = useState(0);
  const previousUrl = useRef<string | null>(null);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    const changed = previousUrl.current !== url;
    previousUrl.current = url;
    if (changed) setState({ data: null, loading: !!url && enabled, error: '', updatedAt: 0 });
    if (!url) return;
    let disposed = false, running = false, timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null, nextInterval = intervalMs;
    const load = async () => {
      if (disposed || running || document.hidden || !navigator.onLine) return;
      running = true;
      controller = new AbortController();
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; controller?.abort(); }, 15000);
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || body.available === false) throw new Error(body.reason || body.error || '数据暂不可用');
        if (!disposed) setState({ data: body as T, loading: false, error: '', updatedAt: Date.now() });
        if (intervalMs > 0 && intervalMs <= 5000 && Array.isArray(body.items) && body.items.length && body.items.every((q: { session?: string }) => q.session === 'closed')) nextInterval = 30000;
        else nextInterval = intervalMs;
      } catch (error) {
        if (!disposed && (timedOut || !controller.signal.aborted)) setState(old => ({ ...old, loading: false, error: timedOut ? '请求超时，请稍后刷新' : error instanceof Error ? error.message : '连接暂不可用' }));
      } finally {
        clearTimeout(deadline);
        running = false;
        if (!disposed && enabled && intervalMs) timer = setTimeout(load, nextInterval || intervalMs);
      }
    };
    const resume = () => { if (enabled && !document.hidden && navigator.onLine) { clearTimeout(timer); void load(); } };
    const manualRefresh = () => { clearTimeout(timer); void load(); };
    window.addEventListener('atlas:refresh', manualRefresh);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    if (enabled || changed || revision > 0) void load();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('atlas:refresh', manualRefresh); };
  }, [url, intervalMs, enabled, revision]);
  const matches = previousUrl.current === url;
  return { ...state, data: matches ? state.data : null, loading: matches ? state.loading : !!url, error: matches ? state.error : '', refresh };
}
