import {useEffect,useRef,useState} from 'react';
import {useWatchInsights} from '../hooks/useWatchInsights';
import {watchInsightCache} from '../hooks/watchInsightCache';
import {insightFresh,type WatchInsightData} from '../../shared/watch-insight';
import {t} from '../preferences';
export default function WatchInsight({symbol,data:provided,managed=false}:{symbol:string;data?:WatchInsightData;managed?:boolean}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting));if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
 const feed=useWatchInsights(visible&&!managed?[symbol]:[]),data=provided||feed[symbol]||watchInsightCache.peek(symbol),score=data?.trend.score,fresh=insightFresh(data);
 return <div ref={ref} className="watch-row-insight" title={data?.operation?.label||t('正在核验日线与当日走势')}><span className={score==null||!fresh?'':score>=60?'bias-bullish':score<40?'bias-bearish':''}>{t(data?.trend.current?'今日走势':data?.trend.date?.slice(5)||'走势')} <b>{score??'—'}</b></span><span>{t(data?.operation?.action||'五线待核验')}</span><small>{t(data&&!fresh?'待更新':data?.structure.state||'—')}</small></div>;
}
