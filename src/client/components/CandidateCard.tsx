import type {CandidateNow} from '../../shared/candidate-now';
import {Star,ArrowUpRight} from 'lucide-react';
import type {ScreenCandidate} from '../../shared/screening';
import {t} from '../preferences';
export default function CandidateCard({row:c,live,rank,watched,onStock,onWatch}:{row:ScreenCandidate;live?:CandidateNow;rank:number;watched:boolean;onStock:(s:string)=>void;onWatch:(s:string)=>void}){
 const price=live?.price??c.price,pct=live?.changePercent??(live?.price?null:c.changePercent);
 const score=c.ranking?.score,up=(pct??0)>=0,advice=c.advice?.action||'观望';
 return <article className="screen-candidate ranked-candidate"><header><div className="candidate-rank">{String(rank).padStart(2,'0')}</div><button className="candidate-name" onClick={()=>onStock(c.symbol)}><b>{c.name}</b><small>{c.symbol}</small></button><button className="desk-icon" aria-label={t((watched?'移出自选 ':'加入自选 ')+c.symbol)} onClick={()=>onWatch(c.symbol)}><Star size={18} fill={watched?'currentColor':'none'}/></button></header>
  <div className="candidate-price"><strong className={up?'positive':'negative'}>{price?.toFixed(2)||'—'}</strong><span className={up?'positive':'negative'}>{pct==null?'—':(up?'+':'')+pct.toFixed(2)+'%'}</span><div className={'candidate-score '+(score!=null&&score>=75?'priority':'')}><b>{score??'—'}</b><small>{t(c.ranking?.label||'待评估')}</small></div></div>
  <small className="candidate-quote-time">{live?.asOf?'报价 '+live.asOf.replace('T',' ').slice(0,16):'历史价格 · '+c.asOf+'（当前报价待核验）'} · 结构分截至 {c.asOf}</small>
  <div className="candidate-current-state" style={{color:live?.tone==='bear'?'var(--down,#28cdb6)':live?.tone==='bull'?'var(--up,#f04a55)':undefined}}><b>{live?.label||'当前行情待核验'}</b><p>{live?.reason||'保留收盘候选结构，当前状态尚未核验。'}</p></div>
  <div className="screen-pattern-tags">{c.patterns?.map(p=><span key={p.mode} data-mode={p.mode}>{t(p.label)}</span>)}</div>
  <div className="candidate-advice"><b>{t(live?.tone==='bear'?'当前先防守':'结构参考：'+advice)}</b><span>{t(c.bucket)} · {t(c.provisional?'盘中待确认':'收盘核验')}</span></div>
  <dl><div><dt>{t('成交额')}</dt><dd>{c.amount==null?'—':(c.amount/1e8).toFixed(2)+'亿'}</dd></div><div><dt>{t('90%集中度')}</dt><dd>{c.chip?.concentration90.toFixed(2)??'—'}%</dd></div><div><dt>{t('股性')}</dt><dd>{t(c.character?.label||'待核验')}</dd></div></dl>
  <p className="candidate-lead">{t(c.advice?.reasons[0]||c.reasons[1]||'等待更多证据')}</p>
  <details open className="candidate-evidence"><summary>{t('评分依据与风险')}</summary>{c.ranking?.parts.map(p=><div className="ranking-part" key={p.label}><b>{t(p.label)}<em>{p.score}/{p.max}</em></b><meter min="0" max={p.max} value={p.score}/><p>{t(p.reason)}</p></div>)}<p>{t(c.ranking?.notice)}</p>{c.reasons.map((r,i)=><p key={i}>{t(r)}</p>)}{[...c.risks,...c.ranking?.warnings||[]].map((r,i)=><p className="screen-warning" key={i}>{t(r)}</p>)}<p>{t(c.chip?.notice)}</p>{!!c.limitUpDates?.length&&<p>{t('近10日收盘涨停估算')}：{c.limitUpDates.join('、')}</p>}</details>
  <footer><small>{c.asOf}</small><button onClick={()=>onStock(c.symbol)}>{t('看图核验')}<ArrowUpRight size={15}/></button></footer>
 </article>;
}
