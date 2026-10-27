import {useState,useEffect} from 'react';
import type {SharedArticle as Article} from '../../shared/share';
import {t} from '../preferences';
export function SharedArticle({id,render}:{id:string;render:(article:Article)=>React.ReactNode}){
 const [data,setData]=useState<Article|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();fetch('/api/shares/'+id,{signal:c.signal}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||'分享读取失败');return j as Article;}).then(setData).catch(e=>{if(!c.signal.aborted)setError(String(e.message));});return()=>c.abort();},[id]);
 return error?<p role="alert" className="reader-notice">{t(error)}</p>:data?render(data):<p className="reader-notice">{t('正在读取分享内容…')}</p>;
}
export function SharedAnnouncement({code}:{code:string}){
 const [data,setData]=useState<{title:string;date:string;content:string;pdfUrl:string|null}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();fetch('/api/announcement?code='+code,{signal:c.signal}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||'公告读取失败');return j;}).then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[code]);
 return error?<p role="alert">{t(error)}</p>:!data?<p>{t('正在读取公告…')}</p>:<><h2>{data.title}</h2><p>{data.date} · {t('公司公告')}</p><div className="reader-document">{data.content}</div>{data.pdfUrl&&<a href={'/api/announcement-pdf?code='+code} target="_blank" rel="noreferrer">{t('查看公告 PDF')}</a>}</>;
}
