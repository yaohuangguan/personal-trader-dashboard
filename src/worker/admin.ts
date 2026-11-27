import {watchDiff,emptyWatch,validWatch,type WatchState} from '../shared/watch-sync';
import {timingSafeEqual,bearer} from './http';
import type {MonitorNamespace} from './signal-monitor';

/**
 * Operator-only maintenance, disabled (404) unless the ADMIN_TOKEN secret is set.
 * Set it only for a maintenance window: `wrangler secret put ADMIN_TOKEN`, then `wrangler secret delete ADMIN_TOKEN`.
 * Vault summaries expose counts only, never other users' symbols.
 */
type Vault={revision:number;updatedAt:string;state:WatchState};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const OBJECT_ID=/^[a-f0-9]{64}$/;

async function readVault(ns:MonitorNamespace,id:unknown):Promise<Vault|null>{
 const r=await ns.get(id).fetch(new Request('https://internal/cloud-watch'));
 if(!r.ok)return null;const v=await r.json() as Vault;return validWatch(v?.state)?v:null;
}

async function lookupAccount(ns:MonitorNamespace,email:string){
 const r=await ns.get(ns.idFromName('accounts:v1')).fetch(new Request('https://internal/account',{method:'POST',body:JSON.stringify({op:'lookup',email})}));
 return r.ok?(await r.json() as {account:{id:string;username:string}}).account:null;
}
async function accountVaultId(ns:MonitorNamespace,email:string){const a=await lookupAccount(ns,email);return a?String(ns.idFromName('watch-account:'+a.id)):null;}

export async function adminRoute(req:Request,env:{ADMIN_TOKEN?:string;MARKET_SCANNER?:MonitorNamespace}){
 const u=new URL(req.url);if(!u.pathname.startsWith('/api/admin/'))return null;
 const expected=env.ADMIN_TOKEN||'';
 if(expected.length<32)return json({error:'Unknown API path'},404);
 // Constant-time digest comparison so the check does not leak the token through timing.
 if(!await timingSafeEqual(bearer(req),expected))return json({error:'Unauthorized'},401);
 const ns=env.MARKET_SCANNER;if(!ns?.idFromString)return json({error:'Storage unavailable'},503);
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let body:Record<string,unknown>;try{body=await req.json() as Record<string,unknown>;}catch{return json({error:'Invalid JSON'},400);}

 if(u.pathname==='/api/admin/watch-vaults'){
  // Free-plan Workers allow 50 subrequests (one or two go to the account lookup), so callers send IDs in batches.
  const ids=body.ids;if(!Array.isArray(ids)||ids.length>38||!ids.every(id=>typeof id==='string'&&OBJECT_ID.test(id)))return json({error:'ids must be 1-38 object IDs'},400);
  // Optionally flag the given account's own vault so it is never picked as a merge source.
  const own=typeof body.email==='string'?await accountVaultId(ns,body.email):null;
  const vaults=[];
  for(const id of ids as string[]){const v=await readVault(ns,ns.idFromString(id));if(v)vaults.push({id,symbols:v.state.watchlist.length,groups:v.state.groups.length,revision:v.revision,updatedAt:v.updatedAt,...(id===own?{accountVault:true}:{})});}
  return json({vaults});
 }
 if(u.pathname==='/api/admin/watch-vaults/merge'){
  const {id,email}=body;
  if(typeof id!=='string'||!OBJECT_ID.test(id)||typeof email!=='string')return json({error:'id and email required'},400);
  const source=await readVault(ns,ns.idFromString(id));if(!source)return json({error:'Source vault not found'},404);
  const account=await lookupAccount(ns,email);if(!account)return json({error:'Account not found'},404);
  const targetId=ns.idFromName('watch-account:'+account.id);
  if(String(targetId)===id)return json({error:'Source is the account vault itself'},400);
  const target=ns.get(targetId);
  const current=await (await target.fetch(new Request('https://internal/cloud-watch?ensure=1'))).json() as Vault;
  const before=new Set(current.state.watchlist);
  // Diff from empty = union merge; dropping the order op appends new stocks after the account's existing order.
  const merged=await target.fetch(new Request('https://internal/cloud-watch?ensure=1',{method:'POST',body:JSON.stringify({id:'admin-merge-'+id.slice(0,24),baseRevision:current.revision,ops:watchDiff(emptyWatch(),source.state).filter(op=>op.kind!=='order')})}));
  if(!merged.ok)return json({error:'Merge rejected',details:await merged.text()},502);
  const result=await merged.json() as Vault;
  return json({account:account.username,sourceSymbols:source.state.watchlist.length,sourceGroups:source.state.groups.length,added:result.state.watchlist.filter(s=>!before.has(s)).length,total:result.state.watchlist.length,groups:result.state.groups.length,revision:result.revision});
 }
 return json({error:'Unknown API path'},404);
}
