import type {MonitorNamespace} from './signal-monitor';

/** Email + username + password accounts. Hashing runs inside the registry Durable Object (30s CPU budget), not the Worker (10ms on Free). */
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;delete(key:string):Promise<boolean>;list?<T>(options:{prefix:string;limit?:number}):Promise<Map<string,T>>};
/** Runs a short storage-only critical section (blockConcurrencyWhile in the registry object). */
export type Lock=<T>(fn:()=>Promise<T>)=>Promise<T>;
export type AccountRecord={id:string;email:string;username:string;salt:string;hash:string;iterations:number;createdAt:string;deleting?:number};
export type PublicAccount={id:string;email:string;username:string};
type Session={accountId:string;createdAt:number;expiresAt:number};
/** Failed password attempts in the current window; `last` is the latest failure time. */
type Failures={count:number;last:number;until:number};
type Counter={count:number;start:number};

export const PBKDF2_ITERATIONS=100000;
const SESSION_MS=365*86400000,FAIL_WINDOW_MS=15*60000,MAX_INDEXED_SESSIONS=50,DELETE_CONFIRM_MS=10*60000;
/** Client-address limits, counted in the registry object so every isolate shares them. */
export const ADDRESS_LIMITS={register:{max:10,windowMs:3600000},login:{max:30,windowMs:15*60000}} as const;
/**
 * Progressive delay instead of a hard lockout: one client address that keeps failing for an
 * account waits 1 s, 2 s, 4 s … (max 15 min) after its fifth failure; all addresses together get
 * at most a 30 s pause after 20 failures. Somebody else's guessing cannot lock the owner out.
 */
