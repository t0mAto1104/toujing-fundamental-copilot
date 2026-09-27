import {
  normalizeMarketText,
  unsafeMarketText,
} from '@/lib/market-agent-safety';

export type MarketHistoryItem = { role: 'user' | 'agent'; text: string };

// Only the tool-free scope/rewriter sees history; the search model receives its
// validated public query, never this transcript. Bound TOTAL size as well as turns.
export function boundedMarketHistory(input: unknown): MarketHistoryItem[] {
  if (!Array.isArray(input)) return [];
  let remaining = 2400;
  const result: MarketHistoryItem[] = [];
  for (const item of input.slice(-6).reverse()) {
    if (
      !item ||
      !['user', 'agent'].includes(item.role) ||
      typeof item.text !== 'string'
    )
      continue;
    const text = normalizeMarketText(item.text);
    if (!text || unsafeMarketText(text) || /https?:|www\./i.test(text))
      continue;
    const clipped = text.slice(0, Math.min(800, remaining));
    if (!clipped) break;
    result.unshift({ role: item.role, text: clipped });
    remaining -= clipped.length;
  }
  return result;
}
