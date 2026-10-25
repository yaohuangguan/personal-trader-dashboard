import { memo, quotes, intraday, history, ticks, sectors, peers, ranks, fundFlow, flash, stockNews, reports } from './desk-data';

export async function deskRoute(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/desk/')) return null;
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  if (request.method !== 'GET') return respond({ error: 'Method not allowed' }, 405);
  const symbol = url.searchParams.get('symbol') || '';
  const kind = url.pathname.slice('/api/desk/'.length);
  try {
    if (kind === 'quotes') {
      const symbols = [...new Set((url.searchParams.get('symbols') || '').split(',').filter(Boolean))].sort();
      if (!symbols.length || symbols.length > 60 || symbols.some(s => !/^\d{6}\.(SH|SZ|BJ)$/.test(s))) return respond({ error: '请提供1至60个带市场后缀的证券代码' }, 400);
      return respond(await memo('quotes:' + symbols.join(','), 3, () => quotes(symbols)));
    }
    if (kind === 'flash') return respond(await memo('flash', 45, flash));
    if (kind === 'ranks') return respond(await memo('ranks', 90, ranks));
    if (kind === 'peers') {
      const code = url.searchParams.get('code') || '';
      if (!/^BK\d{4,6}$/.test(code)) return respond({ error: '无效板块代码' }, 400);
      return respond(await memo('peers:' + code, 45, () => peers(code)));
    }
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)) return respond({ available: false, reason: '此公开接口暂只覆盖沪深北市场，其他市场使用原有授权行情源。' }, 400);
    if (kind === 'history') {
      const period = url.searchParams.get('period') || '';
      if (!['week', 'month'].includes(period)) return respond({ error: '周期须为 week 或 month' }, 400);
      return respond(await memo(kind + symbol + period, 600, () => history(symbol, period)));
    }
    if (kind === 'intraday') return respond(await memo(kind + symbol, 15, () => intraday(symbol)));
    if (kind === 'ticks') return respond(await memo(kind + symbol, 15, () => ticks(symbol)));
    if (kind === 'sectors') return respond(await memo(kind + symbol, 300, () => sectors(symbol)));
    if (kind === 'flow') return respond(await memo(kind + symbol, 45, () => fundFlow(symbol)));
    if (kind === 'stock-news') return respond(await memo(kind + symbol, 120, () => stockNews(symbol)));
    if (kind === 'reports') return respond(await memo(kind + symbol, 1800, () => reports(symbol)));
    return respond({ error: 'Unknown desk endpoint' }, 404);
  } catch (error) {
    return respond({ available: false, reason: error instanceof Error ? error.message : '数据源暂不可用', fetchedAt: new Date().toISOString() }, 502);
  }
}
