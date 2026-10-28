import {watchDiff,applyWatchOps,emptyWatch,validWatch,type WatchState} from '../shared/watch-sync';
const TOKEN='atlas.sync.token.v1',BASE='atlas.sync.base.v1';
let busy=false,timer:ReturnType<typeof setTimeout>|undefined;
export let syncStatus='未连接云同步';
const announce=(message:string)=>{syncStatus=message;window.dispatchEvent(new Event('atlas:sync-status'));};
function local():WatchState{try{return {watchlist:JSON.parse(localStorage.getItem('atlas.watchlist.v1')||'[]'),groups:JSON.parse(localStorage.getItem('atlas.watch.groups.v1')||'[]')};}catch{return emptyWatch();}}
function baseline(){try{return JSON.parse(localStorage.getItem(BASE)||'null') as {state:WatchState;revision:number}|null;}catch{return null;}}
async function request(path:string,body?:unknown){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(localStorage.getItem(TOKEN)||'')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'云同步暂不可用');return data;}
export async function connectSync(token?:string){
 if(busy)throw new Error('正在同步，请稍候');
 const remote=token?await fetch('/api/watch-sync',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}):await request('/api/watch-sync/create',{});
 localStorage.setItem(TOKEN,token||remote.token);localStorage.removeItem(BASE);await syncWatch();
}
export function disconnectSync(){localStorage.removeItem(TOKEN);localStorage.removeItem(BASE);announce('已断开，本机自选保留');}
export const syncKey=()=>localStorage.getItem(TOKEN)||'';
export async function syncWatch(){
 if(busy||!syncKey())return;busy=true;announce('正在同步…');
 try{
  const before=local(),base=baseline(),remote=await request('/api/watch-sync');if(!validWatch(before)||!validWatch(remote.state))throw new Error('自选资料格式无效');
  const ops=watchDiff(base?.state||emptyWatch(),before);
  const result=ops.length?await request('/api/watch-sync',{id:crypto.randomUUID(),baseRevision:base?.revision??remote.revision,ops}):remote;
  // Preserve edits made while the network request was in flight; upload those on the next pass.
  const after=local(),pending=watchDiff(before,after),applied=applyWatchOps(result.state,pending);
  localStorage.setItem(BASE,JSON.stringify({state:result.state,revision:result.revision}));if(JSON.stringify(after)!==JSON.stringify(applied)){localStorage.setItem('atlas.watchlist.v1',JSON.stringify(applied.watchlist));localStorage.setItem('atlas.watch.groups.v1',JSON.stringify(applied.groups));window.dispatchEvent(new Event('atlas:watch-cloud'));}
  announce('已同步 · '+new Date(result.updatedAt).toLocaleTimeString());if(pending.length)scheduleSync();
 }catch(e){announce('未同步：'+(e instanceof Error?e.message:'网络异常')+'；本机修改保留');}finally{busy=false;}
}
export function scheduleSync(){clearTimeout(timer);timer=setTimeout(()=>void syncWatch(),900);}
export function startWatchSync(){window.addEventListener('atlas:watch-local',scheduleSync);window.addEventListener('online',scheduleSync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleSync();});setInterval(()=>{if(!document.hidden)void syncWatch();},30000);void syncWatch();}
