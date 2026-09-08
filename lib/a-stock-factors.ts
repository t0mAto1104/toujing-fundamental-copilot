import { fetchWithTimeout } from '@/lib/a-stock-http';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import { type AdjustmentFactor, type FactorResponse } from '@/lib/quote-types';

export function parseSinaFactors(
  text: string,
  symbol: string,
  mode: 'qfq' | 'hfq',
): AdjustmentFactor[] {
  // A plain JSON assignment followed by an optional provider signature comment.
  // Never eval the remote JavaScript. Strip only the final comment (may contain braces).
  const data = text.replace(/\/\*[\s\S]*?\*\/\s*$/, '').trim();
  const prefix = `var ${symbol}${mode}=`;
  if (!data.startsWith(prefix)) throw new Error('复权因子证券标识不匹配');
  const payload = JSON.parse(
    data.slice(prefix.length).replace(/;\s*$/, ''),
  ) as {
    data?: { d?: string; f?: string; s?: string; u?: string }[];
  };
  if (!Array.isArray(payload.data) || !payload.data.length)
    throw new Error('来源未提供复权因子');
  const values = new Map<string, AdjustmentFactor>();
  for (const row of payload.data) {
    const date = row.d || '';
    const factor = row.f?.trim() ? Number(row.f) : NaN;
    const share = row.s == null ? null : row.s.trim() ? Number(row.s) : NaN;
    const cash = row.u == null ? null : row.u.trim() ? Number(row.u) : NaN;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      !Number.isFinite(factor) ||
      factor <= 0 ||
      (share !== null && (!Number.isFinite(share) || share <= 0)) ||
      (cash !== null && !Number.isFinite(cash))
    )
      throw new Error('复权因子数据无效');
    const value = { date, factor, share, cash };
    if (
      values.has(date) &&
      JSON.stringify(values.get(date)) !== JSON.stringify(value)
    )
      throw new Error('复权因子存在冲突');
    values.set(date, value);
  }
  return [...values.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAdjustmentFactors(
  symbol: string,
  adjustment: 'qfq' | 'hfq',
  signal?: AbortSignal,
): Promise<FactorResponse> {
  const sourceUrl = `https://finance.sina.com.cn/realstock/company/${symbol}/${adjustment}.js`;
  const deadline = requestDeadline(8_000, signal);
  try {
    const snapshot = await abortable(
      getOrRefreshDataSnapshot({
        cacheKey: `quote-factors:v1:${symbol}:${adjustment}`,
        category: 'quote-factors',
        ttlMs: 3600_000,
        sourceName: '新浪财经复权因子',
        sourceUrl,
        requestScoped: true,
        refresh: async () => {
          const response = await fetchWithTimeout(
            sourceUrl,
            {
              signal: deadline.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0',
                Referer: 'https://finance.sina.com.cn/',
              },
            },
            6_000,
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error('来源未提供复权因子');
          }
          return parseSinaFactors(await response.text(), symbol, adjustment);
        },
      }),
      deadline.signal,
    );
    return {
      symbol,
      adjustment,
      factors: snapshot.value,
      sourceUrl,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
    };
  } finally {
    deadline.dispose();
  }
}
