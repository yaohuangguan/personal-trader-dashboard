import {f10} from './f10';
import {dailyTrend} from '../shared/daily-trend';
import {gainers,marketPools,dragon,chips} from './market-overview';
import { memo, quotes, intraday, history, ticks, sectors, peers, ranks, fundFlow, flash, stockNews, reports, universe, sectorScenario, industryRanks } from './desk-data';

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
    if(kind==='gainers')return respond(await memo('gainers',45,gainers));
    if(['market-pools','dragon'].includes(kind)){const date=url.searchParams.get('date')||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return respond({error:'无效交易日期'},400);return respond(await memo<unknown>(kind+date,90,()=>kind==='dragon'?dragon(date):marketPools(date)));}
    if (kind === 'universe') { const page = Number(url.searchParams.get('page') || '1'); if (!Number.isInteger(page) || page < 1 || page > 100) return respond({error:'无效证券列表页码'},400); return respond(await memo('universe:'+page,600,()=>universe(page))); }
    if (kind === 'industries') return respond(await memo('industries',300,()=>industryRanks()));
    if (kind === 'sector-scenario') { const code=url.searchParams.get('code')||'';if(!/^SN:new_[a-z0-9]{2,20}$/.test(code))return respond({error:'无效新浪行业代码'},400);return respond(await memo('scenario:'+code,300,()=>sectorScenario(code))); }
    if (kind === 'flash') return respond(await memo('flash', 45, flash));
    if (kind === 'ranks') return respond(await memo('ranks', 90, ranks));
    if (kind === 'peers') {
      const code = url.searchParams.get('code') || '';
      if (! /^(?:BK\d{4,6}|SN:new_[a-z0-9]{2,20})$/.test(code)) return respond({ error: '无效板块代码' }, 400);
      return respond(await memo('peers:' + code, 45, () => peers(code)));
    }
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)) return respond({ available: false, reason: '此公开接口暂只覆盖沪深北市场，其他市场使用原有授权行情源。' }, 400);
    if (kind === 'history') {
      const period = url.searchParams.get('period') || '';
      if (!['day','week', 'month'].includes(period)) return respond({ error: '周期须为 day、week 或 month' }, 400);
      return respond(await memo(kind + symbol + period, 600, () => history(symbol, period)));
    }
    if(kind==='f10')return respond(await memo('f10'+symbol,1800,()=>f10(symbol)));
    if(kind==='trend')return respond(await memo('trend:'+symbol,30,async()=>{
      const results=await Promise.allSettled([
        memo('history'+symbol+'day',600,()=>history(symbol,'day')),
        memo('quotes:'+symbol+',000300.SH',3,()=>quotes([symbol,'000300.SH'])),
        memo('intraday'+symbol,15,()=>intraday(symbol)),
      ]);
      if(results[0].status==='rejected')throw new Error('走势分析需要可核验日线，当前来源不可用');
      const daily=results[0].value,q=results[1].status==='fulfilled'?results[1].value.items:[];
      return dailyTrend(daily.candles,{symbol,volumeUnit:daily.volumeUnit as '股'|'手',source:daily.source,
        quote:q.find(r=>r.symbol===symbol),benchmark:q.find(r=>r.symbol==='000300.SH'),
        intraday:results[2].status==='fulfilled'?results[2].value:undefined});
    }));
    if (kind === 'chips')return respond(await memo(kind+symbol,600,()=>chips(symbol)));
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
