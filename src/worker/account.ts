import type {MonitorNamespace} from './signal-monitor';

/** Email + username + password accounts. Hashing runs inside the registry Durable Object (30s CPU budget), not the Worker (10ms on Free). */
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;delete(key:string):Promise<boolean>};
export type AccountRecord={id:string;email:string;username:string;salt:string;hash:string;iterations:number;createdAt:string};
export type PublicAccount={id:string;email:string;username:string};
type Session={accountId:string;createdAt:number;expiresAt:number};
type Failures={count:number;until:number};

export const PBKDF2_ITERATIONS=100000;
const SESSION_MS=365*86400000,LOCK_MS=15*60000,MAX_FAILURES=8;
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
const hex=(b:ArrayBuffer|Uint8Array)=>Array.from(b instanceof Uint8Array?b:new Uint8Array(b)).map(n=>n.toString(16).padStart(2,'0')).join('');
const fromHex=(s:string):Uint8Array<ArrayBuffer>=>new Uint8Array((s.match(/../g)||[]).map(h=>parseInt(h,16)));
const b64u=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const sha256=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));

export const normalizeEmail=(v:string)=>v.trim().toLowerCase();
export const usernameKey=(v:string)=>v.trim().normalize('NFKC').toLowerCase();
export const validEmail=(v:unknown):v is string=>typeof v==='string'&&v.trim().length<=254&&/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const validUsername=(v:unknown):v is string=>typeof v==='string'&&/^[\p{L}\p{N}_.-]{2,24}$/u.test(v.trim().normalize('NFKC'));
export const validPassword=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=128;
export const validToken=(v:string)=>/^[A-Za-z0-9_-]{43}$/.test(v);

