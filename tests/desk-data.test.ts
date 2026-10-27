import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuotes, parseTickPage, num, peers, ranks, parseSinaIndustries, memo, fundFlow } from '../src/worker/desk-data';
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


test('Sina fallback preserves a distinct industry namespace and source classification', async () => {
  const text = 'var board = ' + JSON.stringify({new_blhy:'new_blhy,玻璃行业,19,14.7,0.1,1.05,100,200,sz300093,4.2,18.7,0.7,金刚光伏',new_dzxx:'new_dzxx,电子信息,200,15,0.5,3.45,100,200,sz300369,19.9,11.7,1.9,绿盟科技'}) + ';';
  const items = parseSinaIndustries(text);
  assert.equal(items[0].code, 'SN:new_dzxx'); assert.equal(items[0].leaderSymbol, '300369.SZ');
  assert.equal(items[1].name, '玻璃行业');
  assert.throws(() => parseSinaIndustries('var board = {} broken'));
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    if (!String(input).includes('sina.com.cn')) return new Response('', { status: 502 });
    return new Response('var board = {"new_test":"new_test,Industry,1,1,1,2.7,1,1,sz300545,1,1,1,Leader"};');
  };
  try {
    const result = await ranks();
    assert.equal(result.classification, 'sina-industry');
    assert.equal(result.items[0].code, 'SN:new_test');
    assert.match(result.notice || '', /分类与成分不同/);
    assert.match(result.sourceUrl, /sina.com.cn/);
  } finally { globalThis.fetch = original; }
});


test('an abandoned in-flight request cannot trap a later request with the same cache key', async () => {
  void memo('request-lifetime-test', 1, () => new Promise<number>(() => {}));
  const fresh = memo('request-lifetime-test', 1, async () => 42);
  const value = await Promise.race([fresh, new Promise((_, reject) => setTimeout(() => reject(new Error('cross-request promise was reused')), 50))]);
  assert.equal(value, 42);
  assert.equal(await memo('request-lifetime-test', 1, async () => 99), 42);
});


test('an unavailable intraday flow falls back to attributed daily values without claiming live data', async () => {
 const original=globalThis.fetch;
 globalThis.fetch=async input=>String(input).includes('push2delay')?Response.json({data:{code:'300545',klines:['2026-10-23,-3970612,7373320,-3402708,-4638945,668333']}}):new Response('',{status:502});
 try{const result=await fundFlow('300545.SZ');assert.equal(result.period,'daily');assert.equal(result.points[0].time,'2026-10-23');assert.equal(result.points[0].main,result.points[0].large!+result.points[0].superLarge!);assert.match(result.notice||'',/非盘中实时/);assert.match(result.sourceUrl,/push2delay/);}finally{globalThis.fetch=original;}
});

test('Sina independent fallback keeps its net-flow label and never invents size buckets',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async input=>String(input).includes('sina.com.cn')?Response.json([{opendate:'2026-10-26',netamount:'-155293011.66',r0_net:'-106788556.84'}]):new Response('',{status:502});
 try{const r=await fundFlow('300031.SZ');assert.match(r.source,/新浪/);assert.match(r.mainLabel||'',/新浪口径/);assert.equal(r.period,'daily');assert.equal(r.points[0].main,-155293011.66);assert.equal(r.points[0].superLarge,null);assert.equal(r.points[0].large,null);assert.match(r.notice||'',/不是盘中实时/);}finally{globalThis.fetch=original;}
});
test('all unavailable flow sources return a recoverable empty state instead of a 502 crash',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:502});try{const r=await fundFlow('300032.SZ');assert.equal(r.available,true);assert.deepEqual(r.points,[]);assert.match(r.notice||'',/暂时均不可用/);}finally{globalThis.fetch=original;}
});
