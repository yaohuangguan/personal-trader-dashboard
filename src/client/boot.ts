import {APP_BUILD,startUpdater,applyUpdate,checkUpdate} from './pwa-updater';
import {startWatchSync} from './watch-sync';
import {migrateClientState} from './migrate-state';
import {loadDictionary,storedLocale} from './i18n';
document.documentElement.dataset.appBuild=APP_BUILD;
// The dev server has no generated service worker; registering would only produce an update error.
if(!import.meta.env.DEV)void startUpdater();
function failed(message:string,retry:()=>void){
 const root=document.getElementById('root')!;root.style.cssText='padding:32px;font:18px system-ui;line-height:1.8;color:#ddd;background:#111;min-height:100vh';
 const text=document.createElement('p');text.textContent=message;const button=document.createElement('button');button.textContent='重试';button.onclick=retry;root.replaceChildren(text,button);
}
void(async()=>{
 let ready=false;try{ready=await migrateClientState();}catch{failed('自选恢复暂未完成，旧站的数据仍保留。',()=>location.replace('/?restore=1'));return;}
 if(!ready)return;
 // English mode: load the dictionary chunk first so the first paint is already translated.
 const dictionary=storedLocale()==='en'?loadDictionary():Promise.resolve(true);
 try{await dictionary;await import('./main');startWatchSync();}catch(error){console.error('[atlas] boot failed',error);failed('页面资源未加载完成，请联网后检查更新。自选与分组仍保留。',()=>{void checkUpdate().then(applyUpdate);});}
})();
