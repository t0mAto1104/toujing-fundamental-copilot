import { fetchWithTimeout } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import {
  officialDate,
  officialNumber,
  officialText,
} from '@/lib/official-data-types';
import { normalizeQuoteSymbol, type MarketQuote } from '@/lib/quote-types';
import { getTradingSession } from '@/lib/a-stock-official';
import { quoteDateStale } from '@/lib/official-data-types';
import { abortable, requestDeadline } from '@/lib/request-deadline';

const PAGE = 'https://www.bse.cn/nq/quotation.html';
const ENDPOINT = 'https://www.bse.cn/nqhqController/nqhq_en.do';
const headers = { 'User-Agent': 'Mozilla/5.0', Referer: PAGE };
export function parseBseQuote(text: string, symbol: string): MarketQuote {
  if (!/^bj(?:92|43|83|87)\d{4}$/.test(normalizeQuoteSymbol(symbol)))
    throw new Error('不是支持的北交所股票。');
  const raw = text
    .trim()
    .replace(/^null\(/, '')
    .replace(/\);?$/, '');
  const payload = JSON.parse(raw) as Array<{
    content?: Record<string, unknown>[];
    totalElements?: number;
  }>;
  const rows = payload?.[0]?.content;
  if (
    !Array.isArray(payload) ||
    payload.length !== 1 ||
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    ![1, '1'].includes(payload[0].totalElements!)
  )
    throw new Error('北交所未返回唯一目标证券。');
  const row = rows[0];
  if (officialText(row.hqzqdm) !== symbol.slice(2) || !officialText(row.hqzqjc))
    throw new Error('北交所证券身份不匹配。');
  const date = officialDate(row.hqjsrq);
  const clock = officialText(row.hqgxsj);
  if (!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(clock))
    throw new Error('北交所行情时间缺失。');
  const asOf = `${date}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4)}+08:00`;
  const positive = (field: string) => {
    const n = officialNumber(row[field]);
    return n !== null && n > 0 ? n : null;
  };
  const nonnegative = (field: string) => {
    const n = officialNumber(row[field]);
    return n !== null && n >= 0 ? n : null;
  };
  const lots = (field: string) => {
    const shares = nonnegative(field);
    return shares === null ? null : shares / 100;
  };
  const price = positive('hqzjcj');
  if (price === null) throw new Error('北交所未提供有效现价。');
  const previousClose = positive('hqzrsp');
  const change =
    previousClose === null ? null : Number((price - previousClose).toFixed(4));
  const levels = (side: 'b' | 's') =>
    Array.from({ length: 5 }, (_, i) => {
      const level = i + 1;
      const price = positive(`hq${side}jw${level}`);
      return {
        level,
        price,
        volume: price === null ? null : lots(`hq${side}sl${level}`),
      };
    });
  const pe = positive('hqsyl1');
  return {
    symbol,
    name: officialText(row.hqzqjc),
    price,
    previousClose,
    change,
    percent:
      change === null || previousClose === null
        ? null
        : Number(((change / previousClose) * 100).toFixed(2)),
    open: positive('hqjrkp'),
    high: positive('hqzgcj'),
    low: positive('hqzdcj'),
    volume: lots('hqcjsl'),
    amount: nonnegative('hqcjje'),
    pe,
    peBasis: pe === null ? null : '来源口径',
    pb: null,
    marketCap: null,
    floatMarketCap: null,
    turnover: null,
    orderBook: { bids: levels('b'), asks: levels('s') },
    asOf,
    inactive: nonnegative('hqcjje') === 0 && price === previousClose,
    sourceName: '北京证券交易所（官方备用）',
    sourceUrl: PAGE,
  };
}

export async function getBseQuote(symbol: string, signal?: AbortSignal) {
  if (!/^bj(?:92|43|83|87)\d{4}$/.test(normalizeQuoteSymbol(symbol)))
    throw new Error('不是支持的北交所股票。');
  const deadline = requestDeadline(6_000, signal);
  try {
    const [snapshot, session] = await abortable(
      Promise.all([
        cachedMarketSignal(
          `official:bse:${symbol}`,
          15_000,
          '北京证券交易所',
          PAGE,
          async (s) => {
            // Anonymous anti-bot cookie only, request-local; no credentials, no redirect loop.
            for (let attempt = 0; attempt < 2; attempt++) {
              const landing = await fetchWithTimeout(
                PAGE,
                { headers, signal: s, redirect: 'manual' },
                2_000,
              );
              const cookie = (
                landing.headers.getSetCookie?.() || [
                  landing.headers.get('set-cookie') || '',
                ]
              )
                .map((value) => value.split(';')[0])
                .filter(Boolean)
                .join('; ');
              await landing.body?.cancel();
              if (!cookie) throw new Error('北交所匿名会话暂不可用。');
              const response = await fetchWithTimeout(
                ENDPOINT,
                {
                  method: 'POST',
                  redirect: 'manual',
                  signal: s,
                  headers: {
                    ...headers,
                    Cookie: cookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams({
                    page: '0',
                    type_en: '["B"]',
                    sortfield: 'hqzqdm',
                    sorttype: 'asc',
                    xxfcbj_en: '[2]',
                    zqdm: symbol.slice(2),
                  }),
                },
                3_000,
              );
              if (response.status >= 300 && response.status < 400) {
                await response.body?.cancel();
                continue;
              }
              if (!response.ok) {
                await response.body?.cancel();
                throw new Error('北交所行情暂不可用。');
              }
              return parseBseQuote(await response.text(), symbol);
            }
            throw new Error('北交所会话校验未通过。');
          },
          deadline.signal,
          6_000,
        ),
        getTradingSession(deadline.signal),
      ]),
      deadline.signal,
    );
    return {
      ...snapshot.data,
      sourceStale:
        snapshot.stale ||
        session.state === 'unknown' ||
        quoteDateStale(snapshot.data.asOf, session),
    };
  } finally {
    deadline.dispose();
  }
}
