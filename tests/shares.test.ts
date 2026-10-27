import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shareRoute,type ShareStore} from '../src/worker/shares';
test('compact persistent links survive separate reads and preserve Unicode and source identity',async()=>{
 const data=new Map<string,string>();let writes=0;const kv:ShareStore={get:async k=>data.get(k)||null,put:async(k,v)=>{data.set(k,v);writes++;}};
 const article={item:{title:'宝通科技 · 正文',summary:'这是新闻摘要。',source:'来源',url:'https://example.com/news/42'}};
 const request=()=>new Request('https://atlas.example/api/shares',{method:'POST',body:JSON.stringify(article)});
 const a=await(await shareRoute(request(),kv))!.json() as {id:string;url:string};assert.match(a.id,/^[A-Za-z0-9_-]{16}$/);assert.equal(a.url,'https://atlas.example/n/'+a.id);assert.ok(a.url.length<50);
 const b=await(await shareRoute(new Request('https://atlas.example/api/shares/'+a.id),kv))!.json() as {item:{title:string;summary:string}};assert.equal(b.item.title,article.item.title);assert.equal(b.item.summary,article.item.summary);
 await shareRoute(request(),kv);assert.equal(writes,1);assert.equal((await shareRoute(new Request('https://atlas.example/api/shares/abcdefghijklmnop'),kv))!.status,404);
});
test('announcement links retain the announcement code and invalid sources do not create storage records',async()=>{
 const data=new Map<string,string>(),kv:ShareStore={get:async k=>data.get(k)||null,put:async(k,v)=>{data.set(k,v);}};
 const body={item:{title:'公告标题',artCode:'AN202610261234567890',date:'2026-10-26'}};
 const a=await(await shareRoute(new Request('https://atlas.example/api/shares',{method:'POST',body:JSON.stringify(body)}),kv))!.json() as {id:string};const stored=JSON.parse(data.get('article:'+a.id)!);assert.equal(stored.kind,'announcement');assert.equal(stored.code,body.item.artCode);
 const invalid=await shareRoute(new Request('https://atlas.example/api/shares',{method:'POST',body:JSON.stringify({title:'bad',url:'javascript:alert(1)'})}),kv);assert.equal(invalid!.status,400);assert.equal(data.size,1);
});
