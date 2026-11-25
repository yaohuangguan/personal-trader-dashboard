import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountRoute,accountStore,type AccountRecord} from '../src/worker/account';
import {watchVault} from '../src/worker/watch-sync';
import {watchDiff,emptyWatch,type WatchState} from '../src/shared/watch-sync';

/** In-memory stand-in for the MARKET_SCANNER namespace: one storage map per object name, routed like CloseCoordinator. */
function namespace(){
 const objects=new Map<string,Map<string,unknown>>();
 const storage=(data:Map<string,unknown>)=>({get:async<T>(k:string)=>data.get(k) as T|undefined,put:async<T>(k:string,v:T)=>{data.set(k,structuredClone(v));},delete:async(k:string)=>data.delete(k)});
 const ns={idFromName:(name:string)=>name,get:(name:unknown)=>{
  const key=String(name);if(!objects.has(key))objects.set(key,new Map());const s=storage(objects.get(key)!);
  return {fetch:async(req:Request)=>{const action=new URL(req.url).pathname.slice(1);return action==='account'?accountStore(req,s):watchVault(req,s);}};
 }};
 return {ns,objects};
}
const origin='https://guanlan.nzs.workers.dev';
let client=0;
function call(ns:ReturnType<typeof namespace>['ns'],path:string,{body,token,ip='203.0.113.'+(++client%250)}:{body?:object;token?:string;ip?:string}={}){
 return accountRoute(new Request(origin+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:{'cf-connecting-ip':ip,origin,...(token?{authorization:'Bearer '+token}:{})}}),ns as never) as Promise<Response>;
}
const read=async(r:Response)=>({status:r.status,data:await r.json() as Record<string,any>});

test('register stores only a salted PBKDF2 hash and rejects duplicate email or username',async()=>{
 const {ns,objects}=namespace();
 const created=await read(await call(ns,'/api/account/register',{body:{email:' Sam@Example.com ',username:'Sam_Yao',password:'correct horse 42'}}));
 assert.equal(created.status,200);assert.match(created.data.token,/^[A-Za-z0-9_-]{43}$/);
 assert.deepEqual({email:created.data.account.email,username:created.data.account.username},{email:'sam@example.com',username:'Sam_Yao'});
 const registry=objects.get('accounts:v1')!,record=registry.get('acct:id:'+created.data.account.id) as AccountRecord;
 assert.equal(record.iterations,100000);assert.match(record.hash,/^[a-f0-9]{64}$/);assert.match(record.salt,/^[a-f0-9]{32}$/);
 assert.ok(!JSON.stringify([...registry.values()]).includes('correct horse 42'),'plaintext password must never be stored');
 assert.ok(![...registry.keys()].some(k=>k.includes(created.data.token)),'session tokens are stored hashed');
 assert.equal((await call(ns,'/api/account/register',{body:{email:'sam@example.com',username:'other',password:'another pass'}})).status,409);
 assert.equal((await call(ns,'/api/account/register',{body:{email:'new@example.com',username:'sam_yao',password:'another pass'}})).status,409);
 for(const bad of [{email:'not-an-email',username:'abc',password:'12345678'},{email:'a@b.co',username:'x',password:'12345678'},{email:'a@b.co',username:'abc',password:'short'}])
  assert.equal((await call(ns,'/api/account/register',{body:bad})).status,400);
 assert.equal((await read(await call(ns,'/api/account/register',{body:{email:'cn@example.com',username:'观澜用户',password:'12345678'}}))).status,200);
});

