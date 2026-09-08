import { eastmoneyJson } from '@/lib/a-stock-http';
import { getMarketQuotes } from '@/lib/a-stock-quotes';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';
import { toListing, type ListingOption } from '@/lib/market-listings';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import {
  MARKET_ETFS,
  MARKET_INDICES,
  isMarketETF,
  isMarketIndex,
  normalizeQuoteSymbol,
} from '@/lib/quote-types';

function listing(symbol: string, name: string): ListingOption {
  const exchangeCode = symbol.slice(0, 2).toUpperCase();
  const id = `${exchangeCode === 'SH' ? '1' : '0'}.${symbol.slice(2)}`;
  return {
    id,
    quoteId: id,
    code: symbol.slice(2),
    name,
    exchangeCode,
    exchange: {
      SH: '上海证券交易所',
      SZ: '深圳证券交易所',
      BJ: '北京证券交易所',
    }[exchangeCode]!,
    securityType: isMarketIndex(symbol)
      ? '指数'
      : isMarketETF(symbol)
        ? 'ETF'
        : 'A股',
    currency: 'CNY',
  };
}

// Quote-only search: never put ETF/index identities in the company-research cache.
export async function searchQuoteSecurities(
  query: string,
  signal?: AbortSignal,
) {
  const deadline = requestDeadline(8_000, signal);
  try {
    const input = query.trim();
    if (/^(?:(?:sh|sz|bj)\d{6}|\d{6}(?:\.(?:sh|sz|bj))?)$/i.test(input)) {
      const symbol = normalizeQuoteSymbol(input);
      const sameCodeIndex = /^\d{6}$/.test(input)
        ? MARKET_INDICES.find(
            (item) => item.symbol.slice(2) === input && item.symbol !== symbol,
          )
        : undefined;
      const result = await getMarketQuotes(
        sameCodeIndex ? [symbol, sameCodeIndex.symbol] : [symbol],
        deadline.signal,
      );
      return result.quotes
        .sort(
          (a, b) => Number(b.symbol === symbol) - Number(a.symbol === symbol),
        )
        .map((q) => listing(q.symbol, q.name));
    }
    const known = [...MARKET_INDICES, ...MARKET_ETFS]
      .filter(
        (item) =>
          item.name.toLowerCase().includes(input.toLowerCase()) ||
          item.symbol.includes(input),
      )
      .map((item) => listing(item.symbol, item.name));
    const snapshot = await abortable(
      getOrRefreshDataSnapshot({
        cacheKey: `quote-search:v1:${input.toLowerCase()}`,
        category: 'quote-search',
        ttlMs: 3600_000,
        sourceName: '东方财富证券搜索',
        sourceUrl: 'https://quote.eastmoney.com/',
        requestScoped: true,
        refresh: async () => {
          const url = new URL(
            'https://searchapi.eastmoney.com/api/suggest/get',
          );
          url.search = new URLSearchParams({
            input,
            type: '14',
            count: '30',
          }).toString();
          const result = await eastmoneyJson<{
            QuotationCodeTable?: {
              Status?: number;
              Data?: Parameters<typeof toListing>[0][] | null;
            };
          }>(
            url,
            {
              signal: deadline.signal,
              headers: { Referer: 'https://quote.eastmoney.com/' },
            },
            6_000,
          );
          if (result.QuotationCodeTable?.Status !== 0)
            throw new Error('证券搜索暂不可达');
          const found = (result.QuotationCodeTable.Data || []).flatMap(
            (item) => {
              try {
                const stock = toListing(item);
                if (stock) {
                  const symbol = normalizeQuoteSymbol(
                    `${stock.exchangeCode}${stock.code}`,
                  );
                  return [listing(symbol, stock.name)];
                }
                const market = item.QuoteID?.startsWith('1.')
                  ? 'sh'
                  : item.QuoteID?.startsWith('0.')
                    ? 'sz'
                    : '';
                const symbol = normalizeQuoteSymbol(`${market}${item.Code}`);
                return market &&
                  isMarketETF(symbol) &&
                  /ETF/i.test(item.Name || '')
                  ? [listing(symbol, item.Name!)]
                  : [];
              } catch {
                return [];
              }
            },
          );
          return [
            ...new Map(
              [...known, ...found].map((item) => [item.id, item]),
            ).values(),
          ];
        },
      }),
      deadline.signal,
    ).catch((error) => {
      deadline.signal.throwIfAborted();
      if (known.length) return { value: known };
      throw error;
    });
    return snapshot.value;
  } finally {
    deadline.dispose();
  }
}
