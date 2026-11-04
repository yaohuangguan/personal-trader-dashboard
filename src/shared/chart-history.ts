import type {Candle} from './types';

export type HistoryPage={candles:Candle[];anchor?:Candle;hasMore:boolean;nextBefore:string|null;volumeUnit:string;source:string};
/** Keep live refreshes authoritative; never splice incompatible adjustment bases. */
export function mergeHistoryPage(current:Candle[],page:Pick<HistoryPage,'candles'|'anchor'>):Candle[]{
  if(page.anchor){
    const anchor=current.find(c=>c.time===page.anchor!.time);
    if(anchor&&(['open','high','low','close'] as const).some(k=>Math.abs(anchor[k]-page.anchor![k])>Math.max(.011,Math.abs(anchor[k])*.0002)))
      throw new Error('历史复权口径已变化，请刷新图表后重试');
  }else if(page.candles.length)throw new Error('历史页缺少重叠校验，暂不拼接不同来源行情');
  return [...new Map([...page.candles,...current].map(c=>[c.time,c])).values()].sort((a,b)=>a.time.localeCompare(b.time));
}

export function validHistoryDate(value:string):boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1990-01-01'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
