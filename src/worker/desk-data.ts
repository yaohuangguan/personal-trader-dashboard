// HTTP adapters ported from a-stock-data v3.10.3 (Apache-2.0).
// https://github.com/simonlin1212/a-stock-data -- public snapshots are NOT exchange Level-2.
import { createHash } from 'node:crypto';
import { normalizeSymbol } from '../shared/catalog';
import type { Candle } from '../shared/types';
import { sectorBreadth, type SectorMember } from '../shared/screening';
import { marketSession, type Snapshot, type Tick, type IntradayPoint, type Sector, type Peer, type FlashItem, type SourceStamp } from '../shared/desk-types';

type Row = Record<string, unknown>;
const UA = 'Mozilla/5.0';
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export async function memo<T>(key: string, seconds: number, action: () => Promise<T>): Promise<T> {
  const saved = cache.get(key);
  if (saved && saved.until > Date.now()) return saved.value as T;
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const work = action().then(value => {
    if (cache.size > 300) cache.clear();
    cache.set(key, { until: Date.now() + seconds * 1000, value }); return value;
  }).finally(() => pending.delete(key));
  pending.set(key, work); return work;
}
export const num = (value: unknown): number | null => value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const clean = (value: unknown) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const cnDate = (v: string) => /^\d{8}$/.test(v) ? v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8) : null;
export function chineseSymbol(input: string) {
  const symbol = normalizeSymbol(input);
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)) throw new Error('该公开接口支持沪深北证券代码；其他市场保留已配置的行情源。');
  return { symbol, code: symbol.slice(0, 6), wire: symbol.slice(-2).toLowerCase() + symbol.slice(0, 6), secid: (symbol.endsWith('.SH') ? '1.' : '0.') + symbol.slice(0, 6) };
}
async function request(url: string, timeout = 9000) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Referer: url.includes('eastmoney') ? 'https://quote.eastmoney.com/' : 'https://gu.qq.com/' }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('数据源 HTTP ' + response.status);
  return response;
}
let nextEastmoneyStart = 0;
async function eastmoney(url: string, timeout = 9000) {
  // Keep the wait in the calling request's context. A cross-request promise
  // queue can retain a timer after its owner request has already completed.
  const delay = Math.max(0, nextEastmoneyStart - Date.now());
  if (delay > 4500) throw new Error('数据源访问保护中，请稍后刷新');
  nextEastmoneyStart = Date.now() + delay + 900;
  if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
  return request(url, timeout);
}
async function listData(url: string) {
  let failure: unknown;
  for (const endpoint of [url, url.replace('https://push2.eastmoney.com/', 'https://push2delay.eastmoney.com/')]) {
    try {
      const payload = await (await eastmoney(endpoint, 4000)).json() as { data?: { diff?: unknown } };
      if (!payload.data?.diff) throw new Error('板块列表源暂未返回数据');
      return { data: payload.data, sourceUrl: endpoint, delayMinutes: endpoint === url ? 0 : 15 };
    } catch (error) { failure = error; }
  }
  throw failure;
}
function emUrl(path: string, parameters: Record<string, string>) { return 'https://push2.eastmoney.com/api/qt/' + path + '?' + new URLSearchParams({ fltt: '2', invt: '2', ...parameters }); }
const stamp = (source: string, sourceUrl: string): SourceStamp => ({ source, sourceUrl, fetchedAt: new Date().toISOString(), available: true });
const rowList = (value: unknown): Row[] => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) as Row[] : [];

