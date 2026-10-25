import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adhesionCoefficient, adhesionLabel, analyzeGuide, closedPeriodCandles, analyzeGuideResonance } from '../src/shared/guide-analysis';
import type { Candle } from '../src/shared/types';
const now = new Date('2026-10-25T04:00:00Z');
function flat(n = 100): Candle[] { return Array.from({ length: n }, (_, i) => ({ time: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), open: 99.9, high: 100.2, low: 99.8, close: 100, volume: 1000 })); }
function launch() { const rows = flat(); rows.push({ time: '2025-04-11', open: 99, high: 106.2, low: 98.5, close: 106, volume: 2200 }); return rows; }
function append(rows: Candle[], close: number, low = close - 0.8) { const date = new Date(rows.at(-1)!.time + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1); return [...rows, { time: date.toISOString().slice(0, 10), open: close - 0.5, high: close + 0.2, low, close, volume: 1800 }]; }

test('adhesion matches the original guide calculator denominator and strict bands', () => {
  const actual = adhesionCoefficient([10.45, 10.55, 10.48, 10.52, 10.50])!;
  assert.ok(Math.abs(actual - (10.55 - 10.45) / 10.45 * 100) < 1e-10);
  assert.equal(adhesionLabel(2), '紧密粘合'); assert.equal(adhesionLabel(5), '松散粘合'); assert.equal(adhesionLabel(10), '发散状态');
  assert.equal(adhesionCoefficient([0, 10]), null);
});
test('a rising MA order alone never fabricates a guide launch or calibrated score', () => {
  const rows = flat(280).map((c, i) => ({ ...c, open: 100 + i - 0.1, high: 100 + i + 0.2, low: 100 + i - 0.2, close: 100 + i }));
  const a = analyzeGuide(rows, { now });
  assert.equal(a.stage, '趋势延续'); assert.equal(a.event, null); assert.equal(a.events.length, 0); assert.ok(!('score' in a));
});
test('the guide launch remains pending until three observed follow-up bars and uses no future data', () => {
  const start = launch(); const a = analyzeGuide(start, { now });
  assert.equal(a.stage, '确认观察'); assert.equal(a.event!.observedBars, 0); assert.equal(a.event!.state, 'pending');
  assert.ok(a.rules.filter(r => r.required).every(r => r.state === 'pass'));
  const one = append(start, 107), two = append(one, 108), three = append(two, 109);
  assert.equal(analyzeGuide(two, { now }).event!.state, 'pending');
  assert.equal(analyzeGuide(three, { now }).event!.state, 'confirmed');
  assert.equal(analyzeGuide(three, { now }).event!.confirmationDate, three.at(-1)!.time);
  assert.deepEqual(analyzeGuide(three.slice(0, start.length), { now }).events, a.events);
  const historical = analyzeGuide(three, {now: new Date('2025-04-11T08:00:00Z')});
  assert.equal(historical.event!.state, 'pending'); assert.equal(historical.available, start.length);
});
test('a retrace through the launch-body midpoint invalidates confirmation, including intraday lows', () => {
  const a = analyzeGuide(append(launch(), 105, 102), { now });
  assert.equal(a.event!.state, 'failed'); assert.equal(a.stage, '确认失效');
  assert.match(a.event!.reason, /最低价/);
});
test('absent volume, insufficient history and invalid OHLCV cannot pass the launch gate', () => {
  assert.equal(analyzeGuide(flat(30), { now }).ready, false);
  const a = analyzeGuide(launch().map(c => ({ ...c, volume: 0 })), { now });
  assert.equal(a.event, null); assert.equal(a.rules.find(r => r.id === 'strength')!.state, 'unknown');
  const invalid = launch(); invalid[5].high = 1;
  assert.equal(analyzeGuide(invalid, { now }).ready, false);
  assert.equal(analyzeGuide(launch(), { now }).sevenLineCrosses, null);
});
test('an unfinished daily launch stays provisional and cannot be a confirmed historical event', () => {
  const a = analyzeGuide(launch(), { now: new Date('2025-04-11T04:00:00Z') });
  assert.equal(a.provisional, true); assert.equal(a.stage, '盘中候选'); assert.equal(a.events.length, 0);
});
test('unfinished calendar periods are excluded and missing long-period history stays unknown', () => {
  const rows = [{ ...flat(1)[0], time: '2026-10-23' }];
  assert.equal(closedPeriodCandles(rows, 'week', new Date('2026-10-23T06:00:00Z')).length, 0);
  assert.equal(closedPeriodCandles(rows, 'week', new Date('2026-10-23T07:10:00Z')).length, 1);
  assert.equal(closedPeriodCandles(rows, 'month', now).length, 0);
  const r = analyzeGuideResonance([], [], now); assert.equal(r.weekly.ready, false); assert.equal(r.monthly.matched, false);
});


test('strict five-percent and two-times launch thresholds do not pass through floating-point rounding', () => {
  const exactFive = launch(); exactFive.at(-1)!.close = 105;
  assert.equal(analyzeGuide(exactFive, {now}).rules.find(r=>r.id==='strength')!.state, 'fail');
  const exactDouble = launch(); exactDouble.at(-1)!.volume = 2000;
  assert.equal(analyzeGuide(exactDouble, {now}).event, null);
});
