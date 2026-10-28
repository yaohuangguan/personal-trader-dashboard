import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidePatternMarks} from '../src/shared/guide-patterns';
import {FIBONACCI_MA} from '../src/shared/ma-system';
const time=(i:number)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),now=new Date('2026-06-01T08:00:00Z');
function bars(){return Array.from({length:90},(_,i)=>{const close=10+.12*Math.sin(i*1.7)+(i>83?.2:0);return {time:time(i),open:close-.03,close,high:close+.15,low:close-.15,volume:10000};});}
test('a high-open long bearish body cuts prior MAs even without a 60-line cut or 1.5x volume',()=>{
 for(const ma of [undefined,FIBONACCI_MA]){const b=bars();for(let i=0;i<50;i++)for(const key of ['open','high','low','close'] as const)b[i][key]+=3;b.push({time:time(90),open:10.5,high:10.55,low:9.45,close:9.5,volume:13000});const marks=guidePatternMarks(b,now,'day',ma),hit=marks.find(m=>m.kind==='guillotine'&&m.time===time(90));assert.ok(hit);assert.equal(hit.direction,'bearish');assert.match(hit.detail,/前一日MA/);assert.doesNotMatch(hit.detail.split('前一日MA')[1].split('共')[0],/\/(55|60)/,'middle-term line can remain above the opening price');const prior=guidePatternMarks(b.slice(0,-1),now,'day',ma);assert.deepEqual(marks.filter(m=>m.time<time(90)),prior);const live=guidePatternMarks(b,new Date(time(90)+'T02:00:00Z'),'day',ma).find(m=>m.kind==='guillotine');assert.equal(live?.provisional,true);}
});
test('a continuing down candle below all MAs is not called a new guillotine, nor is an intraday wick alone',()=>{
 const b=bars();for(let i=0;i<15;i++){const p=b.at(-1)!.close;b.push({time:time(b.length),open:p,high:p+.02,low:p-.32,close:p-.3,volume:13000});}assert.equal(guidePatternMarks(b,now).filter(m=>m.kind==='guillotine'&&m.time===b.at(-1)!.time).length,0);
 const w=bars();w.push({time:time(90),open:10.5,high:10.55,low:9,close:10.45,volume:13000});assert.equal(guidePatternMarks(w,now).filter(m=>m.kind==='guillotine'&&m.time===time(90)).length,0);
});
