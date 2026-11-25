import {parseWatchTransfer} from '../shared/watch-transfer';
import type {ShareStore} from './shares';

/** One-time snapshot share codes: POST a watchlist, get an 8-character code; anyone with the code can import a copy. */
export const SHARE_CODE_ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHARE_TTL_SECONDS=30*86400;
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
/** Accepts "abcd-2345", "ABCD2345" or with spaces; returns the canonical 8 characters or null. */
export function normalizeShareCode(input:string){const code=input.toUpperCase().replace(/[\s-]/g,'');return code.length===8&&[...code].every(c=>SHARE_CODE_ALPHABET.includes(c))?code:null;}
export const formatShareCode=(code:string)=>code.slice(0,4)+'-'+code.slice(4);
function newCode(){const bytes=crypto.getRandomValues(new Uint8Array(8));return [...bytes].map(b=>SHARE_CODE_ALPHABET[b%SHARE_CODE_ALPHABET.length]).join('');}
const created=new Map<string,{at:number;count:number}>();

export async function watchShareRoute(req:Request,store?:ShareStore){
 const u=new URL(req.url),read=/^\/api\/watch-share\/([^/]{1,20})$/.exec(u.pathname);
 if(!read&&u.pathname!=='/api/watch-share')return null;
 if(!store)return json({error:'分享码存储暂不可用'},503);
 if(read){
  if(req.method!=='GET')return json({error:'Method not allowed'},405);
  const code=normalizeShareCode(decodeURIComponent(read[1]));if(!code)return json({error:'分享码格式无效'},400);
  const found=await store.get('watchshare:'+code);
  return found?json({...JSON.parse(found),code:formatShareCode(code)}):json({error:'分享码不存在或已过期'},404);
 }
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==u.origin)return json({error:'Origin mismatch'},403);
 const ip=req.headers.get('cf-connecting-ip')||'local',old=created.get(ip),entry=old&&Date.now()-old.at<3600000?old:{at:Date.now(),count:0};
 if(entry.count>=20)return json({error:'生成过于频繁，请稍后重试'},429);
 const raw=await req.text();if(raw.length>262144)return json({error:'自选文件过大，最大256KB'},413);
 let transfer;try{transfer=parseWatchTransfer(raw);}catch(e){return json({error:e instanceof Error?e.message:'无效自选资料'},400);}
 if(!transfer.watchlist.length)return json({error:'没有可分享的自选股票'},400);
 if(created.size>2000)created.clear();entry.count++;created.set(ip,entry);
 let code='';for(let i=0;i<5&&!code;i++){const next=newCode();if(!await store.get('watchshare:'+next))code=next;}
 if(!code)return json({error:'暂时无法生成分享码，请重试'},503);
 const expiresAt=new Date(Date.now()+SHARE_TTL_SECONDS*1000).toISOString();
 try{await store.put('watchshare:'+code,JSON.stringify({...transfer,createdAt:new Date().toISOString(),expiresAt}),{expirationTtl:SHARE_TTL_SECONDS});}
 catch{return json({error:'暂时无法保存分享，请稍后重试'},503);}
 return json({code:formatShareCode(code),expiresAt,count:transfer.watchlist.length,groups:transfer.groups.length});
}
