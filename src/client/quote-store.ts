import {useEffect,useSyncExternalStore} from 'react';
import {supportedStock} from '../shared/market-clock';
import type {QuotesPayload,Snapshot} from '../shared/desk-types';
import {errorText,fetchJson} from './http';
import {quotePollDelay} from './hooks/live-policy';

/**
 * One shared /api/desk/quotes poller for the sidebar, research desk, overview and market tape.
 * Components subscribe the symbols they show; the store polls their union (5s while trading, 15s at lunch,
 * 60s after the close), pauses while hidden and keeps per-symbol object identity when nothing changed.
 */
export type QuoteState={quotes:ReadonlyMap<string,Snapshot>;items:Snapshot[];error:string;loading:boolean;updatedAt:number};
const CHUNK=60;
let state:QuoteState={quotes:new Map(),items:[],error:'',loading:false,updatedAt:0};
const listeners=new Set<()=>void>(),subscriptions=new Map<number,string[]>();
let queued=false,nextId=1,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|null=null,delay=5000,failures=0,requested='';

function set(changes:Partial<QuoteState>){state={...state,...changes};listeners.forEach(fn=>fn());}
const wanted=()=>[...new Set([...subscriptions.values()].flat())].filter(supportedStock).sort();

/** Pure: reuse the previous snapshot object when a symbol's quote did not change (keeps memo chains stable). */
export function mergeQuotes(previous:ReadonlyMap<string,Snapshot>,incoming:Snapshot[]):{quotes:Map<string,Snapshot>;changed:boolean}{
 const quotes=new Map(previous);let changed=false;
 for(const item of incoming){
  const old=previous.get(item.symbol);
  if(old&&JSON.stringify(old)===JSON.stringify(item))continue;
  quotes.set(item.symbol,item);changed=true;
 }
 return {quotes:changed?quotes:previous as Map<string,Snapshot>,changed};
}

async function poll(){
 clearTimeout(timer);
 const symbols=wanted();
 if(!symbols.length||document.hidden||!navigator.onLine)return;
 controller?.abort();const ac=controller=new AbortController();
 requested=symbols.join(',');
 if(!state.updatedAt)set({loading:true});
 try{
  const chunks=Array.from({length:Math.ceil(symbols.length/CHUNK)},(_,i)=>symbols.slice(i*CHUNK,i*CHUNK+CHUNK));
  const pages=await Promise.all(chunks.map(list=>fetchJson<QuotesPayload>('/api/desk/quotes?symbols='+list.join(','),{cache:'no-store',signal:AbortSignal.any([ac.signal,AbortSignal.timeout(15000)])})));
  if(ac.signal.aborted)return;
  const items=pages.flatMap(p=>p.items||[]),merged=mergeQuotes(state.quotes,items);
  failures=0;delay=quotePollDelay(items);
  set({quotes:merged.quotes,items:merged.changed||!state.items.length?[...merged.quotes.values()]:state.items,error:'',loading:false,updatedAt:Date.now()});
 }catch(error){
  if(ac.signal.aborted&&controller!==ac)return;
  failures++;delay=Math.min(60000,5000*2**failures);
  set({error:errorText(error,'行情连接异常'),loading:false});
 }finally{
  if(controller===ac){controller=null;if(subscriptions.size)timer=setTimeout(()=>void poll(),delay);}
 }
}
function resume(){if(!document.hidden&&navigator.onLine&&Date.now()-state.updatedAt>=delay)void poll();}
if(typeof window!=='undefined'){
 document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
 window.addEventListener('atlas:refresh',()=>void poll());
}

function subscribe(symbols:string[]){
 const id=nextId++;subscriptions.set(id,symbols);
 // Fetch right away when a new symbol appears; otherwise the running schedule covers it.
 const inflight=controller?requested.split(','):[];
 const missing=symbols.some(s=>supportedStock(s)&&!state.quotes.has(s)&&!inflight.includes(s));
 if((missing||!timer&&!controller)&&!queued){queued=true;setTimeout(()=>{queued=false;void poll();},0);}
 return()=>{subscriptions.delete(id);if(!subscriptions.size){clearTimeout(timer);timer=undefined;controller?.abort();controller=null;}};
}
const onChange=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const refreshQuotes=()=>void poll();
export function useQuotes(symbols:string[],enabled=true):QuoteState&{refresh:()=>void}{
 const key=[...new Set(symbols.filter(supportedStock))].sort().join(',');
 useEffect(()=>enabled&&key?subscribe(key.split(',')):undefined,[key,enabled]);
 return {...useSyncExternalStore(onChange,()=>state),refresh:refreshQuotes};
}
