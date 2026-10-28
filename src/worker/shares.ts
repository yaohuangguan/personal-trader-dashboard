import {shareArticle} from '../shared/share';
export interface ShareStore {get(key:string):Promise<string|null>;put(key:string,value:string,options?:{expirationTtl?:number}):Promise<void>}
const requests=new Map<string,{at:number;count:number}>();
export async function shareRoute(request:Request,store?:ShareStore,canonicalOrigin?:string):Promise<Response|null>{
 const u=new URL(request.url),read=/^\/api\/shares\/([A-Za-z0-9_-]{16})$/.exec(u.pathname),create=u.pathname==='/api/shares';
 if(!read&&!create)return null;
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
 if(!store)return reply({error:'站内短链接存储未配置'},503);
 if(read){if(request.method!=='GET')return reply({error:'Method not allowed'},405);const found=await store.get('article:'+read[1]);return found?reply({...JSON.parse(found),id:read[1]}):reply({error:'分享内容不存在或已移除'},404);}
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==u.origin)return reply({error:'Origin mismatch'},403);
 if(Number(request.headers.get('content-length')||0)>16000)return reply({error:'分享内容过长'},413);
 const body=await request.text();if(body.length>12000)return reply({error:'分享内容过长'},413);
 let parsed:unknown;try{parsed=JSON.parse(body);}catch{return reply({error:'无效分享内容'},400);}
 const article=shareArticle(parsed);if(!article)return reply({error:'分享内容缺少有效标题或来源地址'},400);
 const value=JSON.stringify(article),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),id=btoa(String.fromCharCode(...hash.slice(0,12))).replace(/\+/g,'-').replace(/\//g,'_');
 if(!await store.get('article:'+id)){
  const key=request.headers.get('cf-connecting-ip')||'local',old=requests.get(key),entry=old&&Date.now()-old.at<60000?old:{at:Date.now(),count:0};
  if(entry.count>=15)return reply({error:'分享过于频繁，请稍后重试'},429);if(requests.size>1000)requests.clear();entry.count++;requests.set(key,entry);
  try{await store.put('article:'+id,value);}catch{return reply({error:'暂时无法保存分享，请稍后重试'},503);}
 }
 return reply({id,url:(canonicalOrigin||u.origin)+'/n/'+id});
}
