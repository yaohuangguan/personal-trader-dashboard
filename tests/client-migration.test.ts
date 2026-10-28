import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {mergedClientState,OLD_SITE} from '../src/shared/client-state';
import {clientMigrationRoute} from '../src/worker/client-migration';
test('migration merges old and new watchlists and groups without copying credentials',()=>{
 const r=mergedClientState({'atlas.watchlist.v1':'["300545.SZ"]','atlas.watch.groups.v1':'[{"id":"g","name":"机器人","symbols":["300545.SZ"]}]'},{'atlas.watchlist.v1':'["002472.SZ"]','atlas.watch.groups.v1':'[{"id":"g","name":"机器人","symbols":["002472.SZ"]}]','token':'secret'});
 assert.deepEqual(JSON.parse(r['atlas.watchlist.v1']),['002472.SZ','300545.SZ']);assert.deepEqual(JSON.parse(r['atlas.watch.groups.v1'])[0].symbols,['002472.SZ','300545.SZ']);assert.equal(r.token,undefined);
});
test('old-origin bridge is valid JavaScript and stores only expiring ciphertext',async()=>{
 const data=new Map<string,string>();let ttl=0;const store={get:async(k:string)=>data.get(k)||null,put:async(k:string,v:string,o?:{expirationTtl?:number})=>{data.set(k,v);ttl=o?.expirationTtl||0;}};
 const bridge=await clientMigrationRoute(new Request(OLD_SITE+'/api/client-migration/bridge?nonce='+('a'.repeat(32))),store);
 const html=await bridge!.text();new Script(html.split('<script>')[1].split('</script>')[0]);assert.equal(bridge!.headers.get('cache-control'),'no-store');
 const request=(origin:string)=>new Request(OLD_SITE+'/api/client-migration',{method:'POST',headers:{origin},body:JSON.stringify({iv:'a'.repeat(16),cipher:'b'.repeat(40)})});
 assert.equal((await clientMigrationRoute(request('https://evil.example'),store))!.status,403);
 const result=await(await clientMigrationRoute(request(OLD_SITE),store))!.json() as {id:string};assert.match(result.id,/^[A-Za-z0-9_-]{22}$/);assert.equal(ttl,600);assert.equal(data.size,1);
 const stored=await(await clientMigrationRoute(new Request(OLD_SITE+'/api/client-migration/'+result.id),store))!.json() as {cipher:string};assert.equal(stored.cipher,'b'.repeat(40));
});
