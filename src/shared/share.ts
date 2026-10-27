import type {NewsItem} from './types';
export type SharedArticle={kind:'news'|'announcement';item:NewsItem;code?:string};
const plain=(v:unknown,n:number)=>typeof v==='string'?v.replace(/<[^>]*>/g,'').trim().slice(0,n):'';
export function shareArticle(value:unknown):SharedArticle|null{
 if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>,raw=(v.item&&typeof v.item==='object'?v.item:v) as Record<string,unknown>;
 const title=plain(raw.title,240),source=plain(raw.source||raw.organization,100),url=plain(raw.url||raw.sourceUrl,2048),code=plain(v.code||raw.code||raw.artCode||raw.art_code,30);
 let canonical=url;try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)return null;canonical=parsed.toString();}catch{if(!/^AN\d{18}$/.test(code))return null;canonical='https://data.eastmoney.com/notices/detail/'+code+'.html';}
 if(!title)return null;const date=raw.publishedAt||raw.date,publishedAt=typeof date==='string'&&Number.isFinite(Date.parse(date))?date:null;
 return {kind:/^AN\d{18}$/.test(code)?'announcement':'news',...(/^AN\d{18}$/.test(code)?{code}:{}),item:{id:plain(raw.id,100)||canonical,title,originalTitle:title,source:source||'公开来源',url:canonical,publishedAt,category:'all',summary:plain(raw.summary||raw.content,2400)}};
}
