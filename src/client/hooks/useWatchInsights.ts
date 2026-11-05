import {useEffect,useState} from 'react';
import type {WatchInsightData} from '../../shared/watch-insight';
import {watchInsightCache} from './watchInsightCache';

export function useWatchInsights(symbols:string[]){
 const key=symbols.join(','),[,setRevision]=useState(0);
 useEffect(()=>{
  if(!key)return;
  const list=key.split(',').filter(Boolean);let disposed=false,running=false;
  const load=async(force=false)=>{
   if(disposed||running||document.hidden||!navigator.onLine)return;
   running=true;let index=0;
   await Promise.all(Array.from({length:Math.min(3,list.length)},async()=>{
    while(!disposed&&index<list.length){const symbol=list[index++],previous=watchInsightCache.peek(symbol);try{const data=await watchInsightCache.load(symbol,force);if(!disposed&&data!==previous)setRevision(v=>v+1);}catch{/* Retain the last result; freshness is displayed separately. */}}
   }));running=false;
  };
  const resume=()=>{void load();},refresh=()=>{void load(true);};
  void load();const timer=setInterval(resume,5000);
  document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);window.addEventListener('atlas:refresh',refresh);
  return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener('atlas:refresh',refresh);};
 },[key]);
 return Object.fromEntries(symbols.map(s=>[s,watchInsightCache.peek(s)])) as Record<string,WatchInsightData|undefined>;
}
