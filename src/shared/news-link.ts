import type {NewsItem} from './types';
const plain=(v:unknown,n:number)=>typeof v==='string'?v.replace(/<[^>]*>/g,'').slice(0,n):'';
export function newsLink(item:NewsItem,origin='https://guanlan.nzs.workers.dev'){
 const data={title:plain(item.title,240),source:plain(item.source,100),url:plain(item.url,2048),publishedAt:item.publishedAt,summary:plain(item.summary,1800)};
 const bytes=new TextEncoder().encode(JSON.stringify(data)),encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 return new URL('/?article='+encoded,origin).toString();
}
export function readNewsLink(raw:string):NewsItem|null{
 try{if(raw.length>12000)return null;const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)))) as Record<string,unknown>;
  const title=plain(data.title,240),url=plain(data.url,2048);if(!title||!/^https?:$/.test(new URL(url).protocol))return null;
  const publishedAt=typeof data.publishedAt==='string'&&Number.isFinite(Date.parse(data.publishedAt))?data.publishedAt:null;
  return {id:'shared:'+raw.slice(0,40),title,originalTitle:title,url,source:plain(data.source,100)||'来源未提供',category:'all',publishedAt,summary:plain(data.summary,1800)};
 }catch{return null;}
}
