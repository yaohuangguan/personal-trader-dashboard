import {t} from '../preferences';
import {RefreshCw,LoaderCircle} from 'lucide-react';
import type {FlowPayload,SourceStamp} from '../../shared/desk-types';
import type {FlowObservation} from '../../shared/flow-observation';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import './FlowPanel.css';

const cash=(v:number|null|undefined)=>v==null?'—':Math.abs(v)>=1e8?(v/1e8).toFixed(2)+t("亿"):(v/1e4).toFixed(2)+t("万");
const tone=(v:number|null|undefined)=>v==null||v===0?'':v>0?'is-up':'is-down';
const pct=(v:number|null|undefined)=>v==null?'—':(v*100).toFixed(1)+'%';
function Attribution({data}:{data?:SourceStamp|null}){return data?<p className="flow-attribution"><a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a>{t("· 获取")}{new Date(data.fetchedAt).toLocaleTimeString('zh-CN',{hour12:false})}{data.notice&&<span>{data.notice}</span>}</p>:null;}
export default function FlowPanel({symbol,auto}:{symbol:string;auto:boolean}){
 const current=useLiveEndpoint<FlowPayload>('/api/desk/flow?symbol='+symbol,60000,auto);
 const history=useLiveEndpoint<FlowPayload>('/api/desk/flow-history?symbol='+symbol,300000,auto);
 const sample=useLiveEndpoint<Partial<FlowObservation>&SourceStamp>('/api/desk/flow-observation?symbol='+symbol,60000,auto);
 const daily=history.data||(current.data?.period==='daily'?current.data:null);
 const points=daily?.points||[],last=points.at(-1),snapshot=current.data?.points.at(-1);
 const scale=Math.max(1,...points.map(r=>Math.abs(r.main||0))),s=sample.data;
 const refreshing=current.loading||history.loading||sample.loading;
 const refresh=()=>{current.refresh();history.refresh();sample.refresh();};
 return <div className="flow-workbench">
  <header className="flow-heading"><div><h3>{t("资金流与隐性承接")}</h3><p>{t("公开资金统计 · 历史持续性 · 成交样本交叉验证")}</p></div><button type="button" onClick={refresh} disabled={refreshing} aria-label={t("刷新资金流")}><RefreshCw size={16} className={refreshing?'spin':''}/></button></header>
  <section className="flow-section"><div className="flow-section-title"><h4>{t("日度资金趋势")}</h4><span>{last?t("截至 ")+last.time:t("正在读取独立日度源")}</span></div>
   {points.length?<><div className="flow-stat-grid">{[1,5,10,20].map(days=>{const window=points.slice(-days),valid=window.filter(p=>p.main!==null),value=window.length===days&&valid.length===days?valid.reduce((n,p)=>n+p.main!,0):null;return <div key={days}><small>{days===1?t("最近交易日"):days+t("日累计")}{t("· 主力净额")}</small><strong className={tone(value)}>{cash(value)}</strong><span>{value===null?t("覆盖不足"):valid.filter(p=>p.main!>0).length+'/'+days+t("日净流入")}</span></div>;})}</div>
    <div className="flow-chart"><svg viewBox="0 0 900 160" role="img" aria-label={t("近60个交易日主力净额，红色净流入绿色净流出")}><line x1="0" x2="900" y1="80" y2="80" stroke="currentColor" opacity=".2"/>{points.map((p,i)=>{const h=Math.abs(p.main||0)/scale*72;return <rect key={p.time} x={i*900/points.length+1} y={(p.main||0)>=0?80-h:80} width={Math.max(1,900/points.length-3)} height={h} fill={(p.main||0)>=0?'var(--up)':'var(--down)'}><title>{p.time+t(" 主力净额 ")+cash(p.main)+t(" 全部净额 ")+cash(p.totalNet)}</title></rect>;})}</svg><div><span>{points[0].time}</span><span>{t("主力净额 ·")}{points.length}{t("个交易日 · 单位元")}</span><span>{last?.time}</span></div></div>
    <div className="flow-history-scroll"><table className="desk-table"><thead><tr><th>{t("交易日")}</th><th>{t("主力净额")}</th><th>{t("全部净额")}</th><th>{t("主力净额占比")}</th></tr></thead><tbody>{[...points].reverse().map(p=><tr key={p.time}><td>{p.time}</td><td className={tone(p.main)}>{cash(p.main)}</td><td className={tone(p.totalNet)}>{cash(p.totalNet)}</td><td className={tone(p.mainRatio)}>{p.mainRatio==null?'—':p.mainRatio.toFixed(2)+'%'}</td></tr>)}</tbody></table></div><Attribution data={daily}/></>:<div className="flow-pending">{history.loading?<><LoaderCircle size={16} className="spin"/>{t("读取60日历史…")}</>:history.error||t("日度资金源暂不可用，可先看下方成交样本。")}{history.error&&<button onClick={history.refresh}>{t("重试日度源")}</button>}</div>}
  </section>
  <section className="flow-section"><div className="flow-section-title"><h4>{t("分单资金统计")}</h4><span>{snapshot?(current.data?.period==='daily'?t("日度估算 "):t("盘中估算 "))+snapshot.time:t("独立来源")}</span></div>
   {snapshot?<><div className="flow-stat-grid">{[{name:current.data?.mainLabel||t("主力净额"),value:snapshot.main},{name:t("超大单净额"),value:snapshot.superLarge},{name:t("大单净额"),value:snapshot.large},{name:t("中单净额"),value:snapshot.medium},{name:t("小单净额"),value:snapshot.small}].filter(v=>v.value!=null).map(v=><div key={v.name}><small>{v.name}</small><strong className={tone(v.value)}>{cash(v.value)}</strong></div>)}</div>{snapshot.superLarge==null&&<p className="flow-muted">{t("当前备用源未提供完整四档；下方可查看腾讯成交样本的分单统计，两个口径分别展示。")}</p>}<Attribution data={current.data}/></>:<div className="flow-pending">{current.loading?<><LoaderCircle size={16} className="spin"/>{t("正在校验资金源…")}</>:current.error||current.data?.notice||t("四档源暂不可用，历史与成交观察可独立使用。")}</div>}
  </section>
  <section className="flow-section flow-observation"><div className="flow-section-title"><h4>{t("暗盘／拆单特征观察")}<em>{t("模型估算")}</em></h4><span>{t("最近6页公开成交 · 按需读取")}</span></div>
   {s?.available&&s.count!==undefined?<><div className={'flow-verdict '+(s.stance==='positive'?'positive':s.stance==='negative'?'negative':'')}><strong>{s.label}</strong><p>{s.explanation}</p></div>
    <div className="flow-stat-grid"><div><small>{t("样本范围 ·")}{s.date}</small><strong className="flow-time">{s.start}–{s.end}</strong><span>{s.count}{t("条聚合分笔 · 占当日成交额")}{pct(s.coverage)}</span></div><div><small>{t("样本成交额")}</small><strong>{cash(s.amount)}</strong><span>{t("识别主动方向")}{pct(s.knownShare)}</span></div><div><small>{t("主动买额占已识别额")}</small><strong>{pct(s.buyShare)}</strong><span>{t("样本价格变化")}{s.priceChange?.toFixed(2)}%</span></div></div>
    <div className="flow-table-scroll"><table className="desk-table"><thead><tr><th>{t("聚合单额")}</th><th>{t("主动买额")}</th><th>{t("主动卖额")}</th><th>{t("样本净额")}</th><th>{t("中性成交额")}</th></tr></thead><tbody>{s.buckets?.map(b=><tr key={b.name}><td>{b.name} <small>{b.count}{t("条")}</small></td><td className="is-up">{cash(b.buy)}</td><td className="is-down">{cash(b.sell)}</td><td className={tone(b.buy-b.sell)}>{cash(b.buy-b.sell)}</td><td>{cash(b.neutral)}</td></tr>)}</tbody></table></div>
    <h4 className="flow-cluster-title">{t("疑似连续小额同向成交")}<span>{s.clusters?.length||0}{t("组")}</span></h4>
    {s.clusters?.length?<div className="flow-table-scroll flow-clusters"><table className="desk-table"><thead><tr><th>{t("时段")}</th><th>{t("主动方向")}</th><th>{t("聚合条数")}</th><th>{t("累计成交额")}</th><th>{t("价格变化")}</th></tr></thead><tbody>{s.clusters.map((r,i)=><tr key={r.start+i}><td>{r.start}–{r.end}</td><td className={r.side==='B'?'is-up':'is-down'}>{r.side==='B'?t("买入方向"):t("卖出方向")}</td><td>{r.count}</td><td>{cash(r.amount)}</td><td>{r.priceChange.toFixed(2)}%</td></tr>)}</tbody></table></div>:<p className="flow-muted">{t("当前样本未发现满足阈值的连续同向小额成交；不代表没有拆单。")}</p>}
    <p className="flow-method">{s.methodology}</p><Attribution data={{...s,notice:s.notice}}/>
   </>:<div className="flow-pending">{sample.loading?<><LoaderCircle size={16} className="spin"/>{t("读取并分析近期成交…")}</>:sample.error||s?.reason||t("该证券暂无可用连续竞价样本。")}</div>}
   <p className="flow-muted">{t("尚未接入可授权的暗盘专有模型或完整 Level-2 委托链；公开分笔无法证明同一账户拆单，也不能确认“主力吸筹／出货”。")}<a href="https://www.sseinfo.com/services/assortment/level2/" target="_blank" rel="noreferrer">{t("数据口径")}</a></p>
  </section>
 </div>;
}
