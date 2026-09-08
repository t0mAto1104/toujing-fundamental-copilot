import { eastmoneyJson, fetchJson, stripHtml } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { getMarketQuotes } from '@/lib/a-stock-quotes';
import {
  chinaDate,
  checkedDate,
  shiftDate,
  signalNumber as num,
  stockSignalSymbol,
  type SignalSnapshot,
} from '@/lib/signal-types';
import type {
  PopularityData,
  PopularityItem,
  ConceptHeatData,
  InvestorQuestionsData,
  InvestorQuestion,
} from '@/lib/sentiment-types';

type Raw = Record<string, unknown>;
const object = (x: unknown): Raw =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Raw) : {};
const text = (x: unknown) =>
  typeof x === 'string' || typeof x === 'number' ? stripHtml(String(x)) : '';
const headers = { 'User-Agent': 'Mozilla/5.0' };
const EM = 'https://emappdata.eastmoney.com/stockrank/';
const IRM = 'https://irm.cninfo.com.cn/';
// Public website application identifiers, not credentials or user API keys.
const emBody = { appId: 'appId01', globalId: '786e4c21-70dc-435a-93bb-38' };
const MAX_SNAPSHOT_AGE = 60 * 60_000;

export function recentSnapshot<T>(
  snapshot: SignalSnapshot<T>,
  now = Date.now(),
) {
  const fetched = Date.parse(snapshot.fetchedAt);
  if (
    !Number.isFinite(fetched) ||
    fetched > now + 60_000 ||
    now - fetched > MAX_SNAPSHOT_AGE
  )
    throw new Error('数据源暂不可用，旧快照已停止展示，请稍后刷新。');
  return snapshot;
}

async function cached<T>(
  key: string,
  name: string,
  url: string,
  refresh: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
) {
  return recentSnapshot(
    await cachedMarketSignal(
      `sentiment:v1:${key}`,
      5 * 60_000,
      name,
      url,
      refresh,
      signal,
    ),
  );
}

function rankedRows(payload: unknown, source: 'ths' | 'eastmoney') {
  const root = object(payload);
  const rows = source === 'ths' ? object(root.data).stock_list : root.data;
  const ok =
    source === 'ths'
      ? num(root.status_code) === 0
      : num(root.code) === 0 && num(root.status) === 0;
  if (!ok || !Array.isArray(rows))
    throw new Error('热榜数据源返回异常，请稍后重试。');
  return rows;
}

export function parsePopularity(
  payload: unknown,
  source: 'ths' | 'eastmoney',
  period: 'hour' | 'day' = 'hour',
): PopularityData {
  const items = rankedRows(payload, source).flatMap(
    (value): PopularityItem[] => {
      const row = object(value);
      try {
        const symbol = stockSignalSymbol(
          text(source === 'ths' ? row.code : row.sc),
        );
        const rank = num(source === 'ths' ? row.order : row.rk);
        if (rank == null || !Number.isInteger(rank) || rank < 1 || rank > 100)
          return [];
        const tag = object(row.tag);
        return [
          {
            symbol,
            rank,
            name: source === 'ths' ? text(row.name) : symbol.toUpperCase(),
            // Change baselines are undocumented: do not imply "vs. yesterday".
            rankChange: null,
            heat: source === 'ths' ? text(row.rate) : '',
            percent: source === 'ths' ? num(row.rise_and_fall) : null,
            price: null,
            quoteAsOf: null,
            concepts: Array.isArray(tag.concept_tag)
              ? tag.concept_tag.map(text).filter(Boolean).slice(0, 5)
              : [],
            tag: text(tag.popularity_tag),
          },
        ];
      } catch {
        return [];
      }
    },
  );
  if (!items.length)
    throw new Error('热榜数据源未返回有效排名，暂不展示旧榜单。');
  return {
    items: [
      ...new Map(
        items.sort((a, b) => a.rank - b.rank).map((x) => [x.symbol, x]),
      ).values(),
    ].slice(0, 100),
    sourceAsOf: null,
    period: source === 'ths' ? period : 'current',
  };
}

async function emPost(endpoint: string, body: Raw, signal: AbortSignal) {
  return eastmoneyJson<unknown>(`${EM}${endpoint}`, {
    method: 'POST',
    signal,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Referer: 'https://guba.eastmoney.com/',
    },
    body: JSON.stringify({ ...emBody, ...body }),
  });
}

