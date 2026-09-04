import { eastmoneyJson, fetchWithTimeout } from '@/lib/a-stock-http';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import {
  cachedIdentity,
  cachedSearch,
  rememberSearch,
} from '@/lib/security-search-cache';
import {
  aStockPrefix,
  aStockTencentSymbol,
  listingAStockIdentity,
  normalizeAStockTicker,
} from '@/lib/a-stock-ticker';

export type ListingOption = {
  id: string;
  code: string;
  name: string;
  exchange: string;
  exchangeCode: string;
  securityType: string;
  quoteId: string;
  currency: string;
};

export type VerifiedQuote = {
  price: string;
  change: string;
  currency: string;
  marketCap: string;
  asOf: string;
  sourceName: string;
  sourceUrl: string;
  isStale?: boolean;
  staleReason?: string;
};

type SuggestionItem = {
  Code?: string;
  Name?: string;
  JYS?: string;
  QuoteID?: string;
  SecurityTypeName?: string;
};

const exchangeNames: Record<string, string> = {
  SH: '上海证券交易所',
  SZ: '深圳证券交易所',
  BJ: '北京证券交易所',
  HK: '香港交易所',
  NASDAQ: '纳斯达克',
  NYSE: '纽约证券交易所',
  AMEX: '美国证券交易所',
  OTCBB: '美国场外交易市场',
};

const beijingSecurity = /京A|北证A|北交所A股/;
const allowedSecurity =
  /沪A|深A|京A|北证A|北交所A股|港股|美股|粉单|存托凭证|普通股/i;
const blockedSecurity = /期货|期权|债|基金|指数|板块|可转债|优先股/i;
const blockedName =
  /ETF|基金|期权|期货|可转债|债券|二倍做多|二倍做空|收益策略/i;

