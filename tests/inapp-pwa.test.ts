import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFeed} from '../src/worker/index';

test('RSS article stays attributed and in-app synopsis is from publisher, not invented',()=>{
 const xml='<rss><channel><item><title>Company publishes results</title>'+
  '<link>https://publisher.example/story/1</link>'+
  '<description><![CDATA[<p>Revenue was announced. <strong>Full context is in filings.</strong></p>]]></description>'+
  '<pubDate>Sat, 10 Oct 2026 04:00:00 GMT</pubDate></item></channel></rss>';
 const [article]=parseFeed(xml,'macro','Publisher');
 assert.equal(article.title,'Company publishes results');
 assert.equal(article.source,'Publisher');
 assert.equal(article.summary,'Revenue was announced. Full context is in filings.');
 assert.equal(article.publishedAt,'2026-10-10T04:00:00.000Z');
});
test('empty RSS summary stays absent and does not fabricate article content',()=>{
 const xml='<rss><channel><item><title>Event headline confirmed</title>'+
 '<link>https://publisher.example/story/2</link></item></channel></rss>';
 const [article]=parseFeed(xml,'world','Publisher');
 assert.equal(article.summary,undefined);
});
test('no app-owned research UI opens a third-party new tab',()=>{
 const files=['src/client/App.tsx','src/client/components/IntelPanels.tsx',
 'src/client/components/InAppReader.tsx','src/client/components/TradingViewWidget.tsx'];
 for(const path of files){
  const text=readFileSync(path,'utf8');
  assert.doesNotMatch(text,/target=["']_blank["']/g,path);
  assert.doesNotMatch(text,/window\.open\(/g,path);
 }
});
test('PWA manifest config has standalone mode and HTTP API requests network-only',()=>{
 const config=readFileSync('vite.config.ts','utf8');
 assert.match(config,/display:'standalone'/);
 assert.match(config,/handler:'NetworkOnly'/);
 assert.match(config,/navigateFallbackDenylist:/);
 assert.match(config,/icon-512-maskable\.png/);
});
