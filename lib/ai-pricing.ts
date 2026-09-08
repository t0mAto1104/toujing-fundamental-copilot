// Official Standard USD / 1M tokens, checked 2026-09-06:
// https://developers.openai.com/api/docs/pricing
// Writes and reads are disjoint subsets of input; reasoning is already output.
export const AI_PRICING_VERSION = 'openai-standard-2026-09-06';
const prices: Record<string, [number, number, number, number]> = {
  'gpt-6-astra': [10, 1, 12.5, 50],
  'gpt-5.6-sol': [4, 0.4, 5, 20],
  'gpt-5.6-terra': [2, 0.2, 2.5, 12],
  'gpt-5.6-luna': [0.2, 0.02, 0.25, 1.2],
  // Legacy model pages /api/docs/models/{model}; no write surcharge.
  'gpt-5.4-mini': [0.75, 0.075, 0.75, 4.5],
  'gpt-5.4': [2.5, 0.25, 2.5, 15],
  'gpt-5.5': [5, 0.5, 5, 30],
};
export type PricedUsage = {
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  webSearchRequests?: number;
  serviceTier?: string;
};
export function estimateAIUsd(usage: PricedUsage): number | null {
  const rates = prices[usage.model];
  const counts = [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.cacheWriteTokens,
    usage.outputTokens,
    usage.webSearchRequests,
  ];
  if (
    !rates ||
    !['default', 'standard'].includes(usage.serviceTier || '') ||
    counts.some(
      (n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0,
    )
  )
    return null;
  const [input, read, write, output, searches] = counts as number[];
  if (read + write > input) return null;
  const long = input > 272_000 && usage.model !== 'gpt-5.4-mini';
  return (
    (((input - read - write) * rates[0] + read * rates[1] + write * rates[2]) *
      (long ? 2 : 1)) /
      1_000_000 +
    (output * rates[3] * (long ? 1.5 : 1)) / 1_000_000 +
    searches * 0.01
  );
}
