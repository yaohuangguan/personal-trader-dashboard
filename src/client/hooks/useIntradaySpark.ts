import {useEffect,useSyncExternalStore} from 'react';
import {marketSession,type IntradayPayload} from '../../shared/desk-types';
import {fetchJson} from '../http';
import {KeyedPoller} from '../keyed-poller';

/** Row sparklines share one scheduler: refresh each visible symbol every 60s while trading, every 30min otherwise. */
const sparkPoller=new KeyedPoller<IntradayPayload>({
 load:async symbol=>{
  const data=await fetchJson<IntradayPayload&{available?:boolean;reason?:string}>('/api/desk/intraday?symbol='+encodeURIComponent(symbol),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(data.available===false)throw new Error(data.reason||'分时暂不可用');
  return data;
 },
 staleAt:(_data,now)=>now+(marketSession()==='trading'?60000:1800000),
 concurrency:2,
});
export function useIntradaySpark(symbol:string,active:boolean){
 const eligible=active&&/^\d{6}\.(SH|SZ|BJ)$/.test(symbol);
 useEffect(()=>eligible?sparkPoller.subscribe([symbol]):undefined,[symbol,eligible]);
 useSyncExternalStore(sparkPoller.onChange,sparkPoller.getVersion);
 return sparkPoller.peek(symbol);
}
