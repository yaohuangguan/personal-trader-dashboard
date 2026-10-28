import {useMemo,useState} from 'react';
import {analyzeStrategy} from '../../shared/strategy';
import type {StrategyAnalysis} from '../../shared/strategy';
import type {TradeReview} from '../../shared/trade-review';
import type {PatternMark} from '../../shared/pattern-marks';
import {evaluateStrategyHistory} from '../../shared/strategy-backtest';
import type {Candle} from '../../shared/types';
import {t} from '../preferences';
import {GUIDE_PATTERN_COVERAGE} from '../../shared/guide-patterns';
import './StrategyPlan.css';
export default function StrategyPlan({candles,score,strategy:provided,review,marks=[],loading=false,error=''}:{candles:Candle[];score:number|null;strategy?:StrategyAnalysis|null;review?:TradeReview;marks?:PatternMark[];loading?:boolean;error?:string}) {
 const strategy=useMemo(()=>provided||analyzeStrategy(candles),[provided,candles]);
 const history=useMemo(()=>evaluateStrategyHistory(candles,strategy.signals,{riskStops:strategy.riskStops}),[candles,strategy]);
 const [episodeDate,setEpisodeDate]=useState(''),episode=strategy.episodes.find(e=>e.setup.date===episodeDate)||strategy.episodes.at(-1);
 const p=strategy.plan,zone=p.entry?.map(v=>v.toFixed(2)).join(' – ')||t('等待有效触发'),flat=review?.flat||p.flat,holding=review?.holding||p.holding;
 return <section className={'strategy-plan '+p.direction} aria-label={t('结构量价操作计划')}>
  <div className="strategy-top"><span>{t(strategy.version)}</span><small>{review?.asOf||p.asOf} · {t(p.provisional?'盘中待确认':'日线收盘')}</small></div>
  <div className="strategy-decision"><div><strong>{t(p.label)}</strong><h3>{t(review?'综合研判':loading?'联动证据核验中':'量价初判 · 联动待核验')}</h3></div><div className="strategy-score"><b>{p.structureScore}</b><small>{t('结构准备度 / 100')}</small></div></div>
  <div className="decision-scores"><div><small>{t('当前买点分')}</small><b>{review?review.entryScore??'—':p.score}<em>/100</em></b></div><div><small>{t('持仓退出风险')}</small><b>{review?.exitRisk??p.exitRisk}<em>/100</em></b></div><div><small>{t('综合证据覆盖')}</small><b>{review?review.coverage+'%':t('核验中')}</b></div></div>
  <div className="decision-stances"><article><span>{t('空仓 / 准备买入')}</span><h3>{t(!review&&loading?'等待联动核验':flat.action)}</h3><p>{t(flat.reason)}</p></article><article><span>{t('已有持仓')}</span><h3>{t(holding.action)}</h3><p>{t(holding.reason)}</p></article></div>
  <div className="strategy-prices">{[['条件观察区',zone],['新入场失效价',p.stop?.toFixed(2)||'—'],['持仓防守参考',p.holdingStop?.toFixed(2)||'—'],['计划 2R',p.targets[0]?.toFixed(2)||'—']].map(([label,value])=><div key={label}><small>{t(label)}</small><b>{t(value)}</b></div>)}</div>
  {p.metrics&&<div className="decision-volume"><b>{t(p.metrics.volumeLabel)}</b><p>{t(p.metrics.volumeDetail)}</p><small>{t('距MA60')} {p.metrics.bias60.toFixed(2)}% · {t('相对20日均量')} {p.metrics.volume20.toFixed(2)}× · {t('相对启动日量')} {p.metrics.volumeLaunch===null?'—':p.metrics.volumeLaunch.toFixed(2)+'×'}</small></div>}
  {!!p.patternEvidence?.length&&<div className="decision-volume"><b>当前形态证据</b>{p.patternEvidence.filter(m=>m.chartVisible!==false).slice(0,4).map(m=><p key={m.kind}>{m.label} · {m.detail}</p>)}</div>}
  {p.warnings.map(w=><p className="strategy-warning" key={w}>{t(w)}</p>)}
  {error&&<p className="strategy-warning">{t(error)} · {t('综合联动尚未完成，当前量价结论不代表完整证据。')}</p>}
  {review&&<><h3 className="decision-heading">{t('多维证据 · 同时呈现支持与冲突')}</h3><div className="decision-evidence">{review.evidence.map(e=><article key={e.id} className={e.status==='available'?e.direction:'unknown'}><div><b>{t(e.label)}</b><span>{e.score===null?t(e.status==='missing'?'缺失':'待核验'):e.score+'/'+e.weight}</span></div><p>{t(e.detail)}</p><small>{t(e.source)} · {e.asOf||'—'}</small></article>)}</div><div className="decision-conditions"><article><h3>{t('买入前需要什么')}</h3>{review.buyConditions.map(s=><p key={s}>{t(s)}</p>)}</article><article><h3>{t('什么时候优先卖出 / 风控')}</h3>{review.sellConditions.map(s=><p key={s}>{t(s)}</p>)}</article></div></>}
  <h3 className="decision-heading">{t('启动后 · 10日连续观察')}</h3>
  <div className="decision-episodes">{strategy.episodes.slice(-6).map(e=><button type="button" key={e.setup.date} aria-pressed={episode?.setup.date===e.setup.date} onClick={()=>setEpisodeDate(e.setup.date)}>{e.setup.date} · {t(e.setup.kind==='multi'?'放量穿线':e.setup.kind==='recovery'?'均线修复':'箱体突破')}</button>)}</div>
  {episode?<><p>{episode.setup.date} · {episode.follow.length}/10 {t('根已收盘后续日线')} · {episode.failedAt?t('本段计划失效于')+' '+episode.failedAt:t('持续核验支撑与发散方向')}</p><div className="decision-follow"><table><thead><tr>{['第几日 / 日期','结构变化','相对20日量','相对启动量','五线离散'].map(v=><th key={v}>{t(v)}</th>)}</tr></thead><tbody>{episode.follow.map(f=><tr key={f.date}><td>D{f.day} · {f.date}</td><td className={!f.supportHeld?'negative':''}>{t(f.state)}</td><td>{f.volume20.toFixed(2)}×</td><td>{f.volumeLaunch.toFixed(2)}×</td><td>{f.adhesion.toFixed(2)}%</td></tr>)}</tbody></table></div><small>{t('十日观察不是到期买入或永久淘汰；失效后新的放量修复建立新计划。当前未收盘日不计入已完成天数。')}</small></>:<p>{t('当前没有可跟踪的近期启动；继续核验箱体、量价与新触发。')}</p>}
  {!!marks.length&&<><h3 className="decision-heading">{t('近期形态标注')}</h3><div className="decision-patterns">{marks.slice(-12).reverse().map(m=><article key={m.time+m.kind}><b>{m.time} · {t(m.label)} {m.provisional&&t('待收盘')}</b><p>{t(m.detail)}</p></article>)}</div></>}
  <h3 className="decision-heading">{t('阶段演变 · 旧失效不会被新上涨抹去')}</h3><div className="decision-timeline">{strategy.timeline.slice(-10).map(s=><article key={s.date+s.phase}><small>{s.date}</small><b>{t(s.label)}</b><p>{t(s.reason)}</p></article>)}</div>
  <h3 className="decision-heading">{t('量价触发证据与历史检验')}</h3><div className="strategy-checks">{p.checks.map(c=><div key={c.label}><span>{c.pass?'✓':'○'} {t(c.label)}</span><small>{t(c.detail)}</small></div>)}</div>
  <p>{t('完成交易')} {history.completed} · {t('胜率')} {history.winRate===null?t('样本不足'):(history.winRate*100).toFixed(1)+'%'} · {t('最大回撤')} {history.maxDrawdown.toFixed(2)}%</p><p>{t(history.notice)}</p><p>{t(strategy.method)}</p>
  <small>{t('原始指南严格形态匹配')} {score??'—'}/100 · {t('与当前买入时机分分别呈现，评分均非胜率。')}</small>
  <h3 className="decision-heading">{t('指南形态覆盖与数据条件')}</h3><div className="decision-evidence">{GUIDE_PATTERN_COVERAGE.map(group=><article key={group.group}><div><b>{t(group.group)}</b><span>§{group.chapter}</span></div><p>{group.items.map(t).join(' · ')}</p><small>{t(group.requirement)}</small></article>)}</div>
  <p>{t('图上按空间挑选重要标注；悬停K线可查看当天全部已识别证据。未确认上影试探不在主图冒充仙人指路，确认不回写历史。')}</p>
 </section>;
}
