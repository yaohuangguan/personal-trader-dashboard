import {useState} from 'react';
import {t} from '../preferences';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import type {F10Payload} from '../../shared/f10-types';
import './F10Panel.css';
const money=(n:number|null)=>n===null?'—':Math.abs(n)>=1e8?(n/1e8).toFixed(2)+t('亿'):(n/1e4).toFixed(2)+t('万');
const pct=(n:number|null,multiplier=1)=>n===null?'—':(n*multiplier).toFixed(2)+'%';
export default function F10Panel({symbol}:{symbol:string}){
 const state=useLiveEndpoint<F10Payload>(/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)?'/api/desk/f10?symbol='+symbol:null),[kind,setKind]=useState('2');
 const data=state.data,profile=data?.profile;
 if(!data)return <div className="f10-panel"><p>{t(state.loading?'正在读取 F10…':state.error||'当前 F10 接口覆盖沪深北股票。')}</p><button className="outline-button" onClick={state.refresh}>{t('重试数据源')}</button></div>;
 const businessDate=data.business.map(r=>r.date).sort().at(-1),business=data.business.filter(r=>r.date===businessDate&&r.kind===kind);
 return <div className="f10-panel" data-testid="f10-panel"><header><div><span>COMPANY DOSSIER</span><h2>{profile?.name||symbol}</h2><p>{profile?.industry||'—'}</p></div><button className="outline-button" onClick={state.refresh}>{t('刷新资料')}</button></header>{profile&&<><dl className="f10-facts">{[[t('上市日期'),profile.listing],[t('成立日期'),profile.founded],[t('董事长'),profile.chairman],[t('员工人数'),profile.employees?.toLocaleString()],[t('地区'),profile.province]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'—'}</dd></div>)}</dl><section><h3>{t('公司概况')}</h3><p>{profile.description}</p><details><summary>{t('经营范围')}</summary><p>{profile.business}</p></details></section></>}
 <section><h3>{t('财务摘要')} <small>{t('报告期累计值 · 金额为元折算')}</small></h3><div className="f10-table-scroll"><table><thead><tr>{['报告期','披露日期','营业收入','同比','归母净利润','同比'].map((label,i)=><th key={i}>{t(label)}</th>)}</tr></thead><tbody>{data.financials.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.published||'—'}</td><td>{money(r.revenue)}</td><td>{pct(r.revenueGrowth)}</td><td>{money(r.profit)}</td><td>{pct(r.profitGrowth)}</td></tr>)}</tbody></table></div>{!data.financials.length&&<p>{t('当前源暂无记录')}</p>}</section>
 <section><h3>{t('主营构成')} <small>{businessDate||'—'}</small></h3><div className="f10-kinds">{[['1','按行业'],['2','按产品'],['3','按地区']].map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{t(label)}</button>)}</div><div className="f10-table-scroll"><table><thead><tr>{['业务','营业收入','收入占比','毛利率'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{business.map((r,i)=><tr key={i}><td>{r.name}</td><td>{money(r.revenue)}</td><td>{pct(r.ratio,100)}</td><td>{pct(r.margin,100)}</td></tr>)}</tbody></table></div>{!business.length&&<p>{t('当前分类暂无披露')}</p>}</section>
 <section><h3>{t('股东户数变化')}</h3><div className="f10-table-scroll"><table><thead><tr>{['截止日期','股东户数','较上期变化','户均流通股'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{data.holders.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.count?.toLocaleString()||'—'}</td><td>{pct(r.change)}</td><td>{r.average?.toLocaleString()||'—'}</td></tr>)}</tbody></table></div><p className="f10-note">{t('股东户数为披露期数据，与日K筹码峰模型是不同口径。财务值可能为累计数，不直接比较不同报告期的绝对值。')}</p></section>
 {data.warnings.map(w=><p className="screen-warning" key={w}>{t(w)}</p>)}<p className="f10-note">{t('来源：')}{t(data.source)} · {t('读取于 ')}{new Date(data.fetchedAt).toLocaleString()}<br/>{t('资料来自公开披露汇总，概况未提供单独更新日期；以公司正式报告为准。')}</p></div>;
}
