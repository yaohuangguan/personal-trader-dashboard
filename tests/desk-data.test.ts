import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuotes, parseTickPage, num, peers } from '../src/worker/desk-data';
import { marketSession, evaluateWatchRules } from '../src/shared/desk-types';
import { deskRoute } from '../src/worker/desk-api';

function sourceQuote(timestamp = '20261023093010') {
  const fields = Array(89).fill('');
  for (const [i, value] of Object.entries({ 1: '联得装备', 3: '23.11', 4: '22.50', 5: '22.18', 6: '64696', 9: '23.10', 10: '191', 19: '23.11', 20: '64', 30: timestamp, 31: '0.61', 32: '2.71', 33: '23.20', 34: '21.00', 37: '14254', 38: '5.21', 39: '47.48', 44: '28.69', 45: '43.04', 46: '1.96', 47: '27.00', 48: '18.00', 49: '1.66' })) fields[Number(i)] = value;
  return 'v_sz300545="' + fields.join('~') + '";';
}
test('snapshot fields preserve market/float-cap ordering, timestamp, book depth and missing values', () => {
  const q = parseQuotes(sourceQuote(), new Date('2026-10-23T01:30:20Z'))[0];
  assert.equal(q.symbol, '300545.SZ'); assert.equal(q.name, '联得装备');
  assert.equal(q.price, 23.11); assert.equal(q.marketCap, 43.04e8); assert.equal(q.floatCap, 28.69e8);
  assert.equal(q.amount, 14254e4); assert.equal(q.bids.length, 5); assert.equal(q.asks.length, 5);
  assert.deepEqual(q.bids[0], { price: 23.10, volume: 191 });
  assert.deepEqual(q.asks[0], { price: 23.11, volume: 64 });
  assert.deepEqual(q.asks[4], { price: null, volume: null });
  assert.equal(q.asOf, '2026-10-23T09:30:10+08:00'); assert.equal(q.session, 'trading'); assert.equal(q.stale, false);
  assert.equal(num(''), null); assert.equal(num('--'), null); assert.equal(num(true), null); assert.equal(num(0), 0);
});
test('closed-session snapshots remain historical and cannot trigger price reminders', () => {
  const now = new Date('2026-10-25T02:00:00Z');
  const q = parseQuotes(sourceQuote(), now)[0];
  assert.equal(q.session, 'closed');
  assert.deepEqual(evaluateWatchRules([{ id: 'one', symbol: q.symbol, direction: 'above', value: 20 }], [q], now), []);
  const live = parseQuotes(sourceQuote(), new Date('2026-10-23T01:30:20Z'))[0];
  assert.equal(evaluateWatchRules([{ id: 'one', symbol: live.symbol, direction: 'above', value: 23 }], [live], new Date('2026-10-23T01:30:20Z')).length, 1);
  assert.equal(evaluateWatchRules([{ id: 'one', symbol: live.symbol, direction: 'above', value: 23, firedAt: 'done' }], [live]).length, 0);
  assert.equal(parseQuotes(sourceQuote(), new Date('2026-10-23T02:00:00Z'))[0].stale, true);
});
test('market periods use Beijing time, separate lunch break and reject weekend live status', () => {
  assert.equal(marketSession(new Date('2026-10-23T01:45:00Z')), 'trading');
  assert.equal(marketSession(new Date('2026-10-23T04:00:00Z')), 'break');
  assert.equal(marketSession(new Date('2026-10-23T07:20:00Z')), 'closed');
  assert.equal(marketSession(new Date('2026-10-25T02:00:00Z')), 'closed');
});
test('aggregated ticks retain sequence, side and source units; wrong pages and malformed records fail', () => {
  const page = 'v_detail_data_sz300545=[4,"280/09:48:00/23.1/0.1/20/46200/B|281/09:48:03/23/0.1/10/23000/S"];';
  const rows = parseTickPage(page, 'sz300545', 4);
  assert.equal(rows[0].sequence, 280); assert.equal(rows[0].side, 'B'); assert.equal(rows[0].amount, 46200);
  assert.throws(() => parseTickPage(page, 'sz300545', 3));
  assert.throws(() => parseTickPage(page.replace('/B', '/X'), 'sz300545', 4));
});
test('desk endpoints reject arbitrary URLs, unbounded batches and unsafe board parameters before network access', async () => {
  const call = (path: string) => deskRoute(new Request('https://atlas.example' + path));
  assert.equal((await call('/api/desk/quotes?symbols=https://evil.example'))!.status, 400);
  assert.equal((await call('/api/desk/peers?code=../../bad'))!.status, 400);
  assert.equal((await call('/api/desk/intraday?symbol=NVDA'))!.status, 400);
  assert.equal(await call('/api/market?symbol=NVDA'), null);
  assert.equal((await deskRoute(new Request('https://atlas.example/api/desk/flash', { method: 'POST' })))!.status, 405);
});


test('a failed primary sector list uses the documented delayed host and exposes the delay', async () => {
  const original = globalThis.fetch;
  const visited: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); visited.push(url);
    if (new URL(url).hostname === 'push2.eastmoney.com') return new Response('', { status: 502 });
    return Response.json({ data: { diff: [{ f12: '300545', f13: 0, f14: '联得装备', f2: 23.11, f3: 2.71, f62: null }] } });
  };
  try {
    const result = await peers('BK1335');
    assert.equal(result.items[0].symbol, '300545.SZ');
    assert.equal(result.items[0].mainNet, null);
    assert.equal(result.delayMinutes, 15);
    assert.match(result.source, /15分钟延迟/);
    assert.equal(new URL(result.sourceUrl).hostname, 'push2delay.eastmoney.com');
    assert.deepEqual(visited.map(url => new URL(url).hostname), ['push2.eastmoney.com', 'push2delay.eastmoney.com']);
  } finally { globalThis.fetch = original; }
});
