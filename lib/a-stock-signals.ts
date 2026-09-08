import {
  eastmoneyJson,
  fetchJson,
  fetchWithTimeout,
  stripHtml,
} from '@/lib/a-stock-http';
import { readDataSnapshot, storeDataSnapshot } from '@/lib/data-snapshot-cache';
import { observeDataSource } from '@/lib/data-source-health';
import { requestDeadline } from '@/lib/request-deadline';
import type { IndustrySnapshot } from '@/lib/a-stock-industries';
import {
  checkedDate,
  chinaDate,
  shiftDate,
  signalNumber as num,
  stockSignalSymbol,
  type BoardFlow,
  type BoardKind,
  type BoardPeriod,
  type DragonRecord,
  type DragonSeat,
  type FundData,
  type FundPoint,
  type HotData,
  type Membership,
  type NorthboundData,
  type Paged,
  type SignalSnapshot,
  type UnlockRecord,
  type HoldingsData,
  type SignalEvidence,
} from '@/lib/signal-types';

type Raw = Record<string, unknown>;
const object = (x: unknown): Raw =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Raw) : {};
const array = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const text = (x: unknown) =>
  typeof x === 'string' || typeof x === 'number' ? stripHtml(String(x)) : '';
const diff = (x: unknown) =>
  Array.isArray(x) ? x.map(object) : Object.values(object(x)).map(object);
const EM_SOURCE = 'https://data.eastmoney.com/';
const EM_HEADER = {
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0',
};
const HOLDINGS_URL = 'https://www3.hkexnews.hk/sdw/search/mutualmarket.aspx?t=';

// Reuse the existing D1 snapshot table. Failures have a shared, bounded cooldown;
// no request-owned fetch Promise is shared between Cloudflare invocations.
async function cached<T>(
  key: string,
  ttl: number,
  sourceName: string,
  sourceUrl: string,
  refresh: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
  refreshTimeoutMs = 18_000,
): Promise<SignalSnapshot<T>> {
  const cacheKey = `signals:v1:${key}`;
  const observation = {
    cacheKey,
    category: 'market-signals',
    sourceName,
    sourceUrl,
  };
  const previous = await readDataSnapshot<T>(cacheKey).catch(() => null);
  const wrap = (
    snapshot: NonNullable<typeof previous>,
    stale = snapshot.stale,
  ): SignalSnapshot<T> => ({
    data: snapshot.value,
    fetchedAt: snapshot.fetchedAt,
    sourceName: snapshot.sourceName,
    sourceUrl: snapshot.sourceUrl,
    stale,
    ...(stale
      ? { notice: '刷新暂不可用，保留上次数据；请核对数据日期。' }
      : {}),
  });
  if (previous && !previous.stale) {
    await observeDataSource(observation, 'cache');
    return wrap(previous);
  }
  const failure = await readDataSnapshot<boolean>(`${cacheKey}:cooldown`).catch(
    () => null,
  );
  if (failure?.value && !failure.stale) {
    if (previous) return wrap(previous, true);
    throw new Error('数据源暂不可用，已暂停重复请求，请稍后重试。');
  }
  const deadline = requestDeadline(refreshTimeoutMs, parent);
  const started = Date.now();
  try {
    const value = await refresh(deadline.signal);
    await observeDataSource(
      observation,
      'success',
      Date.now() - started,
      value,
    );
    try {
      return wrap(
        await storeDataSnapshot(
          cacheKey,
          'market-signals',
          value,
          ttl,
          sourceName,
          sourceUrl,
        ),
      );
    } catch {
      return {
        data: value,
        fetchedAt: new Date().toISOString(),
        sourceName,
        sourceUrl,
        stale: false,
        notice: '本次已获取来源数据，但共享缓存写入暂不可用。',
      };
    }
  } catch (error) {
    if (!parent?.aborted)
      await observeDataSource(
        observation,
        'failure',
        Date.now() - started,
        undefined,
        error,
      );
    if (!parent?.aborted)
      await storeDataSnapshot(
        `${cacheKey}:cooldown`,
        'market-signals',
        true,
        3 * 60_000,
        sourceName,
        sourceUrl,
      ).catch(() => null);
    if (previous) return wrap(previous, true);
    throw error;
  } finally {
    deadline.dispose();
  }
}

export { cached as cachedMarketSignal };

