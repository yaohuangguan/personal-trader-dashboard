export type WatchGroup={id:string;name:string;symbols:string[]};
export type WatchState={watchlist:string[];groups:WatchGroup[]};
export type WatchOp={kind:'add'|'remove';symbol:string}|{kind:'group';group:WatchGroup;previous?:WatchGroup}|{kind:'delete-group';id:string}|{kind:'order';symbols:string[]};
const symbol=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z0-9.^:=_-]{1,32}$/.test(v);
export function validWatch(value:unknown):value is WatchState{const v=value as WatchState;return !!v&&Array.isArray(v.watchlist)&&v.watchlist.length<=200&&v.watchlist.every(symbol)&&Array.isArray(v.groups)&&v.groups.length<=30&&v.groups.every(g=>typeof g.id==='string'&&/^[\w-]{1,100}$/.test(g.id)&&typeof g.name==='string'&&g.name.length>0&&g.name.length<=24&&Array.isArray(g.symbols)&&g.symbols.length<=200&&g.symbols.every(symbol));}
export function watchDiff(base:WatchState,current:WatchState):WatchOp[]{
 const ops:WatchOp[]=[];for(const s of base.watchlist)if(!current.watchlist.includes(s))ops.push({kind:'remove',symbol:s});for(const s of current.watchlist)if(!base.watchlist.includes(s))ops.push({kind:'add',symbol:s});
 for(const g of base.groups)if(!current.groups.some(v=>v.id===g.id))ops.push({kind:'delete-group',id:g.id});for(const g of current.groups)if(JSON.stringify(g)!==JSON.stringify(base.groups.find(v=>v.id===g.id)))ops.push({kind:'group',group:g,previous:base.groups.find(v=>v.id===g.id)});
 if(JSON.stringify(base.watchlist)!==JSON.stringify(current.watchlist))ops.push({kind:'order',symbols:current.watchlist});return ops;
}
export function applyWatchOps(state:WatchState,ops:WatchOp[]):WatchState{
 const next=structuredClone(state);for(const op of ops){
  if(op.kind==='add'){if(!next.watchlist.includes(op.symbol))next.watchlist.push(op.symbol);}
  else if(op.kind==='remove'){next.watchlist=next.watchlist.filter(s=>s!==op.symbol);next.groups=next.groups.map(g=>({...g,symbols:g.symbols.filter(s=>s!==op.symbol)}));}
  else if(op.kind==='delete-group')next.groups=next.groups.filter(g=>g.id!==op.id);
  else if(op.kind==='group'){
   const remote=next.groups.find(g=>g.id===op.group.id),old=op.previous;if(!remote&&old)continue;
   const memberships=remote?remote.symbols.filter(s=>!old?.symbols.includes(s)||op.group.symbols.includes(s)):[];
   const symbols=[...new Set([...memberships,...op.group.symbols.filter(s=>!old||!old.symbols.includes(s))])].filter(s=>next.watchlist.includes(s));
   const group={...op.group,name:remote&&old&&old.name===op.group.name?remote.name:op.group.name,symbols};next.groups=next.groups.filter(g=>g.id!==group.id);next.groups.push(group);
  }
  else if(op.kind==='order')next.watchlist=[...new Set([...op.symbols.filter(s=>next.watchlist.includes(s)),...next.watchlist])];
 }return next;
}
export const emptyWatch=():WatchState=>({watchlist:[],groups:[]});
