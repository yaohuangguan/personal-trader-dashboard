import {useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {Share2,Copy,X} from 'lucide-react';
import {t} from '../preferences';
import './StockSnapshot.css';

export default function StockSnapshot({symbol}:{symbol:string}) {
 const [busy,setBusy]=useState(false),[snapshot,setSnapshot]=useState<{blob:Blob;url:string}|null>(null),[message,setMessage]=useState('');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>()=>{if(snapshot)URL.revokeObjectURL(snapshot.url);},[snapshot]);
 const file=(blob:Blob)=>new File([blob],`guanlan-${symbol.replace(/[^A-Za-z0-9.-]/g,'')}.png`,{type:'image/png'});
 const share=async(blob:Blob)=>{
  const files=[file(blob)];
  if(!navigator.canShare?.({files}))return false;
  try{await navigator.share({files});return true;}catch(error){if((error as Error).name==='AbortError')return true;return false;}
 };
 const capture=async()=>{
  if(busy)return;setBusy(true);setMessage('');
  try{
   const {default:html2canvas}=await import('html2canvas');
   const canvas=await html2canvas(document.body,{x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight,scale:Math.min(window.devicePixelRatio||1,2),useCORS:true,allowTaint:false,logging:false,imageTimeout:2500,backgroundColor:getComputedStyle(document.body).backgroundColor});
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('capture')),'image/png'));
   canvas.width=0;canvas.height=0;
   if(!mounted.current)return;
   if(!await share(blob)&&mounted.current)setSnapshot({blob,url:URL.createObjectURL(blob)});
  }catch{if(mounted.current)setMessage(t('截图失败，请稍后重试'));}
  finally{if(mounted.current)setBusy(false);}
 };
 const copy=async()=>{
  if(!snapshot)return;
  try{await navigator.clipboard.write([new ClipboardItem({'image/png':snapshot.blob})]);setMessage(t('截图已复制，可在微信中粘贴发送'));}
  catch{setMessage(t('浏览器未允许复制图片，请允许剪贴板权限后重试'));}
 };
 return <><button type="button" onClick={capture} disabled={busy} data-html2canvas-ignore="true" aria-label={t('分享当前画面')}><Share2 size={14}/>{t(busy?'生成截图…':'分享')}</button>
  {!snapshot&&message&&<span role="status">{message}</span>}
  <Dialog.Root open={!!snapshot} onOpenChange={open=>{if(!open){setSnapshot(null);setMessage('');}}}><Dialog.Portal>
   <Dialog.Overlay className="snapshot-overlay" data-html2canvas-ignore="true"/>
   <Dialog.Content className="snapshot-dialog" data-html2canvas-ignore="true">
    <header><Dialog.Title>{t('分享当前画面')}</Dialog.Title><Dialog.Close aria-label={t('关闭')}><X size={18}/></Dialog.Close></header>
    <Dialog.Description>{t('图片不保存到相册；可通过系统分享，或复制后在微信粘贴。')}</Dialog.Description>
    {snapshot&&<img src={snapshot.url} alt={t('当前个股画面截图')}/>}
    <div className="snapshot-actions"><button type="button" onClick={()=>snapshot&&share(snapshot.blob).then(ok=>{if(!ok)setMessage(t('当前浏览器不支持图片分享，请复制截图'));})}><Share2 size={16}/>{t('系统分享')}</button><button type="button" onClick={copy}><Copy size={16}/>{t('复制截图')}</button></div>
    {message&&<p role="status">{message}</p>}
   </Dialog.Content>
  </Dialog.Portal></Dialog.Root></>;
}