function sourceDate(value: unknown) {
  const date = text(value).slice(0, 10);
  try {
    return checkedDate(date);
  } catch {
    return '';
  }
}

function rowSymbol(row: Raw) {
  return stockSignalSymbol(
    text(row.SECURITY_CODE || row.code).padStart(6, '0'),
  );
}

export function parseHotStocks(payload: unknown): HotData {
  const root = object(payload);
  if (Number(root.errocode ?? 0) !== 0 || !Array.isArray(root.data))
    throw new Error('热点源返回格式异常。');
  const date = sourceDate(root.date);
  const items = array(root.data).flatMap((value) => {
    const row = object(value);
    try {
      const rowDate = sourceDate(row.date) || date;
      if (!rowDate || !text(row.name)) return [];
      return [
        {
          symbol: rowSymbol(row),
          name: text(row.name),
          date: rowDate,
          reason: text(row.reason),
          price: num(row.close),
          percent: num(row.zhangfu),
          // Verified against Tencent: getharden amount is 万元 (volume is 手).
          amount:
            num(row.chengjiaoe) == null ? null : num(row.chengjiaoe)! * 10_000,
          turnover: num(row.huanshou),
        },
      ];
    } catch {
      return [];
    }
  });
  const latest =
    date ||
    items
      .map((x) => x.date)
      .sort()
      .at(-1) ||
    '';
  if (!latest) throw new Error('热点源缺少数据日期。');
  return {
    date: latest,
    items: [
      ...new Map(
        items.filter((x) => x.date === latest).map((x) => [x.symbol, x]),
      ).values(),
    ].sort((a, b) => (b.percent ?? -Infinity) - (a.percent ?? -Infinity)),
    coverage:
      '同花顺热点样本，并非全市场涨幅榜；题材为来源编辑标签，不代表已证实的上涨原因。',
  };
}

export function getHotStocks(signal?: AbortSignal) {
  const day = chinaDate();
  const url = `https://zx.10jqka.com.cn/event/api/getharden/date/${day}/orderby/date/orderway/desc/charset/GBK/`;
  return cached(
    `hot:${day}`,
    5 * 60_000,
    '同花顺热点',
    url,
    async (s) =>
      parseHotStocks(
        await fetchJson(url, { headers: EM_HEADER, signal: s }, 8_000),
      ),
    signal,
  );
}

async function push2(
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
  route?: { host?: string },
) {
  let error: unknown;
  const defaults = ['push2.eastmoney.com', 'push2delay.eastmoney.com'];
  const hosts = route?.host
    ? [route.host, ...defaults.filter((host) => host !== route.host)]
    : defaults;
  for (const host of hosts) {
    try {
      const url = `https://${host}/api/qt/${path}?${new URLSearchParams(params)}`;
      const root = object(
        await eastmoneyJson(url, { headers: EM_HEADER, signal }, 6_500),
      );
      if (root.rc != null && root.rc !== 0)
        throw new Error('行情源未接受请求。');
      if (!root.data || typeof root.data !== 'object')
        throw new Error('行情源暂未提供该数据。');
      if (route) route.host = host;
      return object(root.data);
    } catch (cause) {
      error = cause;
      if (signal.aborted) throw cause;
    }
  }
  throw error;
}

export { push2 as fetchPush2Data };

export function parseMemberships(payload: unknown): Membership[] {
  return diff(object(payload).diff).flatMap((row) => {
    const code = text(row.f12),
      name = text(row.f14);
    return /^BK\d{4,6}$/.test(code) && name
      ? [{ code, name, percent: num(row.f3) }]
      : [];
  });
}

export async function getMemberships(
  symbol: string,
  signal?: AbortSignal,
  kind?: BoardKind,
) {
  const secid = `${symbol.startsWith('sh') ? 1 : 0}.${symbol.slice(2)}`;
  const snapshot = await cached(
    `membership:${symbol}`,
    86400_000,
    '东方财富板块归属',
    `https://quote.eastmoney.com/${symbol}.html`,
    async (s) => {
      const data = await push2(
        'slist/get',
        {
          fltt: '2',
          invt: '2',
          secid,
          spt: '3',
          pi: '0',
          pz: '200',
          po: '1',
          fields: 'f12,f14,f3',
        },
        s,
      );
      const items = parseMemberships(data);
      if (Number(data.total) > items.length)
        throw new Error('板块归属尚未完整返回，请查看来源。');
      return items;
    },
    signal,
  );
  if (!kind) return snapshot;
  const catalog = await getBoardCatalog(kind, signal);
  return {
    ...snapshot,
    stale: snapshot.stale || catalog.stale,
    data: snapshot.data.filter((x) => catalog.data.includes(x.code)),
  };
}

