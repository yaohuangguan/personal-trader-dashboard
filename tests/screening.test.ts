import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectorBreadth, screenCandidate, type SectorMember } from '../src/shared/screening';
import { analyzeGuide } from '../src/shared/guide-analysis';
import { deskRoute } from '../src/worker/desk-api';
import { sinaBeijingDaily, parseSinaFactors, applySinaFactors } from '../src/worker/research';
const member = (n: number, change: number): SectorMember => ({ symbol: String(n).padStart(6, '0') + '.SZ', name: 'Sample', price: 10, changePercent: change, amount: 1e8 });
test('industry breadth uses the complete active population rather than only leaders', () => {
  const rows = Array.from({ length: 10 }, (_, i) => member(i, i < 3 ? 10 : -2));
  const whole = sectorBreadth(rows, 10); assert.equal(whole.up, 3); assert.equal(whole.positiveShare, 0.3); assert.equal(whole.median, -2); assert.equal(whole.label, '多数成分走弱');
  const leaders = sectorBreadth(rows.slice(0, 3), 10); assert.equal(leaders.complete, false); assert.equal(leaders.label, '样本不足');
  assert.equal(sectorBreadth(rows, 9).complete, false);
  assert.equal(sectorBreadth(rows,10,false).complete,false);
  const halted = sectorBreadth([...rows, { ...member(11, 0), amount: 0 }], 11); assert.equal(halted.active, 10); assert.equal(halted.flat, 0);
});
test('missing daily volume cannot produce a tradable adhesion candidate', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ time: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), open: 10, high: 10, low: 10, close: 10, volume: 0 }));
  const guide = analyzeGuide(rows); assert.equal(guide.stage, '粘合蓄势');
  assert.equal(screenCandidate({ symbol: '300545.SZ', name: 'Example', price: 10, changePercent: 0, amount: 0, turnover: 0 }, guide, 'test'), null);
});
test('new scan endpoints bound paging and separate provider sector namespaces', async () => {
  for (const path of ['/api/desk/universe?page=101', '/api/desk/universe?page=1.5', '/api/desk/sector-scenario?code=BK1335', '/api/desk/sector-scenario?code=SN:../../bad']) {
    const result = await deskRoute(new Request('https://example.test' + path)); assert.equal(result!.status, 400);
  }
});
test('Beijing daily adapter parses JSONP as data and preserves explicitly raw prices', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('/*<script>ignored</script>*/\nvar _bj920000_240_500=([{"day":"2025-10-22","open":"10","high":"11","low":"9","close":"10.5","volume":"1000"},{"day":"2025-10-23","open":"10.5","high":"12","low":"10","close":"11.5","volume":"1500"}]);');
  try { const result = await sinaBeijingDaily('920000.BJ'); assert.equal(result.candles.length, 2); assert.equal(result.candles[1].close, 11.5); assert.equal(result.candles[1].volume, 1500); await assert.rejects(() => sinaBeijingDaily('../bad')); }
  finally { globalThis.fetch = original; }
});


test('Sina factors are parsed as data with a signature comment and applied only from their effective dates', () => {
  const text='var sz300394qfq={"total":2,"data":[{"d":"2025-01-02","f":"1"},{"d":"1900-01-01","f":"2"}]}\n/* public signature */';
  const factors=parseSinaFactors(text,'sz300394');
  const rows=[{time:'2025-01-01',open:20,high:22,low:18,close:21,volume:100},{time:'2025-01-02',open:10,high:11,low:9,close:10.5,volume:200}];
  const adjusted=applySinaFactors(rows,factors);
  assert.equal(adjusted[0].close,10.5);assert.equal(adjusted[1].close,10.5);assert.equal(adjusted[0].volume,100);
  assert.throws(()=>parseSinaFactors(text,'sh600584'));
  assert.throws(()=>parseSinaFactors(text+';alert(1)','sz300394'));
  assert.throws(()=>applySinaFactors(rows,[{date:'2025-01-02',factor:1}]));
});
