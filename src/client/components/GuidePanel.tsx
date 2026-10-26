import type {StockCharacter} from '../../shared/stock-character';
import {guideScore} from '../../shared/guide-score';
import {guideAction} from '../../shared/guide-action';
import {t as uiText} from '../preferences';
import { Check, Circle, CircleHelp, BookOpen, ArrowRight, AlertTriangle } from 'lucide-react';
import { analyzeGuideResonance, GUIDE_VERSION, GUIDE_URL, type GuideAnalysis } from '../../shared/guide-analysis';
import type { Candle } from '../../shared/types';
import { useReader } from './InAppReader';
import './GuidePanel.css';

const fmt = (v: number | null, suffix = '') => v === null ? '—' : v.toFixed(2) + suffix;
export function GuideSummary({ data,character=null, onOpen }: { data: GuideAnalysis;character?:StockCharacter|null; onOpen: () => void }) {
  return <button type="button" className="guide-summary" onClick={onOpen} aria-label={uiText("查看五线开花分析")}>
    <div><span>{uiText("姚记五线开花")}</span><strong>{uiText(data.stage)}</strong></div>
    <div><span>{uiText("五线总分")}</span><b>{guideScore(data,character).score??'—'} / 100 · {uiText(guideAction(data,character).action)}</b></div><div><span>{uiText("五线粘合系数")}</span><b>{uiText(fmt(data.adhesionPct, '%'))}</b></div>
    <div><span>{uiText("当前 BIAS60")}</span><b>{uiText(fmt(data.bias60, '%'))}</b></div>
    <div><span>{uiText(data.event ? '启动观察日' : '历史日线')}</span><b>{uiText(data.event?.date || data.asOf || '—')}</b></div>
    <ArrowRight size={15} />
  </button>;
}