export function getBoardCatalog(kind: BoardKind, signal?: AbortSignal) {
  return cached(
    `board-catalog:${kind}`,
    86400_000,
    '东方财富板块分类',
    'https://quote.eastmoney.com/center/boardlist.html',
    async (s) => {
      if (kind === 'industry') {
        const existing = await readDataSnapshot<IndustrySnapshot>(
          'industry:all',
        ).catch(() => null);
        const source = existing?.value;
        const codes = [
          ...new Set(
            source?.industries
              .map((x) => x.code)
              .filter((code) => /^BK\d{4,6}$/.test(code)) || [],
          ),
        ];
        if (
          existing &&
          !existing.stale &&
          codes.length > 0 &&
          codes.length === source?.sourceTotal
        )
          return codes;
      }
      const codes = new Set<string>();
      // Keep the successful provider for the rest of this request's pages.
      // Re-probing a failed primary on every page exhausts the total deadline.
      const route: { host?: string } = {};
      for (let page = 1; page <= 20; page++) {
        const data = await push2(
          'clist/get',
          {
            pn: String(page),
            pz: '100',
            po: '1',
            np: '1',
            fltt: '2',
            invt: '2',
            fs: `m:90+t:${kind === 'industry' ? 2 : kind === 'concept' ? 3 : 1}`,
            fid: 'f12',
            fields: 'f12',
          },
          s,
          route,
        );
        const rows = diff(data.diff)
          .map((x) => text(x.f12))
          .filter((code) => /^BK\d{4,6}$/.test(code));
        const total = num(data.total);
        if (!rows.length || total == null || total < 1)
          throw new Error('板块分类清单不完整。');
        const before = codes.size;
        rows.forEach((code) => codes.add(code));
        if (codes.size === before) throw new Error('板块分类分页重复。');
        if (codes.size === total) return [...codes];
        if (codes.size > total) throw new Error('板块分类数量不一致。');
      }
      throw new Error('板块分类清单超出安全范围。');
    },
    signal,
  );
}

export function parseFundPoints(rows: unknown): FundPoint[] {
  return [
    ...new Map(
      array(rows).flatMap((x) => {
        const values = typeof x === 'string' ? x.split(',') : [];
        if (
          values.length < 6 ||
          !/^20\d{2}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(values[0]) ||
          !sourceDate(values[0])
        )
          return [];
        const [main, small, medium, large, superLarge] = values
          .slice(1, 6)
          .map(num);
        return [
          [
            values[0],
            { time: values[0], main, small, medium, large, superLarge },
          ] as const,
        ];
      }),
    ).values(),
  ].sort((a, b) => a.time.localeCompare(b.time));
}

export function getStockFlow(
  symbol: string,
  period: 'minute' | 'day',
  signal?: AbortSignal,
) {
  const secid = `${symbol.startsWith('sh') ? 1 : 0}.${symbol.slice(2)}`;
  return cached<FundData>(
    `flow:${symbol}:${period}`,
    period === 'minute' ? 60_000 : 15 * 60_000,
    '东方财富资金统计',
    `https://data.eastmoney.com/zjlx/${symbol.slice(2)}.html`,
    async (s) => {
      const params = {
        secid,
        klt: '1',
        lmt: period === 'minute' ? '0' : '120',
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56',
      };
      let data: Raw;
      if (period === 'minute')
        data = await push2('stock/fflow/kline/get', params, s);
      else {
        const root = object(
          await eastmoneyJson(
            `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?${new URLSearchParams(params)}`,
            { headers: EM_HEADER, signal: s },
            8_000,
          ),
        );
        data = object(root.data);
      }
      if (text(data.code) !== symbol.slice(2))
        throw new Error('资金源证券标识不匹配。');
      const points = parseFundPoints(data.klines);
      if (!points.length) throw new Error('该证券暂未获得有效资金流序列。');
      return { symbol, period, points };
    },
    signal,
  );
}

