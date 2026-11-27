import {useSyncExternalStore} from 'react';

/** Render one layout per breakpoint instead of rendering both and hiding one with CSS. */
export function useMediaQuery(query:string){
 return useSyncExternalStore(
  fn=>{const list=matchMedia(query);list.addEventListener('change',fn);return()=>list.removeEventListener('change',fn);},
  ()=>matchMedia(query).matches,
 );
}
