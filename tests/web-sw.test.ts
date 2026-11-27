import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const origin='https://atlas.test';
function load(manifest:string[],clients:object[]=[]){
 const stores=new Map<string,Map<string,Response>>(),events=new Map<string,Function>(),fetched:string[]=[],opened:string[]=[];
 const caches={keys:async()=>[...stores.keys()],delete:async(k:string)=>stores.delete(k),open:async(k:string)=>{if(!stores.has(k))stores.set(k,new Map());const map=stores.get(k)!;return {match:async(url:string|Request)=>{const r=map.get(typeof url==='string'?url:url.url);return r?.clone();},put:async(url:string,response:Response)=>{map.set(url,response);}};}};
 const self={location:new URL(origin+'/sw.js'),clients:{matchAll:async()=>clients,claim:async()=>{},openWindow:async(u:string)=>{opened.push(u);}},addEventListener:(event:string,fn:Function)=>events.set(event,fn),skipWaiting:async()=>{},registration:{showNotification:async()=>{}}};
 const source=readFileSync(new URL('../src/pwa/sw.js',import.meta.url),'utf8').replace('__APP_BUILD__','"new-build"').replace('self.__WB_MANIFEST',JSON.stringify(manifest));
 runInNewContext(source,{self,caches,URL,Request,Response,Headers,AbortController,setTimeout,clearTimeout,fetch:async(request:Request)=>{fetched.push(request.url);return new Response(request.url.endsWith('.js')?'export {}':'<main/>',{headers:{'content-type':request.url.endsWith('.js')?'application/javascript':'text/html'}});}});
 const dispatch=async(type:string,extra:object={})=>{const pending:Promise<unknown>[]=[];events.get(type)!({waitUntil:(p:Promise<unknown>)=>pending.push(p),...extra});await Promise.all(pending);};
 return {stores,caches,fetched,opened,dispatch};
}

test('a deploy copies unchanged hashed assets from the previous shell cache instead of downloading them',async()=>{
 const w=load(['index.html','assets/charts-BaHkp9G7.js','assets/main-NEWhash1.js']);
 await (await w.caches.open('guanlan-shell-old')).put(origin+'/assets/charts-BaHkp9G7.js',new Response('old charts',{headers:{'content-type':'application/javascript'}}));
 await w.dispatch('install');
 assert.deepEqual(w.fetched.sort(),[origin+'/assets/main-NEWhash1.js',origin+'/index.html']);
 assert.equal(await w.stores.get('guanlan-shell-new-build')!.get(origin+'/assets/charts-BaHkp9G7.js')!.text(),'old charts');
});
test('unhashed files are always fetched fresh even when an old copy exists',async()=>{
 const w=load(['index.html','favicon.svg']);
 await (await w.caches.open('guanlan-shell-old')).put(origin+'/favicon.svg',new Response('<svg/>'));
 await w.dispatch('install');
 assert.ok(w.fetched.includes(origin+'/favicon.svg'));
});
test('notification click on an uncontrolled window falls back to a navigate message',async()=>{
 const messages:unknown[]=[];let focused=false;
 const client={url:origin+'/',focused:false,focus:async()=>{focused=true;},navigate:async()=>{throw new TypeError('not controlled');},postMessage:(m:unknown)=>messages.push(m)};
 const w=load(['index.html'],[client]);
 await w.dispatch('notificationclick',{notification:{close(){},data:{url:origin+'/?view=signals'}}});
 assert.ok(focused);
 assert.equal(JSON.stringify(messages),JSON.stringify([{type:'ATLAS_NAVIGATE',url:origin+'/?view=signals'}]),'objects come from the worker realm');
 const empty=load(['index.html'],[]);
 await empty.dispatch('notificationclick',{notification:{close(){},data:{url:origin+'/?view=signals'}}});
 assert.deepEqual(empty.opened,[origin+'/?view=signals']);
});
