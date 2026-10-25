import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartIndicators, defaultMAs, kdj, macd, sma, validMAPreferences } from '../src/shared/chart-indicators';
import type { Candle } from '../src/shared/types';

const bars = (closes: number[]): Candle[] => closes.map((close, i) => ({
  time: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
  open: close, high: close + 1, low: close - 1, close, volume: 100 + i,
}));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('MA250 is calculated from full history and remains available at a shorter viewport boundary', () => {
  const candles = bars(Array.from({ length: 400 }, (_, i) => 100 + i));
  const points = sma(candles, 250);
  assert.equal(points.length, 151);
  near(points[0].value, 224.5);
  near(points.find(p => p.time === candles[334].time)!.value, 309.5);
});

test('SMA and volume averages have no partial-period or future-data lookahead', () => {
  const candles = bars([1, 2, 3, 4, 5]);
  assert.deepEqual(sma(candles, 3).map(p => p.value), [2, 3, 4]);
  assert.deepEqual(sma(candles, 3, 'volume').map(p => p.value), [101, 102, 103]);
  assert.deepEqual(sma(candles, 10), []);
  assert.throws(() => sma(candles, 0));
});

test('MACD flat prices produce zero and its histogram uses twice the DIF/DEA difference', () => {
  const flat = macd(bars(Array(60).fill(100)));
  assert.equal(flat.length, 27);
  for (const p of flat) assert.deepEqual([p.dif, p.dea, p.histogram], [0, 0, 0]);
  const jump = macd(bars([...Array(40).fill(100), 110])).at(-1)!;
  const expectedDif = 10 * (2 / 13 - 2 / 27);
  near(jump.dif, expectedDif);
  near(jump.dea, expectedDif * 0.2);
  near(jump.histogram, expectedDif * 1.6);
});

test('KDJ uses Chinese 9/3/3 recursive smoothing, seeded at 50', () => {
  const candles = bars(Array(9).fill(100));
  candles[8] = { ...candles[8], high: 110, low: 90, close: 105 };
  const first = kdj(candles)[0];
  near(first.k, 175 / 3);
  near(first.d, (100 + 175 / 3) / 3);
  near(first.j, 3 * first.k - 2 * first.d);
  const flat = bars(Array(12).fill(100)).map(c => ({ ...c, high: 100, low: 100 }));
  assert.ok(kdj(flat).every(p => p.k === 50 && p.d === 50 && p.j === 50));
  assert.deepEqual(kdj(candles.slice(0, 8)), []);
});

test('preset matches the requested eight adjustable periods; persisted settings reject invalid entries', () => {
  assert.deepEqual(defaultMAs().map(p => p.period), [5, 13, 20, 30, 60, 120, 144, 250]);
  assert.equal(validMAPreferences(defaultMAs()), true);
  assert.equal(validMAPreferences(defaultMAs().map(p => ({ ...p, period: 0 }))), false);
  assert.equal(validMAPreferences(defaultMAs().map(p => ({ ...p, period: 5 }))), false);
  assert.equal(validMAPreferences({ period: 5 }), false);
});

test('custom expansion signals require sufficient history and are stable when future candles are appended', () => {
  const candles = bars(Array.from({ length: 320 }, (_, i) => 100 + i * 0.4));
  const before = chartIndicators(candles.slice(0, 260), defaultMAs());
  const after = chartIndicators(candles, defaultMAs());
  assert.ok(before.expanded);
  assert.equal(before.signals.filter(s => s.kind === 'bloom').length, 1);
  assert.equal(before.signals.find(s => s.kind === 'bloom')!.time, candles[254].time);
  assert.deepEqual(after.signals.filter(s => s.time <= candles[259].time), before.signals);
  assert.equal(chartIndicators(candles.slice(0, 254), defaultMAs()).expanded, false);
});
