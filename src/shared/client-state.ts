export const OLD_SITE='https://personal-market-atlas.nzs.workers.dev';
export const NEW_SITE='https://guanlan.nzs.workers.dev';
export const CLIENT_STATE_KEYS=['atlas.watchlist.v1','atlas.watch.groups.v1','atlas.preferences.v1','atlas.last-symbol.v1','atlas.bookmarks.v1','atlas.price-alerts.v1','atlas.chart.ma.v2','atlas.watch-width.v1','atlas.quote-width.v1','atlas.sidebar-collapsed.v1'] as const;
export const MIGRATED_KEY='atlas.client-migrated.v1';
export function mergedClientState(current:Record<string,string>,old:Record<string,string>){
 const result={...current},array=(s:string|undefined):unknown[]=>{try{const v=JSON.parse(s||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
 for(const key of CLIENT_STATE_KEYS){const value=old[key];if(typeof value!=='string'||value.length>262144)continue;
  if(key==='atlas.watchlist.v1'){const values=[...array(value),...array(current[key])].filter((s):s is string=>typeof s==='string'&&/^[A-Za-z0-9.^:=_-]{1,32}$/.test(s));result[key]=JSON.stringify([...new Set(values)]);}
  else if(key==='atlas.watch.groups.v1'){
   const groups:{id:string;name:string;symbols:string[]}[]=[];
   for(const item of [...array(value),...array(current[key])]){if(!item||typeof item!=='object')continue;const g=item as Record<string,unknown>;if(typeof g.id!=='string'||typeof g.name!=='string'||!Array.isArray(g.symbols))continue;const symbols=g.symbols.filter((s):s is string=>typeof s==='string');const found=groups.find(v=>v.id===g.id||v.name===g.name);if(found)found.symbols=[...new Set([...found.symbols,...symbols])];else groups.push({id:g.id,name:g.name,symbols});}result[key]=JSON.stringify(groups);
  }else if(['atlas.bookmarks.v1','atlas.price-alerts.v1'].includes(key)){const rows=[...array(value),...array(current[key])],seen=new Set<string>();result[key]=JSON.stringify(rows.filter(item=>{if(!item||typeof item!=='object')return false;const v=item as Record<string,unknown>,id=String(v.url||v.id||'');if(!id||seen.has(id))return false;seen.add(id);return true;}));}
  else if(!Object.hasOwn(current,key))result[key]=value;
 }
 return result;
}
