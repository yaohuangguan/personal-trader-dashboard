import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeJobCandidates,staleReportNotice} from '../src/client/screen-job';

test('job polling appends only the candidates discovered since the last poll',()=>{
 const first=['A','B'];
 assert.deepEqual(mergeJobCandidates(first,{candidates:['C','D'],since:2}),['A','B','C','D']);
 assert.equal(mergeJobCandidates(first,{candidates:[],since:2}),first,'no new candidates keeps the identity');
 assert.equal(mergeJobCandidates(first,{}),first,'running job without a candidates key keeps the list');
 assert.equal(mergeJobCandidates(first,{candidates:null}),first);
 assert.deepEqual(mergeJobCandidates(first,{candidates:['X']}),['X'],'old servers answer with the full list');
 assert.deepEqual(mergeJobCandidates(first,{candidates:['Z'],since:5}),['Z'],'a reset job cannot be stitched');
 assert.deepEqual(mergeJobCandidates(['A','B','C'],{candidates:['Q'],since:1}),['A','Q']);
});
test('a stale closing report produces a banner with both dates; current or old servers do not',()=>{
 assert.deepEqual(staleReportNotice({stale:true,expectedDate:'2026-11-26',report:{date:'2026-11-13'}}),{latest:'2026-11-13',expected:'2026-11-26'});
 assert.deepEqual(staleReportNotice({stale:true,expectedDate:null,report:null}),{latest:'—',expected:'—'});
 assert.equal(staleReportNotice({stale:false,report:{date:'2026-11-26'}}),null);
 assert.equal(staleReportNotice({report:{date:'2026-11-13'}}),null);
 assert.equal(staleReportNotice(null),null);
});
