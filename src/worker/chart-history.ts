import type {Candle} from '../shared/types';
import {validHistoryDate} from '../shared/chart-history';

/** Same public Tencent backend, documented alternate hosts; bounded total time. */
export async function requestTencentHistory(wire:string,period:string,before='',count=500){
  let failure:unknown;
  for(const host of ['https://web.ifzq.gtimg.cn','https://ifzq.gtimg.cn','https://proxy.finance.qq.com/ifzqgtimg']){
    const url=host+'/appstock/app/fqkline/get?param='+wire+','+period+',,'+before+','+count+',qfq';
    try{
      const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://gu.qq.com/','Accept':'application/json'},signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw new Error('历史来源 HTTP '+response.status);
      const payload=await response.json() as {data?:Record<string,Record<string,string[][]>>};
      const node=payload.data?.[wire];
      if(!node||!Array.isArray(node['qfq'+period]??node[period]))throw new Error('历史周期响应格式变化');
      return {node,url};
    }catch(error){failure=error;}
  }
  throw failure instanceof Error?failure:new Error('历史来源暂不可用，请重试');
}

/** One bounded source request per gesture. End date is inclusive upstream. */
export async function historyPage(symbol:string,period:string,before:string){
  if(!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)||!['day','week','month'].includes(period)||!validHistoryDate(before))throw new RangeError('无效历史分页参数');
  const wire=symbol.slice(-2).toLowerCase()+symbol.slice(0,6);
  const {node,url}=await requestTencentHistory(wire,period,before,501),raw=node['qfq'+period]??node[period];
  if(!Array.isArray(raw)||raw.length>501||raw.length===0&&Array.isArray(node?.[period])&&(node[period] as unknown[]).length>0)throw new Error('历史分页响应格式变化');
  const byDate=new Map<string,Candle>();
  for(const row of raw){
    if(!Array.isArray(row)||row.length<6)throw new Error('历史分页记录格式变化');
    const [time,...values]=row;
    const [open,close,high,low,volume]=values.slice(0,5).map(Number);
    if(typeof time!=='string'||!validHistoryDate(time)||time>before||values.slice(0,5).some(v=>v===null||v===''||typeof v==='boolean')||![open,close,high,low,volume].every(Number.isFinite)||high<Math.max(open,close)||low>Math.min(open,close)||volume<0||byDate.has(time))throw new Error('历史分页OHLCV或日期异常');
    if(Math.min(open,close,high,low)<=0)throw new Error('来源早期前复权价格非正，暂不能继续拼接该段历史');
    byDate.set(time,{time,open,close,high,low,volume});
  }
  const candles=[...byDate.values()].filter(c=>c.time<before).sort((a,b)=>a.time.localeCompare(b.time));
  return {symbol,period,candles,anchor:byDate.get(before),hasMore:candles.length>0&&candles[0].time>'1990-01-01',nextBefore:candles[0]?.time??null,source:'腾讯财经'+(node?.['qfq'+period]?'前复权':'未复权')+'历史分页',sourceUrl:url,fetchedAt:new Date().toISOString(),volumeUnit:/^68[89]/.test(symbol)?'股':'手'};
}
