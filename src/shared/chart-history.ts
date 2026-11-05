import type {Candle} from './types';

export type HistoryPage={candles:Candle[];anchor?:Candle;hasMore:boolean;nextBefore:string|null;volumeUnit:string;source:string};
export type HistoryBasis='tencent'|'sina-qfq'|'sina-raw';
export function historyBasisFor(source='',symbol=''):HistoryBasis{
  if(!source.includes('新浪'))return 'tencent';
  return symbol.endsWith('.BJ')||/指数原值|不复权|未复权/.test(source)?'sina-raw':'sina-qfq';
}
/** Unit conversion is explicit; price-basis verification still happens before merging. */
export function normalizeHistoryPage<T extends HistoryPage>(page:T,target?:string):T{
  if(!target||!page.candles.length||page.volumeUnit===target)return page;
  if(!['股','手'].includes(target)||!['股','手'].includes(page.volumeUnit))throw new Error('历史来源成交量口径不同，请刷新图表后重试');
  const factor=page.volumeUnit==='手'?100:.01;
  const convert=(c:Candle)=>{
    if(!Number.isFinite(c.volume)||c.volume<0)throw new Error('历史分页成交量异常');
    return {...c,volume:c.volume*factor};
  };
  return {...page,candles:page.candles.map(convert),anchor:page.anchor?convert(page.anchor):undefined,volumeUnit:target};
}
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
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
