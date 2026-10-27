import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
 plugins: [
  react(),
  VitePWA({
   registerType:'prompt',
   injectRegister:null,
   includeAssets:['favicon.svg','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'],
   manifest:{
    id:'/',name:'观澜 · Market Atlas',short_name:'观澜',
    description:'全球信息、产业催化、证券研究与公告，统一站内阅读。',
    start_url:'/',scope:'/',display:'standalone',display_override:['window-controls-overlay','standalone'],
    theme_color:'#101012',background_color:'#101012',lang:'zh-CN',
    categories:['finance','news','productivity'],
    icons:[
     {src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
     {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
     {src:'/icons/icon-512-maskable.png',sizes:'512x512',type:'image/png',purpose:'maskable'}
    ]
   },
   workbox:{
    importScripts:['/push-worker.js'],
    navigateFallback:'/index.html',
    navigateFallbackDenylist:[/^\/api\//],
    globPatterns:['**/*.{html,js,css,svg,png,woff2,ico}'],
    cleanupOutdatedCaches:true,
    skipWaiting:false,
    clientsClaim:true,
    runtimeCaching:[
     // Financial and news APIs must always be requested from the network, never served as "current" from an offline cache.
     {urlPattern:({url}: {url:URL})=>url.origin===self.location.origin&&url.pathname.startsWith('/api/'),
      handler:'NetworkOnly' as const},
     {urlPattern:/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/,
      handler:'StaleWhileRevalidate',options:{cacheName:'market-atlas-fonts',expiration:{maxEntries:16,maxAgeSeconds:60*60*24*30}}}
    ]
   }
  })
 ],
 server:{port:5173,proxy:{'/api':'http://127.0.0.1:8787'}},
 build:{target:'es2022',rollupOptions:{output:{manualChunks:{charts:['lightweight-charts'],primitives:['@radix-ui/react-tabs','@radix-ui/react-tooltip','@radix-ui/react-dialog']}}}}
});
