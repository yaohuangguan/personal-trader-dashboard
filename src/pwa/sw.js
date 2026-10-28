/* Asset-only cache. Prices, news, article migration and cloud sync always use the network. */
const BUILD=__APP_BUILD__,CACHE='guanlan-shell-'+BUILD,ENTRIES=self.__WB_MANIFEST;
const urls=[...new Set(ENTRIES.map(v=>new URL(typeof v==='string'?v:v.url,self.location.origin).href))];
let state={type:'ATLAS_UPDATE_STATUS',build:BUILD,phase:'ready',completed:0,total:urls.length,error:''};
async function broadcast(){const message={...state};for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage(message);}
function respond(event,value){event.ports?.[0]?.postMessage(value);}
self.addEventListener('message',event=>{
 if(event.data?.type==='ATLAS_UPDATE_STATUS')respond(event,state);
 if(event.data?.type==='ATLAS_PUSH_READY')respond(event,{ready:true});
 if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
});
self.addEventListener('install',event=>{
 state={...state,phase:'downloading',completed:0};
 event.waitUntil((async()=>{
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),45000);
  try{
   const cache=await caches.open(CACHE),pending=[];
   for(const url of urls){if(await cache.match(url))state.completed++;else pending.push(url);}
   await broadcast();let cursor=0;
   await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
    while(cursor<pending.length){const url=pending[cursor++];let response;
     for(let attempt=0;attempt<2;attempt++){try{response=await fetch(new Request(url,{cache:'reload',credentials:'same-origin',signal:controller.signal}));if(response.ok)break;}catch(e){if(controller.signal.aborted)throw e;}if(attempt===1)throw new Error('资源下载失败');}
     if(!response?.ok)throw new Error('资源下载失败');const contentType=response.headers.get('content-type')||'';if(url.endsWith('.js')&&!/javascript/.test(contentType)||url.endsWith('.css')&&!/text\/css/.test(contentType))throw new Error('资源类型不匹配');await cache.put(url,response);state.completed++;await broadcast();
    }
   }));
   state={...state,phase:'ready',completed:urls.length};await broadcast();
  }catch(e){controller.abort();await caches.delete(CACHE);state={...state,phase:'error',error:'新版本未下载完成，请联网后重试'};await broadcast();throw e;}
  finally{clearTimeout(deadline);}
 })());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 await self.clients.claim();state={...state,phase:'active',completed:urls.length};await broadcast();
 // Keep one previous asset version for open tabs/lazy chunks. Never clear user or push storage.
 const own=(await caches.keys()).filter(k=>k.startsWith('guanlan-shell-')),prior=own.filter(k=>k!==CACHE).at(-1);
 for(const name of own)if(name!==CACHE&&name!==prior)await caches.delete(name);
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||['/sw.js','/version.json'].includes(url.pathname))return;
 if(request.mode==='navigate'){
  if(self.location.hostname==='personal-market-atlas.nzs.workers.dev'){event.respondWith(Response.redirect('https://guanlan.nzs.workers.dev'+url.pathname+url.search));return;}
  event.respondWith((async()=>await(await caches.open(CACHE)).match(new URL('/index.html',self.location.origin).href)||fetch(request))());return;
 }
 if(urls.includes(url.origin+url.pathname)||url.pathname.startsWith('/assets/'))event.respondWith((async()=>{
  const cache=await caches.open(CACHE),hit=await cache.match(url.origin+url.pathname);if(hit)return hit;
  // Old hashed resources may still be needed by another tab during activation.
  if(url.pathname.startsWith('/assets/')){for(const name of await caches.keys()){if(!name.startsWith('guanlan-shell-')&&!name.startsWith('workbox-precache'))continue;const old=await(await caches.open(name)).match(request);if(old)return old;}}
  return fetch(request);
 })());
});
self.addEventListener('push',event=>{
 let message={title:'观澜',body:'收盘研究报告已更新。',url:'/?view=signals',tag:'atlas-close'};try{message={...message,...event.data?.json()};}catch{}
 let url;try{url=new URL(message.url,self.location.origin);if(url.origin!==self.location.origin)url=new URL('/?view=signals',self.location.origin);}catch{url=new URL('/?view=signals',self.location.origin);}
 event.waitUntil(self.registration.showNotification(String(message.title).slice(0,100),{body:String(message.body).slice(0,700),icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:String(message.tag).slice(0,160),data:{url:url.href}}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{let url;try{url=new URL(event.notification.data?.url,self.location.origin);if(url.origin!==self.location.origin)return;}catch{return;}const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});if(windows[0]){await windows[0].navigate(url.href);await windows[0].focus();}else await self.clients.openWindow(url.href);})());});
