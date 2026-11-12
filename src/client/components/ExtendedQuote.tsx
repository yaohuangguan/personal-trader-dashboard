import {useEffect,useRef,useState} from 'react';
import {isUSStock} from '../../shared/market-clock';
import {EXTENDED_LABELS,type ExtendedPayload} from '../../shared/extended-quote';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import {t} from '../preferences';
import './ExtendedQuote.css';

export default function ExtendedQuote({symbol}:{symbol:string}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting));if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
 const feed=useLiveEndpoint<ExtendedPayload>(visible&&isUSStock(symbol)?'/api/desk/extended-quote?symbol='+encodeURIComponent(symbol):null,60000);
 if(!isUSStock(symbol))return null;
 const q=feed.data?.current,session=q?.session??feed.data?.activeSession;
 const stale=q&&(q.stale||!!feed.error||Date.now()-Date.parse(q.asOf)>20*60000);
 const label=session?t(EXTENDED_LABELS[session]):t('盘前 / 盘后 / 24h');
 if(feed.data&&!q&&!session)return <div ref={ref}/>;
 return <div ref={ref} className="watch-extended-line" title={q?`${q.source} · ${new Date(q.asOf).toLocaleString()} · ${t('时段涨幅基准')} ${q.reference.toFixed(2)} USD`:t('扩展时段行情')}>
  <span className="extended-session">{label}</span>
  {q?<><span className={q.change>=0?'positive':'negative'}>{q.price.toFixed(2)}</span><span className={q.change>=0?'positive':'negative'}>{q.change>=0?'+':''}{q.changePercent.toFixed(2)}%</span>{stale&&<span className="extended-stale">{t('待更新')}</span>}</>:<span>{t(feed.error?'暂不可用':feed.loading?'加载中…':'暂无报价')}</span>}
 </div>;
}
