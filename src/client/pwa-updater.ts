export type UpdateState={phase:'idle'|'checking'|'downloading'|'ready'|'applying'|'reloading'|'success'|'error';build:string;completed:number;total:number;error:string};
declare const __APP_BUILD__:string;
export const APP_BUILD=__APP_BUILD__;
let state:UpdateState={phase:'idle',build:APP_BUILD,completed:0,total:0,error:''},registration:ServiceWorkerRegistration|undefined,started=false,listening=false,applying=false,reloaded=false,lastCheck=0,applyTimer:ReturnType<typeof setTimeout>|undefined;
const tracked=new WeakSet<ServiceWorkerRegistration>(),installingWorkers=new WeakSet<ServiceWorker>();
let applyingTo:ServiceWorker|undefined;
const listeners=new Set<()=>void>();
const set=(value:Partial<UpdateState>)=>{state={...state,...value};for(const fn of listeners)fn();};
export const subscribeUpdate=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const updateSnapshot=()=>state;
function status(worker:ServiceWorker){return new Promise<{build:string;phase:string;completed:number;total:number}>(resolve=>{const channel=new MessageChannel(),empty={build:'',phase:'',completed:0,total:0},timer=setTimeout(()=>{channel.port1.close();resolve(empty);},2000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};try{worker.postMessage({type:'ATLAS_UPDATE_STATUS'},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve(empty);}});}
async function activated(){
 const controller=navigator.serviceWorker.controller;if(!controller)return;
 const info=await status(controller);if(info.build===APP_BUILD){if(!applying||controller===applyingTo){clearTimeout(applyTimer);applying=false;set({phase:'success',build:APP_BUILD,error:''});}return;}
 if(!info.build||reloaded)return;
 clearTimeout(applyTimer);reloaded=true;set({phase:'reloading',build:info.build,completed:state.total,error:''});
 try{sessionStorage.setItem('atlas.update.expected',info.build);}catch{}
 setTimeout(()=>location.reload(),120);
}
function track(reg:ServiceWorkerRegistration){
 registration=reg;const inspect=()=>{const installing=reg.installing;
  if(reg.waiting){set({phase:'ready',error:''});void status(reg.waiting).then(info=>{if(info.build)set({build:info.build,completed:info.total,total:info.total});});}
  if(installing&&!installingWorkers.has(installing)){installingWorkers.add(installing);set({phase:'downloading',completed:0,total:0,error:''});installing.addEventListener('statechange',()=>{if(installing.state==='installed'){if(reg.waiting)inspect();else set({phase:'success',build:APP_BUILD,error:''});}else if(installing.state==='redundant'&&!reg.waiting)set({phase:'error',error:'新版本下载失败，当前版本仍可使用。'});});void status(installing).then(info=>{if(info.build&&reg.installing===installing)set({build:info.build,completed:info.completed,total:info.total});});}
 };if(!tracked.has(reg)){tracked.add(reg);reg.addEventListener('updatefound',inspect);}inspect();
}
export async function startUpdater(){
 if(started||!('serviceWorker'in navigator))return;started=true;
 try{const expected=sessionStorage.getItem('atlas.update.expected');if(expected){sessionStorage.removeItem('atlas.update.expected');set({phase:expected===APP_BUILD?'success':'error',error:expected===APP_BUILD?'':'更新未生效，请重新检查更新。'});}}catch{}
 if(!listening){listening=true;
 navigator.serviceWorker.addEventListener('controllerchange',()=>void activated());
 navigator.serviceWorker.addEventListener('message',event=>{const data=event.data;if(data?.type!=='ATLAS_UPDATE_STATUS'||typeof data.build!=='string')return;
  if(data.phase==='active'){if(data.build!==APP_BUILD)void activated();else if(!applying||navigator.serviceWorker.controller===applyingTo){clearTimeout(applyTimer);applying=false;set({phase:'success',build:APP_BUILD,error:''});}return;}
  if(data.phase==='downloading'||data.phase==='ready'||data.phase==='error')set({phase:data.phase,build:data.build,completed:Number(data.completed)||0,total:Number(data.total)||0,error:data.error||''});
 });
 const resume=()=>{if(!document.hidden&&navigator.onLine&&Date.now()-lastCheck>60000)void checkUpdate();};window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
 }
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{track(await Promise.race([navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('更新服务连接超时')),12000);})]));}catch{set({phase:'error',error:'更新服务连接失败或超时，请检查网络后重试。'});}finally{clearTimeout(timer);}
}
export async function checkUpdate(){
 if(applying||state.phase==='checking'||state.phase==='downloading')return;
 lastCheck=Date.now();set({phase:'checking',error:''});let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  if(!navigator.onLine)throw Error('当前离线，联网后可重试；自选保留。');
  if(!registration){started=false;await startUpdater();}if(!registration)throw Error('此浏览器暂不能连接更新服务。');
  await Promise.race([registration.update(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('检查超时，当前版本仍可使用，请重试。')),12000);})]);
  if(registration.waiting){set({phase:'ready'});return;}if(registration.installing)return;
  if(updateSnapshot().phase==='checking')set({phase:'success',build:APP_BUILD,error:''});
 }catch(e){set({phase:'error',error:e instanceof Error?e.message:'检查更新失败，请重试。'});}finally{clearTimeout(timer);}
}
export async function applyUpdate(){
 if(applying)return;
 if(!registration?.waiting){await checkUpdate();if(!registration?.waiting){if(state.phase==='success')location.reload();return;}}
 applying=true;applyingTo=registration.waiting;set({phase:'applying',error:''});
 applyTimer=setTimeout(()=>{applying=false;set({phase:'error',error:'新版本切换超时；请重试，或关闭其他观澜窗口后再更新。'});},15000);
 registration.waiting.postMessage({type:'SKIP_WAITING'});
 // Handles browsers where activation finished just before the listener was attached.
 setTimeout(()=>{if(navigator.serviceWorker.controller&&navigator.serviceWorker.controller!==registration?.waiting)void activated();},800);
}
