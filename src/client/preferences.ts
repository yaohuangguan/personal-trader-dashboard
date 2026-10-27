import {useSyncExternalStore} from 'react';
import dictionary from './translations.json';
export type Preferences={locale:'zh-CN'|'en';fontSize:18|20|22;theme:'dark'|'light'};
const defaults:Preferences={locale:'zh-CN',fontSize:18,theme:'dark'};
function read():Preferences{try{const p=JSON.parse(localStorage.getItem('atlas.preferences.v1')||'null');return {theme:p?.theme==='light'?'light':'dark',locale:p?.locale==='en'?'en':'zh-CN',fontSize:[18,20,22].includes(p?.fontSize)?p.fontSize:18};}catch{return defaults;}}
let current=read();const listeners=new Set<()=>void>();
function apply(){document.documentElement.lang=current.locale;document.documentElement.dataset.theme=current.theme;document.documentElement.style.fontSize=current.fontSize+'px';}
apply();
export function setPreferences(p:Partial<Preferences>){current={...current,...p};try{localStorage.setItem('atlas.preferences.v1',JSON.stringify(current));}catch{}apply();listeners.forEach(fn=>fn());}
window.addEventListener('storage',e=>{if(e.key==='atlas.preferences.v1'){current=read();apply();listeners.forEach(fn=>fn());}});
export function usePreferences(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>current);}
export function t<T>(value:T):T {
 if(current.locale!=='en'||typeof value!=='string')return value;
 const translated=Object.hasOwn(dictionary,value)?(dictionary as Record<string,string>)[value]:undefined;
 if(translated)return translated as T;
 // Only anchored UI templates; source articles and security names retain their original text.
 const templates:[RegExp,string][]=[[/^(\d+) 个候选$/,'$1 candidates'],[/^(\d+) 分钟前$/,'$1 min ago'],[/^(\d+) 小时前$/,'$1 h ago'],[/^(\d+) 天前$/,'$1 d ago'],[/^每(\d+)秒更新$/,'Updates every $1s'],[/^卖(\d+)$/,'Ask $1'],[/^买(\d+)$/,'Bid $1'],[/^选股扫描 · /,'Scan · ']];
 let result:string=value;for(const [pattern,replacement] of templates)result=result.replace(pattern,replacement);return result as T;
}

export function chartColor(color:string,light:boolean){if(!light||!/^#[0-9a-f]{6}$/i.test(color))return color;const v=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255),l=(Math.max(...v)+Math.min(...v))/2;if(l<.5)return color;const factor=.4/l;return '#'+v.map(n=>Math.round(n*factor*255).toString(16).padStart(2,'0')).join('');}
