import {useEffect,useRef,useState} from 'react';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import {t} from '../preferences';
type Insight={trend:{score:number|null;label:string;date:string|null;current:boolean;provisional:boolean};operation:{action:string;score:number|null;reasons:string[]}|null;structure:{state:string;direction:string;period:string}};
export default function WatchInsight({symbol}:{symbol:string}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting));if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
 const cn=/^\d{6}\.(SH|SZ|BJ)$/.test(symbol),feed=useLiveEndpoint<Insight>(visible&&cn?'/api/desk/insight?symbol='+symbol:null,60000),data=feed.data,score=data?.trend.score;
 if(!cn)return null;
 return <div ref={ref} className="watch-row-insight" title={feed.error||data?.operation?.reasons[0]||t('正在核验日线与当日走势')}><span className={score==null?'':score>=60?'bias-bullish':score<40?'bias-bearish':''}>{t(data?.trend.current?'今日走势':data?.trend.date?.slice(5)||'走势')} <b>{score??'—'}</b></span><span>{t(data?.operation?.action||'五线待核验')}</span><small>{t(data?.structure.state||'—')}</small></div>;
}
