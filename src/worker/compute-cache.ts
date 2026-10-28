/** Content-addressed edge cache; does not consume KV writes or cache private user data. */
export async function computeCache(request:Request,identity:string,ttl:number,action:()=>Promise<Response>|Response){
 const edge=typeof caches!=='undefined'?(caches as CacheStorage&{default?:Cache}).default:undefined;
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const key=new Request(new URL('/__compute-cache/v1/'+digest,request.url)),start=performance.now();
 if(edge){try{const hit=await edge.match(key);if(hit){const response=new Response(hit.body,hit);response.headers.set('cache-control','no-store');response.headers.set('x-atlas-compute-cache','hit');response.headers.set('server-timing','edge-cache;dur='+(performance.now()-start).toFixed(1));return response;}}catch{/* Cache failures must not prevent computing a valid response. */}}
 const response=await action();response.headers.set('x-atlas-compute-cache','miss');
 if(edge&&response.ok){try{const copy=response.clone();copy.headers.set('cache-control','public, max-age='+ttl);await edge.put(key,copy);}catch{/* Keep the successful response if storage is unavailable. */}}
 response.headers.set('cache-control','no-store');response.headers.append('server-timing','request;dur='+(performance.now()-start).toFixed(1));return response;
}
export function studySession(now=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(now),part=(k:string)=>parts.find(p=>p.type===k)?.value||'';return [part('year'),part('month'),part('day'),Number(part('hour'))<15?'forming':'closed'].join('-');}
