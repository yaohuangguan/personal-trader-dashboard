import {useEffect,useRef,useState} from 'react';
import {t} from '../preferences';
export function usePanelWidth(key:string,initial:number,min:number,max:number){
 const [width,setWidth]=useState(()=>{try{const n=Number(localStorage.getItem(key));return n>=min&&n<=max?n:initial;}catch{return initial;}});
 useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem(key,String(width));}catch{}},200);return()=>clearTimeout(timer);},[key,width]);
 return [width,(next:number)=>setWidth(Math.max(min,Math.min(max,Math.round(next))))] as const;
}
/** Write a CSS custom property directly while dragging, so pointermove does not re-render the whole app. */
export const cssVarPreview=(selector:string,property:string)=>(n:number)=>{document.querySelector<HTMLElement>(selector)?.style.setProperty(property,Math.round(n)+'px');};
export default function ResizeRail({label,width,onChange,preview,defaultWidth,min=280,max=()=>560,side='left',className=''}:{label:string;width:number;onChange:(n:number)=>void;preview?:(n:number)=>void;defaultWidth:number;min?:number;max?:()=>number;side?:'left'|'right';className?:string}){
 const drag=useRef<{x:number;width:number;max:number;value:number;frame:number}|null>(null),sign=side==='left'?1:-1;
 useEffect(()=>()=>document.body.classList.remove('resizing-rail'),[]);
 const limit=(n:number,bound=max())=>Math.max(min,Math.min(Math.max(min,bound),n));
 const finish=()=>{const d=drag.current;drag.current=null;document.body.classList.remove('resizing-rail');if(d){cancelAnimationFrame(d.frame);onChange(d.value);}};
 return <div className={'resize-rail '+className} role="separator" aria-label={t(label)} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={Math.max(min,max())} aria-valuenow={width} tabIndex={0} title={t('拖动调宽，双击恢复默认；方向键微调')}
 onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current={x:e.clientX,width,max:max(),value:width,frame:0};e.currentTarget.setPointerCapture(e.pointerId);document.body.classList.add('resizing-rail');}}
 onPointerMove={e=>{const d=drag.current;if(!d)return;d.value=limit(d.width+sign*(e.clientX-d.x),d.max);
  // One update per frame; with a preview the React state is committed only when the drag ends.
  if(!d.frame)d.frame=requestAnimationFrame(()=>{d.frame=0;if(drag.current===d)(preview||onChange)(d.value);});}}
 onPointerUp={finish} onLostPointerCapture={finish}
 onDoubleClick={()=>onChange(limit(defaultWidth))} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();onChange(limit(e.key==='Home'?defaultWidth:width+(e.key==='ArrowRight'?1:-1)*sign*(e.shiftKey?1:10)));}}}><i/></div>;
}
