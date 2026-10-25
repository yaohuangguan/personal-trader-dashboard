import type { SearchItem } from '../shared/types';

export function parseTencentSearch(text: string): SearchItem[] {
  const match = /^v_hint="(.*)"\s*;?\s*$/s.exec(text.trim());
  if (!match) return [];
  let value: string;
  try { value = JSON.parse('"' + match[1] + '"') as string; } catch { return []; }
  return value.split('^').flatMap(row => {
    const [market, code, name] = row.split('~');
    if (!['sh', 'sz', 'bj'].includes(market) || !/^\d{6}$/.test(code) || !name) return [];
    return [{ symbol: code + '.' + market.toUpperCase(), name, exchange: market === 'sh' ? 'SSE' : market === 'sz' ? 'SZSE' : 'BSE' }];
  });
}

export async function searchChineseMarket(query: string): Promise<SearchItem[]> {
  const url = 'https://smartbox.gtimg.cn/s3/?q=' + encodeURIComponent(query) + '&t=all';
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Symbol search HTTP ' + response.status);
  return parseTencentSearch(await response.text());
}

export function mergeSearch(local: SearchItem[], found: SearchItem[]): SearchItem[] {
  const items = new Map(local.map(item => [item.symbol, item]));
  for (const item of found) {
    const previous = items.get(item.symbol);
    if (!previous || previous.name.startsWith('自定义代码')) items.set(item.symbol, item);
  }
  return [...items.values()].slice(0, 15);
}
