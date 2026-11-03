import {validWatch,type WatchState} from './watch-sync';
export const WATCH_TRANSFER_FORMAT='guanlan-watchlist';
export const WATCH_TRANSFER_MAX_BYTES=262144;
export type WatchTransfer={format:typeof WATCH_TRANSFER_FORMAT;version:1;watchlist:string[];groups:{name:string;symbols:string[]}[]};
export type WatchImportPlan={state:WatchState;added:number;existing:number;skipped:number;groupsAdded:number;groupsMerged:number;groupsSkipped:number};
function tickers(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>200)throw new Error('自选代码格式无效或超过200只');
 return [...new Set(value.map(v=>{
  if(typeof v!=='string'||v.length>64)throw new Error('自选代码格式无效或超过200只');
  let symbol=v.trim().toUpperCase();
  if(!/^[A-Z0-9.^:=_-]{1,32}$/.test(symbol))throw new Error('自选代码格式无效或超过200只');
  if(/^\d{6}$/.test(symbol))symbol+='.'+(/^[65]/.test(symbol)?'SH':/^(?:4|8|92)/.test(symbol)?'BJ':'SZ');
  return symbol;
 }))];
}
/** Explicitly copy transferable fields; never copy credentials or local group IDs. */
export function parseWatchTransfer(input:string):WatchTransfer{
 if(new TextEncoder().encode(input).length>WATCH_TRANSFER_MAX_BYTES)throw new Error('自选文件过大，最大256KB');
 let raw;try{raw=JSON.parse(input.replace(/^\uFEFF/,''));}catch{throw new Error('不是有效的自选JSON文件');}
 if(Array.isArray(raw))raw={watchlist:raw};
 if(!raw||typeof raw!=='object'||raw.format!==undefined&&(raw.format!==WATCH_TRANSFER_FORMAT||raw.version!==1))throw new Error('不支持的自选文件格式或版本');
 const watchlist=tickers(raw.watchlist),allowed=new Set(watchlist),groups:WatchTransfer['groups']=[];
 if(raw.groups!==undefined&&(!Array.isArray(raw.groups)||raw.groups.length>30))throw new Error('自选分组格式无效或超过30组');
 for(const g of raw.groups||[]){
  if(!g||typeof g.name!=='string'||!g.name.trim()||g.name.trim().length>24||/[\u0000-\u001f\u007f]/.test(g.name))throw new Error('分组名称需要1–24个字');
  const members=tickers(g.symbols);if(members.some(s=>!allowed.has(s)))throw new Error('分组包含自选名单之外的代码');
  const name=g.name.trim(),old=groups.find(v=>v.name===name);
  if(old)old.symbols=[...new Set([...old.symbols,...members])];else groups.push({name,symbols:members});
 }
 return {format:WATCH_TRANSFER_FORMAT,version:1,watchlist,groups};
}
export function serializeWatchTransfer(state:WatchState):string{
 if(!validWatch(state))throw new Error('本机自选资料格式无效');
 const allowed=new Set(state.watchlist);
 const data=parseWatchTransfer(JSON.stringify({format:WATCH_TRANSFER_FORMAT,version:1,watchlist:state.watchlist,groups:state.groups.map(g=>({name:g.name,symbols:g.symbols.filter(s=>allowed.has(s))}))}));
 return JSON.stringify(data,null,2);
}
export function planWatchImport(current:WatchState,incoming:WatchTransfer,newId:()=>string=()=>crypto.randomUUID()):WatchImportPlan{
 if(!validWatch(current))throw new Error('本机自选资料格式无效');
 const source=parseWatchTransfer(JSON.stringify(incoming)),watchlist=[...current.watchlist],groups=current.groups.map(g=>({...g,symbols:[...g.symbols]})),old=new Set(watchlist);
 let added=0,existing=0,skipped=0,groupsAdded=0,groupsMerged=0,groupsSkipped=0;
 for(const s of source.watchlist){if(old.has(s)){existing++;continue;}if(watchlist.length>=60){skipped++;continue;}watchlist.push(s);added++;}
 const allowed=new Set(watchlist);
 for(const g of source.groups){
  const members=g.symbols.filter(s=>allowed.has(s)),found=groups.find(v=>v.name===g.name);
  if(found){found.symbols=[...new Set([...found.symbols,...members])];groupsMerged++;continue;}
  if(groups.length>=20||g.symbols.length>0&&!members.length){groupsSkipped++;continue;}
  const id=newId();if(!/^[\w-]{1,100}$/.test(id)||groups.some(g=>g.id===id))throw new Error('无法创建新的分组标识');
  groups.push({id,name:g.name,symbols:members});groupsAdded++;
 }
 return {state:{watchlist,groups},added,existing,skipped,groupsAdded,groupsMerged,groupsSkipped};
}
