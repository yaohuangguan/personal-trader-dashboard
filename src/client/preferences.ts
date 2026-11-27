import {useSyncExternalStore} from 'react';
import {loadDictionary,translate} from './i18n';
import {resolvePreferences,type Display,type Preferences,type Stored} from './prefs-resolve';
export type {Display,Preferences};

const KEY='atlas.preferences.v1';
const THEME_COLORS={dark:'#09090b',light:'#f9f9fc'} as const;
const media=(query:string)=>typeof matchMedia==='function'?matchMedia(query):null;
const systemLight=media('(prefers-color-scheme: light)'),desktop=media('(min-width: 901px) and (pointer: fine)');

function stored():Stored{try{const p=JSON.parse(localStorage.getItem(KEY)||'null');return p&&typeof p==='object'?p:{};}catch{return {};}}
const read=()=>resolvePreferences(stored(),!!systemLight?.matches,!!desktop?.matches);
let current=read();const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(fn=>fn());
function apply(){
 const root=document.documentElement;root.lang=current.locale;root.dataset.theme=current.theme;root.style.fontSize=current.rootPx+'px';
 // Browser chrome / iOS status bar follow the active theme.
 for(const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))meta.content=THEME_COLORS[current.theme];
 if(current.locale==='en')void loadDictionary().then(ok=>{if(ok)notify();});
}
apply();
function refresh(){current=read();apply();notify();}
export function setPreferences(p:Partial<Preferences>){
 const next:Stored={...stored(),...p};
 // Do not persist an implicit theme: that would stop the page following the system setting.
 if(!('theme' in p)&&!current.themeChosen)delete next.theme;
 try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* private mode: keep the in-memory choice */}
 current=resolvePreferences(next,!!systemLight?.matches,!!desktop?.matches);apply();notify();
}
window.addEventListener('storage',e=>{if(e.key===KEY)refresh();});
systemLight?.addEventListener?.('change',()=>{if(!current.themeChosen)refresh();});
desktop?.addEventListener?.('change',refresh);
export function usePreferences(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>current);}
export function t<T>(value:T):T {
 if(current.locale!=='en'||typeof value!=='string')return value;
 return translate(value) as T;
}

export function chartColor(color:string,light:boolean){if(!light||!/^#[0-9a-f]{6}$/i.test(color))return color;const v=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255),l=(Math.max(...v)+Math.min(...v))/2;if(l<.5)return color;const factor=.4/l;return '#'+v.map(n=>Math.round(n*factor*255).toString(16).padStart(2,'0')).join('');}
