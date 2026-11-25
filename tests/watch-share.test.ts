import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {watchShareRoute,normalizeShareCode} from '../src/worker/watch-share';
import {adminRoute} from '../src/worker/admin';
import {accountStore,accountRoute} from '../src/worker/account';
import {watchVault} from '../src/worker/watch-sync';

const origin='https://guanlan.nzs.workers.dev';
function kv(){const data=new Map<string,{value:string;ttl?:number}>();return {data,get:async(k:string)=>data.get(k)?.value??null,put:async(k:string,value:string,o?:{expirationTtl?:number})=>{data.set(k,{value,ttl:o?.expirationTtl});}};}
let ip=0;
const create=(store:ReturnType<typeof kv>,body:unknown,from='198.51.100.'+(++ip%250))=>watchShareRoute(new Request(origin+'/api/watch-share',{method:'POST',body:JSON.stringify(body),headers:{origin,'cf-connecting-ip':from}}),store) as Promise<Response>;
const read=(store:ReturnType<typeof kv>,code:string)=>watchShareRoute(new Request(origin+'/api/watch-share/'+encodeURIComponent(code)),store) as Promise<Response>;

test('a share code round-trips stocks and groups and expires after 30 days',async()=>{
 const store=kv();
 const r=await create(store,{format:'guanlan-watchlist',version:1,watchlist:['300750','NVDA','600519.SH'],groups:[{name:'核心',symbols:['NVDA','300750.SZ']}],syncKey:'SECRET',id:'private'});
 assert.equal(r.status,200);const made=await r.json() as {code:string;count:number;expiresAt:string};
 assert.match(made.code,/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);assert.equal(made.count,3);
 const [entry]=[...store.data.values()];assert.equal(entry.ttl,30*86400);
 assert.ok(!entry.value.includes('SECRET')&&!entry.value.includes('private'),'only transferable fields are stored');
 for(const variant of [made.code,made.code.toLowerCase(),made.code.replace('-',''),' '+made.code.replace('-',' ')+' ']){
  const got=await read(store,variant);assert.equal(got.status,200,variant);
  const packet=await got.json() as {watchlist:string[];groups:{name:string;symbols:string[]}[];code:string};
  assert.deepEqual(packet.watchlist,['300750.SZ','NVDA','600519.SH']);assert.deepEqual(packet.groups,[{name:'核心',symbols:['NVDA','300750.SZ']}]);assert.equal(packet.code,made.code);
 }
});

test('share codes reject bad input, unknown codes and cross-site creation',async()=>{
 const store=kv();
 assert.equal((await create(store,{watchlist:[]})).status,400);
 assert.equal((await create(store,{watchlist:['not a ticker!']})).status,400);
 assert.equal((await read(store,'ABCD-2345')).status,404);
 assert.equal((await read(store,'ABC-123')).status,400);
 assert.equal(normalizeShareCode('IIII-OOOO'),null,'ambiguous letters are never issued');
 const r=await watchShareRoute(new Request(origin+'/api/watch-share',{method:'POST',body:'{"watchlist":["NVDA"]}',headers:{origin:'https://evil.example'}}),store);
 assert.equal(r!.status,403);
 let last=0;for(let i=0;i<21;i++)last=(await create(store,{watchlist:['NVDA']},'192.0.2.9')).status;
 assert.equal(last,429,'creation is rate limited per address');
});

