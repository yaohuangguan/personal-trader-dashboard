import {useEffect,useSyncExternalStore} from 'react';
import type {WatchInsightData} from '../../shared/watch-insight';
import {insightPoller,watchInsightCache} from './watchInsightCache';

/** Subscribe the given symbols to the shared insight poller (no per-row timers). */
export function useWatchInsights(symbols:string[]){
 const key=symbols.join(',');
 useEffect(()=>key?insightPoller.subscribe(key.split(',')):undefined,[key]);
 useSyncExternalStore(insightPoller.onChange,insightPoller.getVersion);
 return Object.fromEntries(symbols.map(s=>[s,watchInsightCache.peek(s)])) as Record<string,WatchInsightData|undefined>;
}