export async function getPopularity(
  source: 'ths' | 'eastmoney',
  period: 'hour' | 'day',
  signal?: AbortSignal,
) {
  const url =
    source === 'ths'
      ? `https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=${period}&list_type=normal`
      : 'https://guba.eastmoney.com/rank/';
  return cached(
    `rank:${source}:${source === 'ths' ? period : 'current'}`,
    source === 'ths' ? '同花顺热榜' : '东方财富人气榜',
    url,
    async (s) => {
      const data = parsePopularity(
        source === 'ths'
          ? await fetchJson(url, { headers, signal: s })
          : await emPost(
              'getAllCurrentList',
              { marketType: '', pageNo: 1, pageSize: 100 },
              s,
            ),
        source,
        period,
      );
      if (source === 'eastmoney') {
        // The rank endpoint has codes only. One existing public quote batch resolves
        // company names; quote timestamps remain separate from the rank timestamp.
        const quotes = await getMarketQuotes(
          data.items.map((x) => x.symbol),
          s,
        ).catch(() => null);
        const bySymbol = new Map(quotes?.quotes.map((x) => [x.symbol, x]));
        data.items = data.items.map((x) => {
          const q = bySymbol.get(x.symbol);
          if (!q) return x;
          if (
            quotes?.stale ||
            Date.now() - Date.parse(quotes!.fetchedAt) > MAX_SNAPSHOT_AGE
          )
            return { ...x, name: q.name };
          return {
            ...x,
            name: q.name,
            price: q.price,
            percent: q.percent,
            quoteAsOf: q.asOf,
          };
        });
        data.quoteUnavailable =
          !quotes || quotes.stale || quotes.missing.length > 0;
      }
      return data;
    },
    signal,
  );
}

function conceptDate(value: unknown) {
  const raw = text(value);
  if (!/^20\d{2}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(raw))
    return '';
  try {
    checkedDate(raw.slice(0, 10));
  } catch {
    return '';
  }
  return raw;
}

export function parseConceptHeat(
  payload: unknown,
  symbol: string,
  today = chinaDate(),
): ConceptHeatData {
  const rows = rankedRows(payload, 'eastmoney');
  const start = shiftDate(today, -6);
  const valid = rows.flatMap((value) => {
    const row = object(value);
    const sourceAsOf = conceptDate(row.calcTime);
    let identity = '';
    try {
      identity = stockSignalSymbol(text(row.srcSecurityCode));
    } catch {
      return [];
    }
    if (identity !== symbol || !sourceAsOf) return [];
    const name = text(row.conceptName),
      code = text(row.conceptId),
      hits = num(row.hitCount);
    if (!name || !code || hits == null || hits < 0 || !Number.isInteger(hits))
      return [];
    return [{ code, name, hits, sourceAsOf }];
  });
  if (rows.length && !valid.length)
    throw new Error('概念源未返回可核验的证券、日期或命中字段。');
  const all = valid.filter(
    (x) =>
      x.sourceAsOf.slice(0, 10) >= start && x.sourceAsOf.slice(0, 10) <= today,
  );
  const sourceAsOf =
    all
      .map((x) => x.sourceAsOf)
      .sort()
      .at(-1) || null;
  return {
    symbol,
    sourceAsOf,
    items: [
      ...new Map(
        all.filter((x) => x.sourceAsOf === sourceAsOf).map((x) => [x.code, x]),
      ).values(),
    ].sort((a, b) => b.hits - a.hits),
  };
}

export async function getConceptHeat(input: string, signal?: AbortSignal) {
  const symbol = stockSignalSymbol(input),
    today = chinaDate();
  return cached(
    `concept:${symbol}:${today}`,
    '东方财富个股概念命中',
    `https://guba.eastmoney.com/rank/stock?code=${symbol.toUpperCase()}`,
    async (s) =>
      parseConceptHeat(
        await emPost(
          'getHotStockRankList',
          { srcSecurityCode: symbol.toUpperCase() },
          s,
        ),
        symbol,
        today,
      ),
    signal,
  );
}

function epoch(value: unknown): string | null {
  const n = num(value);
  if (n == null || n < Date.UTC(2000, 0, 1) || n > Date.now() + 60_000)
    return null;
  return new Date(n).toISOString();
}

