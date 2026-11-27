import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translateUI} from '../src/shared/ui-translation';
import shared from '../src/client/translations.json';
import web from '../src/client/translations-web.json';

// Web-only strings live in a separate catalogue so the shared web/native catalogue stays identical to mobile.
test('web-only English catalogue has valid placeholders and does not contradict the shared catalogue',()=>{
 const tokens=(s:string)=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
 for(const [key,value] of Object.entries(web)){
  assert.ok(value.trim(),key);
  assert.deepEqual(tokens(value),tokens(key),key);
  if(Object.hasOwn(shared,key))assert.equal(value,(shared as Record<string,string>)[key],key);
 }
});
test('merged catalogue translates web-only templates',()=>{
 const merged={...shared,...web};
 assert.equal(translateUI('阅读内容暂时无法显示',merged),'Reader content is temporarily unavailable');
});
test('string literals passed to t() in new web modules have English entries',()=>{
 const merged={...shared,...web} as Record<string,string>;
 const files=['src/client/components/ErrorBoundary.tsx','src/client/main.tsx','src/client/components/LiveAlerts.tsx','src/client/components/WatchSidebar.tsx','src/client/components/ResearchDesk.tsx','src/client/components/MarketChart.tsx','src/client/components/IntradayChart.tsx','src/client/components/DailyTrendPanel.tsx','src/client/components/ExtendedQuote.tsx'];
 for(const file of files){
  const source=readFileSync(file,'utf8');
  for(const match of source.matchAll(/\b(?:t|uiText|copyText)\(\s*(['"])((?:(?!\1).)*[㐀-鿿](?:(?!\1).)*)\1\s*\)/g))assert.equal(translateUI(match[2],merged)!==match[2]||Object.hasOwn(merged,match[2]),true,file+': '+match[2]);
 }
});
