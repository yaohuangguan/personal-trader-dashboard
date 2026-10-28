import {DEFAULT_MULTI,type MultiFilters,type ScreenOptions} from '../../shared/pattern-screen';
import {t} from '../preferences';
export default function MultiLineFilters({options,onChange,disabled}:{options:ScreenOptions;onChange:(o:ScreenOptions)=>void;disabled:boolean}){
 const f=options.multi||DEFAULT_MULTI,set=(p:Partial<MultiFilters>)=>onChange({...options,multi:{...f,...p}});
 return <section className="multi-line-filters" aria-label={t('一阳多线判定条件')}><b>{t('一阳多线判定条件')}</b><div className="screen-filter-grid">
 <label>{t('实体至少穿过')}<select aria-label={t('实体至少穿过')} disabled={disabled} value={f.lines} onChange={e=>set({lines:Number(e.target.value) as 4|5})}><option value={4}>{t('4条核心均线')}</option><option value={5}>{t('5条核心均线')}</option></select></label>
 <label>{t('线束离散上限')}<select aria-label={t('线束离散上限')} disabled={disabled} value={f.dispersion} onChange={e=>set({dispersion:Number(e.target.value)})}>{[10,5,2].map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
 <label>{t('相对20日均量至少')}<select aria-label={t('相对20日均量至少')} disabled={disabled} value={f.volume20} onChange={e=>set({volume20:Number(e.target.value)})}>{[1.2,1.5,2,3].map(n=><option key={n} value={n}>{n}×</option>)}</select></label>
 <label>{t('相对5日均量至少')}<select aria-label={t('相对5日均量至少')} disabled={disabled} value={f.volume5} onChange={e=>set({volume5:Number(e.target.value)})}>{[0,1,1.5,2].map(n=><option key={n} value={n}>{n?n+'×':t('不限')}</option>)}</select></label>
 <label>{t('阳线涨幅至少')}<select aria-label={t('阳线涨幅至少')} disabled={disabled} value={f.gain} onChange={e=>set({gain:Number(e.target.value)})}>{[3,5,9].map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
 <label>{t('收盘位于振幅上方')}<select aria-label={t('收盘位于振幅上方')} disabled={disabled} value={f.closeLocation} onChange={e=>set({closeLocation:Number(e.target.value)})}><option value={.7}>{t('30%区域')}</option><option value={.9}>{t('10%区域')}</option></select></label>
 </div><div className="screen-toggles"><label><input type="checkbox" disabled={disabled} checked={f.require60} onChange={e=>set({require60:e.target.checked})}/>{t('穿线必须包含MA60')}</label><label><input type="checkbox" disabled={disabled} checked={f.middle} onChange={e=>set({middle:e.target.checked})}/>{t('密集线束位于实体中轴')}</label></div><small>{t('核心线固定为5/10/20/30/60；普通至少穿四线。强力模式另外固定要求含60线、密集居中、大阳倍量及收近高点，不能用自定义条件放宽。')}</small></section>;
}