export function failureDelayMs(perAddress:number,perAccount:number){
 const own=perAddress<5?0:Math.min(FAIL_WINDOW_MS,1000*2**(perAddress-5));
 const shared=perAccount<20?0:30000;
 return Math.max(own,shared);
}
const json=(v:unknown,status=200,headers:Record<string,string>={})=>Response.json(v,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer',...headers}});
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

/** Per-account index of session keys, so deleting an account signs out every device. */
const sessionIndex=(accountId:string)=>'acct-sess:'+accountId;
async function openSession(s:Storage,accountId:string){
 const token=b64u(crypto.getRandomValues(new Uint8Array(32))),now=Date.now(),key='sess:'+await sha256(token);
 await s.put<Session>(key,{accountId,createdAt:now,expiresAt:now+SESSION_MS});
 const index=(await s.get<string[]>(sessionIndex(accountId))||[]).filter(k=>k!==key);
 await s.put(sessionIndex(accountId),[...index,key].slice(-MAX_INDEXED_SESSIONS));
 return token;
}
async function closeSession(s:Storage,key:string,accountId?:string){
 await s.delete(key);
 if(accountId){const index=await s.get<string[]>(sessionIndex(accountId));if(index?.includes(key))await s.put(sessionIndex(accountId),index.filter(k=>k!==key));}
}
const live=(f:Failures|undefined,now:number)=>f&&f.until>now?f:undefined;
let lastSweep=0;
/** Expired failure and rate-limit records are deleted at most every 10 minutes (bounded). */
async function sweep(s:Storage,now=Date.now()){
 if(!s.list||now-lastSweep<600000)return;lastSweep=now;
 for(const prefix of ['fail:','rl:']){const batch=await s.list<{until?:number;start?:number}>({prefix,limit:200});for(const [key,v] of batch)if(!v||(v.until??((v.start??0)+3600000))<=now)await s.delete(key);}
}
/** Counts one request per client address and kind; returns seconds to wait when over the limit. */
async function addressLimited(s:Storage,lock:Lock,kind:keyof typeof ADDRESS_LIMITS,ip:string){
 const {max,windowMs}=ADDRESS_LIMITS[kind],key='rl:'+kind+':'+(await sha256(ip||'unknown')).slice(0,32),now=Date.now();
 return lock(async()=>{
  const old=await s.get<Counter>(key),v=old&&now-old.start<windowMs?old:{count:0,start:now};
  if(v.count>=max)return Math.max(1,Math.ceil((v.start+windowMs-now)/1000));
  v.count++;await s.put(key,v);return 0;
 });
}
const tooMany=(retryAfter:number)=>json({error:'请求过于频繁，请稍后重试',code:'RATE_LIMITED',retryAfter},429,{'retry-after':String(retryAfter)});

/**
 * Verifies a password with progressive per-address delays; returns an error response or null when it
 * matches. The PBKDF2 derivation runs outside the critical section; only the counters are locked.
 */
async function checkPassword(s:Storage,lock:Lock,record:AccountRecord|undefined,subject:string,ip:string,password:string,wrong:string){
 const now=Date.now(),addressKey='fail:'+subject+':'+(await sha256(ip||'unknown')).slice(0,16),accountKey='fail:'+subject;
 const own=live(await s.get<Failures>(addressKey),now),shared=live(await s.get<Failures>(accountKey),now);
 const wait=Math.max(own?own.last+failureDelayMs(own.count,0)-now:0,shared?shared.last+failureDelayMs(0,shared.count)-now:0);
 if(wait>0){const retryAfter=Math.ceil(wait/1000);return json({error:'尝试次数过多，请'+retryAfter+'秒后再试',code:'RATE_LIMITED',retryAfter,retryAt:new Date(now+wait).toISOString()},429,{'retry-after':String(retryAfter)});}
 // Unknown accounts still pay for one derivation so response time does not reveal which logins exist.
 const hash=await derive(password,record?fromHex(record.salt):new Uint8Array(16),record?.iterations||PBKDF2_ITERATIONS);
 if(!record||!same(hash,record.hash)){
  await lock(async()=>{for(const key of [addressKey,accountKey]){const t=Date.now(),old=live(await s.get<Failures>(key),t);await s.put<Failures>(key,{count:(old?.count||0)+1,last:t,until:t+FAIL_WINDOW_MS});}});
  await sweep(s);
  return json({error:wrong},401);
 }
 if(own)await s.delete(addressKey);
 if(shared)await s.delete(accountKey);
 return null;
}
async function sessionRecord(s:Storage,token:unknown){
 if(typeof token!=='string'||!validToken(token))return null;
 const key='sess:'+await sha256(token),session=await s.get<Session>(key);
 if(!session)return null;
 if(session.expiresAt<=Date.now()){await closeSession(s,key,session.accountId);return null;}
 const record=await s.get<AccountRecord>('acct:id:'+session.accountId);
 if(!record){await s.delete(key);return null;}// Account deleted before session indexes existed.
 return {key,session,record};
}

/**
 * Registry Durable Object handler: one store for every account, username/email index and session.
 * `lock` wraps only short storage critical sections; password hashing runs outside it, so one
 * login no longer serialises every session check behind a 100k-iteration PBKDF2.
 */
export async function accountStore(req:Request,s:Storage,lock:Lock=fn=>fn()):Promise<Response>{
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let body:Record<string,unknown>;try{body=await req.json() as Record<string,unknown>;}catch{return json({error:'Invalid JSON'},400);}
 const op=body.op,ip=typeof body.ip==='string'?body.ip.slice(0,64):'';
 if(op==='register'){
  const limited=await addressLimited(s,lock,'register',ip);if(limited)return tooMany(limited);
  const {email,username,password}=body;
  if(!validEmail(email))return json({error:'邮箱格式无效'},400);
  if(!validUsername(username))return json({error:'用户名需为2-24位字母、数字、中文或 _ . -'},400);
  if(!validPassword(password))return json({error:'密码需为8-128位'},400);
  const mail=normalizeEmail(email),name=username.trim().normalize('NFKC');
  if(await s.get('acct:email:'+mail))return json({error:'该邮箱已注册'},409);
  if(await s.get('acct:user:'+usernameKey(name)))return json({error:'该用户名已被使用'},409);
  const salt=crypto.getRandomValues(new Uint8Array(16)),id=crypto.randomUUID();
  const record:AccountRecord={id,email:mail,username:name,salt:hex(salt),hash:await derive(password,salt,PBKDF2_ITERATIONS),iterations:PBKDF2_ITERATIONS,createdAt:new Date().toISOString()};
  // Uniqueness is re-checked inside the critical section: the derivation above may interleave.
  return lock(async()=>{
   if(await s.get('acct:email:'+mail))return json({error:'该邮箱已注册'},409);
   if(await s.get('acct:user:'+usernameKey(name)))return json({error:'该用户名已被使用'},409);
   await s.put('acct:id:'+id,record);await s.put('acct:email:'+mail,id);await s.put('acct:user:'+usernameKey(name),id);
   return json({token:await openSession(s,id),account:publicAccount(record)});
  });
 }
 if(op==='login'){
  const limited=await addressLimited(s,lock,'login',ip);if(limited)return tooMany(limited);
  const {login,password}=body;
  if(typeof login!=='string'||!login.trim()||login.length>254||typeof password!=='string'||password.length>128)return json({error:'请输入邮箱或用户名和密码'},400);
  const id=await s.get<string>(login.includes('@')?'acct:email:'+normalizeEmail(login):'acct:user:'+usernameKey(login));
  const record=id?await s.get<AccountRecord>('acct:id:'+id):undefined;
  const denied=await checkPassword(s,lock,record,id||'unknown:'+(await sha256(usernameKey(login))).slice(0,32),ip,password,'邮箱/用户名或密码错误');
  if(denied||!record)return denied!;
  return lock(async()=>json({token:await openSession(s,record.id),account:publicAccount(record)}));
 }
 // Deletion is two-phase so the watchlist vault is purged before the account disappears:
 // delete-verify (password) marks the account, the Worker purges the vault, delete-commit removes it.
 if(op==='delete-verify'){
  const found=await sessionRecord(s,body.token);if(!found)return json({error:'登录已过期，请重新登录'},401);
  if(typeof body.password!=='string'||body.password.length>128)return json({error:'请输入密码确认删除'},400);
  const denied=await checkPassword(s,lock,found.record,found.record.id,ip,body.password,'密码错误');
  if(denied)return denied;
  await lock(async()=>{const current=await s.get<AccountRecord>('acct:id:'+found.record.id);if(current)await s.put('acct:id:'+current.id,{...current,deleting:Date.now()});});
  return json({ok:true,accountId:found.record.id});
 }
 if(op==='delete-commit'){
  const found=await sessionRecord(s,body.token);if(!found)return json({error:'登录已过期，请重新登录'},401);
  const {record}=found;
  if(!record.deleting||Date.now()-record.deleting>DELETE_CONFIRM_MS)return json({error:'请重新输入密码确认删除',code:'DELETE_NOT_CONFIRMED'},409);
  await lock(async()=>{
   const sessions=await s.get<string[]>(sessionIndex(record.id))||[];
   for(const key of new Set([...sessions,found.key]))await s.delete(key);
   await s.delete(sessionIndex(record.id));await s.delete('fail:'+record.id);
   await s.delete('acct:id:'+record.id);await s.delete('acct:email:'+record.email);await s.delete('acct:user:'+usernameKey(record.username));
  });
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
  if(op==='logout'){const key='sess:'+await sha256(body.token),session=await s.get<Session>(key);if(session)await closeSession(s,key,session.accountId);return json({ok:true});}
  const found=await sessionRecord(s,body.token);
  if(!found)return json({error:'登录已过期，请重新登录'},401);
  return json({account:publicAccount(found.record)});
 }
 return json({error:'Unknown operation'},400);
}

/**
 * Positive session checks are reused for 30 s per isolate, so watchlist sync does not hit the
 * registry object on every request. Logout and deletion clear the entry in this isolate; another
 * isolate may accept a revoked token for at most 30 s, and a deleted account's vault is tombstoned.
 */
const SESSION_CACHE_MS=30000;
const sessionCache=new Map<string,{until:number;account:PublicAccount}>();
const forgetSession=(token:string)=>{sessionCache.delete(token);};
async function sessionLookup(ns:MonitorNamespace,token:string):Promise<{account:PublicAccount|null;response:Response}>{
 const hit=sessionCache.get(token);
 if(hit&&hit.until>Date.now())return {account:hit.account,response:json({account:hit.account})};
 const response=await ns.get(ns.idFromName('accounts:v1')).fetch(new Request('https://internal/account',{method:'POST',body:JSON.stringify({op:'session',token})}));
 if(!response.ok){forgetSession(token);return {account:null,response};}
 const {account}=await response.json() as {account:PublicAccount};
 if(sessionCache.size>2000)sessionCache.clear();
 sessionCache.set(token,{until:Date.now()+SESSION_CACHE_MS,account});
 return {account,response:json({account})};
}
/** Resolves an account session token; null when invalid or expired. */
export async function verifyAccountSession(ns:MonitorNamespace,token:string):Promise<PublicAccount|null>{
 if(!validToken(token))return null;
 return (await sessionLookup(ns,token)).account;
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
  const raw=await req.text();if(raw.length>4000)return json({error:'请求过大'},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
  // Address limits are counted in the registry object (shared by every isolate).
  return registry(action==='register'?{op:'register',email:body.email,username:body.username,password:body.password,ip}:{op:'login',login:body.login,password:body.password,ip});
 }
 if(!validToken(token))return json({error:'请先登录'},401);
 if(action==='logout'){if(req.method!=='POST')return json({error:'Method not allowed'},405);forgetSession(token);return registry({op:'logout',token});}
 if(action==='delete'){
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const raw=await req.text();if(raw.length>4000)return json({error:'请求过大'},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
  const verified=await registry({op:'delete-verify',token,password:body.password,ip});
  if(!verified.ok)return verified;
  const {accountId}=await verified.json() as {accountId:string};
  // Purge (and tombstone) the synced watchlist first; if that fails the account still exists and the user can retry.
  let purged=false;
  try{purged=(await ns.get(ns.idFromName('watch-account:'+accountId)).fetch(new Request('https://internal/cloud-watch?purge=1',{method:'DELETE'}))).ok;}catch{purged=false;}
  if(!purged)return json({error:'云端自选删除未完成，账号已保留，请重试',code:'DELETE_INCOMPLETE',retryAfter:5},503,{'retry-after':'5'});
  const committed=await registry({op:'delete-commit',token});
  if(!committed.ok)return committed;
  forgetSession(token);
  return json({ok:true});
 }
 const {account,response:session}=await sessionLookup(ns,token);
 if(action==='me')return session;
 if(action!=='watch')return json({error:'Unknown API path'},404);
 if(!account)return session;
 return ns.get(ns.idFromName('watch-account:'+account.id)).fetch(new Request('https://internal/cloud-watch?ensure=1',{method:req.method,body:req.method==='GET'?undefined:await req.text()}));
}