export function parseBoardFlow(
  row: Raw,
  kind: BoardKind,
  period: BoardPeriod,
): BoardFlow {
  const fields =
    period === 'today'
      ? ['f3', 'f62', 'f184']
      : period === '5d'
        ? ['f109', 'f164', 'f165']
        : ['f160', 'f174', 'f175'];
  return {
    code: text(row.f12),
    name: text(row.f14),
    kind,
    percent: num(row[fields[0]]),
    mainNet: num(row[fields[1]]),
    mainRatio: num(row[fields[2]]),
  };
}

export function getBoardFlows(
  kind: BoardKind,
  period: BoardPeriod,
  page: number,
  signal?: AbortSignal,
) {
  return cached<Paged<BoardFlow>>(
    `boards:${kind}:${period}:${page}`,
    5 * 60_000,
    '东方财富板块资金',
    'https://data.eastmoney.com/bkzj/',
    async (s) => {
      const data = await push2(
        'clist/get',
        {
          pn: String(page),
          pz: '50',
          po: '1',
          np: '1',
          fltt: '2',
          invt: '2',
          fs: `m:90+t:${kind === 'industry' ? 2 : kind === 'concept' ? 3 : 1}+f:!50`,
          fid: period === 'today' ? 'f62' : period === '5d' ? 'f164' : 'f174',
          fields: 'f12,f14,f3,f62,f184,f109,f164,f165,f160,f174,f175,f124',
        },
        s,
      );
      const items = diff(data.diff)
        .filter((r) => /^BK\d{4,6}$/.test(text(r.f12)))
        .map((r) => parseBoardFlow(r, kind, period));
      const total = num(data.total);
      if (total == null || (!items.length && total > (page - 1) * 50))
        throw new Error('板块资金分页数据异常。');
      const timestamp = num(diff(data.diff)[0]?.f124);
      return {
        items,
        total,
        page,
        pages: Math.ceil(total / 50),
        date: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
      };
    },
    signal,
  );
}

type DataPage = { rows: Raw[]; count: number; pages: number };
export function parseDatacenter(payload: unknown): DataPage {
  const root = object(payload);
  // A documented empty result is distinct from an outage / invalid report.
  if (Number(root.code) === 9201 && root.message === '返回数据为空')
    return { rows: [], count: 0, pages: 0 };
  const result = object(root.result);
  if (
    root.success !== true ||
    !Array.isArray(result.data) ||
    num(result.count) == null
  )
    throw new Error('数据源未返回有效列表。');
  return {
    rows: array(result.data).map(object),
    count: num(result.count)!,
    pages: num(result.pages) ?? 1,
  };
}

async function datacenter(
  reportName: string,
  filter: string,
  page: number,
  sortColumns: string,
  sortTypes: string,
  signal: AbortSignal,
  pageSize = 50,
) {
  return parseDatacenter(
    await eastmoneyJson(
      `https://datacenter-web.eastmoney.com/api/data/v1/get?${new URLSearchParams({ reportName, columns: 'ALL', filter, pageNumber: String(page), pageSize: String(pageSize), sortColumns, sortTypes, source: 'WEB', client: 'WEB' })}`,
      { headers: EM_HEADER, signal },
      8_000,
    ),
  );
}

export function parseDragon(row: Raw): DragonRecord | null {
  try {
    const symbol = rowSymbol(row),
      date = sourceDate(row.TRADE_DATE),
      reason = text(row.EXPLANATION);
    if (!date || !text(row.SECURITY_NAME_ABBR)) return null;
    return {
      id: `${symbol}:${date}:${text(row.TRADE_ID) || reason}`,
      symbol,
      name: text(row.SECURITY_NAME_ABBR),
      date,
      reason,
      percent: num(row.CHANGE_RATE),
      buy: num(row.BILLBOARD_BUY_AMT),
      sell: num(row.BILLBOARD_SELL_AMT),
      net: num(row.BILLBOARD_NET_AMT),
      amount: num(row.BILLBOARD_DEAL_AMT),
    };
  } catch {
    return null;
  }
}