test('login accepts email or username, sessions resolve and logout revokes',async()=>{
 const {ns}=namespace();
 await call(ns,'/api/account/register',{body:{email:'sam@example.com',username:'Sam',password:'pass-word-1'}});
 const byName=await read(await call(ns,'/api/account/login',{body:{login:'SAM',password:'pass-word-1'}}));
 const byMail=await read(await call(ns,'/api/account/login',{body:{login:'Sam@Example.com',password:'pass-word-1'}}));
 assert.equal(byName.status,200);assert.equal(byMail.status,200);assert.notEqual(byName.data.token,byMail.data.token);
 assert.equal((await call(ns,'/api/account/login',{body:{login:'Sam',password:'wrong-password'}})).status,401);
 assert.equal((await call(ns,'/api/account/login',{body:{login:'nobody',password:'wrong-password'}})).status,401);
 const me=await read(await call(ns,'/api/account/me',{token:byName.data.token}));assert.equal(me.status,200);assert.equal(me.data.account.username,'Sam');
 assert.equal((await call(ns,'/api/account/logout',{body:{},token:byName.data.token})).status,200);
 assert.equal((await call(ns,'/api/account/me',{token:byName.data.token})).status,401);
 assert.equal((await call(ns,'/api/account/me',{token:byMail.data.token})).status,200,'other devices stay signed in');
 assert.equal((await call(ns,'/api/account/me')).status,401);
});

test('repeated wrong passwords lock the account for 15 minutes',async()=>{
 const {ns}=namespace();
 await call(ns,'/api/account/register',{body:{email:'lock@example.com',username:'locked',password:'right-password'}});
 for(let i=0;i<8;i++)assert.equal((await call(ns,'/api/account/login',{body:{login:'locked',password:'wrong-'+i},ip:'198.51.100.'+i})).status,401);
 const blocked=await read(await call(ns,'/api/account/login',{body:{login:'locked',password:'right-password'}}));
 assert.equal(blocked.status,429);assert.ok(blocked.data.retryAt);
});

test('first login uploads every local stock and a second device merges into the same account watchlist',async()=>{
 const {ns}=namespace();
 const {data:{token:phone}}=await read(await call(ns,'/api/account/register',{body:{email:'w@example.com',username:'watcher',password:'watch-pass'}}));
 const empty=await read(await call(ns,'/api/account/watch',{token:phone}));
 assert.equal(empty.status,200);assert.equal(empty.data.revision,0);assert.deepEqual(empty.data.state,emptyWatch());
 const phoneLocal:WatchState={watchlist:['002472.SZ','NVDA','600519.SH'],groups:[{id:'core',name:'核心',symbols:['NVDA']}]};
 const uploaded=await read(await call(ns,'/api/account/watch',{token:phone,body:{id:'phone-initial-upload-1',baseRevision:0,ops:watchDiff(emptyWatch(),phoneLocal)}}));
 assert.equal(uploaded.status,200);assert.deepEqual(uploaded.data.state,phoneLocal);
 const {data:{token:web}}=await read(await call(ns,'/api/account/login',{body:{login:'w@example.com',password:'watch-pass'}}));
 const webLocal:WatchState={watchlist:['AAPL','NVDA'],groups:[]};
 const merged=await read(await call(ns,'/api/account/watch',{token:web,body:{id:'web-initial-upload-01',baseRevision:uploaded.data.revision,ops:watchDiff(emptyWatch(),webLocal)}}));
 assert.deepEqual([...merged.data.state.watchlist].sort(),['002472.SZ','600519.SH','AAPL','NVDA']);
 assert.deepEqual(merged.data.state.groups,phoneLocal.groups);
 const {data:{token:other}}=await read(await call(ns,'/api/account/register',{body:{email:'o@example.com',username:'other',password:'other-pass'}}));
 assert.deepEqual((await read(await call(ns,'/api/account/watch',{token:other}))).data.state,emptyWatch(),'accounts never share a vault');
 assert.equal((await call(ns,'/api/account/watch',{token:'A'.repeat(43)})).status,401);
});

test('cross-site writes are rejected',async()=>{
 const {ns}=namespace();
 const r=await accountRoute(new Request(origin+'/api/account/register',{method:'POST',body:'{}',headers:{origin:'https://evil.example'}}),ns as never);
 assert.equal(r!.status,403);
 assert.equal(await accountRoute(new Request(origin+'/api/watch-sync'),ns as never),null);
});

test('registration is rate limited per client address',async()=>{
 const {ns}=namespace();let last=0;
 for(let i=0;i<11;i++)last=(await call(ns,'/api/account/register',{body:{email:`r${i}@example.com`,username:'rate'+i,password:'rate-pass-1'},ip:'192.0.2.1'})).status;
 assert.equal(last,429);
});
