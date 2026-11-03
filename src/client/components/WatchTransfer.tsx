import {useEffect,useMemo,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {Download,Upload,FileJson,X,Check} from 'lucide-react';
import {parseWatchTransfer,serializeWatchTransfer,planWatchImport,WATCH_TRANSFER_MAX_BYTES,type WatchTransfer as Transfer} from '../../shared/watch-transfer';
import {readLocalWatch,importLocalWatch} from '../watch-transfer';
import {t} from '../preferences';
import './WatchTransfer.css';
const initial=()=>{try{return readLocalWatch();}catch{return {watchlist:[],groups:[]};}};
export default function WatchTransfer({compact=false}:{compact?:boolean}){
 const [current,setCurrent]=useState(initial),[incoming,setIncoming]=useState<Transfer|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[name,setName]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 const picker=useRef<HTMLInputElement>(null);
 useEffect(()=>{const update=()=>{try{setCurrent(readLocalWatch());}catch(e){setError(String(e));}};for(const event of ['atlas:watch-cloud','atlas:watch-local','storage'])window.addEventListener(event,update);return()=>{for(const event of ['atlas:watch-cloud','atlas:watch-local','storage'])window.removeEventListener(event,update);};},[]);
 const preview=useMemo(()=>{try{return {plan:incoming?planWatchImport(current,incoming):null,error:''};}catch(e){return {plan:null,error:String(e)};}},[current,incoming]);
 const choose=async(file?:File)=>{
  if(!file)return;setOpen(true);setBusy(true);setName(file.name);setError('');setMessage('');setIncoming(null);
  try{if(file.size>WATCH_TRANSFER_MAX_BYTES)throw new Error('自选文件过大，最大256KB');const value=parseWatchTransfer(await file.text());if(!value.watchlist.length)throw new Error('文件中没有自选股票');setCurrent(readLocalWatch());setIncoming(value);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 const exportFile=async()=>{
  setError('');setMessage('');setBusy(true);
  try{
   const file=new File([serializeWatchTransfer(readLocalWatch())],'guanlan-watchlist-'+new Date().toISOString().slice(0,10)+'.json',{type:'application/json'});
   let shared=false;
   if(navigator.share&&navigator.canShare?.({files:[file]}))try{await navigator.share({files:[file],title:t('观澜自选'),text:t('含股票和分组，在观澜选择“导入自选”即可合并。')});shared=true;}catch(e){if(e instanceof DOMException&&e.name==='AbortError')return;}
   if(!shared){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setMessage(t('自选文件已导出，可发给其他用户导入。'));
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 const apply=()=>{if(!incoming)return;try{const result=importLocalWatch(incoming);setCurrent(result.state);setOpen(false);setMessage(t('导入完成')+' · '+t('新增股票')+' '+result.added+' · '+t('新建分组')+' '+result.groupsAdded+(result.skipped||result.groupsSkipped?' · '+t('容量不足跳过')+' '+result.skipped+' / '+result.groupsSkipped:''));}catch(e){setError(e instanceof Error?e.message:String(e));}};
 const plan=preview.plan;
 return <div className={'watch-transfer'+(compact?' is-compact':'')}>
  <div className="watch-transfer-actions"><button type="button" disabled={busy||!current.watchlist.length} onClick={()=>void exportFile()}><Download size={16}/>{t('导出自选')}</button><button type="button" disabled={busy} onClick={()=>{if(picker.current)picker.current.value='';picker.current?.click();}}><Upload size={16}/>{t('导入自选')}</button></div>
  <input ref={picker} type="file" accept=".json,application/json" aria-label={t('选择自选文件')} className="watch-transfer-file" onChange={e=>void choose(e.target.files?.[0])}/>
  {message&&<p role="status">{message}</p>}{!open&&error&&<p role="alert">{t(error)}</p>}
  <Dialog.Root open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><Dialog.Portal><Dialog.Overlay className="settings-overlay watch-transfer-overlay"/><Dialog.Content className="watch-transfer-dialog"><header><Dialog.Title><FileJson size={21}/>{t('导入自选')}</Dialog.Title><Dialog.Close asChild><button type="button" className="icon-button" disabled={busy} aria-label={t('关闭')}><X size={22}/></button></Dialog.Close></header><Dialog.Description>{name} · {t('合并到当前自选，原有股票与分组保留。')}</Dialog.Description>
   {busy&&<p role="status">{t('正在读取自选文件…')}</p>}{(error||preview.error)&&<p className="watch-transfer-error" role="alert">{t(error||preview.error)}</p>}
   {incoming&&plan&&<><div className="watch-transfer-stats"><div><span>{t('文件股票')}</span><b>{incoming.watchlist.length}</b></div><div><span>{t('新增股票')}</span><b>{plan.added}</b></div><div><span>{t('已有股票')}</span><b>{plan.existing}</b></div><div><span>{t('文件分组')}</span><b>{incoming.groups.length}</b></div></div><p>{t('同名分组合并成员，重复导入不会重复添加。')}</p><div className="watch-transfer-groups">{incoming.groups.map(g=><span key={g.name}>{g.name} · {g.symbols.length}</span>)}</div><div className="watch-transfer-symbols">{incoming.watchlist.map(s=><span key={s}>{s}</span>)}</div>{(plan.skipped>0||plan.groupsSkipped>0)&&<p className="watch-transfer-error" role="status">{t('容量不足跳过')}：{t('股票')} {plan.skipped} · {t('分组')} {plan.groupsSkipped}。{t('自选最多60只、分组最多20个；已有数据不会删除。')}</p>}<p className="watch-transfer-note">{t('仅交换股票和分组，不包含云同步密钥、提醒或账号资料。')}</p></>}
   <footer><button type="button" onClick={()=>picker.current?.click()} disabled={busy}>{t('重新选择文件')}</button><button type="button" className="watch-transfer-confirm" disabled={busy||!incoming?.watchlist.length||!plan} onClick={apply}><Check size={17}/>{t('一键合并导入')}</button></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </div>;
}
