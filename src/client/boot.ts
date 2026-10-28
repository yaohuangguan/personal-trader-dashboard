import {APP_BUILD,startUpdater,applyUpdate,checkUpdate} from './pwa-updater';
import {startWatchSync} from './watch-sync';
import {migrateClientState} from './migrate-state';
document.documentElement.dataset.appBuild=APP_BUILD;
void startUpdater();
function failed(message:string,retry:()=>void){
 const root=document.getElementById('root')!;root.style.cssText='padding:32px;font:18px system-ui;line-height:1.8;color:#ddd;background:#111;min-height:100vh';
 const text=document.createElement('p');text.textContent=message;const button=document.createElement('button');button.textContent='重试';button.onclick=retry;root.replaceChildren(text,button);
}
void(async()=>{
 let ready=false;try{ready=await migrateClientState();}catch{failed('自选恢复暂未完成，旧站的数据仍保留。',()=>location.replace('/?restore=1'));return;}
 if(!ready)return;
 try{await import('./main');startWatchSync();}catch{failed('页面资源未加载完成，请联网后检查更新。自选与分组仍保留。',()=>{void checkUpdate().then(applyUpdate);});}
})();
