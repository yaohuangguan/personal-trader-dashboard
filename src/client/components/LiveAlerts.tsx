import type {LiveAlert} from '../../shared/live-alerts';
import {t} from '../preferences';

/** Intraday observations; colours come from theme tokens so the panel reads in both themes. */
export default function LiveAlerts({alerts=[],collapsible=false,defaultOpen=true}:{alerts?:LiveAlert[];collapsible?:boolean;defaultOpen?:boolean}){
 const head=<><b>{t('盘中动态观察')}</b><small>{t('随量价更新 · 待收盘核验')}</small>{alerts.length>0&&<em className="live-alerts-count">{alerts.length}</em>}</>;
 const body=alerts.length?alerts.map(a=><div key={a.id} className={'live-alert is-'+a.direction}><strong>{t(a.title)}</strong><p>{t(a.detail)}</p></div>):<p className="live-alerts-empty">{t('当前无新增盘中预警')}</p>;
 if(collapsible)return <details className="live-alerts" open={defaultOpen}><summary>{head}</summary>{body}</details>;
 return <section className="live-alerts" aria-label={t('盘中动态观察')}><div className="live-alerts-head">{head}</div>{body}</section>;
}
