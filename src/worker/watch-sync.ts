import {applyWatchOps,validWatch,emptyWatch,type WatchState,type WatchOp} from '../shared/watch-sync';
import type {MonitorNamespace} from './signal-monitor';
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>};
type Vault={revision:number;updatedAt:string;state:WatchState;seen:string[]};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
export async function watchVault(req:Request,s:Storage){
 let vault=await s.get<Vault>('watch:v1');
 if(req.method==='POST'&&new URL(req.url).searchParams.has('create')){if(vault)return json({error:'Already exists'},409);vault={revision:0,updatedAt:new Date().toISOString(),state:emptyWatch(),seen:[]};await s.put('watch:v1',vault);return json(vault);}
 if(!vault)return json({error:'同步密钥无效'},404);
 if(req.method==='GET')return json(vault);
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const raw=await req.text();if(raw.length>100000)return json({error:'同步资料过大'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 if(typeof body.id!=='string'||!/^[\w-]{16,100}$/.test(body.id)||!Array.isArray(body.ops)||body.ops.length>600||!Number.isInteger(body.baseRevision)||body.baseRevision<0||body.baseRevision>vault.revision)return json({error:'无效同步请求'},400);
 if(vault.seen.includes(body.id))return json(vault);
 const ops=body.ops as WatchOp[];if(ops.some(o=>!o||!['add','remove','order','group','delete-group'].includes(o.kind)))return json({error:'Invalid operation'},400);
 let next;try{next=applyWatchOps(vault.state,ops);}catch{return json({error:'Invalid operation'},400);}if(!validWatch(next))return json({error:'无效自选或分组'},400);
 vault={revision:vault.revision+1,updatedAt:new Date().toISOString(),state:next,seen:[...vault.seen,body.id].slice(-512)};await s.put('watch:v1',vault);return json(vault);
}
const attempts=new Map<string,{at:number;count:number}>();
export async function watchSyncRoute(req:Request,ns?:MonitorNamespace){
 const u=new URL(req.url);if(!u.pathname.startsWith('/api/watch-sync'))return null;
 if(!ns)return json({error:'云同步存储暂不可用'},503);
 const create=u.pathname==='/api/watch-sync/create'&&req.method==='POST';
 if(req.method!=='GET'&&req.headers.has('origin')&&!['https://guanlan.nzs.workers.dev','https://personal-market-atlas.nzs.workers.dev',u.origin].includes(req.headers.get('origin')!))return json({error:'Invalid origin'},403);
 let token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(create){const ip=req.headers.get('cf-connecting-ip')||'local',old=attempts.get(ip),v=old&&Date.now()-old.at<3600000?old:{at:Date.now(),count:0};if(v.count++>=10)return json({error:'创建过于频繁，请稍后重试'},429);if(attempts.size>1000)attempts.clear();attempts.set(ip,v);token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return json({error:'需要有效同步密钥'},401);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const response=await ns.get(ns.idFromName('watch-sync:'+hash)).fetch(new Request('https://internal/cloud-watch'+(create?'?create=1':''),{method:req.method,body:req.method==='GET'?undefined:await req.text()}));
 if(create&&response.ok)return json({...await response.json() as object,token});return response;
}