export default function GuidePanel({ data,character=null, weekly, monthly, weekError, monthError, loading }: { data: GuideAnalysis;character?:StockCharacter|null; weekly?: Candle[]; monthly?: Candle[]; weekError?: string; monthError?: string; loading?: boolean }) {
  const { openNews } = useReader();
  const strength=guideScore(data,character),action=guideAction(data,character);
  const resonance = analyzeGuideResonance(weekly || [], monthly || []);
  const steps = ['粘合蓄势', '放量穿线', '3–5日确认', '周月共振'];
  return <div className="guide-panel" data-testid="guide-panel">
    <header><div><span>YOUR RESEARCH PLAYBOOK</span><h2>{uiText(GUIDE_VERSION)}</h2><p>{uiText("先找形成过程，再核验强度与后续确认。当前日线")}{uiText(data.asOf || '—')}。</p></div><button type="button" onClick={() => openNews({ id: 'sam-five-line-guide', title: GUIDE_VERSION, source: '姚柏杨 · 原始指南', publishedAt: null, url: GUIDE_URL, category: 'all', summary: '规则依据：第02/03/04/05/08/09/14/23章。粘合 → 放量一阳穿线 → 3–5日回踩和排列确认 → 周月共振。下方计算口径区分指南给定阈值与具体化参数。', originalTitle: GUIDE_VERSION })}><BookOpen size={14} />{uiText("指南来源")}</button></header>
    <section className="guide-operation"><div><h3>{uiText('五线操作建议')}</h3><strong>{uiText(action.action)} · {strength.score??'—'} / 100</strong><small>{data.asOf} · {uiText(data.provisional?'盘中待确认':'收盘规则')}</small></div><ul>{action.reasons.map((r,i)=><li key={i}>{uiText(r)}</li>)}</ul><details><summary>{uiText('评分与失效条件')}</summary>{strength.parts.map(p=><p key={p.label}>{uiText(p.label)} {p.score} / {p.max}</p>)}<p>{uiText(strength.notice)}</p><p>{action.invalidation&&`${uiText('阳线半位')} ${action.invalidation.midpoint.toFixed(2)} · MA20 ${action.invalidation.ma20?.toFixed(2)??'—'}`}</p><p>{uiText(action.notice)}</p></details></section>
    <div className="guide-sequence">{uiText(steps.map((text, i) => <div key={text}><span>{uiText(i + 1)}</span><b>{uiText(text)}</b>{uiText(i < 3 && <ArrowRight size={14} />)}</div>))}</div>
    <div className="guide-verdict"><div><span>{uiText("当前观察状态")}</span><strong>{uiText(data.stage)}</strong><p>{uiText(data.event ? `${data.event.date} 启动观察 · 已取得 ${data.event.observedBars} 根确认窗口日线` : data.ready ? '尚未检出满足完整启动条件的近期形态；多头排列单独出现不等同于开花。' : `有效样本 ${data.available} / ${data.required}，先补足日线。`)}</p></div><div><span>{uiText("结构背景")}</span><b>{uiText(data.adhesionLabel)}</b><small>{uiText("系数")}{uiText(fmt(data.adhesionPct, '%'))} · BIAS60 {uiText(fmt(data.bias60, '%'))}</small><small>{uiText("实体穿线")}{uiText(data.crossedLines)}{uiText("/5 · 长期七线")}{uiText(data.sevenLineCrosses === null ? '未齐备' : data.sevenLineCrosses + '/7')}</small></div></div>
    <div className="guide-core-mas" aria-label={uiText("指南核心均线数值")}>{uiText([5,10,20,30,60].map(period => <div key={period}><span>MA{uiText(period)}</span><b>{uiText(fmt(data.ma[period]))}</b></div>))}</div>
    <div className="guide-dimensions">{uiText(data.dimensions.map(d=><article key={d.title}><span>{uiText(d.title)}</span><b>{uiText(d.value)}</b><p>{uiText(d.detail)}</p></article>))}</div>
    {uiText(data.provisional && <p className="guide-notice">{uiText("当前日线尚未收盘，盘中满足条件仍只是候选。")}</p>)}
    <div className="guide-section-heading"><h3>{uiText("一阳穿线 · 强度清单")}</h3><span>{uiText(data.event ? '核验启动日 ' + data.event.date : '核验末根日线')}</span></div>
    <div className="guide-rule-list">{uiText(data.rules.map(r => <div className={'guide-rule ' + r.state} key={r.id}><span className="guide-rule-icon">{uiText(r.state === 'pass' ? <Check size={14} /> : r.state === 'unknown' ? <CircleHelp size={14} /> : <Circle size={12} />)}</span><div><b>{uiText(r.title)}{uiText(!r.required && <small>{uiText("优选")}</small>)}</b><p>{uiText(r.rule)}</p></div><div><strong>{uiText(r.value)}</strong><small>{uiText("指南 §")}{uiText(r.chapter)} · {uiText(r.state === 'pass' ? '满足' : r.state === 'fail' ? '未满足' : '待核验')}</small></div></div>))}</div>
    <div className="guide-confirmation"><h3>{uiText("后续确认")}</h3>{uiText(data.event ? <><div><b>{uiText(data.event.state === 'confirmed' ? '确认成立' : data.event.state === 'failed' ? '确认失败' : '观察窗口尚未完成')}</b><span>{uiText("实体中点")}{uiText(data.event.midpoint.toFixed(2))} {uiText("· 启动最低")}{uiText(data.event.low.toFixed(2))}</span></div><p>{uiText(data.event.reason)}</p>{uiText(data.event.confirmationDate && <small>{uiText("首次确认")}{uiText(data.event.confirmationDate)}</small>)}{uiText(data.event.invalidationDate && <small>{uiText("失守日期")}{uiText(data.event.invalidationDate)}</small>)}</> : <p>{uiText("先出现已收盘的启动阳线，再观察后续3–5根；不会把未来确认条件提前算入当日。")}</p>)}</div>
    <div className="guide-section-heading"><h3>{uiText("全周期共振")}</h3><span>{uiText("仅用已收盘周期")}</span></div>
    <div className="guide-resonance">{uiText(([{ key: 'weekly', title: '周线 · 屠龙刀', error: weekError, data: resonance.weekly, rule: '近5根周线出现5/10金叉，30/60接近走平并粘合' }, { key: 'monthly', title: '月线 · 30月线回踩', error: monthError, data: resonance.monthly, rule: '前月放量上破30月线，次月缩量回踩不破' }] as const).map(r => <div key={r.key}><div><h4>{uiText(r.title)}</h4><b>{uiText(r.error ? '来源不可用' : loading && !r.data.bars ? '正在读取' : !r.data.ready ? '样本不足' : r.data.matched ? '条件满足' : '未满足')}</b></div><p>{uiText(r.rule)}</p><small>{uiText(r.error || r.data.detail)}</small><small>{uiText(r.data.bars)} {uiText("根已收盘周期 ·")}{uiText(r.data.asOf || '—')}</small></div>))}</div>
    <div className="guide-section-heading"><h3>{uiText("指标协同与人工证据")}</h3><span>{uiText("辅助验证，分别呈现")}</span></div>
    <div className="guide-supporting">{uiText(data.supporting.map(r => <div key={r.title}><b>{uiText(r.title)}</b><span>{uiText(r.state === 'pass' ? '满足' : r.state === 'unknown' ? '待核验' : '未满足')}</span><p>{uiText(r.detail)}</p></div>))}</div>
    <div className="guide-risk"><h3><AlertTriangle size={15} />{uiText("风险与失效观察")}</h3>{uiText(data.risks.length ? data.risks.map(r => <p key={r}>{uiText(r)}</p>) : <p>{uiText("当前未命中已实现的风险条件；仍需核验行情时效、消息与筹码。")}</p>)}</div>
    <details className="guide-method"><summary>{uiText("计算口径与指南对应")}</summary><p>{uiText("核心五线固定为 MA5/10/20/30/60。长期120/250用于背景观察，图表的八条可调均线独立保留。粘合系数严格采用指南计算器：(最高均线−最低均线)/最低均线；小于2%/5%/10%分别对应极致/紧密/松散粘合。")}</p><p>{uiText("指南明确给定：涨幅>5%、突破量>粘合期均量2倍、收盘高于MA60、后续3–5日确认、BIAS60>20%风险提示、J从高位跌破80复核。具体化参数：连续粘合至少5根、最多20根；30/60线用5根斜率且容许−0.1%；收盘在振幅上方10%；中轴允许偏离实体中点25%，作为优选项。后续用最低价检验阳线半位，采用严格口径。")}</p><p>{uiText("量价时空页把当前量与前20根均量比较；价平具体化为涨跌幅绝对值<0.5%，量缩平价为相对量≤0.8倍，滞涨放量为相对量≥2倍。该观察不归因于主力。周线金叉近5根、30/60粘合<2%及斜率容差沿用上述参数；月线只检验相邻已收盘月份。尚未完成的周/月不参加确认，月线保守排除当前自然月。筹码、队列及主力意图不从OHLCV代填。指南中的胜率说法没有转成系统胜率或置信度。")}</p>{uiText(data.warnings.map(w => <p key={w}>{uiText(w)}</p>))}</details>
  </div>;
}