/** Same in-memory MARKET_SCANNER fake as account.test.ts, plus idFromString for admin reads. */
function namespace(){
 const objects=new Map<string,Map<string,unknown>>();
 const storage=(d:Map<string,unknown>)=>({get:async<T>(k:string)=>d.get(k) as T|undefined,put:async<T>(k:string,v:T)=>{d.set(k,structuredClone(v));},delete:async(k:string)=>d.delete(k)});
 const get=(name:unknown)=>{const key=String(name);if(!objects.has(key))objects.set(key,new Map());const s=storage(objects.get(key)!);return {fetch:async(req:Request)=>new URL(req.url).pathname==='/account'?accountStore(req,s):watchVault(req,s)};};
 // Like real Durable Object IDs, names map to stable 64-hex IDs.
 return {objects,ns:{idFromName:(n:string)=>createHash('sha256').update(n).digest('hex'),idFromString:(id:string)=>id,get}};
}
test('admin endpoints are off without ADMIN_TOKEN, report counts only, and merge a vault into an account without deleting',async()=>{
 const {ns,objects}=namespace(),token='T'.repeat(40);
 const admin=(path:string,body:object,auth=token,env:{ADMIN_TOKEN?:string}={ADMIN_TOKEN:token})=>adminRoute(new Request(origin+path,{method:'POST',body:JSON.stringify(body),headers:{authorization:'Bearer '+auth}}),{...env,MARKET_SCANNER:ns as never}) as Promise<Response>;
 assert.equal((await admin('/api/admin/watch-vaults',{ids:[]},token,{})).status,404,'disabled when the secret is unset');
 assert.equal((await admin('/api/admin/watch-vaults',{ids:[]},'wrong'.repeat(8))).status,401);
 // A legacy sync-key vault with many stocks, and a small one.
 const big='a'.repeat(64),small='b'.repeat(64),seed=(id:string,watchlist:string[],groups:object[]=[])=>{objects.set(id,new Map([['watch:v1',{revision:3,updatedAt:'2026-11-20T00:00:00.000Z',state:{watchlist,groups},seen:[]}]]));};
 seed(big,['002472.SZ','NVDA','600519.SH','AAPL','300750.SZ'],[{id:'g1',name:'机器人',symbols:['002472.SZ']}]);seed(small,['MSFT']);
 const listed=await (await admin('/api/admin/watch-vaults',{ids:[big,small,'c'.repeat(64)]})).json() as {vaults:{id:string;symbols:number;groups:number}[]};
 assert.deepEqual(listed.vaults.map(v=>[v.id,v.symbols,v.groups]),[[big,5,1],[small,1,0]]);
 assert.ok(!JSON.stringify(listed).includes('NVDA'),'summaries never include symbols');
 const reg=await accountRoute(new Request(origin+'/api/account/register',{method:'POST',body:JSON.stringify({email:'me@example.com',username:'me',password:'me-pass-123'}),headers:{origin,'cf-connecting-ip':'203.0.113.200'}}),ns as never);
 const {token:session}=await reg!.json() as {token:string};
 await accountRoute(new Request(origin+'/api/account/watch',{method:'POST',body:JSON.stringify({id:'phone-upload-000001',baseRevision:0,ops:[{kind:'add',symbol:'TSLA'}]}),headers:{origin,authorization:'Bearer '+session}}),ns as never);
 const merged=await (await admin('/api/admin/watch-vaults/merge',{id:big,email:'ME@example.com'})).json() as {added:number;total:number;groups:number};
 assert.deepEqual([merged.added,merged.total,merged.groups],[5,6,1]);
 const vault=await (await accountRoute(new Request(origin+'/api/account/watch',{headers:{authorization:'Bearer '+session}}),ns as never))!.json() as {state:{watchlist:string[]}};
 assert.deepEqual(vault.state.watchlist,['TSLA','002472.SZ','NVDA','600519.SH','AAPL','300750.SZ'],'existing account stocks are kept first');
 const me=await (await accountRoute(new Request(origin+'/api/account/me',{headers:{authorization:'Bearer '+session}}),ns as never))!.json() as {account:{id:string}};
 const own=createHash('sha256').update('watch-account:'+me.account.id).digest('hex');
 assert.equal((await admin('/api/admin/watch-vaults/merge',{id:own,email:'me@example.com'})).status,400,'an account vault cannot be merged into itself');
 const flagged=await (await admin('/api/admin/watch-vaults',{ids:[big,own],email:'me@example.com'})).json() as {vaults:{id:string;accountVault?:boolean}[]};
 assert.deepEqual(flagged.vaults.map(v=>!!v.accountVault),[false,true]);
 const again=await (await admin('/api/admin/watch-vaults/merge',{id:big,email:'me@example.com'})).json() as {added:number;total:number};
 assert.deepEqual([again.added,again.total],[0,6],'re-running the merge is idempotent');
 assert.equal((await admin('/api/admin/watch-vaults/merge',{id:big,email:'nobody@example.com'})).status,404);
 const lookup=await accountRoute(new Request(origin+'/api/account/lookup',{method:'POST',body:JSON.stringify({op:'lookup',email:'me@example.com'}),headers:{origin,authorization:'Bearer '+session}}),ns as never);
 assert.equal(lookup!.status,404,'lookup is not exposed through the public account API');
});