export function cleanCompanyQuery(query: string) {
  return query
    .replace(/[“”"'：:？?。！!，,]/g, ' ')
    .replace(
      /帮我|请你|请|分析一下|分析|研究一下|研究|基本面信息|基本面|公司情况|公司信息|的信息|的情况/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:的|相关|资料)$/g, '')
    .trim()
    .slice(0, 60);
}

function currencyFor(exchangeCode: string, name: string) {
  if (exchangeCode === 'HK') return /-W?R$/.test(name) ? 'CNH' : 'HKD';
  if (
    exchangeCode === 'NASDAQ' ||
    exchangeCode === 'NYSE' ||
    exchangeCode === 'AMEX' ||
    exchangeCode === 'OTCBB'
  )
    return 'USD';
  return 'CNY';
}

function normalizeExchangeCode(
  rawCode: string,
  securityType: string,
  quoteId: string,
) {
  // The live suggestion API uses JYS=81 / 京A for Beijing equities.
  // Its Classify=NEEQ is also used for these listed shares, so is not a veto.
  if (beijingSecurity.test(securityType)) return 'BJ';
  if (exchangeNames[rawCode]) return rawCode;
  if (/沪A/.test(securityType) || quoteId.startsWith('1.')) return 'SH';
  if (/深A/.test(securityType)) return 'SZ';
  if (/港股/.test(securityType)) return 'HK';
  if (/美股|普通股|存托凭证|粉单/i.test(securityType)) {
    if (/纳斯达克/i.test(securityType)) return 'NASDAQ';
    if (/纽交所|纽约证券交易所/i.test(securityType)) return 'NYSE';
    if (/场外|粉单/i.test(securityType)) return 'OTCBB';
  }
  return rawCode;
}

export function toListing(item: SuggestionItem): ListingOption | null {
  const code = item.Code?.trim();
  const name = item.Name?.trim();
  const quoteId = item.QuoteID?.trim();
  const rawExchangeCode = item.JYS?.trim() || '';
  const securityType = item.SecurityTypeName?.trim() || '';
  if (
    !code ||
    !name ||
    !quoteId ||
    blockedName.test(name) ||
    blockedSecurity.test(securityType) ||
    !allowedSecurity.test(securityType)
  )
    return null;
  const exchangeCode = normalizeExchangeCode(
    rawExchangeCode,
    securityType,
    quoteId,
  );
  const listing = {
    id: quoteId,
    code,
    name,
    exchange: exchangeNames[exchangeCode] || securityType || exchangeCode,
    exchangeCode,
    securityType,
    quoteId,
    currency: currencyFor(exchangeCode, name),
  };
  if (
    ['SH', 'SZ', 'BJ'].includes(exchangeCode) &&
    !listingAStockIdentity(listing)
  )
    return null;
  return listing;
}

export async function searchListedSecurities(
  query: string,
  options: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<ListingOption[]> {
  const deadline = requestDeadline(8_000, options.signal);
  try {
    deadline.signal.throwIfAborted();
    if (!options.fresh) {
      const cached = await abortable(cachedSearch(query), deadline.signal);
      if (cached) return cached;
    }
    const listings = await abortable(
      searchUncachedSecurities(query, deadline.signal),
      deadline.signal,
    );
    await abortable(rememberSearch(query, listings), deadline.signal);
    return listings;
  } finally {
    deadline.dispose();
  }
}

export async function resolveCompanySecurity(
  query: string,
  listingId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (listingId) {
    const cached = await cachedIdentity(query, listingId);
    signal?.throwIfAborted();
    if (cached) return cached;
  }
  const listings = await searchListedSecurities(query, { signal });
  return {
    listing: listingId
      ? listings.find((item) => item.id === listingId) || null
      : listings[0] || null,
    listings,
  };
}

async function searchUncachedSecurities(
  query: string,
  signal: AbortSignal,
): Promise<ListingOption[]> {
  let input = cleanCompanyQuery(query) || query.trim().slice(0, 60);
  let requestedMarket: string | undefined;
  // Never drop an explicit exchange: SH000001 is not SZ000001.
  if (/^(?:sh|sz|bj)\d|^\d.*\.(?:sh|sz|bj)$/i.test(input)) {
    try {
      const ticker = normalizeAStockTicker(input, { stockOnly: true });
      input = ticker.code;
      requestedMarket = ticker.market;
    } catch (error) {
      throw new InvalidSecurityQueryError(
        error instanceof Error ? error.message : '证券代码格式无效。',
      );
    }
  }
  if (!input) return [];
  const candidates = Array.from(
    new Set(
      [
        input,
        input.replace(/(?:最新|近期|目前|当前|最近一期).*/, ''),
        input.replace(
          /的(?:财报|业绩|渠道|库存|现金流|估值|份额|盈利|政策|风险|基本面).*/,
          '',
        ),
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  for (const candidate of candidates) {
    const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
    url.searchParams.set('input', candidate);
    url.searchParams.set('type', '14');
    url.searchParams.set('count', '30');
    const payload = await eastmoneyJson<{
      QuotationCodeTable?: { Data?: SuggestionItem[] | null; Status?: number };
    }>(
      url,
      {
        signal,
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
      },
      7_000,
    );
    const table = payload.QuotationCodeTable;
    if (
      !table ||
      table.Status !== 0 ||
      (table.Data != null && !Array.isArray(table.Data))
    )
      throw new Error('证券搜索数据源返回异常。');
    const seen = new Set<string>();
    const listings = (payload.QuotationCodeTable?.Data || [])
      .map(toListing)
      .filter((item): item is ListingOption => item !== null)
      .filter(
        (item) =>
          !requestedMarket ||
          (item.exchangeCode === requestedMarket && item.code === input),
      )
      .filter((item) => !/^\d{6}$/.test(input) || item.code === input)
      .filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))
      .sort((left, right) => {
        const leftExact = left.code === candidate || left.name === candidate;
        const rightExact = right.code === candidate || right.name === candidate;
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const coreName = (name: string) =>
          name.replace(/(?:-W?R|-W|\(ADR\)|（ADR）)$/i, '');
        const leftCoreExact = coreName(left.name) === candidate;
        const rightCoreExact = coreName(right.name) === candidate;
        if (leftCoreExact !== rightCoreExact) return leftCoreExact ? -1 : 1;
        const order = [
          'SH',
          'SZ',
          'BJ',
          'HK',
          'NASDAQ',
          'NYSE',
          'AMEX',
          'OTCBB',
        ];
        const leftRank = order.indexOf(left.exchangeCode);
        const rightRank = order.indexOf(right.exchangeCode);
        return (
          (leftRank === -1 ? order.length : leftRank) -
          (rightRank === -1 ? order.length : rightRank)
        );
      })
      .slice(0, 12);
    if (listings.length) return listings;
  }
  return [];
}

export class InvalidSecurityQueryError extends Error {}

function parseTencentRow(text: string) {
  const match = text.match(/="([\s\S]*?)"/);
  return match ? match[1].split('~') : [];
}

async function getTencentQuote(
  listing: ListingOption,
  signal?: AbortSignal,
): Promise<VerifiedQuote | null> {
  const identity = listingAStockIdentity(listing);
  if (!identity) return null;
  const symbol = aStockTencentSymbol(identity.code, identity.market);
  const response = await fetchWithTimeout(
    `https://qt.gtimg.cn/q=${symbol}`,
    {
      signal,
      headers: {
        Referer: 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      cf: { cacheTtl: 20, cacheEverything: true },
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } },
    8_000,
  );
  if (!response.ok) return null;
  const row = parseTencentRow(await response.text());
  if (row.length < 53) return null;
  const price = Number(row[3]);
  const previousClose = Number(row[4]);
  const percent = Number(row[32]);
  const amount = Number(row[37]);
  const marketCap = Number(row[45]);
  if (!Number.isFinite(price) || price <= 0) return null;
  const isStale =
    Number.isFinite(amount) &&
    amount === 0 &&
    Number.isFinite(previousClose) &&
    price === previousClose;
  const prefix = aStockPrefix(identity.code, identity.market);
  return {
    price: price.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }),
    change: Number.isFinite(percent)
      ? `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
      : '--',
    currency: 'CNY',
    marketCap:
      Number.isFinite(marketCap) && marketCap > 0
        ? `${marketCap.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}亿元`
        : '待核验',
    asOf: `${new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())}（北京时间）`,
    sourceName: '腾讯行情',
    sourceUrl: `https://gu.qq.com/${prefix}${identity.code}/gp`,
    isStale,
    staleReason: isStale
      ? '成交额为0且最新价等于昨收，可能处于停牌、未开盘或旧代码状态。'
      : undefined,
  };
}

