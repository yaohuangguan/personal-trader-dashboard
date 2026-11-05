import {projectMarket} from '../src/shared/market-projection';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translateUI} from '../src/shared/ui-translation';
import dictionary from '../src/client/translations.json';
test('web and native English catalogs stay identical with valid placeholders',()=>{
 const native=JSON.parse(readFileSync(new URL('../mobile/assets/strings_en.json',import.meta.url),'utf8'));
 assert.deepEqual(native,dictionary);
 for(const [key,value] of Object.entries(dictionary)){
  assert.ok(value.trim(),key);
  const tokens=(s:string)=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  assert.deepEqual(tokens(value),tokens(key),key);
 }
});
test('English translates catalogued dynamic states and leaves source articles untouched',()=>{
 assert.equal(translateUI('15 个候选',dictionary),'15 candidates');
 assert.equal(translateUI('已同步 · 15:32',dictionary),'Synced · 15:32');
 assert.equal(translateUI('当前结构：多头趋势延续；近5根涨跌 2.35%。',dictionary),'Current structure: Uptrend continuation; five-bar change: 2.35%.');
 assert.equal(translateUI('从12段同股相似窗口中选整段路径',dictionary),'Whole paths selected from 12 similar windows in this stock');
 assert.equal(translateUI('2.50亿',dictionary),'250M');
 assert.equal(translateUI('招商银行发布年度业绩报告',dictionary),'招商银行发布年度业绩报告');
});

test('all generated projection evidence is English, including numeric facts and scenario paths',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/002472-20261020.json',import.meta.url),'utf8'));
 const projection=projectMarket(fixture.candles,{symbol:'NVDA',now:new Date('2026-10-20T22:00:00Z')});
 assert.equal(projection.available,true);
 const text=[projection.notice,projection.basis!.regime,...projection.basis!.facts,...projection.basis!.limitations,...projection.conditions.map(c=>c.text),...projection.scenarios.flatMap(s=>[s.label,s.explanation!])];
 for(const value of text)assert.ok(!/[\u3400-\u9fff]/.test(translateUI(value,dictionary)),value);
});
