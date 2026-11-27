import {formatMarketTime,ZONE_LABELS} from '../time-format';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {isUSStock} from '../../shared/market-clock';
import {EXTENDED_LABELS,type ExtendedPayload} from '../../shared/extended-quote';
import {fetchJson} from '../http';
import {KeyedPoller} from '../keyed-poller';
import {t} from '../preferences';
import './ExtendedQuote.css';

/** Pre/post/overnight quotes for visible US rows share one 60s scheduler. */
const extendedPoller=new KeyedPoller<ExtendedPayload>({
 load:symbol=>fetchJson<ExtendedPayload>('/api/desk/extended-quote?symbol='+encodeURIComponent(symbol),{cache:'no-store',signal:AbortSignal.timeout(15000)}),
 staleAt:(_data,now)=>now+60000,
 concurrency:2,
});

export default function ExtendedQuote({symbol}:{symbol:string}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),us=isUSStock(symbol);
 useEffect(()=>{if(!us)return;const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting));if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[us]);
 useEffect(()=>visible&&us?extendedPoller.subscribe([symbol]):undefined,[symbol,visible,us]);
 useSyncExternalStore(extendedPoller.onChange,extendedPoller.getVersion);
 if(!us)return null;
 const data=extendedPoller.peek(symbol),q=data?.current,session=q?.session??data?.activeSession;
 const stale=q&&(q.stale||Date.now()-Date.parse(q.asOf)>20*60000);
 const label=session?t(EXTENDED_LABELS[session]):t('盘前 / 盘后 / 24h');
 if(data&&!q&&!session)return <div ref={ref}/>;
 return <div ref={ref} className="watch-extended-line" title={q?`${q.source} · ${formatMarketTime(q.asOf,'dateTime',{zone:'us'})} ${t(ZONE_LABELS.us)} · ${t('时段涨幅基准')} ${q.reference.toFixed(2)} USD`:t('扩展时段行情')}>
  <span className="extended-session">{label}</span>
  {q?<><span className={q.change>=0?'positive':'negative'}>{q.price.toFixed(2)}</span><span className={q.change>=0?'positive':'negative'}>{q.change>=0?'+':''}{q.changePercent.toFixed(2)}%</span>{stale&&<span className="extended-stale">{t('待更新')}</span>}</>:<span>{t(data?'暂无报价':extendedPoller.failed(symbol)?'暂不可用':'加载中…')}</span>}
 </div>;
}
