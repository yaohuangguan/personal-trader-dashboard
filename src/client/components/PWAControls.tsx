import {useCallback,useEffect,useState} from 'react';
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
 const {needRefresh:[needRefresh,setNeedRefresh],offlineReady:[offlineReady,setOfflineReady],updateServiceWorker}=useRegisterSW({
  onRegisteredSW(_url,registration){if(registration){const onFocus=()=>registration.update().catch(()=>{});window.addEventListener('focus',onFocus);}},
  onRegisterError(err){console.warn('PWA update registration failed',err);}
 });
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
  <button type="button" className="pwa-install-trigger" title="安装到手机或桌面" onClick={install}>
   {installed?<Smartphone size={16}/>:<Download size={16}/>}<span>{installed?'已作为应用运行':'安装应用'}</span>
  </button>
  {!online&&<div className="pwa-state-message"><WifiOff size={16}/> 当前离线：可打开已缓存界面与本地收藏；实时行情、新闻需联网。</div>}
  {needRefresh&&<div className="pwa-update-banner"><RefreshCw size={18}/><span>发现新版本，更新后启用最新研究功能。</span><button onClick={()=>updateServiceWorker(true)}>立即更新</button><button aria-label="稍后更新" onClick={()=>setNeedRefresh(false)}><X size={16}/></button></div>}
  {offlineReady&&<div className="pwa-update-banner"><Smartphone size={17}/><span>应用界面已缓存，可离线打开。</span><button onClick={()=>setOfflineReady(false)}>知道了</button></div>}
  {open&&<div className="pwa-help-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
   <div className="pwa-help-dialog" role="dialog" aria-modal="true" aria-label="安装 Market Atlas">
    <div className="pwa-help-title"><h2>安装 Market Atlas</h2><button aria-label="关闭" onClick={()=>setOpen(false)}><X size={18}/></button></div>
    {ios?<p>在 iPhone / iPad Safari 中，点击浏览器的分享图标，选择「添加到主屏幕」，即可作为独立应用打开。</p>:
     <p>使用 Chrome、Edge 或支持 PWA 的浏览器打开本站，选择地址栏中的「安装」或浏览器菜单的「安装应用」。</p>}
    <p className="pwa-help-foot">安装不需要应用商店。离线时保留应用外壳和设备本地收藏；新闻、行情和公告必须联网更新。</p>
   </div>
  </div>}
 </>;
}
