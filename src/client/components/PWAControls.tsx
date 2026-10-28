import {t as uiText} from '../preferences';
import {useCallback,useEffect,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {Download,RefreshCw,Smartphone,WifiOff,X} from 'lucide-react';
import {APP_BUILD,subscribeUpdate,updateSnapshot,checkUpdate,applyUpdate} from '../pwa-updater';
import './PWAControls.css';

type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed';platform:string}>};
function standalone(){
 return window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
}
export default function PWAControls(){
 const [offer,setOffer]=useState<InstallEvent|null>(null),[installed,setInstalled]=useState(standalone);
 const [open,setOpen]=useState(false),[online,setOnline]=useState(navigator.onLine);
 const [ios,setIos]=useState(false);
 const update=useSyncExternalStore(subscribeUpdate,updateSnapshot),[dismissed,setDismissed]=useState('');
 const busy=['checking','downloading','applying','reloading'].includes(update.phase),ready=update.phase==='ready',error=update.phase==='error';
 const progress=update.total?Math.min(100,Math.round(update.completed/update.total*100)):0;
 const title=update.phase==='checking'?'正在检查新版本':update.phase==='downloading'?'正在下载新版本':ready?'新版本已下载，可以更新':update.phase==='applying'?'正在切换到新版本':update.phase==='reloading'?'切换完成，正在重新打开':error?'更新未完成':update.phase==='success'?'当前版本已就绪':'';
 const showUpdate=(busy||ready||error)&&dismissed!==update.build+update.phase;
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
   {showUpdate&&<div className="pwa-toast pwa-update-toast"><div className="pwa-update-body"><b role="status">{uiText(title)}</b>{update.phase==='downloading'&&<span>{update.total?`${update.completed} / ${update.total} ${uiText('个文件')} · ${progress}%`:uiText('正在准备资源清单…')}</span>}{error&&<p role="alert">{uiText(update.error)}</p>}{busy&&<progress aria-label={uiText('应用更新进度')} max={100} value={update.phase==='downloading'&&update.total?progress:update.phase==='reloading'?100:undefined}/>}<small>{uiText('自选、分组与设置会保留。')}</small></div>{ready&&<button onClick={()=>void applyUpdate()}>{uiText('立即更新')}</button>}{error&&<button onClick={()=>void checkUpdate().then(()=>{if(updateSnapshot().phase==='ready')void applyUpdate();})}>{uiText('重试更新')}</button>}{!busy&&<button aria-label={uiText('稍后更新')} onClick={()=>setDismissed(update.build+update.phase)}><X size={20}/></button>}</div>}

  </div>,document.body))}
  <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="pwa-help-backdrop"/><Dialog.Content className="pwa-help-dialog pwa-help-modal">
    <div className="pwa-help-title"><Dialog.Title>{uiText("安装 Market Atlas")}</Dialog.Title><Dialog.Close asChild><button aria-label={uiText("关闭")}><X size={20}/></button></Dialog.Close></div>
    {uiText(ios?<p>{uiText("在 iPhone / iPad Safari 中，点击浏览器的分享图标，选择「添加到主屏幕」，即可作为独立应用打开。")}</p>:
     <p>{uiText("使用 Chrome、Edge 或支持 PWA 的浏览器打开本站，选择地址栏中的「安装」或浏览器菜单的「安装应用」。")}</p>)}
    <section className="pwa-version-panel"><b>{uiText('应用与更新')}</b><p>{uiText(title||'当前版本')} · <code>{APP_BUILD}</code></p>{update.phase==='downloading'&&<progress aria-label={uiText('应用更新进度')} max={100} value={update.total?progress:undefined}/>}<div><button disabled={busy} onClick={()=>{setDismissed('');void checkUpdate();}}>{uiText('检查更新')}</button>{ready&&<button onClick={()=>void applyUpdate()}>{uiText('立即更新')}</button>}</div>{error&&<p role="alert">{uiText(update.error)}</p>}</section>
    <Dialog.Description className="pwa-help-foot">{uiText("安装不需要应用商店。离线时保留应用外壳和设备本地收藏；新闻、行情和公告必须联网更新。")}</Dialog.Description>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </>;
}
