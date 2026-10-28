import {CLIENT_STATE_KEYS,MIGRATED_KEY,NEW_SITE,OLD_SITE,mergedClientState} from '../shared/client-state';
const pending='atlas.client-migration.nonce';
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
function collect(){const entries:Record<string,string>={};for(const k of CLIENT_STATE_KEYS){const v=localStorage.getItem(k);if(v!==null)entries[k]=v;}return entries;}
export async function migrateClientState(){
 if(location.origin!==NEW_SITE)return true;
 const u=new URL(location.href),claim=u.hash.startsWith('#client-migration=')?u.hash.slice(18):'';
 if(claim){
  history.replaceState(null,'',u.pathname+u.search);
  const [id,key]=claim.split('.'),nonce=sessionStorage.getItem(pending);
  if(id==='empty'){if(!nonce||key!==nonce)throw new Error('恢复会话不匹配');localStorage.setItem(MIGRATED_KEY,'1');sessionStorage.removeItem(pending);return true;}
  if(!nonce||!/^[A-Za-z0-9_-]{22}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(key))throw new Error('恢复会话不匹配，请重新打开恢复入口');
  let encrypted;for(let attempt=0;attempt<4;attempt++){const r=await fetch('/api/client-migration/'+id,{cache:'no-store'});if(r.ok){encrypted=await r.json();break;}await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}
  if(!encrypted)throw new Error('暂时未取得迁移资料，请重试');
  const secret=await crypto.subtle.importKey('raw',decode(key),'AES-GCM',false,['decrypt']),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(encrypted.iv)},secret,decode(encrypted.cipher));
  const data=JSON.parse(new TextDecoder().decode(plain));if(data.nonce!==nonce||!data.entries||typeof data.entries!=='object')throw new Error('恢复资料校验失败');
  const merged=mergedClientState(collect(),data.entries);for(const k of CLIENT_STATE_KEYS)if(typeof merged[k]==='string')localStorage.setItem(k,merged[k]);
  localStorage.setItem(MIGRATED_KEY,'1');sessionStorage.removeItem(pending);const destination=new URL(data.returnPath||'/',NEW_SITE);if(destination.origin===NEW_SITE)history.replaceState(null,'',destination.pathname+destination.search+destination.hash);return true;
 }
 if(u.searchParams.get('restore')==='1'||localStorage.getItem(MIGRATED_KEY)!=='1'){
  u.searchParams.delete('restore');const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');sessionStorage.setItem(pending,nonce);
  location.replace(OLD_SITE+'/api/client-migration/bridge?nonce='+nonce+'&return='+encodeURIComponent(u.pathname+u.search+u.hash));return false;
 }
 return true;
}