export function getDragons(
  date: string,
  symbol: string,
  page: number,
  signal?: AbortSignal,
) {
  return cached<Paged<DragonRecord>>(
    `dragon:${date ? `exact:${date}` : `latest:${chinaDate()}`}:${symbol}:${page}`,
    30 * 60_000,
    '东方财富龙虎榜（交易所披露）',
    'https://data.eastmoney.com/stock/tradedetail.html',
    async (s) => {
      let actual = date;
      if (!actual && !symbol) {
        const newest = await datacenter(
          'RPT_DAILYBILLBOARD_DETAILSNEW',
          `(TRADE_DATE<='${chinaDate()}')(SECURITY_TYPE_CODE="058001001")`,
          1,
          'TRADE_DATE',
          '-1',
          s,
          1,
        );
        actual = sourceDate(newest.rows[0]?.TRADE_DATE);
        if (!actual) throw new Error('尚未查明最近披露日期。');
      }
      const filter =
        '(SECURITY_TYPE_CODE="058001001")' +
        (symbol ? `(SECURITY_CODE="${symbol.slice(2)}")` : '') +
        (actual
          ? `(TRADE_DATE='${actual}')`
          : `(TRADE_DATE>='${shiftDate(chinaDate(), -90)}')(TRADE_DATE<='${chinaDate()}')`);
      const data = await datacenter(
        'RPT_DAILYBILLBOARD_DETAILSNEW',
        filter,
        page,
        'TRADE_DATE,BILLBOARD_NET_AMT',
        '-1,-1',
        s,
      );
      return {
        items: data.rows.map(parseDragon).filter((x): x is DragonRecord => !!x),
        total: data.count,
        pages: data.pages,
        page,
        date: actual || undefined,
      };
    },
    signal,
  );
}

export function getDragonSeats(
  symbol: string,
  date: string,
  signal?: AbortSignal,
) {
  return cached<DragonSeat[]>(
    `seats:${symbol}:${date}`,
    86400_000,
    '东方财富龙虎榜席位',
    `https://data.eastmoney.com/stock/lhb,${date.replaceAll('-', '')},${symbol.slice(2)}.html`,
    async (s) => {
      const seats: DragonSeat[] = [];
      for (const side of ['buy', 'sell'] as const) {
        const data = await datacenter(
          `RPT_BILLBOARD_DAILYDETAILS${side.toUpperCase()}`,
          `(TRADE_DATE='${date}')(SECURITY_CODE="${symbol.slice(2)}")`,
          1,
          side.toUpperCase(),
          '-1',
          s,
          50,
        );
        if (data.pages > 1) throw new Error('席位记录未完整返回，请查看来源。');
        for (const row of data.rows)
          seats.push({
            name: text(row.OPERATEDEPT_NAME),
            side,
            rank: num(row.RANK),
            buy: num(row.BUY),
            sell: num(row.SELL),
            reason: text(row.EXPLANATION),
          });
      }
      return seats;
    },
    signal,
  );
}

export function parseUnlock(row: Raw): UnlockRecord | null {
  try {
    const symbol = rowSymbol(row),
      date = sourceDate(row.FREE_DATE),
      shareType = text(row.FREE_SHARES_TYPE);
    if (!date || !text(row.SECURITY_NAME_ABBR)) return null;
    // FREE_SHARES is post-unlock float; FREE_RATIO uses pre-unlock float.
    // Neither is the current batch quantity / total-share ratio.
    const shares = num(row.CURRENT_FREE_SHARES);
    const ratio = num(row.TOTAL_RATIO) ?? num(row.TOTALSHARES_RATIO);
    return {
      id: `${symbol}:${date}:${shareType}`,
      symbol,
      name: text(row.SECURITY_NAME_ABBR),
      date,
      shareType,
      shares: shares == null ? null : shares * 10_000,
      totalRatio: ratio == null ? null : ratio * 100,
    };
  } catch {
    return null;
  }
}

export function getUnlocks(
  start: string,
  end: string,
  symbols: string[],
  page: number,
  signal?: AbortSignal,
  onlyWatchlist = false,
) {
  const codes = [...new Set(symbols.map((x) => x.slice(2)))].sort();
  return cached<Paged<UnlockRecord>>(
    `unlocks:${start}:${end}:${codes.join(',')}:${onlyWatchlist}:${page}`,
    6 * 3600_000,
    '东方财富限售股解禁',
    'https://data.eastmoney.com/dxf/default.html',
    async (s) => {
      if (onlyWatchlist && !codes.length)
        return { items: [], page, pages: 0, total: 0 };
      const filter =
        `(FREE_DATE>='${start}')(FREE_DATE<='${end}')` +
        (codes.length
          ? `(SECURITY_CODE in (${codes.map((c) => `"${c}"`).join(',')}))`
          : '');
      const data = await datacenter(
        'RPT_LIFT_STAGE',
        filter,
        page,
        'FREE_DATE,SECURITY_CODE',
        '1,1',
        s,
      );
      return {
        items: data.rows.map(parseUnlock).filter((x): x is UnlockRecord => !!x),
        total: data.count,
        pages: data.pages,
        page,
      };
    },
    signal,
  );
}

