// Optional FCM transport. No account is created and no credentials are bundled in the app.
type Storage={get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>;delete?(key:string):Promise<boolean>};
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const encoded=(v:unknown)=>b64(new TextEncoder().encode(JSON.stringify(v)));
/** FCM says the registration token is gone (app uninstalled or token rotated): stop retrying it. */
export function deadFcmToken(status:number,body:string){
 if(status===404)return true;
 try{const e=(JSON.parse(body) as {error?:{status?:string;details?:{errorCode?:string}[]}}).error;return e?.status==='NOT_FOUND'||!!e?.details?.some(d=>d.errorCode==='UNREGISTERED');}catch{return /UNREGISTERED/.test(body);}
}
/** ttl (seconds) is forwarded to Android and APNs so a closing digest (86400 s) survives an offline phone. */
export async function sendNativePush(secret:string,token:string,data:{title:string;body:string;url:string;tag:string},storage:Storage,ttl=300){
 const account=JSON.parse(secret) as {project_id:string;client_email:string;private_key:string};
 if(!/^[a-z][a-z0-9-]{4,62}$/.test(account.project_id)||!account.client_email.endsWith('.iam.gserviceaccount.com')||!account.private_key.includes('BEGIN PRIVATE KEY'))throw new Error('Firebase 服务端配置无效');
 let access=await storage.get<{token:string;until:number}>('fcm-oauth');
 if(!access||access.until<Date.now()+60000){const now=Math.floor(Date.now()/1000),header=encoded({alg:'RS256',typ:'JWT'}),body=encoded({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),bytes=Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0)),key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']),signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(header+'.'+body)),assertion=header+'.'+body+'.'+b64(new Uint8Array(signature));
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error('Firebase OAuth HTTP '+response.status);const result=await response.json() as {access_token?:string;expires_in?:number};if(!result.access_token)throw new Error('Firebase OAuth 暂不可用');access={token:result.access_token,until:Date.now()+(result.expires_in||3600)*1000};await storage.put('fcm-oauth',access);
 }
 const response=await fetch('https://fcm.googleapis.com/v1/projects/'+account.project_id+'/messages:send',{method:'POST',headers:{Authorization:'Bearer '+access.token,'content-type':'application/json'},body:JSON.stringify({message:{token,notification:{title:data.title,body:data.body},data:{url:data.url,tag:data.tag},android:{ttl:Math.max(0,Math.round(ttl))+'s',priority:'high',notification:{channel_id:'market_signals',tag:data.tag}},apns:{headers:{'apns-expiration':String(Math.floor(Date.now()/1000)+Math.max(0,Math.round(ttl)))}}}}),signal:AbortSignal.timeout(7000)});
 if(!response.ok){const detail=await response.text().catch(()=>'');if(deadFcmToken(response.status,detail)&&await storage.get<string>('native-token')===token)await storage.delete?.('native-token');throw new Error('Firebase 推送 HTTP '+response.status);}
}
