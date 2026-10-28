import {useReader} from './InAppReader';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import {t,usePreferences} from '../preferences';
import type {DailyTrend} from '../../shared/daily-trend';
import './DailyTrendPanel.css';

export default function DailyTrendPanel({symbol}:{symbol:string}){
 const english=usePreferences().locale==='en', {openNews}=useReader();
 const feed=useLiveEndpoint<DailyTrend>('/api/desk/trend?symbol='+symbol,60000),r=feed.data;
 return <section className="daily-trend-panel" data-testid="daily-trend"><details><summary><span>{t(r?.sessionReview?.title||'当日走势分析')}</span><strong>{r?.score??'—'}<small> / 100</small></strong><span>{t(r?.label||'正在读取')}</span></summary>
  {feed.error&&<p role="status">{t('刷新失败，保留上一快照')} · {t(feed.error)}</p>}
  {r&&<><p>{r.date} · {t(r.current?r.provisional?'盘中暂评':'收盘复盘':'历史快照')} · {t('依据覆盖')} {r.coveredWeight}/100</p><ul>{(english?r.observationsEn:r.observations).map(v=><li key={v}>{t(v)}</li>)}</ul>
  {r.sessionReview&&<section className="session-review"><h3>{t(r.sessionReview.title)}</h3><p>{t(r.sessionReview.summary)}</p><small>{t('分析更新')} {r.sessionReview.asOf}</small><div className="session-evidence">{r.sessionReview.evidence.map(e=><article key={e.label}><header><b>{t(e.label)}</b><small>{t(e.status==='available'?'已取得':e.status==='missing'?'缺失':'待核验')}</small></header><p>{t(e.detail)}</p><small>{t(e.source)} · {e.asOf||'—'}</small>{e.items?.map(n=><p key={n.url}><button type="button" onClick={()=>openNews({...n,id:n.url,category:'all',originalTitle:n.title})}>{n.title}</button><small> · {n.source} · {n.publishedAt}</small></p>)}</article>)}</div>{r.sessionReview.conditions.map(s=><p key={s}>{t(s)}</p>)}<small>{t(r.sessionReview.notice)}</small></section>}
  {r.operation&&<section><h3>{t('五线操作建议')} · {t(r.operation.action)}</h3><p>{r.operation.asOf} · {t('当日强弱分结合形态与股性核验')}</p><ul>{r.operation.reasons.map((v,i)=><li key={i}>{t(v)}</li>)}</ul><small>{t(r.operation.notice)}</small></section>}
  <div className="daily-trend-dimensions">{r.dimensions.map(d=><div key={d.key}><span>{t(d.key)} · {d.weight}%</span><b>{d.score===null?t('未计分'):`${d.value?.toFixed(2)}${d.unit} · ${d.score.toFixed(0)}`}</b></div>)}</div>
  <p>{t('日内支撑参考')} {r.levels.support?.toFixed(2)??'—'} · {t('日内压力参考')} {r.levels.resistance?.toFixed(2)??'—'} · {t('分时均价')} {r.levels.vwap?.toFixed(2)??'—'}</p>
  {(english?r.risksEn:r.risks).map(v=><p key={v}>{t(v)}</p>)}<details><summary>{t('评分计算口径')}</summary><p>{t(r.method)}</p></details><small>{r.source} · {r.asOf}</small></>}
  <button type="button" onClick={feed.refresh}>{t('刷新数据')}</button>
 </details></section>;
}
