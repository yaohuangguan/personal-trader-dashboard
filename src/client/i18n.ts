import {translateUI} from '../shared/ui-translation';

/**
 * The 160KB zh→en catalogue is only needed in English mode, so it is a separate chunk.
 * boot.ts awaits it before the first render when the stored locale is English.
 */
let dictionary: Record<string, string> | null = null;
let pending: Promise<boolean> | null = null;

export function loadDictionary(): Promise<boolean> {
  if (dictionary) return Promise.resolve(true);
  pending ??= Promise.all([import('./translations.json'), import('./translations-web.json')])
    .then(([shared, web]) => { dictionary = { ...shared.default, ...web.default }; return true; })
    .catch(() => { pending = null; return false; });
  return pending;
}

export const dictionaryReady = () => dictionary !== null;
export const translate = (value: string) => dictionary ? translateUI(value, dictionary) : value;

export function storedLocale(): 'zh-CN' | 'en' {
  try { return JSON.parse(localStorage.getItem('atlas.preferences.v1') || 'null')?.locale === 'en' ? 'en' : 'zh-CN'; } catch { return 'zh-CN'; }
}
