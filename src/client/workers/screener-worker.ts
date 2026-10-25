import {stockCharacter} from '../../shared/stock-character';
import { analyzeGuide } from '../../shared/guide-analysis';
import { screenCandidate, type UniverseItem } from '../../shared/screening';
import type { MarketPayload } from '../../shared/types';
self.onmessage = (event: MessageEvent<{ id: string; stock: UniverseItem; market: MarketPayload }>) => {
  try {
    const { id, stock, market } = event.data, last = market.candles.at(-1), previous = market.candles.at(-2);
    const guide = analyzeGuide(market.candles);
    const item = { ...stock, name: market.name && market.name !== market.symbol ? market.name : stock.name, price: last?.close ?? null, changePercent: last && previous ? (last.close / previous.close - 1) * 100 : null };
    const candidate = screenCandidate(item, guide, market.provider);
    if(candidate){candidate.character=stockCharacter(market.candles,candidate.asOf);candidate.risks=[...candidate.risks,...(candidate.character?.warnings||[])];}
    if (candidate && market.provider.includes('不复权')) candidate.risks.push('不复权历史：送转与除权可能影响均线，需复核');
    self.postMessage({ id, candidate, insufficient: !guide.ready, invalid: !guide.available });
  } catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : '形态计算失败' }); }
};
