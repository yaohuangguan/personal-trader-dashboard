import {useMemo} from 'react';
import {analyzeStrategy} from '../../shared/strategy';
import {evaluateStrategyHistory} from '../../shared/strategy-backtest';
import type {Candle} from '../../shared/types';
import {t} from '../preferences';
import './StrategyPlan.css';
export default function StrategyPlan({candles,score}:{candles:Candle[];score:number|null}) {
 const strategy=useMemo(()=>analyzeStrategy(candles),[candles]);
 const history=useMemo(()=>evaluateStrategyHistory(candles,strategy.signals,{riskStops:strategy.riskStops}),[candles,strategy]);
 const p=strategy.plan,zone=p.entry?.map(v=>v.toFixed(2)).join(' – ')||t('等待有效触发');
 return <section className={'strategy-plan '+p.direction} aria-label={t('结构量价操作计划')}>
  <div className="strategy-top"><span>{t(strategy.version)}</span><small>{p.asOf} · {t(p.provisional?'盘中待确认':'日线收盘')}</small></div>
  <div className="strategy-decision"><div><strong>{t(p.action)}</strong><h3>{t(p.label)}</h3></div><div className="strategy-score"><b>{score??'—'}</b><small>{t('五线总分 / 100')}</small></div></div>
  <p>{t(p.reasons[0]||'等待有效行情')}</p>
  <div className="strategy-prices">{[['计划入场区间',zone],['结构失效价',p.stop?.toFixed(2)||'—'],['计划 2R',p.targets[0]?.toFixed(2)||'—']].map(([label,value])=><div key={label}><small>{t(label)}</small><b>{t(value)}</b></div>)}</div>
  {p.warnings.map(w=><p className="strategy-warning" key={w}>{t(w)}</p>)}
  <details open><summary>{t('触发证据与历史检验')}</summary><div className="strategy-checks">{p.checks.map(c=><div key={c.label}><span>{c.pass?'✓':'○'} {t(c.label)}</span><small>{t(c.detail)}</small></div>)}</div>
  <p>{t('完成交易')} {history.completed} · {t('胜率')} {history.winRate===null?t('样本不足'):(history.winRate*100).toFixed(1)+'%'} · {t('最大回撤')} {history.maxDrawdown.toFixed(2)}%</p><p>{t(history.notice)}</p><p>{t(strategy.method)}</p></details>
  <small>{t('评分衡量形态条件，不是胜率；价位是条件计划，不代表实际持仓或成交。')}</small>
 </section>;
}