class NorthboundUnpublished extends Error {}

export function parseNorthbound(
  raw: string,
  requestedDate: string,
): NorthboundData {
  const match = raw
    .replace(/^\uFEFF/, '')
    .trim()
    .match(/^tabData\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) throw new Error('港交所日统计格式变化。');
  const markets = array(JSON.parse(match[1]))
    .map(object)
    .filter((r) =>
      ['SSE Northbound', 'SZSE Northbound'].includes(text(r.market)),
    )
    .map((row) => {
      if (sourceDate(row.date) !== requestedDate)
        throw new Error('港交所返回日期或交易日状态不符。');
      if (Number(row.tradingDay) === 0)
        throw new NorthboundUnpublished('该日不是北向交易日。');
      if (Number(row.tradingDay) !== 1)
        throw new Error('港交所交易日状态不明。');
      const tables = array(row.content).map((x) => object(object(x).table));
      const table = tables.find((x) => x.classname === 'tradingTable') || {},
        schema = array(array(table.schema)[0]).map(text);
      const values = array(table.tr).map(
        (r) => array(array(object(r).td)[0])[0],
      );
      const metric = (name: string) => num(values[schema.indexOf(name)]);
      const turnover = metric('Total Turnover'),
        etf = metric('ETF Turnover');
      const topTable = tables.find((x) => x.classname === 'top10Table') || {},
        topSchema = array(array(topTable.schema)[0]).map(text);
      return {
        name: text(row.market) === 'SSE Northbound' ? '沪股通' : '深股通',
        turnover: turnover == null ? null : turnover * 1e6,
        trades: metric('Total Trade Count'),
        etfTurnover: etf == null ? null : etf * 1e6,
        top: array(topTable.tr).flatMap((r) => {
          const v = array(array(object(r).td)[0]);
          const code = text(v[topSchema.indexOf('Stock Code')]).padStart(
            6,
            '0',
          );
          return /^\d{6}$/.test(code)
            ? [
                {
                  code,
                  name: text(v[topSchema.indexOf('Stock Name')]),
                  turnover: num(v[topSchema.indexOf('Total Turnover')]),
                },
              ]
            : [];
        }),
      };
    });
  if (
    markets.length !== 2 ||
    new Set(markets.map((m) => m.name)).size !== 2 ||
    markets.some((m) => m.turnover == null)
  )
    throw new Error('该日北向交易统计尚未完整披露。');
  return { date: requestedDate, markets };
}

export function getNorthbound(date: string, signal?: AbortSignal) {
  return cached<NorthboundData>(
    `north:${date ? `exact:${date}` : `latest:${chinaDate()}`}`,
    30 * 60_000,
    '香港交易所',
    'https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily?sc_lang=zh-HK',
    async (s) => {
      // Request explicit dates exactly; the default searches recent published days.
      const candidates = date
        ? [date]
        : Array.from({ length: 12 }, (_, i) =>
            shiftDate(chinaDate(), -i),
          ).filter(
            (d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()),
          );
      for (const day of candidates) {
        s.throwIfAborted();
        const url = `https://www.hkex.com.hk/chi/csm/DailyStat/data_tab_daily_${day.replaceAll('-', '')}c.js`;
        try {
          const response = await fetchWithTimeout(
            url,
            { headers: EM_HEADER, signal: s },
            4_000,
          );
          if (response.status === 404) {
            await response.body?.cancel();
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error('港交所暂不可达。');
          }
          return parseNorthbound(await response.text(), day);
        } catch (error) {
          // Only a known unpublished/non-trading day permits moving backward.
          // Transport, rate-limit and parsing failures must use the stale cache.
          if (date || s.aborted || !(error instanceof NorthboundUnpublished))
            throw error;
        }
      }
      throw new Error('近期北向成交统计暂未取得，请查看港交所原始披露。');
    },
    signal,
  );
}

