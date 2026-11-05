import {supportedStock} from '../../shared/market-clock';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Candle} from '../../shared/types';
import {mergeHistoryPage,type HistoryPage} from '../../shared/chart-history';

export function useChartHistory(initial:Candle[],symbol:string|undefined,unit:string,volumeUnit?:string){
  const key=symbol+':'+unit;
  const enabled=!!symbol&&supportedStock(symbol)&&['day','week','month'].includes(unit);
  const [state,setState]=useState<{key:string;older:Candle[];hasMore:boolean;error:string;loading:boolean}>({key,older:[],hasMore:true,error:'',loading:false});
  const active=state.key===key?state:null;
  const overlap=active?.older.find(c=>c.time===initial[0]?.time);
  const basisChanged=!!overlap&&initial.length>1&&(['open','high','low','close'] as const).some(k=>Math.abs(overlap[k]-initial[0][k])>Math.max(.011,Math.abs(overlap[k])*.0002));
  const candles=useMemo(()=>active?.older.length&&!basisChanged?[...new Map([...active.older,...initial].map(c=>[c.time,c])).values()].sort((a,b)=>a.time.localeCompare(b.time)):initial,[initial,active?.older,basisChanged]);
  const current=useRef({key,candles,enabled,volumeUnit,hasMore:active?.hasMore??true});
  current.current={key,candles,enabled,volumeUnit,hasMore:active?.hasMore??true};
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>{setState({key,older:[],hasMore:true,error:'',loading:false});return()=>{pending.current?.abort();pending.current=null;};},[key]);
  useEffect(()=>{if(basisChanged){pending.current?.abort();pending.current=null;setState({key,older:[],hasMore:true,error:'复权口径已更新，已刷新历史窗口',loading:false});}},[basisChanged,key]);
  async function loadOlder(){
    const snapshot=current.current,before=snapshot.candles[0]?.time;
    if(!snapshot.enabled||!before||!snapshot.hasMore||pending.current)return;
    const controller=new AbortController();pending.current=controller;
    let timedOut=false;
    const deadline=setTimeout(()=>{timedOut=true;controller.abort();},15000);
    setState(old=>({...old,key,loading:true,error:''}));
    try{
      const response=await fetch('/api/desk/history?'+new URLSearchParams({symbol:symbol!,period:unit,before}),{signal:controller.signal});
      const page=await response.json() as HistoryPage&{error?:string;reason?:string};
      if(!response.ok)throw new Error(page.reason||page.error||'历史行情暂不可用');
      if(current.current.key!==snapshot.key||controller.signal.aborted)return;
      if(snapshot.volumeUnit&&page.candles.length&&snapshot.volumeUnit!==page.volumeUnit)throw new Error('历史来源成交量口径不同，请刷新图表后重试');
      const merged=mergeHistoryPage(current.current.candles,page);
      setState({key,older:merged,hasMore:page.hasMore,error:'',loading:false});
    }catch(error){if(!controller.signal.aborted||timedOut)setState(old=>({...old,loading:false,error:timedOut?'历史加载超时，请重试':error instanceof Error?error.message:'历史加载失败'}));}
    finally{clearTimeout(deadline);if(pending.current===controller)pending.current=null;}
  }
  return {candles,loadOlder,enabled,loading:active?.loading??false,error:active?.error??'',hasMore:active?.hasMore??true};
}
