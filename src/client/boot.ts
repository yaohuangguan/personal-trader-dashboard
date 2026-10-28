import {startWatchSync} from './watch-sync';
import {migrateClientState} from './migrate-state';
void migrateClientState().then(ready=>{if(ready){void import('./main');startWatchSync();}}).catch(()=>{
 const root=document.getElementById('root')!;root.style.cssText='padding:32px;font:18px system-ui;line-height:1.8;color:#ddd;background:#111;min-height:100vh';
 const message=document.createElement('p');message.textContent='自选恢复暂未完成，旧站的数据仍保留。';
 const retry=document.createElement('button');retry.textContent='重新恢复自选';retry.onclick=()=>location.replace('/?restore=1');root.replaceChildren(message,retry);
});
