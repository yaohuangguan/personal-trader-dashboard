// HTTP adapters ported from a-stock-data v3.10.3 (Apache-2.0).
// https://github.com/simonlin1212/a-stock-data -- public snapshots are NOT exchange Level-2.
import { createHash } from 'node:crypto';
import { normalizeSymbol } from '../shared/catalog';
import type { Candle } from '../shared/types';
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
async function request(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Referer: url.includes('eastmoney') ? 'https://quote.eastmoney.com/' : 'https://gu.qq.com/' }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error('数据源 HTTP ' + response.status);
  return response;
}
let nextEastmoneyStart = 0;
async function eastmoney(url: string) {
  // Keep the wait in the calling request's context. A cross-request promise
  // queue can retain a timer after its owner request has already completed.
  const delay = Math.max(0, nextEastmoneyStart - Date.now());
  if (delay > 4500) throw new Error('数据源访问保护中，请稍后刷新');
  nextEastmoneyStart = Date.now() + delay + 900;
  if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
  return request(url);
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
export async function peers(code: string) {
  if (!/^BK\d{4,6}$/.test(code)) throw new Error('无效板块代码');
  const url = emUrl('clist/get', { fs: 'b:' + code, pn: '1', pz: '16', po: '1', np: '1', fid: 'f3', fields: 'f2,f3,f12,f13,f14,f62' });
  const data = await (await eastmoney(url)).json() as { data?: { diff?: unknown } };
  if (!data.data) throw new Error('板块成分暂不可用');
  const items: Peer[] = rowList(data.data.diff).filter(r => /^\d{6}$/.test(String(r.f12))).map(r => ({ symbol: String(r.f12) + (Number(r.f13) === 1 ? '.SH' : /^(4|8|92)/.test(String(r.f12)) ? '.BJ' : '.SZ'), name: String(r.f14 || ''), price: num(r.f2), changePercent: num(r.f3), mainNet: num(r.f62) }));
  return { ...stamp('东方财富板块成分', url), code, items };
}
export async function ranks() {
  const url = emUrl('clist/get', { fs: 'm:90+t:2', pn: '1', pz: '20', po: '1', np: '1', fid: 'f3', fields: 'f12,f14,f3,f62,f128,f140,f141' });
  const data = await (await eastmoney(url)).json() as { data?: { diff?: unknown } };
  if (!data.data) throw new Error('行业排行暂不可用');
  return { ...stamp('东方财富行业涨幅排行', url), items: rowList(data.data.diff).map(mapSector) };
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
