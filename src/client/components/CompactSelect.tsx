import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './CompactSelect.css';

type Option={value:string;label:string};
/** Anchored, bounded choices on touch screens as well as desktop. */
export default function CompactSelect({label,value,options,onChange}:{label:string;value:string;options:Option[];onChange:(value:string)=>void}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0);
  const [position,setPosition]=useState({left:12,top:0,width:240,maxHeight:280});
  const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),id=useId();
  const filtered=options.filter(o=>o.label.toLowerCase().includes(query.toLowerCase()));
  const close=()=>{setOpen(false);trigger.current?.focus();};
  useEffect(()=>{
    if(!open)return;
    const place=()=>{
      const rect=trigger.current!.getBoundingClientRect(),height=Math.min(320,window.innerHeight*.4),width=Math.min(Math.max(240,rect.width),window.innerWidth-24);
      setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:rect.bottom+height+8<window.innerHeight?rect.bottom+6:Math.max(12,rect.top-height-6),width,maxHeight:height});
    };
    place();
    const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    requestAnimationFrame(()=>menu.current?.querySelector<HTMLElement>('input,[role=option]')?.focus());
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(()=>{menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active]);
  function keyboard(event:React.KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setActive(i=>Math.max(0,Math.min(filtered.length-1,i+(event.key==='ArrowDown'?1:-1))));}
    if(event.key==='Enter'&&filtered[active]){event.preventDefault();onChange(filtered[active].value);close();}
    if(event.key==='Tab')setOpen(false);
  }
  return <span className="compact-select"><button ref={trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{setQuery('');setActive(Math.max(0,options.findIndex(o=>o.value===value)));setOpen(v=>!v);}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}>{options.find(o=>o.value===value)?.label||label}<span aria-hidden>⌄</span></button>{open&&createPortal(<div className="compact-select-menu" ref={menu} style={position} onKeyDown={keyboard}>
    <div className="compact-select-heading"><b>{label}</b><button type="button" aria-label="关闭选项" onClick={close}>×</button></div>
    {options.length>8&&<input aria-label={'搜索'+label} placeholder="搜索名称" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}}/>}
    <div id={id} role="listbox" aria-label={label}>{filtered.map((option,i)=><button type="button" role="option" aria-selected={option.value===value} className={i===active?'highlighted':''} data-index={i} key={option.value} onClick={()=>{onChange(option.value);close();}}>{option.label}{option.value===value&&<span aria-hidden>✓</span>}</button>)}{!filtered.length&&<p>暂无匹配项</p>}</div>
  </div>,document.body)}</span>;
}
