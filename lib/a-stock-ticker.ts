import type { ListingOption } from '@/lib/market-listings';

export type AStockMarket = 'SH' | 'SZ' | 'BJ';

const tickerPattern = /^(?:(sh|sz|bj)(\d{6})|(\d{6})(?:\.(sh|sz|bj))?)$/i;
const shIndexCodes = new Set([
  '000010',
  '000016',
  '000300',
  '000688',
  '000852',
  '000905',
]);

function inferredMarket(code: string): AStockMarket {
  // Market inference is broader than the admitted live A-share universe.
  // quote-types / security search still reject unsupported NEEQ and B-share assets.
  if (/^(4|8|92)/.test(code)) return 'BJ';
  if (/^[569]/.test(code) || shIndexCodes.has(code)) return 'SH';
  return 'SZ';
}

export function normalizeAStockTicker(
  input: string,
  options: { stockOnly?: boolean } = {},
) {
  const match = tickerPattern.exec(String(input).trim());
  if (!match)
    throw new Error(
      '证券代码格式无效；支持 600519、SH600519、600519.SH 等写法。',
    );
  const code = match[2] || match[3];
  const explicit = (match[1] || match[4] || '').toUpperCase() as
    | AStockMarket
    | '';
  const natural = inferredMarket(code);

  if (explicit) {
    if (code.startsWith('000')) {
      if (explicit === 'BJ')
        throw new Error('000xxx 代码不属于北京证券交易所。');
      if (options.stockOnly && explicit === 'SH')
        throw new Error('该代码指向沪市指数，不是上市公司证券。');
    } else if (explicit !== natural) {
      throw new Error(`证券代码与上市地不匹配：${code} 应属于 ${natural}。`);
    }
  }

  const market = explicit || natural;
  return { code, market };
}

export function aStockPrefix(code: string, explicitMarket?: AStockMarket) {
  const market = explicitMarket || normalizeAStockTicker(code).market;
  return market.toLowerCase() as 'sh' | 'sz' | 'bj';
}

export function aStockEastmoneySecid(
  code: string,
  explicitMarket?: AStockMarket,
) {
  const normalized = normalizeAStockTicker(code);
  const market = explicitMarket || normalized.market;
  return `${market === 'SH' ? 1 : 0}.${normalized.code}`;
}

export function aStockTencentSymbol(
  code: string,
  explicitMarket?: AStockMarket,
  simple = false,
) {
  const normalized = normalizeAStockTicker(code);
  const prefix = aStockPrefix(
    normalized.code,
    explicitMarket || normalized.market,
  );
  return `${simple ? 's_' : ''}${prefix}${normalized.code}`;
}

export function listingAStockIdentity(listing: ListingOption) {
  if (!['SH', 'SZ', 'BJ'].includes(listing.exchangeCode)) return null;
  try {
    const normalized = normalizeAStockTicker(
      `${listing.exchangeCode}${listing.code}`,
      { stockOnly: true },
    );
    return normalized;
  } catch {
    return null;
  }
}

export function isLegacyBeijingCode(code: string) {
  return /^(43|83|87)/.test(code);
}
