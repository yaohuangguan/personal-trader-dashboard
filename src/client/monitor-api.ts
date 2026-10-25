import type {MonitorStatus} from '../shared/monitor';
const KEY='atlas.monitor.device.v1';
function credential(){let token=localStorage.getItem(KEY);if(!token||!/^[a-f0-9]{64}$/.test(token)){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');localStorage.setItem(KEY,token);}return token;}
export async function monitorApi<T=MonitorStatus>(action='status',body?:unknown):Promise<T>{
 const r=await fetch('/api/monitor/'+action,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+credential(),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(action==='check'?45000:12000)});
 const data=await r.json();if(!r.ok)throw new Error(data.error||'后台监控暂不可用');return data as T;
}
export async function subscribeMonitor(){
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw new Error('当前浏览器不支持推送；iPhone 请先添加到主屏幕后打开。');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('通知未获允许，请在浏览器站点设置中开启。');
 const {publicKey}=await monitorApi<{publicKey:string}>('public-key');
 const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('通知组件尚未就绪，请更新应用后重试。')),12000))]);
 await new Promise<void>((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('通知组件尚未就绪，请更新应用后重试。'));},2500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.ready?resolve():reject(new Error('通知组件尚未就绪，请更新应用后重试。'));};registration.active?.postMessage({type:'ATLAS_PUSH_READY'},[channel.port2]);});
 const existing=await registration.pushManager.getSubscription();let subscription=existing;
 if(existing){const raw=existing.options.applicationServerKey,expected=Uint8Array.from(atob(publicKey.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(!raw||new Uint8Array(raw).some((v,i)=>v!==expected[i])){await existing.unsubscribe();subscription=null;}}
 if(!subscription){const key=Uint8Array.from(atob(publicKey.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
 await monitorApi('subscribe',{subscription:subscription.toJSON()});
}
export async function unsubscribeMonitor(){
 await monitorApi('unsubscribe',{});if('serviceWorker'in navigator){const registration=await navigator.serviceWorker.getRegistration();await(await registration?.pushManager.getSubscription())?.unsubscribe();}
}
