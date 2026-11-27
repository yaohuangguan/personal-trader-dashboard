import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeDispatchRequest,dispatchCloseWorkflow,CLOSE_DISPATCH_CRON} from '../src/worker/close-dispatch';
import worker from '../src/worker/index';

test('the close cron is a no-op without a dispatch token',async()=>{
 let called=false;const fetcher=async()=>{called=true;return new Response(null,{status:204});};
 assert.equal(closeDispatchRequest({}),null);
 assert.deepEqual(await dispatchCloseWorkflow({},fetcher),{dispatched:false,reason:'GITHUB_DISPATCH_TOKEN is not configured'});
 assert.equal((await dispatchCloseWorkflow({GITHUB_DISPATCH_TOKEN:'t',GITHUB_REPO:'not a repo'},fetcher)).dispatched,false);
 assert.equal(called,false);
 const tasks:Promise<unknown>[]=[],original=globalThis.fetch;globalThis.fetch=async()=>{called=true;return new Response(null,{status:204});};
 try{await worker.scheduled({cron:CLOSE_DISPATCH_CRON},{} as never,{waitUntil:t=>tasks.push(t)});await Promise.all(tasks);assert.equal(called,false);}finally{globalThis.fetch=original;}
});
test('a configured token dispatches the closing workflow on the default branch',async()=>{
 const seen:Request[]=[];const result=await dispatchCloseWorkflow({GITHUB_DISPATCH_TOKEN:'ghp_example'},async r=>{seen.push(r);return new Response(null,{status:204});});
 assert.deepEqual(result,{dispatched:true,status:204,reason:'workflow_dispatch accepted'});
 assert.equal(seen[0].url,'https://api.github.com/repos/yaohuangguan/personal-trader-dashboard/actions/workflows/close-screen.yml/dispatches');
 assert.equal(seen[0].method,'POST');assert.equal(seen[0].headers.get('authorization'),'Bearer ghp_example');
 assert.deepEqual(await seen[0].json(),{ref:'master'});
 const custom=closeDispatchRequest({GITHUB_DISPATCH_TOKEN:'x',GITHUB_REPO:'me/fork',GITHUB_REF:'main'})!;
 assert.match(custom.url,/repos\/me\/fork\//);assert.deepEqual(await custom.json(),{ref:'main'});
 const failed=await dispatchCloseWorkflow({GITHUB_DISPATCH_TOKEN:'bad'},async()=>new Response('Bad credentials',{status:401}));
 assert.equal(failed.dispatched,false);assert.equal(failed.status,401);
});