export function parseQuestions(
  payload: unknown,
  symbol: string,
  days: 7 | 30,
  page: number,
  today = chinaDate(),
): InvestorQuestionsData {
  const root = object(payload),
    start = shiftDate(today, -(days - 1));
  const total = num(root.total),
    totalPage = num(root.totalPage);
  if (
    !Array.isArray(root.rows) ||
    total == null ||
    total < 0 ||
    !Number.isInteger(total) ||
    totalPage == null ||
    totalPage < 0 ||
    !Number.isInteger(totalPage) ||
    (root.pageNo != null && num(root.pageNo) !== page)
  )
    throw new Error('互动易返回格式异常，请稍后重试。');
  const valid = root.rows.flatMap((value): InvestorQuestion[] => {
    const row = object(value),
      askedAt = epoch(row.pubDate),
      id = text(row.indexId);
    if (
      text(row.stockCode) !== symbol.slice(2) ||
      !askedAt ||
      !/^\d+$/.test(id)
    )
      return [];
    const question = text(row.mainContent),
      answer = text(row.attachedContent) || null;
    if (!question) return [];
    const replyTime = answer ? epoch(row.attachedPubDate) : null;
    return [
      {
        id,
        symbol,
        company: text(row.companyShortName),
        question,
        answer,
        answerer: answer ? text(row.attachedAuthor) : '',
        askedAt,
        answeredAt: replyTime && replyTime >= askedAt ? replyTime : null,
        url: `${IRM}ircs/question/questionDetail?questionId=${encodeURIComponent(id)}`,
      },
    ];
  });
  if (root.rows.length && !valid.length)
    throw new Error('互动易未返回可核验的当前证券问答。');
  const items = valid.filter((x) => {
    const date = chinaDate(new Date(x.askedAt));
    return date >= start && date <= today;
  });
  return {
    symbol,
    days,
    start,
    end: today,
    items: [...new Map(items.map((x) => [x.id, x])).values()].sort((a, b) =>
      b.askedAt.localeCompare(a.askedAt),
    ),
    page,
    hasMore: page < Math.min(num(root.totalPage)!, 10),
    coverage:
      '仅覆盖深市互动易。按提问时间筛选近 7 / 30 天，已排除日期缺失、过早或证券不匹配的记录；不将更新时间当作回复时间。最多读取 10 页。',
  };
}

export function parseIrmIdentity(payload: unknown, symbol: string) {
  const root = object(payload);
  if (root.message !== 'success' || !Array.isArray(root.data))
    throw new Error('互动易公司查询暂不可用。');
  const matches = root.data
    .map(object)
    .filter(
      (x) =>
        text(x.stockCode) === symbol.slice(2) &&
        /^[a-zA-Z0-9]+$/.test(text(x.secid)),
    );
  if (matches.length !== 1)
    throw new Error('互动易未返回唯一匹配的公司，请核对证券代码。');
  return text(matches[0].secid);
}

export async function getInvestorQuestions(
  input: string,
  days: 7 | 30,
  page: number,
  signal?: AbortSignal,
) {
  const symbol = stockSignalSymbol(input),
    today = chinaDate(),
    start = shiftDate(today, -(days - 1));
  if (!symbol.startsWith('sz'))
    throw new Error('互动易仅覆盖深市公司；沪市及北交所暂不提供此来源的问答。');
  return cached(
    `questions:${symbol}:${days}:${today}:${page}`,
    '深交所互动易',
    IRM,
    async (s) => {
      const orgId = parseIrmIdentity(
        await fetchJson(`${IRM}newircs/index/queryKeyboardInfo`, {
          method: 'POST',
          signal: s,
          headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: IRM,
          },
          body: new URLSearchParams({ keyWord: symbol.slice(2) }).toString(),
        }),
        symbol,
      );
      const query = new URLSearchParams({
        _t: '1',
        stockcode: symbol.slice(2),
        orgId,
        pageSize: '20',
        pageNum: String(page),
        keyWord: '',
        startDay: start,
        endDay: today,
      });
      return parseQuestions(
        await fetchJson(`${IRM}newircs/company/question?${query}`, {
          method: 'POST',
          signal: s,
          headers: { ...headers, Referer: IRM },
        }),
        symbol,
        days,
        page,
        today,
      );
    },
    signal,
  );
}
