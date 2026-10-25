/* Loaded by the generated PWA service worker; no financial API is cached here. */
self.addEventListener('message',event=>{if(event.data?.type==='ATLAS_PUSH_READY')event.ports?.[0]?.postMessage({ready:true});});
self.addEventListener('push',event=>{
 let message={title:'Market Atlas',body:'有新的盘中研究信号，请打开信号中心。',url:'/?view=signals',tag:'atlas-signal'};
 try{const data=event.data?.json();if(data&&typeof data==='object')message={...message,...data};}catch{}
 let url;try{url=new URL(message.url,self.location.origin);if(url.origin!==self.location.origin)url=new URL('/?view=signals',self.location.origin);}catch{url=new URL('/?view=signals',self.location.origin);}
 event.waitUntil(self.registration.showNotification(String(message.title).slice(0,100),{body:String(message.body).slice(0,700),icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:String(message.tag).slice(0,160),data:{url:url.href},renotify:false}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();let url;try{url=new URL(event.notification.data?.url,self.location.origin);if(url.origin!==self.location.origin)return;}catch{return;}
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const window=windows.find(w=>new URL(w.url).origin===url.origin);if(window){await window.navigate(url.href);return window.focus();}return self.clients.openWindow(url.href);})());
});
