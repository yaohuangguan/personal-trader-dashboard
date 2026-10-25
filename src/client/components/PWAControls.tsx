import {t as uiText} from '../preferences';
import {useCallback,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {Download,RefreshCw,Smartphone,WifiOff,X} from 'lucide-react';
import {useRegisterSW} from 'virtual:pwa-register/react';

type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed';platform:string}>};
function standalone(){
 return window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
}
export default function PWAControls(){
 const [offer,setOffer]=useState<InstallEvent|null>(null),[installed,setInstalled]=useState(standalone);
 const [open,setOpen]=useState(false),[online,setOnline]=useState(navigator.onLine);
 const [ios,setIos]=useState(false);
 const [registration,setRegistration]=useState<ServiceWorkerRegistration|null>(null);
 const {needRefresh:[needRefresh,setNeedRefresh],offlineReady:[offlineReady,setOfflineReady],updateServiceWorker}=useRegisterSW({
  onRegisteredSW(_url,registration){setRegistration(registration||null);},
  onRegisterError(err){console.warn('PWA update registration failed',err);}
 });
 useEffect(()=>{if(!registration)return;const onFocus=()=>{void registration.update().catch(()=>{});};window.addEventListener('focus',onFocus);return()=>window.removeEventListener('focus',onFocus);},[registration]);
 useEffect(()=>{if(!offlineReady)return;const timer=setTimeout(()=>setOfflineReady(false),8000);return()=>clearTimeout(timer);},[offlineReady,setOfflineReady]);
 useEffect(()=>{
  const receive=(e:Event)=>{e.preventDefault();setOffer(e as InstallEvent);};
  const installedFn=()=>{setInstalled(true);setOffer(null);setOpen(false);};
  const onOnline=()=>setOnline(true),onOffline=()=>setOnline(false);
  window.addEventListener('beforeinstallprompt',receive);
  window.addEventListener('appinstalled',installedFn);
  window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);
  setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent));
  return ()=>{window.removeEventListener('beforeinstallprompt',receive);window.removeEventListener('appinstalled',installedFn);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);};
 },[]);
 const install=useCallback(async()=>{
  if(!offer){setOpen(true);return;}
  await offer.prompt();
  const result=await offer.userChoice;
  if(result.outcome==='accepted')setOffer(null);
  setOpen(false);
 },[offer]);
 return <>
  <button type="button" className="pwa-install-trigger" title={uiText("安装到手机或桌面")} onClick={install}>
   {uiText(installed?<Smartphone size={16}/>:<Download size={16}/>)}<span>{uiText(installed?'已作为应用运行':'安装应用')}</span>
  </button>
  {uiText(createPortal(<div className="pwa-toast-stack" aria-live="polite">
   {uiText(!online&&<div className="pwa-toast"><WifiOff size={18}/><span>{uiText("当前离线：可打开已缓存界面与本地收藏；实时行情、新闻需联网。")}</span></div>)}
   {uiText(needRefresh?<div className="pwa-toast"><RefreshCw size={20}/><span>{uiText("发现新版本，更新后启用最新研究功能。")}</span><button onClick={()=>updateServiceWorker(true)}>{uiText("立即更新")}</button><button aria-label={uiText("稍后更新")} onClick={()=>setNeedRefresh(false)}><X size={20}/></button></div>:offlineReady&&<div className="pwa-toast"><Smartphone size={20}/><span>{uiText("应用界面已缓存，可离线打开。")}</span><button onClick={()=>setOfflineReady(false)}>{uiText("知道了")}</button></div>)}
  </div>,document.body))}
  <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="pwa-help-backdrop"/><Dialog.Content className="pwa-help-dialog pwa-help-modal">
    <div className="pwa-help-title"><Dialog.Title>{uiText("安装 Market Atlas")}</Dialog.Title><Dialog.Close asChild><button aria-label={uiText("关闭")}><X size={20}/></button></Dialog.Close></div>
    {uiText(ios?<p>{uiText("在 iPhone / iPad Safari 中，点击浏览器的分享图标，选择「添加到主屏幕」，即可作为独立应用打开。")}</p>:
     <p>{uiText("使用 Chrome、Edge 或支持 PWA 的浏览器打开本站，选择地址栏中的「安装」或浏览器菜单的「安装应用」。")}</p>)}
    <Dialog.Description className="pwa-help-foot">{uiText("安装不需要应用商店。离线时保留应用外壳和设备本地收藏；新闻、行情和公告必须联网更新。")}</Dialog.Description>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </>;
}
