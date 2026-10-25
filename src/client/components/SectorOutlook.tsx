import {t as uiText} from '../preferences';
import { useMemo, useState } from 'react';
import { ArrowRight, Globe2, Layers3, UsersRound, LoaderCircle } from 'lucide-react';
import { useLiveEndpoint } from '../hooks/useLiveEndpoint';
import { useReader } from './InAppReader';
import type { IndustryPayload, SectorScenario } from '../../shared/screening';
import type { QuotesPayload, FlashPayload, FlowPayload } from '../../shared/desk-types';
import './Screener.css';
const SECTOR_TERMS: Record<string,string[]> = {'电子信息':['人工智能','算力','数据中心','芯片','半导体','工业互联网'],'电子器件':['芯片','半导体','面板','OLED','光模块','消费电子'],'仪器仪表':['工业自动化','仪器','机器人','工业互联网'],'电器行业':['电网','特高压','储能','电力设备'],'机械行业':['机器人','自动化','高端装备','工程机械','设备更新'],'传媒娱乐':['游戏','传媒','影视'],'生物制药':['创新药','医药','医保','FDA','生物医药'],'水泥行业':['水泥','基建','房地产'],'金融行业':['银行','证券','券商','保险','降准','降息'],'煤炭行业':['煤炭','动力煤','煤价','焦煤'],'有色金属':['有色金属','锂电','铜价','铝价','贵金属'],'发电设备':['电力设备','风电','核电'],'电力行业':['电力','电网','水电','核电'],'次新股':['次新','IPO','新股','注册制']};
const INDEXES = '000001.SH,399001.SZ,399006.SZ,000300.SH,000688.SH';
const cash = (n: number | null | undefined) => n == null ? '—' : Math.abs(n) >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : (n / 1e4).toFixed(1) + '万';
export default function SectorOutlook({ symbol, onStock }: { symbol?: string; onStock: (symbol: string) => void }) {
  const industries = useLiveEndpoint<IndustryPayload>('/api/desk/industries', 300000);
  const [code, setCode] = useState('');
  const industry = industries.data?.items.find(s => s.code === code) || industries.data?.items[0];
  const scenario = useLiveEndpoint<SectorScenario>(industry ? '/api/desk/sector-scenario?code=' + encodeURIComponent(industry.code) : null, 300000);
  const quotes = useLiveEndpoint<QuotesPayload>('/api/desk/quotes?symbols=' + INDEXES, 30000);
  const news = useLiveEndpoint<FlashPayload>('/api/desk/flash', 60000);
  const flow = useLiveEndpoint<FlowPayload>(symbol && /^\d{6}\.(SH|SZ|BJ)$/.test(symbol) ? '/api/desk/flow?symbol=' + symbol : null, 60000);
  const { openNews } = useReader();
  const validQuotes = quotes.data?.items.filter(q => !q.stale) || [], upIndexes = validQuotes.filter(q => (q.changePercent || 0) > 0).length;
  const b = scenario.data?.breadth, latestFlow = flow.data?.points.at(-1);
  const combined = !b?.complete ? '样本范围待核验，先观察参与面' : validQuotes.length < 3 ? '缺少足够大盘快照，暂不做同向判断' : b.positiveShare !== null && b.positiveShare >= 0.65 ? upIndexes >= 3 ? b.leaderGap !== null && b.leaderGap > 8 ? '市场与行业同向，需看领涨向中位成分扩散' : '市场与行业快照同向，进入扩散延续观察' : '行业快照相对有韧性，等待大盘配合' : b.positiveShare !== null && b.positiveShare <= 0.35 ? '当前参与面偏弱，等待修复条件出现' : '行业内部轮动分歧，等待方向与参与面统一';
  const headlines = useMemo(() => {
    const words = [industry?.name, ...(SECTOR_TERMS[industry?.name || ''] || []), ...(scenario.data?.leaders.slice(0, 5).map(r => r.name) || [])].filter((v): v is string => !!v && v.length >= 2);
    return news.data?.items.filter(item => words.some(word => item.title.includes(word))).slice(0, 4) || [];
  }, [industry?.name, scenario.data?.leaders, news.data?.items]);
  return <section className="sector-outlook" data-testid="sector-outlook"><header><div><span>CONDITIONAL SECTOR OUTLOOK</span><h2>{uiText("天时 · 地利 · 人和")}</h2><p>{uiText("根据可核验的市场与成分快照建立观察剧本，条件变化就调整判断。")}</p></div><label>{uiText("行业口径")}<select value={industry?.code || ''} onChange={event => setCode(event.target.value)} aria-label={uiText("分析行业")}>{uiText(industries.data?.items.map(s => <option key={s.code} value={s.code}>{uiText(s.name)} {uiText(s.changePercent === null ? '' : (s.changePercent >= 0 ? '+' : '') + s.changePercent.toFixed(2) + '%')}</option>))}</select></label></header>
    <div className="outlook-context"><article><h3><Globe2 size={14} />{uiText("天时 · 大盘环境")}</h3><strong>{uiText(quotes.error ? '大盘来源待恢复' : validQuotes.length ? `${upIndexes}/${validQuotes.length} 主要指数上涨` : '正在核验')}</strong><div className="outlook-indexes">{uiText(validQuotes.map(q => <button type="button" key={q.symbol} onClick={() => onStock(q.symbol)}><span>{(q.name)}</span><b className={q.changePercent && q.changePercent > 0 ? 'is-up' : 'is-down'}>{uiText(q.changePercent === null ? '—' : (q.changePercent >= 0 ? '+' : '') + q.changePercent.toFixed(2) + '%')}</b></button>))}</div><small>{uiText("来源日期")}{uiText(validQuotes[0]?.asOf.slice(0, 10) || '—')} · {uiText(validQuotes[0]?.session === 'closed' ? '盘后快照' : '公开行情')}</small></article>
    <article><h3><Layers3 size={14} />{uiText("地利 · 行业内扩散")}</h3><strong>{uiText(b?.label || (scenario.error ? '行业数据待恢复' : '读取成分中'))}</strong>{uiText(b ? <><div className="outlook-breadth"><span>{uiText("上涨")}{uiText(b.up)}</span><span>{uiText("下跌")}{uiText(b.down)}</span><span>{uiText("平盘")}{uiText(b.flat)}</span></div><p>{uiText("上涨占比")}{uiText(b.positiveShare === null ? '—' : (b.positiveShare * 100).toFixed(1) + '%')} {uiText("· 中位涨幅")}{uiText(b.median === null ? '—' : b.median.toFixed(2) + '%')}</p><small>{uiText("覆盖")}{uiText(b.sampled)}/{uiText(b.total)} · {uiText(b.complete ? '家数与登记一致' : b.sampled > b.total ? '家数超出来源登记，范围待核对' : '部分样本，停止整体结论')} {uiText("· 有成交")}{uiText(b.active)}</small></> : <p>{uiText(scenario.error || '按全成分计算，避免只统计领涨股。')}</p>)}</article>
    <article><h3><UsersRound size={14} />{uiText("人和 · 参与与证据")}</h3><strong>{uiText(b?.complete ? '行业成交额' : '已读成分成交额')} {uiText(cash(b?.amount))}</strong><p>{uiText(symbol ? `${flow.data?.period === 'daily' ? '个股最近日度主力净额' : '个股主力净额'}：${cash(latestFlow?.main)}（估算）${latestFlow?.time || ''}` : '行业主力净流入与筹码集中度尚待独立数据核验。')}</p><small>{uiText("资金估算不等于主动逐笔；挂单不用于认定机构身份。")}</small></article></div>
    {uiText(scenario.loading && <div className="screen-inline-loading"><LoaderCircle size={14} className="spin" />{uiText("正在读取行业完整成分…")}</div>)}
    {uiText(scenario.data && <div className="outlook-combined"><span>{uiText("综合观察剧本")}</span><h3>{uiText(combined)}</h3><p>{uiText("行业参与面")}{uiText(b?.positiveShare === null || b?.positiveShare === undefined ? '—' : (b.positiveShare * 100).toFixed(1) + '%')}{uiText("上涨 ·")}{uiText(upIndexes)}/{uiText(validQuotes.length)}{uiText("主要指数上涨 ·")}{uiText(headlines.length)}{uiText("条名称关联快讯待核验。来源时间尚未完全对齐，需复核最新交易日后再判断延续。")}</p></div>)}
    {uiText(scenario.data && <div className="outlook-scenarios"><div><b>{uiText("延续条件")}</b><p>{uiText(scenario.data.conditions.continuation)}</p></div><div><b>{uiText("降级条件")}</b><p>{uiText(scenario.data.conditions.invalidation)}</p></div></div>)}
    <div className="outlook-catalysts"><h3>{uiText("原始催化线索")}<span>{uiText("行业词典/公司名关联，尚未验证因果")}</span></h3>{uiText(headlines.length ? headlines.map(item => <button type="button" key={item.id} onClick={() => openNews(item)}><span>{uiText(item.source)}</span><b>{(item.title)}</b><ArrowRight size={13} /></button>) : <p>{uiText(news.error || '当前快讯未命中行业关键词或领涨公司名。可以继续在个股资讯和公告中核验催化。')}</p>)}</div>
    <div className="outlook-leaders">{uiText(scenario.data?.leaders.slice(0, 6).map(stock => <button type="button" key={stock.symbol} onClick={() => onStock(stock.symbol)}><span>{(stock.name)}<small>{uiText(stock.symbol)}</small></span><b className={(stock.changePercent || 0) >= 0 ? 'is-up' : 'is-down'}>{uiText(stock.changePercent === null ? '—' : stock.changePercent.toFixed(2) + '%')}</b><ArrowRight size={12} /></button>))}</div>
    <footer>{uiText(industries.error || scenario.error || '新浪行业独立分类；不代替东方财富板块归属。行业来源没有交易日期，与大盘日期的一致性仍待核对。')}<br />{uiText(scenario.data?.conditions.verification || '情景条件为观察阈值，不输出未经校准的上涨概率。')} {uiText(scenario.data && '读取于 ' + new Date(scenario.data.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '（北京时间）')}</footer>
  </section>;
}
