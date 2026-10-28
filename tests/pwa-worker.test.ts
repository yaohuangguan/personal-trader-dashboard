import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function worker(fail=false){
 const stores=new Map<string,Map<string,Response>>(),events=new Map<string,Function>(),messages:Record<string,unknown>[]=[],origin='https://atlas.test';let fetches=0,claimed=false;
 const caches={keys:async()=>[...stores.keys()],delete:async(k:string)=>stores.delete(k),open:async(k:string)=>{if(!stores.has(k))stores.set(k,new Map());const map=stores.get(k)!;return {match:async(url:string|Request)=>map.get(typeof url==='string'?url:url.url),put:async(url:string,response:Response)=>{map.set(url,response);}};}};
 const self={location:new URL(origin+'/sw.js'),clients:{matchAll:async()=>[{postMessage:(data:Record<string,unknown>)=>messages.push({...data})}],claim:async()=>{claimed=true;}},addEventListener:(event:string,fn:Function)=>events.set(event,fn),skipWaiting:async()=>{},registration:{showNotification:async()=>{}}};
 const source=readFileSync(new URL('../src/pwa/sw.js',import.meta.url),'utf8').replace('__APP_BUILD__','"test-build"').replace('self.__WB_MANIFEST',JSON.stringify(['index.html','assets/main.js']));
 runInNewContext(source,{self,caches,URL,Request,Response,AbortController,setTimeout,clearTimeout,fetch:async(request:Request)=>{fetches++;return new Response(request.url.endsWith('.js')?'export {}':'<main>app</main>',{status:fail&&request.url.endsWith('.js')?503:200,headers:{'content-type':request.url.endsWith('.js')?'application/javascript':'text/html'}});}});
 const dispatch=async(type:string,extra:object={})=>{const pending:Promise<unknown>[]=[];events.get(type)!({waitUntil:(p:Promise<unknown>)=>pending.push(p),...extra});await Promise.all(pending);};
 return {stores,caches,events,messages,dispatch,get fetches(){return fetches;},get claimed(){return claimed;}};
}
test('shell update reports real completed assets, activates only a complete cache and never intercepts API requests',async()=>{
 const w=worker();await w.dispatch('install');const progress=w.messages.filter(m=>m.phase==='downloading').map(m=>Number(m.completed));assert.deepEqual(progress,[0,1,2]);assert.equal(w.messages.at(-1)?.phase,'ready');assert.equal(w.fetches,2);
 await w.dispatch('activate');assert.ok(w.claimed);assert.equal(w.messages.at(-1)?.phase,'active');
 let intercepted=false;w.events.get('fetch')!({request:new Request('https://atlas.test/api/desk/quotes'),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);
});
test('a failed new download leaves the old app cache and user-independent caches intact',async()=>{
 const w=worker(true);await(await w.caches.open('guanlan-shell-old')).put('https://atlas.test/index.html',new Response('old'));await w.caches.open('unrelated-cache');
 await assert.rejects(w.dispatch('install'));assert.equal(w.messages.at(-1)?.phase,'error');assert.equal(w.claimed,false);assert.equal(await w.stores.get('guanlan-shell-old')!.get('https://atlas.test/index.html')!.text(),'old');assert.ok(w.stores.has('unrelated-cache'));
});
