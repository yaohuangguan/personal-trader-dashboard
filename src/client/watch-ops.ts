/**
 * Watchlist edits are applied as operations against the *freshest* stored state, never by writing back a
 * React copy of the whole array. A second tab (PWA + browser) therefore cannot erase stocks it never saw.
 */
export type WatchGroup = { id: string; name: string; symbols: string[] };
export type LocalWatch = { watchlist: string[]; groups: WatchGroup[] };
export type LocalWatchOp =
  | { kind: 'toggle'; symbol: string; max?: number }
  | { kind: 'add'; symbol: string; max?: number }
  | { kind: 'remove'; symbol: string }
  | { kind: 'group-create'; id: string; name: string; maxGroups?: number }
  | { kind: 'group-rename'; id: string; name: string }
  | { kind: 'group-delete'; id: string }
  | { kind: 'group-member'; id: string; symbol: string; member: boolean };

export const MAX_WATCH = 60, MAX_GROUPS = 20;
const SYMBOL = /^[A-Za-z0-9.^:=_-]{1,32}$/;

/** null when the stored value is not a list of symbols (corrupt / "null" / object). */
export function sanitizeWatchlist(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((s): s is string => typeof s === 'string' && SYMBOL.test(s)))].slice(0, 200);
}
export function sanitizeGroups(value: unknown): WatchGroup[] {
  if (!Array.isArray(value)) return [];
  return value.filter((g): g is WatchGroup => !!g && typeof g === 'object' && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.symbols))
    .map(g => ({ id: g.id, name: g.name, symbols: [...new Set(g.symbols.filter((s: unknown): s is string => typeof s === 'string' && SYMBOL.test(s)))] }))
    .slice(0, MAX_GROUPS);
}

/** Returns the same object when the operation changes nothing (callers skip the write). */
export function applyLocalWatchOp(state: LocalWatch, op: LocalWatchOp): LocalWatch {
  const has = (symbol: string) => state.watchlist.includes(symbol);
  const withoutSymbol = (symbol: string): LocalWatch => ({
    watchlist: state.watchlist.filter(s => s !== symbol),
    groups: state.groups.map(g => g.symbols.includes(symbol) ? { ...g, symbols: g.symbols.filter(s => s !== symbol) } : g),
  });
  switch (op.kind) {
    case 'toggle':
      return has(op.symbol) ? withoutSymbol(op.symbol) : applyLocalWatchOp(state, { kind: 'add', symbol: op.symbol, max: op.max });
    case 'add':
      if (has(op.symbol) || state.watchlist.length >= (op.max ?? MAX_WATCH)) return state;
      return { ...state, watchlist: [op.symbol, ...state.watchlist] };
    case 'remove':
      return has(op.symbol) ? withoutSymbol(op.symbol) : state;
    case 'group-create':
      if (state.groups.some(g => g.id === op.id || g.name === op.name) || state.groups.length >= (op.maxGroups ?? MAX_GROUPS)) return state;
      return { ...state, groups: [...state.groups, { id: op.id, name: op.name, symbols: [] }] };
    case 'group-rename': {
      const target = state.groups.find(g => g.id === op.id);
      if (!target || target.name === op.name || state.groups.some(g => g.id !== op.id && g.name === op.name)) return state;
      return { ...state, groups: state.groups.map(g => g.id === op.id ? { ...g, name: op.name } : g) };
    }
    case 'group-delete':
      return state.groups.some(g => g.id === op.id) ? { ...state, groups: state.groups.filter(g => g.id !== op.id) } : state;
    case 'group-member': {
      const target = state.groups.find(g => g.id === op.id);
      if (!target || target.symbols.includes(op.symbol) === op.member || (op.member && !has(op.symbol))) return state;
      const symbols = op.member ? [...target.symbols, op.symbol] : target.symbols.filter(s => s !== op.symbol);
      return { ...state, groups: state.groups.map(g => g.id === op.id ? { ...g, symbols } : g) };
    }
  }
}

export const sameWatch = (a: LocalWatch, b: LocalWatch) => JSON.stringify(a) === JSON.stringify(b);
