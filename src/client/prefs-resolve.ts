/** fontSize is the size *level* (标准 / 大 / 超大 = 18 / 20 / 22 on phones); desktops render it 2px smaller for dense reading. */
export type Preferences={locale:'zh-CN'|'en';fontSize:18|20|22;theme:'dark'|'light'};
export type Display=Preferences&{rootPx:number;themeChosen:boolean};
export type Stored=Partial<Preferences>;

/** Explicit theme wins; otherwise follow the operating system until the user picks one. */
export function resolvePreferences(p:Stored,prefersLight:boolean,isDesktop:boolean):Display{
 const themeChosen=p.theme==='light'||p.theme==='dark';
 const theme=themeChosen?p.theme!:prefersLight?'light':'dark';
 const fontSize=([18,20,22] as const).find(size=>size===p.fontSize)??18;
 return {theme,locale:p.locale==='en'?'en':'zh-CN',fontSize,rootPx:fontSize-(isDesktop?2:0),themeChosen};
}
