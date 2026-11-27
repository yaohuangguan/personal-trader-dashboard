import {useEffect,useId,useRef} from 'react';

/**
 * Overlays (reader, search, expanded chart, drawers, dialogs) get their own history entry, so the
 * browser / Android / PWA Back button closes them instead of leaving the app. Closing from the UI
 * removes that entry again.
 */
export function useHistoryLayer(open:boolean,close:()=>void){
 const id=useId(),closeRef=useRef(close);closeRef.current=close;
 useEffect(()=>{
  if(!open)return;
  history.pushState({...(history.state||{}),layer:id},'',location.href);
  const onPop=()=>{if(history.state?.layer!==id)closeRef.current();};
  window.addEventListener('popstate',onPop);
  return()=>{window.removeEventListener('popstate',onPop);if(history.state?.layer===id)history.back();};
 },[open,id]);
}
/** True while the current entry belongs to an overlay; navigation then replaces it instead of stacking. */
export const onHistoryLayer=()=>typeof history.state?.layer==='string';
