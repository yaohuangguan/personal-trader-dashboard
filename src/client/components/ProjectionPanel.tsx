import * as Dialog from '@radix-ui/react-dialog';
import type {MarketProjection} from '../../shared/market-projection';
export default function ProjectionPanel({projection:p,unit,horizon,onHorizon,scenario,onScenario}:{projection:MarketProjection|null;unit:string;horizon:number;onHorizon:(n:number)=>void;scenario:string;onScenario:(s:string)=>void}){
 const chosen=p?.scenarios.find(s=>s.id===scenario),sample=p?.model==='analogs',basis=p?.basis;
 const full=()=> <><p><strong>本条路径依据：</strong>{chosen?.explanation}</p><div className="projection-fact-grid">{basis?.facts.map((fact,i)=><p key={i}>{fact}</p>)}</div>{basis?.limitations.map((text,i)=><small key={i}>{text}</small>)}<div className="projection-condition-grid">{p?.conditions.map(c=><p key={c.side} style={{color:c.side==='bull'?'#f04a55':c.side==='bear'?'#28cdb6':undefined}}>{c.text}</p>)}</div><small>{p?.notice||p?.reason}</small></>;
 return <div className="terminal-projection-details">
  <div className="projection-controls"><label>情景 <select aria-label="推演情景" value={scenario} onChange={e=>onScenario(e.target.value)}><option value="base">基准</option><option value="bull">偏强</option><option value="bear">偏弱</option></select></label><label>推演范围 <select aria-label="推演范围" value={horizon} onChange={e=>onHorizon(Number(e.target.value))}>{[5,10,15,20].map(n=><option key={n} value={n}>{unit==='day'?'约'+n/5+'周':n+'根'+(unit==='week'?'周':unit==='month'?'月':unit)+'K'}</option>)}</select></label><span className="projection-desktop-note">半透明K线＋虚线指标 · 非实盘</span>
   <Dialog.Root><Dialog.Trigger asChild><button className="projection-mobile-more">完整依据</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="projection-dialog-overlay"/><Dialog.Content className="projection-explanation-dialog"><div className="projection-dialog-header"><Dialog.Title>完整推演依据</Dialog.Title><Dialog.Close asChild><button>完成</button></Dialog.Close></div><Dialog.Description>所选情景、量价依据与失效条件。假设价量不写入真实行情或交易信号。</Dialog.Description>{full()}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
  <div className="terminal-projection-basis"><b>{basis?.regime||p?.reason||'正在生成条件情景'}</b></div>
  <div className="projection-desktop-evidence">{full()}</div>
  <div className="projection-mobile-summary">
   <p>{sample?'从'+p?.sampleCount+'段同股相似窗口中选整段路径':'相似样本不足，采用近期量价片段重采样'}，按当前波动与量能缩放，保留涨跌实体和影线。</p>
   <p>{basis?.facts[2]}</p>
   <p>支撑 {p?.support?.toFixed(2)||'—'} · 压力 {p?.resistance?.toFixed(2)||'—'}。失守支撑不能收回、放量走弱时核验偏弱分支；放量站稳压力时核验偏强分支。</p>
   <small>假设情景，非发生概率；历史回放尚未优于价格不变基线。</small>
  </div>
 </div>;
}