function formatMarketCap(value: unknown, currency: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return '待核验';
  const unit =
    currency === 'HKD'
      ? '亿港元'
      : currency === 'USD'
        ? '亿美元'
        : currency === 'CNH'
          ? '亿元人民币'
          : '亿元';
  return `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit}`;
}

function formatAsOf(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return '最新行情快照';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value * 1000));
}

export async function getVerifiedQuote(
  listing: ListingOption,
  signal?: AbortSignal,
): Promise<VerifiedQuote | null> {
  const deadline = requestDeadline(10_000, signal);
  try {
    if (listingAStockIdentity(listing)) {
      try {
        const quote = await getTencentQuote(listing, deadline.signal);
        if (quote) return quote;
      } catch {}
    }
    deadline.signal.throwIfAborted();
    const url = new URL('https://push2delay.eastmoney.com/api/qt/stock/get');
    url.searchParams.set('secid', listing.quoteId);
    url.searchParams.set(
      'fields',
      'f43,f47,f48,f57,f58,f59,f60,f86,f116,f117,f169,f170',
    );
    const response = await fetchWithTimeout(
      url,
      {
        signal: deadline.signal,
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
      },
      deadline.remaining(),
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: Record<string, unknown> | null;
    };
    const data = payload.data;
    if (!data || typeof data.f43 !== 'number') return null;
    const decimals = typeof data.f59 === 'number' ? data.f59 : 2;
    const price = data.f43 / 10 ** decimals;
    const percent = typeof data.f170 === 'number' ? data.f170 / 100 : null;
    const previousClose =
      typeof data.f60 === 'number' ? data.f60 / 10 ** decimals : null;
    const amount = typeof data.f48 === 'number' ? data.f48 : null;
    const isStale =
      amount === 0 && previousClose !== null && price === previousClose;
    return {
      price: price.toLocaleString('zh-CN', {
        minimumFractionDigits: Math.min(decimals, 2),
        maximumFractionDigits: decimals,
      }),
      change:
        percent === null
          ? '--'
          : `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`,
      currency: listing.currency,
      marketCap: formatMarketCap(data.f116, listing.currency),
      asOf: `${formatAsOf(data.f86)}（北京时间）`,
      sourceName: '东方财富行情',
      sourceUrl: `https://quote.eastmoney.com/unify/r/${listing.quoteId}`,
      isStale,
      staleReason: isStale
        ? '成交额为0且最新价等于昨收，可能处于停牌、未开盘或旧代码状态。'
        : undefined,
    };
  } catch {
    return null;
  } finally {
    deadline.dispose();
  }
}
