import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol } from '../src/shared/catalog';
import { mergeSearch, parseTencentSearch } from '../src/worker/market-search';
import { tencentAshares } from '../src/worker/research';

test('arbitrary A-share codes, explicit index prefixes and Shanghai ETFs normalize correctly', () => {
  for (const [input, expected] of [['300031', '300031.SZ'], ['002167', '002167.SZ'], ['510300', '510300.SH'], ['159915', '159915.SZ'], ['920021', '920021.BJ'], ['sh000001', '000001.SH'], ['600519.ss', '600519.SH'], ['NVDA', 'NVDA']]) assert.equal(normalizeSymbol(input), expected);
});

test('full-market search parses provider names beyond the built-in catalog', () => {
  const text = 'v_hint="sz~300031~\\u5b9d\\u901a\\u79d1\\u6280~btkj~GP-A^sh~510300~ETF~etf~ETF"';
  const items = parseTencentSearch(text);
  assert.equal(items[0].name, '宝通科技');
  assert.equal(items[0].symbol, '300031.SZ');
  assert.equal(items[1].symbol, '510300.SH');
  assert.deepEqual(parseTencentSearch('v_hint="N"'), []);
  assert.deepEqual(parseTencentSearch('invalid response'), []);
  const result = mergeSearch([{ symbol: '300031.SZ', name: '自定义代码 · 尝试加载行情', exchange: 'CN' }], items);
  assert.equal(result[0].name, '宝通科技');
  assert.equal(result.length, 2);
});

test('newly listed securities still return a chart while long averages warm up', async () => {
  const previous = globalThis.fetch;
  const rows = Array.from({ length: 35 }, (_, i) => [new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), '20', '21', '22', '19', '1000']);
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { sz301999: { qfqday: rows, qt: { sz301999: ['51', '任意新股'] } } } }));
  try {
    const result = await tencentAshares('301999.SZ');
    assert.equal(result.candles.length, 35);
    assert.equal(result.name, '任意新股');
  } finally { globalThis.fetch = previous; }
});