async function derive(password:string,salt:Uint8Array<ArrayBuffer>,iterations:number){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256));
}
/** Constant-time comparison of two equal-format hex strings. */
function same(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
const publicAccount=(a:AccountRecord):PublicAccount=>({id:a.id,email:a.email,username:a.username});

async function openSession(s:Storage,accountId:string){
 const token=b64u(crypto.getRandomValues(new Uint8Array(32))),now=Date.now();
 await s.put<Session>('sess:'+await sha256(token),{accountId,createdAt:now,expiresAt:now+SESSION_MS});
 return token;
}

/** Verifies a password with the shared 15-minute lockout; returns an error response or null when it matches. */
async function checkPassword(s:Storage,record:AccountRecord|undefined,failKey:string,password:string,wrong:string){
 const fails=await s.get<Failures>(failKey);
 if(fails&&fails.count>=MAX_FAILURES&&fails.until>Date.now())return json({error:'尝试次数过多，请15分钟后再试',retryAt:new Date(fails.until).toISOString()},429);
 // Unknown accounts still pay for one derivation so response time does not reveal which logins exist.
 const hash=await derive(password,record?fromHex(record.salt):new Uint8Array(16),record?.iterations||PBKDF2_ITERATIONS);
 if(!record||!same(hash,record.hash)){
  const count=(fails&&fails.until>Date.now()?fails.count:0)+1;await s.put<Failures>(failKey,{count,until:Date.now()+LOCK_MS});
  return json({error:wrong},401);
 }
 if(fails)await s.delete(failKey);
 return null;
}

/** Registry Durable Object handler: one serialized store for every account, username/email index and session. */
export async function accountStore(req:Request,s:Storage):Promise<Response>{
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let body:Record<string,unknown>;try{body=await req.json() as Record<string,unknown>;}catch{return json({error:'Invalid JSON'},400);}
 const op=body.op;
 if(op==='register'){
  const {email,username,password}=body;
  if(!validEmail(email))return json({error:'邮箱格式无效'},400);
  if(!validUsername(username))return json({error:'用户名需为2-24位字母、数字、中文或 _ . -'},400);
  if(!validPassword(password))return json({error:'密码需为8-128位'},400);
  const mail=normalizeEmail(email),name=username.trim().normalize('NFKC');
  if(await s.get('acct:email:'+mail))return json({error:'该邮箱已注册'},409);
  if(await s.get('acct:user:'+usernameKey(name)))return json({error:'该用户名已被使用'},409);
  const salt=crypto.getRandomValues(new Uint8Array(16)),id=crypto.randomUUID();
  const record:AccountRecord={id,email:mail,username:name,salt:hex(salt),hash:await derive(password,salt,PBKDF2_ITERATIONS),iterations:PBKDF2_ITERATIONS,createdAt:new Date().toISOString()};
  await s.put('acct:id:'+id,record);await s.put('acct:email:'+mail,id);await s.put('acct:user:'+usernameKey(name),id);
  return json({token:await openSession(s,id),account:publicAccount(record)});
 }
 if(op==='login'){
  const {login,password}=body;
  if(typeof login!=='string'||!login.trim()||login.length>254||typeof password!=='string'||password.length>128)return json({error:'请输入邮箱或用户名和密码'},400);
  const id=await s.get<string>(login.includes('@')?'acct:email:'+normalizeEmail(login):'acct:user:'+usernameKey(login));
  const record=id?await s.get<AccountRecord>('acct:id:'+id):undefined;
  const denied=await checkPassword(s,record,'fail:'+(id||'unknown:'+await sha256(usernameKey(login))),password,'邮箱/用户名或密码错误');
  if(denied||!record)return denied!;
  return json({token:await openSession(s,record.id),account:publicAccount(record)});
 }
 if(op==='delete'){
  if(typeof body.token!=='string'||!validToken(body.token))return json({error:'请先登录'},401);
  if(typeof body.password!=='string'||body.password.length>128)return json({error:'请输入密码确认删除'},400);
  const key='sess:'+await sha256(body.token),session=await s.get<Session>(key);
  const record=session&&session.expiresAt>Date.now()?await s.get<AccountRecord>('acct:id:'+session.accountId):undefined;
  if(!record)return json({error:'登录已过期，请重新登录'},401);
  const denied=await checkPassword(s,record,'fail:'+record.id,body.password,'密码错误');
  if(denied)return denied;
  // Other devices' sessions now resolve to a missing account and sign out on their next request.
  await s.delete('acct:id:'+record.id);await s.delete('acct:email:'+record.email);await s.delete('acct:user:'+usernameKey(record.username));await s.delete(key);
  return json({ok:true,accountId:record.id});
 }
 // Internal only: accountRoute never forwards an op from client input, so this is reachable solely from operator code.
 if(op==='lookup'){
  if(!validEmail(body.email))return json({error:'Invalid email'},400);
  const id=await s.get<string>('acct:email:'+normalizeEmail(body.email)),record=id?await s.get<AccountRecord>('acct:id:'+id):undefined;
  return record?json({account:publicAccount(record)}):json({error:'Account not found'},404);
 }
 if(op==='session'||op==='logout'){
  if(typeof body.token!=='string'||!validToken(body.token))return json({error:'请先登录'},401);
  const key='sess:'+await sha256(body.token),session=await s.get<Session>(key);
  if(op==='logout'){if(session)await s.delete(key);return json({ok:true});}
  if(!session||session.expiresAt<=Date.now()){if(session)await s.delete(key);return json({error:'登录已过期，请重新登录'},401);}
  const record=await s.get<AccountRecord>('acct:id:'+session.accountId);
  if(!record)return json({error:'账号不存在'},401);
  return json({account:publicAccount(record)});
 }
 return json({error:'Unknown operation'},400);
}

const attempts=new Map<string,{at:number;count:number}>();
function limited(ip:string,kind:string,max:number,windowMs:number){
 const key=kind+':'+ip,old=attempts.get(key),v=old&&Date.now()-old.at<windowMs?old:{at:Date.now(),count:0};
 if(v.count++>=max)return true;if(attempts.size>2000)attempts.clear();attempts.set(key,v);return false;
}
const ORIGINS=['https://guanlan.nzs.workers.dev','https://personal-market-atlas.nzs.workers.dev'];

/** /api/account/{register,login,logout,me,watch,delete}. The watchlist vault is one Durable Object per account. */
export async function accountRoute(req:Request,ns?:MonitorNamespace){
 const u=new URL(req.url);if(!u.pathname.startsWith('/api/account/'))return null;
 if(!ns)return json({error:'账号服务暂不可用'},503);
 const origin=req.headers.get('origin');
 if(req.method!=='GET'&&origin&&![...ORIGINS,u.origin].includes(origin))return json({error:'Invalid origin'},403);
 const action=u.pathname.slice('/api/account/'.length),ip=req.headers.get('cf-connecting-ip')||'local';
 const registry=(payload:object)=>ns.get(ns.idFromName('accounts:v1')).fetch(new Request('https://internal/account',{method:'POST',body:JSON.stringify(payload)}));
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(action==='register'||action==='login'){
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(action==='register'?limited(ip,'register',10,3600000):limited(ip,'login',30,LOCK_MS))return json({error:'请求过于频繁，请稍后重试'},429);
  const raw=await req.text();if(raw.length>4000)return json({error:'请求过大'},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
  return registry(action==='register'?{op:'register',email:body.email,username:body.username,password:body.password}:{op:'login',login:body.login,password:body.password});
 }
 if(!validToken(token))return json({error:'请先登录'},401);
 if(action==='logout'){if(req.method!=='POST')return json({error:'Method not allowed'},405);return registry({op:'logout',token});}
 if(action==='delete'){
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const raw=await req.text();if(raw.length>4000)return json({error:'请求过大'},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
  const result=await registry({op:'delete',token,password:body.password});
  if(!result.ok)return result;
  const {accountId}=await result.json() as {accountId:string};
  await ns.get(ns.idFromName('watch-account:'+accountId)).fetch(new Request('https://internal/cloud-watch?purge=1',{method:'DELETE'}));
  return json({ok:true});
 }
 const session=await registry({op:'session',token});
 if(action==='me')return session;
 if(action!=='watch')return json({error:'Unknown API path'},404);
 if(!session.ok)return session;
 const {account}=await session.json() as {account:PublicAccount};
 return ns.get(ns.idFromName('watch-account:'+account.id)).fetch(new Request('https://internal/cloud-watch?ensure=1',{method:req.method,body:req.method==='GET'?undefined:await req.text()}));
}
