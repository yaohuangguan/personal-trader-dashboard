import {CLIENT_STATE_KEYS,NEW_SITE,OLD_SITE} from '../shared/client-state';
import type {ShareStore} from './shares';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const buckets=new Map<string,{at:number;count:number}>();
export async function clientMigrationRoute(request:Request,store?:ShareStore){
 const u=new URL(request.url);if(!u.pathname.startsWith('/api/client-migration'))return null;
 if(u.pathname==='/api/client-migration/bridge'&&request.method==='GET'){
  if(u.origin!==OLD_SITE)return Response.redirect(OLD_SITE+u.pathname+u.search,302);
  const target=new URL(u.searchParams.get('return')||'/',NEW_SITE),nonce=u.searchParams.get('nonce')||'';
  if(target.origin!==NEW_SITE)return json({error:'Invalid destination'},400);
  const safe=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c');
  const script=String.raw`(async()=>{
const target=TARGET,keys=KEYS,returnPath=RETURN,nonce=NONCE;
if(!/^[A-Za-z0-9_-]{24,64}$/.test(nonce)){location.replace(target+'/?restore=1');return;}
const enc=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
try{
 const entries={};for(const k of keys){const v=localStorage.getItem(k);if(v!==null)entries[k]=v;}
 if(!Object.keys(entries).length){location.replace(target+returnPath.split('#')[0]+'#client-migration=empty.'+nonce);return;}
 const key=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12)),secret=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 const plain=new TextEncoder().encode(JSON.stringify({entries,returnPath,nonce}));
 if(plain.length>524000)throw new Error('本地收藏数据过大，请先导出后再迁移');
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},secret,plain));
 const chunks=[];for(let i=0;i<cipher.length;i+=8192)chunks.push(String.fromCharCode(...cipher.subarray(i,i+8192)));
 const encrypted=btoa(chunks.join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const response=await fetch('/api/client-migration',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({iv:enc(iv),cipher:encrypted})});
 const data=await response.json();if(!response.ok||!data.id)throw new Error(data.error||'恢复暂时失败');
 location.replace(target+returnPath.split('#')[0]+'#client-migration='+data.id+'.'+enc(key));
}catch(e){document.getElementById('status').textContent='恢复暂未完成：'+e.message+'。旧站本地数据仍保留，可刷新重试。';}
})();`.replace('TARGET',safe(NEW_SITE)).replace('KEYS',safe(CLIENT_STATE_KEYS)).replace('RETURN',safe(target.pathname+target.search+target.hash)).replace('NONCE',safe(nonce));
  return new Response('<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>恢复自选 · 观澜</title><body style="background:#101013;color:#ddd;font:18px system-ui;padding:40px"><p id="status">正在从旧站恢复自选、分组和设置…</p><script>'+script+'</script>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
 }
 if(!store)return json({error:'迁移存储暂不可用'},503);
 const read=/^\/api\/client-migration\/([A-Za-z0-9_-]{22})$/.exec(u.pathname);
 if(read&&request.method==='GET'){const raw=await store.get('migration:'+read[1]);if(!raw)return json({error:'迁移资料已过期，请重新从旧站恢复'},404);const data=JSON.parse(raw);return data.expiresAt>Date.now()?json(data):json({error:'迁移资料已过期'},410);}
 if(u.pathname!=='/api/client-migration'||request.method!=='POST')return json({error:'Not found'},404);
 if(request.headers.get('origin')!==u.origin)return json({error:'Invalid origin'},403);
 const ip=request.headers.get('cf-connecting-ip')||'local',prior=buckets.get(ip),entry=prior&&Date.now()-prior.at<60000?prior:{at:Date.now(),count:0};if(entry.count>=6)return json({error:'恢复请求过于频繁，请稍后重试'},429);if(buckets.size>1000)buckets.clear();buckets.set(ip,entry);entry.count++;
 const text=await request.text();if(text.length>750000)return json({error:'迁移数据过大'},413);
 let data;try{data=JSON.parse(text);}catch{return json({error:'Invalid payload'},400);}
 if(typeof data.iv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(data.iv)||typeof data.cipher!=='string'||!/^[A-Za-z0-9_-]{24,749000}$/.test(data.cipher))return json({error:'Invalid encrypted payload'},400);
 const id=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 await store.put('migration:'+id,JSON.stringify({iv:data.iv,cipher:data.cipher,expiresAt:Date.now()+600000}),{expirationTtl:600});return json({id});
}
