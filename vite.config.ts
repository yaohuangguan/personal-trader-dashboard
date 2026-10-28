import {execFileSync} from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const buildId=process.env.ATLAS_BUILD_ID||execFileSync('git',['rev-parse','--short=8','HEAD'],{encoding:'utf8'}).trim()+'-'+Date.now().toString(36);
export default defineConfig({
 define:{__APP_BUILD__:JSON.stringify(buildId)},
 plugins: [
  react(),
  {name:'atlas-build-version',generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({build:buildId})});}},
  VitePWA({
   strategies:'injectManifest',srcDir:'src/pwa',filename:'sw.js',
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
   injectManifest:{globPatterns:['**/*.{html,js,css,svg,png,woff2,ico,webmanifest}'],maximumFileSizeToCacheInBytes:3*1024*1024}

  })
 ],
 server:{port:5173,proxy:{'/api':'http://127.0.0.1:8787'}},
 build:{target:'es2022',rollupOptions:{output:{manualChunks:{charts:['lightweight-charts'],primitives:['@radix-ui/react-tabs','@radix-ui/react-tooltip','@radix-ui/react-dialog']}}}}
});
