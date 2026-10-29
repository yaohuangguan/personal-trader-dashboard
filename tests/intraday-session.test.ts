import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionMinute,sessionGrid,defaultBenchmark} from '../src/shared/intraday-axis';
import {parseAuctionTrends} from '../src/shared/auction';
test('morning data keeps its actual position on a complete session, with lunch excluded',()=>{
 const grid=sessionGrid('2026-10-29');assert.equal(grid[0].clock,'09:30');assert.equal(grid.at(-1)!.clock,'15:00');assert.equal(grid.length,242);
 assert.equal(sessionMinute('10:00'),30);assert.equal(sessionMinute('15:00'),240);assert.equal(sessionMinute('12:00'),null);assert.equal(sessionMinute('09:25'),null);
 assert.ok(grid.every(p=>p.clock<='11:30'||p.clock>='13:00'));assert.equal(defaultBenchmark('300031.SZ'),'399006.SZ');
});
test('auction keeps indicative prices separate from real matches and never uses the continuous opening minute',()=>{
 const rows=[
  '2026-10-29 09:20,10,10.2,10.2,10,0,0,10',
  '2026-10-29 09:25,10,10.3,10.3,10,0,0,10',
  '2026-10-29 09:26,10.3,10.3,10.3,10.3,123,126690,10.3',
  '2026-10-29 09:31,10.3,10.8,10.9,10.3,9000,9720000,10.5',
  '2026-10-29 15:00,10.4,10.5,10.5,10.4,100,105000,10.5',
  '2026-10-29 15:10,10.5,10.5,10.5,10.5,10,10500,10.5',
 ];
 const [open,close,after]=parseAuctionTrends(rows),match=open.points.find(p=>!p.indicative)!;
 assert.equal(match.clock,'09:25');assert.equal(match.sourceClock,'09:26');assert.equal(match.amount,126690);assert.equal(open.points.length,3);assert.equal(close.points.length,1);assert.equal(after.points.length,1);assert.equal(after.points[0].amount,10500);
});
