import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountRoute,accountStore,failureDelayMs,type AccountRecord} from '../src/worker/account';
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

test('repeated wrong passwords slow that address down progressively without locking the owner out',async ctx=>{
 const {ns}=namespace();
 await call(ns,'/api/account/register',{body:{email:'lock@example.com',username:'locked',password:'right-password'}});
 ctx.mock.timers.enable({apis:['Date'],now:Date.now()});
 try{
  for(let i=0;i<5;i++)assert.equal((await call(ns,'/api/account/login',{body:{login:'locked',password:'wrong-'+i},ip:'198.51.100.7'})).status,401);
  const blocked=await call(ns,'/api/account/login',{body:{login:'locked',password:'right-password'},ip:'198.51.100.7'});
  assert.equal(blocked.status,429);const body=await blocked.json() as {retryAt:string;retryAfter:number;code:string};
  assert.ok(body.retryAt);assert.equal(body.retryAfter,1);assert.equal(body.code,'RATE_LIMITED');assert.equal(blocked.headers.get('retry-after'),'1');
  assert.equal((await call(ns,'/api/account/login',{body:{login:'locked',password:'right-password'},ip:'203.0.113.200'})).status,200,'the owner on another address is not locked out');
  ctx.mock.timers.tick(1100);
  assert.equal((await call(ns,'/api/account/login',{body:{login:'locked',password:'right-password'},ip:'198.51.100.7'})).status,200,'the delay is short and clears on success');
  for(let i=0;i<20;i++)await call(ns,'/api/account/login',{body:{login:'locked',password:'spray-'+i},ip:'192.0.2.'+(100+i)});
  const sprayed=await call(ns,'/api/account/login',{body:{login:'locked',password:'right-password'},ip:'203.0.113.201'});
  assert.equal(sprayed.status,429,'many addresses together get a bounded pause');assert.ok((await sprayed.json() as {retryAfter:number}).retryAfter<=30);
  ctx.mock.timers.tick(31000);
  assert.equal((await call(ns,'/api/account/login',{body:{login:'locked',password:'right-password'},ip:'203.0.113.201'})).status,200);
 }finally{ctx.mock.timers.reset();}
});

test('failure delays grow per address and stay bounded for the whole account',()=>{
 assert.deepEqual([0,4,5,6,7,14,30].map(n=>failureDelayMs(n,0)),[0,0,1000,2000,4000,512000,900000]);
 assert.equal(failureDelayMs(0,19),0);assert.equal(failureDelayMs(0,500),30000);
});

test('a failed vault purge keeps the account so deletion can be retried, and the vault is tombstoned',async()=>{
 const {ns,objects}=namespace();
 const {data:{token,account}}=await read(await call(ns,'/api/account/register',{body:{email:'retry@example.com',username:'retrier',password:'retry-pass-1'}}));
 await call(ns,'/api/account/watch',{token,body:{id:'upload-before-delete-2',baseRevision:0,ops:[{kind:'add',symbol:'NVDA'}]}});
 const flaky={idFromName:ns.idFromName,get:(name:unknown)=>String(name).startsWith('watch-account:')?{fetch:async(r:Request)=>r.method==='DELETE'?new Response('down',{status:500}):ns.get(name).fetch(r)}:ns.get(name)};
 const failed=await accountRoute(new Request(origin+'/api/account/delete',{method:'POST',body:JSON.stringify({password:'retry-pass-1'}),headers:{origin,authorization:'Bearer '+token,'cf-connecting-ip':'198.51.100.50'}}),flaky as never) as Response;
 assert.equal(failed.status,503);assert.equal((await failed.json() as {code:string}).code,'DELETE_INCOMPLETE');
 assert.equal((await call(ns,'/api/account/me',{token})).status,200,'the account survives a failed purge');
 assert.equal((await call(ns,'/api/account/delete',{token,body:{password:'retry-pass-1'}})).status,200,'retrying works');
 const vault=objects.get('watch-account:'+account.id)!;assert.equal(vault.has('watch:v1'),false);assert.ok(vault.has('watch:v1:deleted'));
 const recreated=await watchVault(new Request('https://internal/cloud-watch?ensure=1'),{get:async<T>(k:string)=>vault.get(k) as T|undefined,put:async<T>(k:string,v:T)=>{vault.set(k,v);},delete:async(k:string)=>vault.delete(k)});
 assert.equal(recreated.status,410,'a stale session cannot recreate a deleted vault');assert.equal(vault.has('watch:v1'),false);
 assert.ok(![...objects.get('accounts:v1')!.keys()].some(k=>k.startsWith('sess:')||k.startsWith('acct')),'every session and index is removed');
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

test('deleting an account needs the password, removes the account and its watchlist, and signs out every device',async()=>{
 const {ns,objects}=namespace();
 const {data:{token:phone,account}}=await read(await call(ns,'/api/account/register',{body:{email:'del@example.com',username:'leaver',password:'leave-pass-1'}}));
 const {data:{token:web}}=await read(await call(ns,'/api/account/login',{body:{login:'leaver',password:'leave-pass-1'}}));
 await call(ns,'/api/account/watch',{token:phone,body:{id:'upload-before-delete-1',baseRevision:0,ops:[{kind:'add',symbol:'NVDA'}]}});
 assert.equal(objects.get('watch-account:'+account.id)!.has('watch:v1'),true);
 assert.equal((await call(ns,'/api/account/delete',{token:phone,body:{password:'wrong-password'}})).status,401);
 assert.equal((await call(ns,'/api/account/me',{token:phone})).status,200,'a wrong password deletes nothing');
 assert.equal((await call(ns,'/api/account/delete',{body:{password:'leave-pass-1'}})).status,401,'a session is required');
 assert.equal((await call(ns,'/api/account/delete',{token:phone,body:{password:'leave-pass-1'}})).status,200);
 assert.equal(objects.get('watch-account:'+account.id)!.has('watch:v1'),false,'the synced watchlist is purged');
 const registry=objects.get('accounts:v1')!;
 assert.ok(![...registry.keys()].some(k=>k.startsWith('acct:')),'no account record or index remains');
 assert.equal((await call(ns,'/api/account/me',{token:phone})).status,401);
 assert.equal((await call(ns,'/api/account/me',{token:web})).status,401,'other devices are signed out too');
 assert.equal((await call(ns,'/api/account/login',{body:{login:'leaver',password:'leave-pass-1'}})).status,401);
 assert.equal((await call(ns,'/api/account/register',{body:{email:'del@example.com',username:'leaver',password:'new-pass-123'}})).status,200,'the email and username can be reused');
});

test('public sync routes cannot purge a vault',async()=>{
 const data=new Map<string,unknown>([['watch:v1',{revision:0,updatedAt:'',state:{watchlist:['NVDA'],groups:[]},seen:[]}]]);
 const store={get:async<T>(k:string)=>data.get(k) as T|undefined,put:async<T>(k:string,v:T)=>{data.set(k,v);},delete:async(k:string)=>data.delete(k)};
 assert.equal((await watchVault(new Request('https://internal/cloud-watch',{method:'DELETE'}),store)).status,405);
 assert.equal((await watchVault(new Request('https://internal/cloud-watch?ensure=1',{method:'DELETE'}),store)).status,405);
 assert.ok(data.has('watch:v1'));
});
