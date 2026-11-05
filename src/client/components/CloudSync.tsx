import {t,usePreferences} from '../preferences';
import {useEffect,useState} from 'react';
import {connectSync,disconnectSync,syncKey,syncStatus,syncWatch} from '../watch-sync';
export default function CloudSync(){
 usePreferences();
 const [status,setStatus]=useState(syncStatus),[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const listener=()=>setStatus(syncStatus);window.addEventListener('atlas:sync-status',listener);return()=>window.removeEventListener('atlas:sync-status',listener);},[]);
 const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');try{await task();setStatus(syncStatus);setKey('');}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <fieldset><legend>{t('自选云同步')}</legend><p role="status">{t(status)}</p><p>{t('在另一设备输入同一同步密钥，自选与分组会自动同步；离线修改联网后补传。密钥仅交给自己的设备。')}</p><div className="settings-options">{syncKey()?<><button disabled={busy} onClick={()=>void run(syncWatch)}>{t('立即同步')}</button><button onClick={()=>void navigator.clipboard.writeText(syncKey()).then(()=>setStatus('同步密钥已复制'))}>{t('复制同步密钥')}</button><button onClick={()=>{disconnectSync();setStatus(syncStatus);}}>{t('断开本机')}</button></>:<button disabled={busy} onClick={()=>void run(()=>connectSync())}>{t('创建我的云同步')}</button>}</div><label>{t('连接已有同步')}<input type="password" autoComplete="off" aria-label={t('同步密钥')} placeholder={t('粘贴另一设备的同步密钥')} value={key} onChange={e=>setKey(e.target.value.trim())}/></label><button disabled={busy||!/^[A-Za-z0-9_-]{43}$/.test(key)} onClick={()=>void run(()=>connectSync(key))}>{t('连接并合并自选')}</button>{error&&<p role="alert">{t(error)}</p>}<p><a href="/?restore=1">{t('恢复旧站自选、分组和设置')}</a></p></fieldset>;
}
