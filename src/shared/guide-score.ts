import type {GuideAnalysis} from './guide-analysis';
import type {StockCharacter} from './stock-character';
/** Explainable checklist score. Missing evidence earns no points. */
export function guideScore(g:GuideAnalysis,c:StockCharacter|null){
 const rate=(r:{state:string}[])=>r.length?r.filter(v=>v.state==='pass').length/r.length:0;
 const parts=[{label:'形态条件',score:Math.round(rate(g.rules)*50),max:50},{label:'指标协同',score:Math.round(rate(g.supporting)*15),max:15},{label:'股性弹性',score:c?Math.round(c.score*.2):0,max:20},{label:'启动确认',score:g.event?.state==='confirmed'?15:g.currentLaunch||g.event?.state==='pending'?7:0,max:15}];
 const penalty=Math.min(20,g.risks.length*4),raw=parts.reduce((s,p)=>s+p.score,0)-penalty;
 const cap=!g.ready?0:g.stage==='确认失效'||g.event?.state==='failed'?39:c?.quiet||c?.weakFollow?49:g.event?.state==='confirmed'?100:g.currentLaunch||g.event?.state==='pending'?79:59;
 return {score:g.ready?Math.max(0,Math.min(cap,raw)):null,parts,penalty,cap,provisional:g.provisional,asOf:g.asOf,notice:'规则匹配总分，非上涨概率；形态50、协同15、股性20、确认15，风险每项扣4分（最多20）。未启动最高59，待确认79，低弹性或弱延续49，确认失败39；缺失证据不加分。'};
}
