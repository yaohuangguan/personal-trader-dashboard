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
 const files=['src/client/components/ErrorBoundary.tsx','src/client/main.tsx'];
 for(const file of files){
  const source=readFileSync(file,'utf8');
  for(const match of source.matchAll(/\bt\('([^']*[㐀-鿿][^']*)'\)/g))assert.ok(Object.hasOwn(merged,match[1]),file+': '+match[1]);
 }
});