export function parseQuotes(text: string, now = new Date()): Snapshot[] {
  const result: Snapshot[] = [];
  for (const match of text.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
    const wire = match[1], f = match[2].split('~');
    const price = num(f[3]), previous = num(f[4]);
    if (f.length < 53 || price === null || price <= 0 || previous === null || !/^\d{14}$/.test(f[30])) continue;
    const date = cnDate(f[30].slice(0, 8))!;
    const asOf = date + 'T' + f[30].slice(8, 10) + ':' + f[30].slice(10, 12) + ':' + f[30].slice(12, 14) + '+08:00';
    if (!Number.isFinite(Date.parse(asOf))) continue;
    const session = marketSession(now), age = now.getTime() - Date.parse(asOf);
    const levels = (start: number) => Array.from({ length: 5 }, (_, i) => ({ price: (num(f[start + i * 2]) ?? 0) > 0 ? num(f[start + i * 2]) : null, volume: num(f[start + i * 2 + 1]) }));
    result.push({ symbol: wire.slice(2) + '.' + wire.slice(0, 2).toUpperCase(), name: f[1], price, previous,
      open: num(f[5]), high: num(f[33]), low: num(f[34]), change: num(f[31]), changePercent: num(f[32]),
      volume: num(f[6]), amount: num(f[37]) === null ? null : num(f[37])! * 10000,
      turnover: num(f[38]), pe: num(f[39]), pb: num(f[46]), marketCap: num(f[45]) === null ? null : num(f[45])! * 1e8,
      floatCap: num(f[44]) === null ? null : num(f[44])! * 1e8, volumeRatio: num(f[49]), limitUp: num(f[47]), limitDown: num(f[48]),
      asOf, session, stale: age < -60000 || age > 7 * 86400000 || session === 'trading' && age > 120000,
      bids: levels(9), asks: levels(19), volumeUnit: /^68[89]/.test(wire.slice(2)) ? '股' : '手' });
  }
  return result;
}
export async function quotes(symbols: string[]) {
  const resolved = symbols.map(chineseSymbol), url = 'https://qt.gtimg.cn/q=' + resolved.map(s => s.wire).join(',');
  const response = await request(url);
  const items = parseQuotes(new TextDecoder('gbk').decode(await response.arrayBuffer()));
  if (!items.length) throw new Error('行情源没有返回有效快照');
  return { ...stamp('腾讯财经公开快照', url), items, unavailable: resolved.map(s => s.symbol).filter(s => !items.some(q => q.symbol === s)), level2: false as const, depth: 5 as const };
}
export async function intraday(raw: string) {
  const { symbol, wire } = chineseSymbol(raw);
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + wire;
  const payload = await (await request(url)).json() as { data?: Record<string, { data?: { date?: string; data?: string[] }; qt?: Record<string, string[]> }> };
  const node = payload.data?.[wire], date = cnDate(node?.data?.date || '');
  if (!date || !Array.isArray(node?.data?.data)) throw new Error('分时源缺少交易日期或数据');
  let prior = 0;
  const points: IntradayPoint[] = [];
  for (const row of node.data.data) {
    const [clock, p, v, amount] = row.trim().split(/\s+/), price = num(p), cumulativeVolume = num(v);
    if (!/^\d{4}$/.test(clock) || !price || cumulativeVolume === null || cumulativeVolume < prior) throw new Error('分时价格或累计成交量格式异常');
    points.push({ time: Date.parse(date + 'T' + clock.slice(0, 2) + ':' + clock.slice(2) + ':00+08:00') / 1000, clock: clock.slice(0, 2) + ':' + clock.slice(2), price, volume: cumulativeVolume - prior, cumulativeVolume, amount: num(amount) });
    prior = cumulativeVolume;
  }
  if (!points.length) throw new Error('暂无有效分时');
  return { ...stamp('腾讯财经公开分时', url), symbol, date, previous: num(node.qt?.[wire]?.[4]), points };
}
export async function history(raw: string, period: string) {
  const { symbol, wire } = chineseSymbol(raw);
  if (!['week', 'month'].includes(period) || symbol.endsWith('.BJ')) throw new Error('此历史接口支持沪深周线和月线');
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + wire + ',' + period + ',,,500,qfq';
  const payload = await (await request(url)).json() as { data?: Record<string, Record<string, string[][]>> };
  const node = payload.data?.[wire], rows = node?.['qfq' + period] ?? node?.[period];
  if (!Array.isArray(rows)) throw new Error('历史周期响应格式变化');
  const candles: Candle[] = rows.map(r => {
    const [date, open, close, high, low, volume] = r;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || [open, close, high, low, volume].some(v => num(v) === null) || Math.min(Number(open), Number(close), Number(high), Number(low)) <= 0) throw new Error('来源含无效或非正复权价格');
    return { time: date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) };
  }).sort((a, b) => a.time.localeCompare(b.time));
  if (candles.length < 2) throw new Error('来源历史样本不足');
  return { ...stamp('腾讯财经前复权' + (period === 'week' ? '周线' : '月线'), url), symbol, candles, period };
}
export function parseTickPage(text: string, wire: string, page: number): Tick[] {
  const match = new RegExp('^v_detail_data_' + wire + '=\\[(\\d+),"([^"]*)"\\];?$').exec(text.trim());
  if (!match || Number(match[1]) !== page) throw new Error('分笔分页响应格式变化');
  return match[2] ? match[2].split('|').map(line => {
    const [seq, time, price, , volume, amount, side] = line.split('/');
    if (!/^\d{2}:\d{2}:\d{2}$/.test(time) || !['B', 'S', 'M'].includes(side) || [seq, price, volume, amount].some(v => num(v) === null)) throw new Error('分笔记录格式变化');
    return { sequence: Number(seq), time, price: Number(price), volume: Number(volume), amount: Number(amount), side: side as Tick['side'] };
  }) : [];
}
export async function ticks(raw: string) {
  const { symbol, wire } = chineseSymbol(raw);
  if (symbol.endsWith('.BJ') || wire.startsWith('sh000') || wire.startsWith('sz399')) throw new Error('该分笔接口不覆盖北交所和指数');
  const base = 'https://stock.gtimg.cn/data/index.php?appn=detail&c=' + wire;
  const listing = new TextDecoder('gbk').decode(await (await request(base + '&action=pages')).arrayBuffer());
  const match = new RegExp('v_detail_time_' + wire + '=\\[(\\d{8}),"([^"]*)"\\]').exec(listing);
  if (!match || !match[2]) throw new Error('来源未提供最近交易日分笔');
  const page = match[2].split('|').length - 1;
  if (page > 299) throw new Error('分笔页数超出已验证范围');
  const text = new TextDecoder('gbk').decode(await (await request(base + '&action=data&p=' + page)).arrayBuffer());
  const items = parseTickPage(text, wire, page).sort((a, b) => b.sequence - a.sequence);
  return { ...stamp('腾讯财经成交分笔（约3秒聚合）', base), symbol, date: cnDate(match[1]), items, partial: true as const, level2: false as const, volumeUnit: '手' as const };
}
function mapSector(row: Row): Sector {
  const leaderCode = String(row.f140 || '');
  return { code: String(row.f12 || ''), name: String(row.f14 || ''), changePercent: num(row.f3), leader: String(row.f128 || row.f204 || ''), leaderSymbol: /^\d{6}$/.test(leaderCode) ? leaderCode + (Number(row.f141) === 1 ? '.SH' : '.SZ') : null, mainNet: num(row.f62) };
}
export async function sectors(raw: string) {
  const { symbol, secid } = chineseSymbol(raw);
  const url = emUrl('slist/get', { secid, spt: '3', pi: '0', pz: '100', po: '1', fields: 'f12,f14,f3,f128,f140,f141' });
  const data = await (await eastmoney(url)).json() as { data?: { diff?: unknown } };
  if (!data.data) throw new Error('板块归属源暂未返回数据');
  return { ...stamp('东方财富板块归属', url), symbol, boards: rowList(data.data.diff).map(mapSector).filter(s => /^BK\d+$/.test(s.code)) };
}
export function parseSinaIndustries(text: string): Sector[] {
  const begin = text.indexOf('{');
  if (begin < 0) throw new Error('新浪行业格式异常');
  const raw = JSON.parse(text.slice(begin).trim().replace(/;$/, '')) as Record<string, string>;
  return Object.values(raw).map(value => {
    const r = value.split(',');
    if (!/^new_[a-z0-9]+$/.test(r[0]) || !r[1] || num(r[5]) === null) throw new Error('新浪行业记录异常');
    return { code: 'SN:' + r[0], name: r[1], changePercent: num(r[5]), leader: r[12] || '', leaderSymbol: /^(sh|sz)\d{6}$/.test(r[8]) ? r[8].slice(2) + '.' + r[8].slice(0, 2).toUpperCase() : null };
  }).sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
}
export async function industryRanks(fallback = false) {
  const url = 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php';
  const response = await request(url, 5000);
  const allItems = parseSinaIndustries(new TextDecoder('gbk').decode(await response.arrayBuffer()));
  const items = fallback ? allItems.slice(0, 20) : allItems;
  if (!items.length) throw new Error('新浪行业暂无数据');
  return { ...stamp('新浪行业公开行情（来源未提供交易日期）', url), items, classification: 'sina-industry', notice: (fallback ? '东方财富列表暂不可用，已切换新浪行业口径；' : '独立使用新浪行业口径；') + '两者分类与成分不同。' };
}
async function sinaPeers(code: string) {
  if (!/^SN:new_[a-z0-9]{2,20}$/.test(code)) throw new Error('无效新浪行业代码');
  const url = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?' + new URLSearchParams({ page: '1', num: '16', sort: 'changepercent', asc: '0', node: code.slice(3), symbol: '' });
  const response = await request(url, 6000);
  const raw = JSON.parse(new TextDecoder('gbk').decode(await response.arrayBuffer())) as Row[];
  if (!Array.isArray(raw)) throw new Error('新浪行业成分格式异常');
  const items: Peer[] = raw.filter(r => /^(sh|sz)\d{6}$/.test(String(r.symbol))).map(r => { const wire = String(r.symbol); return { symbol: wire.slice(2) + '.' + wire.slice(0, 2).toUpperCase(), name: clean(r.name), price: num(r.trade), changePercent: num(r.changepercent), mainNet: null }; });
  return { ...stamp('新浪行业成分公开行情（来源未提供交易日期）', url), code, items, classification: 'sina-industry', notice: '当前是新浪行业成分，主力净额没有提供；不代替东方财富板块归属。' };
}
export async function peers(code: string) {
  if (code.startsWith('SN:')) return sinaPeers(code);
  if (!/^BK\d{4,6}$/.test(code)) throw new Error('无效板块代码');
  const url = emUrl('clist/get', { fs: 'b:' + code, pn: '1', pz: '16', po: '1', np: '1', fid: 'f3', fields: 'f2,f3,f12,f13,f14,f62' });
  const data = await listData(url);
  const items: Peer[] = rowList(data.data.diff).filter(r => /^\d{6}$/.test(String(r.f12))).map(r => ({ symbol: String(r.f12) + (Number(r.f13) === 1 ? '.SH' : /^(4|8|92)/.test(String(r.f12)) ? '.BJ' : '.SZ'), name: String(r.f14 || ''), price: num(r.f2), changePercent: num(r.f3), mainNet: num(r.f62) }));
  return { ...stamp('东方财富板块成分' + (data.delayMinutes ? '（约15分钟延迟）' : ''), data.sourceUrl), delayMinutes: data.delayMinutes, code, items };
}
export async function ranks() {
  const url = emUrl('clist/get', { fs: 'm:90+t:2', pn: '1', pz: '20', po: '1', np: '1', fid: 'f3', fields: 'f12,f14,f3,f62,f128,f140,f141' });
  let data;
  try { data = await listData(url); } catch { return industryRanks(true); }
  return { ...stamp('东方财富行业涨幅排行' + (data.delayMinutes ? '（约15分钟延迟）' : ''), data.sourceUrl), delayMinutes: data.delayMinutes, items: rowList(data.data.diff).map(mapSector) };
}
export async function fundFlow(raw: string) {
  const { symbol, secid } = chineseSymbol(raw);
  const url = emUrl('stock/fflow/kline/get', { secid, klt: '1', fields1: 'f1,f2,f3,f7', fields2: 'f51,f52,f53,f54,f55,f56,f57' });
  const payload = await (await eastmoney(url)).json() as { data?: { klines?: string[] } };
  if (!payload.data?.klines?.length) throw new Error('该证券暂无资金流数据，ETF可能不受此接口覆盖');
  return { ...stamp('东方财富资金流估算', url), symbol, points: payload.data.klines.map(row => { const r = row.split(','); return { time: r[0], main: num(r[1]), small: num(r[2]), medium: num(r[3]), large: num(r[4]), superLarge: num(r[5]) }; }) };
}
export async function reports(raw: string) {
  const { code } = chineseSymbol(raw);
  const url = 'https://reportapi.eastmoney.com/report/list?' + new URLSearchParams({ code, qType: '0', pageNo: '1', pageSize: '16', industryCode: '*', industry: '*', rating: '*', ratingChange: '*', beginTime: new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10), endTime: new Date().toISOString().slice(0, 10) });
  const payload = await (await eastmoney(url)).json() as { data?: Row[] };
  if (!Array.isArray(payload.data)) throw new Error('研报源响应不可用');
  return { ...stamp('东方财富研报索引', url), items: payload.data.map(r => ({ title: clean(r.title), date: String(r.publishDate || '').slice(0, 10), organization: clean(r.orgSName), rating: clean(r.emRatingName), url: /^\w+$/.test(String(r.infoCode)) ? 'https://data.eastmoney.com/report/zw_stock.jshtml?infocode=' + r.infoCode : 'https://data.eastmoney.com/report/' })) };
}
async function wscn() {
  const url = 'https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=35';
  const payload = await (await request(url)).json() as { code?: number; data?: { items?: Row[] } };
  if (payload.code !== 20000 || !Array.isArray(payload.data?.items)) throw new Error('快讯源响应异常');
  return payload.data.items.map(r => ({ id: 'wscn-' + r.id, title: clean(r.title || r.content_text).slice(0, 180), summary: clean(r.content_text).slice(0, 260), publishedAt: num(r.display_time) ? new Date(Number(r.display_time) * 1000).toISOString() : null, source: '华尔街见闻', url: String(r.uri || 'https://wallstreetcn.com/live/global'), category: 'all', originalTitle: clean(r.title), important: Number(r.score) >= 2 }));
}
async function cls() {
  const params = { appName: 'CailianpressWeb', os: 'web', sv: '7.7.5', last_time: '', refresh_type: '1', rn: '30' };
  const query = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('&');
  const sign = createHash('md5').update(createHash('sha1').update(query).digest('hex')).digest('hex');
  const payload = await (await request('https://www.cls.cn/v1/roll/get_roll_list?' + query + '&sign=' + sign)).json() as { errno?: number; data?: { roll_data?: Row[] } };
  if (payload.errno || !Array.isArray(payload.data?.roll_data)) throw new Error('电报源响应异常');
  return payload.data.roll_data.map(r => ({ id: 'cls-' + r.id, title: clean(r.title || r.brief || r.content).slice(0, 180), summary: clean(r.brief || r.content).slice(0, 260), publishedAt: num(r.ctime) ? new Date(Number(r.ctime) * 1000).toISOString() : null, source: '财联社', url: 'https://www.cls.cn/detail/' + String(r.id), category: 'all', originalTitle: clean(r.title), important: String(r.level) === 'A' }));
}
export async function flash() {
  const fetched = await Promise.allSettled([cls(), wscn()]), sources: string[] = [], warnings: string[] = [], items: FlashItem[] = [];
  fetched.forEach((r, i) => { const name = ['财联社', '华尔街见闻'][i]; if (r.status === 'fulfilled') { sources.push(name); items.push(...r.value); } else warnings.push(name + '暂不可用'); });
  if (!items.length) throw new Error('两路7×24快讯源暂不可用');
  const seen = new Set<string>();
  const unique = items.filter(n => { const key = n.title.replace(/[\s\p{P}]/gu, ''); if (!key || seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, 65);
  return { ...stamp(sources.join(' / '), 'https://www.cls.cn/telegraph'), items: unique, warnings, sources };
}
export async function stockNews(raw: string) {
  const { code } = chineseSymbol(raw);
  const param = JSON.stringify({ uid: '', keyword: code, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr', param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 20, preTag: '', postTag: '' } } });
  const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=jQuery_news&param=' + encodeURIComponent(param);
  const text = await (await eastmoney(url)).text(), begin = text.indexOf('('), end = text.lastIndexOf(')');
  if (begin < 0 || end <= begin) throw new Error('个股新闻响应格式异常');
  const data = JSON.parse(text.slice(begin + 1, end)) as { result?: { cmsArticleWebOld?: Row[] } };
  if (!Array.isArray(data.result?.cmsArticleWebOld)) throw new Error('来源未提供个股新闻，可能暂时限流');
  return { ...stamp('东方财富个股新闻检索', url), warnings: [], sources: ['东方财富'], items: data.result.cmsArticleWebOld.map(r => ({ id: 'em-' + String(r.code || r.url), title: clean(r.title), summary: clean(r.content).slice(0, 260), publishedAt: String(r.date || '').replace(' ', 'T') + '+08:00', source: clean(r.mediaName) || '东方财富', url: String(r.url || ''), category: 'all', originalTitle: clean(r.title) })) };
}


const SINA_API = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.';
async function sinaJson(method: string, params: Record<string, string>) {
  const url = SINA_API + method + '?' + new URLSearchParams(params);
  const response = await request(url, 8000);
  return { data: JSON.parse(new TextDecoder('gbk').decode(await response.arrayBuffer())) as unknown, url };
}
function sinaMembers(data: unknown): SectorMember[] {
  if (!Array.isArray(data)) throw new Error('新浪证券列表格式异常');
  return (data as Row[]).filter(r => /^(sh|sz|bj)\d{6}$/.test(String(r.symbol))).map(r => {const wire = String(r.symbol);return {symbol:wire.slice(2)+'.'+wire.slice(0,2).toUpperCase(),name:clean(r.name),price:num(r.trade),changePercent:num(r.changepercent),amount:num(r.amount)};});
}
export async function universe(page: number) {
  if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('证券列表页码超出范围');
  const total = await memo('sina-universe-count', 600, async () => {
    const {data} = await sinaJson('getHQNodeStockCount', {node:'hs_a'});
    const count = num(data);if(count === null || count < 1 || count > 8000)throw new Error('证券总数异常');return count;
  });
  const {data,url} = await sinaJson('getHQNodeData',{page:String(page),num:'80',sort:'symbol',asc:'1',node:'hs_a',symbol:''});
  const rows = data as Row[], items = sinaMembers(data).map(item => ({...item,turnover:num(rows.find(r=>String(r.symbol).slice(2)===item.symbol.slice(0,6))?.turnoverratio)}));
  if(!items.length && (page-1)*80<total)throw new Error('证券列表提前结束，未视为完整覆盖');
  return {...stamp('新浪公开A股证券列表与快照（来源未提供交易日期）',url),total,page,pageSize:80,sourceRows:rows.length,items,tradingDate:null};
}
export async function sectorScenario(code: string) {
  if(!/^SN:new_[a-z0-9]{2,20}$/.test(code))throw new Error('此观察使用独立新浪行业代码');
  const node=code.slice(3),countResult=await sinaJson('getHQNodeStockCount',{node}),total=num(countResult.data);
  if(total===null||total<1||total>8000)throw new Error('行业成分总数异常');
  const members:SectorMember[]=[];let sourceEnded=false;
  for(let page=1;page<=10;page++){
    const result=await sinaJson('getHQNodeData',{page:String(page),num:'80',sort:'symbol',asc:'1',node,symbol:''});
    const pageMembers=sinaMembers(result.data);members.push(...pageMembers);
    if((result.data as unknown[]).length<80){sourceEnded=true;break;}
  }
  const unique=[...new Map(members.map(r=>[r.symbol,r])).values()],breadth=sectorBreadth(unique,total,sourceEnded);
  return {...stamp('新浪行业全成分公开快照（来源未提供交易日期）',countResult.url),code,breadth,tradingDate:null,leaders:[...unique].filter(r=>r.changePercent!==null).sort((a,b)=>b.changePercent!-a.changePercent!).slice(0,12),conditions:{continuation:'若上涨家数占比保持65%以上、中位涨幅为正，且大盘未转弱，继续观察扩散；再核验资金与原始催化。',invalidation:'若上涨家数占比降至35%以下、中位涨幅转负，或只剩少数领涨股维持，降级为分歧/退潮观察。',verification:'65%/35%是本页观察阈值，不是预测概率。行业源缺少交易日期；未完成全成分覆盖时不输出整体强弱结论。'}};
}