export { HOLDINGS_URL, EM_SOURCE };

export function parseNorthboundHoldings(
  html: string,
  market: 'sh' | 'sz',
): HoldingsData {
  const heading =
    html.match(
      /<h2\b[^>]*class=["'][^"']*ccass-heading[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i,
    )?.[1] || '';
  const date = stripHtml(heading)
    .match(/Shareholding Date:\s*(\d{4}\/\d{2}\/\d{2})/i)?.[1]
    ?.replaceAll('/', '-');
  const table = html.match(
    /<table\b[^>]*id=["']mutualmarket-result["'][^>]*>([\s\S]*?)<\/table>/i,
  )?.[1];
  if (!date || !table) throw new Error('港交所持仓页面结构变化。');
  checkedDate(date);
  const items = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(
    (match) => {
      const cell = (cls: string) => {
        const td =
          [
            ...match[1].matchAll(
              /<td\b[^>]*class=["']([^"']*)["'][^>]*>([\s\S]*?)<\/td>/gi,
            ),
          ].find((cellMatch) => cellMatch[1].split(/\s+/).includes(cls))?.[2] ||
          '';
        return stripHtml(
          td.match(
            /<div\b[^>]*class=["'][^"']*mobile-list-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
          )?.[1] || '',
        );
      };
      const name = cell('col-stock-name'),
        code = name.match(/\(A\s*#(\d{6})\)/)?.[1];
      if (!code) return [];
      // HKEX also includes northbound ETFs with an A # code; this table is
      // explicitly A-share holdings, whose denominator differs from ETF units.
      try {
        if (stockSignalSymbol(code) !== `${market}${code}`) return [];
      } catch {
        return [];
      }
      return [
        {
          code,
          name: name.replace(/\s*\(A\s*#\d{6}\)/, ''),
          shares: num(cell('col-shareholding')),
          percent: num(cell('col-shareholding-percent').replace('%', '')),
        },
      ];
    },
  );
  if (!items.length) throw new Error('尚未取得可识别的 A 股季度持仓。');
  return { date, market, items };
}

export function getNorthboundHoldings(
  market: 'sh' | 'sz',
  signal?: AbortSignal,
) {
  const url = `${HOLDINGS_URL}${market}`;
  return cached<HoldingsData>(
    `holdings:stocks:${market}`,
    6 * 3600_000,
    '香港交易所季度持仓',
    url,
    async (s) => {
      const response = await fetchWithTimeout(
        url,
        { headers: EM_HEADER, signal: s },
        12_000,
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('持仓来源暂不可达。');
      }
      return parseNorthboundHoldings(await response.text(), market);
    },
    signal,
  );
}

export function parseSignalEvidence(
  payload: unknown,
  symbol: string,
): SignalEvidence[] {
  const root = object(payload),
    data = object(root.data);
  if (Number(root.success) !== 1 || !Array.isArray(data.list))
    throw new Error('公告源未返回有效结果。');
  return array(data.list)
    .map(object)
    .flatMap((r) => {
      if (
        !array(r.codes).some(
          (c) => text(object(c).stock_code) === symbol.slice(2),
        )
      )
        return [];
      const id = text(r.art_code),
        title = text(r.title),
        date = sourceDate(r.display_time) || sourceDate(r.notice_date);
      return /^AN\d{12,24}$/.test(id) && title && date
        ? [
            {
              title,
              date,
              url: `https://data.eastmoney.com/notices/detail/${symbol.slice(2)}/${id}.html`,
            },
          ]
        : [];
    });
}

export function getSignalEvidence(symbol: string, signal?: AbortSignal) {
  return cached<SignalEvidence[]>(
    `evidence:${symbol}`,
    30 * 60_000,
    '东方财富公司公告',
    `https://data.eastmoney.com/notices/stock/${symbol.slice(2)}.html`,
    async (s) => {
      const params = new URLSearchParams({
        sr: '-1',
        page_size: '10',
        page_index: '1',
        ann_type: 'A',
        client_source: 'web',
        stock_list: symbol.slice(2),
        f_node: '0',
        s_node: '0',
      });
      return parseSignalEvidence(
        await eastmoneyJson(
          `https://np-anotice-stock.eastmoney.com/api/security/ann?${params}`,
          { headers: EM_HEADER, signal: s },
          8_000,
        ),
        symbol,
      );
    },
    signal,
  );
}
