import {marketContext} from '../../shared/market-context';
import type {Candle} from '../../shared/types';
import {t} from '../preferences';
export default function MarketContext({candles,provisional=false}:{candles:Candle[];provisional?:boolean}){
 const {structure:s,priceVolume:p}=marketContext(candles,provisional);
 return <div className="market-context-cards"><article className={'context-card bias-'+s.direction}><span>{t('当前结构与周期')}</span><strong>{t(s.state)}</strong><small>{t(s.period)} · {s.asOf||'—'}</small><p>{t(s.detail)}</p>{s.support!=null&&s.resistance!=null&&<small>{t('60日区间')} {s.support.toFixed(2)} – {s.resistance.toFixed(2)}</small>}</article><article className={'context-card bias-'+p.direction}><span>{t('量价解读')}</span><strong>{t(p.label)}</strong><small>{t('对比前20日均量')} {p.volumeRatio?.toFixed(2)??'—'}x</small><p>{t(p.explanation)}</p></article></div>;
}
