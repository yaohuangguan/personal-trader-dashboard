import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatMarketTime,relativeAge,validDate,zoneClock,zoneForSymbol} from '../src/client/time-format';

test('market timestamps render in Beijing time regardless of the device zone',()=>{
 // 06:30Z is 14:30 in Shanghai; New Zealand daylight time would have shown 19:30.
 assert.equal(formatMarketTime('2026-11-26T06:30:00Z','clock'),'14:30');
 assert.equal(formatMarketTime('2026-11-26T06:30:00Z','dateClock'),'11-26 14:30');
 assert.equal(formatMarketTime('2026-11-26T14:30:00+08:00','dateTime'),'2026-11-26 14:30');
 assert.equal(formatMarketTime('2026-11-26T16:30:00Z','date'),'2026-11-27');
 assert.equal(formatMarketTime(Date.parse('2026-11-26T06:30:00Z'),'weekdayClock'),'11-26 周四 14:30');
 assert.equal(formatMarketTime(Date.parse('2026-11-26T06:30:00Z'),'weekdayClock',{locale:'en'}),'11-26 Thu 14:30');
});
test('US session values use New York time including daylight saving changes',()=>{
 assert.equal(formatMarketTime('2026-11-25T21:00:00Z','clock',{zone:'us'}),'16:00');
 assert.equal(formatMarketTime('2026-07-15T20:00:00Z','clock',{zone:'us'}),'16:00');
 assert.equal(zoneClock(new Date('2026-11-26T06:30:00Z'),'us'),'纽约 01:30');
 assert.equal(zoneForSymbol('NVDA'),'us');assert.equal(zoneForSymbol('300545.SZ'),'cn');assert.equal(zoneForSymbol('000001.SH'),'cn');
});
test('invalid or partial dates never reach Intl.format',()=>{
 for(const value of ['+08:00','T00:00:00+08:00','',null,undefined,'not a date',NaN])assert.equal(formatMarketTime(value as string,'dateTime'),'—');
 assert.equal(formatMarketTime('+08:00','clock',{fallback:'时间未提供'}),'时间未提供');
 assert.equal(validDate('+08:00'),null);
 assert.ok(validDate('2026-11-26T00:00:00+08:00'));
});
test('relative age degrades to unknown instead of NaN',()=>{
 const now=Date.parse('2026-11-26T06:30:00Z');
 assert.deepEqual(relativeAge('garbage',now),{unit:'unknown',count:0});
 assert.deepEqual(relativeAge('2026-11-26T06:29:40Z',now),{unit:'now',count:0});
 assert.deepEqual(relativeAge('2026-11-26T06:00:00Z',now),{unit:'minute',count:30});
 assert.deepEqual(relativeAge('2026-11-26T01:00:00Z',now),{unit:'hour',count:5});
 assert.deepEqual(relativeAge('2026-11-23T06:30:00Z',now),{unit:'day',count:3});
});
