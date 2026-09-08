import { fetchJson, fetchWithTimeout } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import { chinaDate, shiftDate, type SignalSnapshot } from '@/lib/signal-types';
import { MARKET_INDICES, normalizeQuoteSymbol } from '@/lib/quote-types';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';
import {
  officialCode,
  officialDate,
  officialNumber,
  officialText,
  parseTradingCalendar,
  tradingSession,
  type CompanyMargin,
  type IndexComposition,
  type IndexMember,
  type IndexValuation,
  type MarginData,
  type TradingSession,
  type TradingDay,
} from '@/lib/official-data-types';

type Row = Record<string, unknown>;
const headers = (referer: string) => ({
  'User-Agent': 'Mozilla/5.0',
  Referer: referer,
});
const DAY = 86400_000;

// Only fixed official URLs reach this parser. Both BIFF XLS and ZIP XLSX are used.
export async function officialWorkbook(
  url: string,
  referer: string,
  signal?: AbortSignal,
) {
  const response = await fetchWithTimeout(
    url,
    { headers: headers(referer), signal },
    7_000,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`官方文件暂不可用（${response.status}）。`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('官方文件为空。');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) throw new Error('官方文件超过安全读取上限。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const ole = [0xd0, 0xcf, 0x11, 0xe0].every((v, i) => bytes[i] === v);
  if (!ole && !(bytes[0] === 0x50 && bytes[1] === 0x4b))
    throw new Error('官方接口未返回有效的 Excel 文件。');
  signal?.throwIfAborted();
  const { read, utils } = await import('xlsx');
  const workbook = read(bytes, {
    type: 'array',
    sheetRows: 6002,
    cellFormula: false,
    cellHTML: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('官方工作表为空。');
  const rows = utils.sheet_to_json<Row>(sheet, { defval: null, raw: false });
  if (!rows.length || rows.length > 6000)
    throw new Error('官方明细尚未发布或超出完整读取上限。');
  return {
    name: workbook.SheetNames[0],
    rows: rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/\s/g, ''),
          value,
        ]),
      ),
    ),
  };
}
function required(row: Row, columns: string[]) {
  if (columns.some((key) => !(key in row)))
    throw new Error('官方文件字段发生变化，已停止展示。');
}
function singleDate(dates: string[]) {
  if (new Set(dates).size !== 1) throw new Error('官方文件包含混合日期。');
  return dates[0];
}
function checkItems(items: IndexMember[], weights: boolean) {
  if (
    !items.length ||
    new Set(items.map((r) => `${r.exchange}${r.code}`)).size !== items.length
  )
    throw new Error('指数成分为空或重复。');
  if (weights) {
    if (items.some((r) => r.weight === null || r.weight < 0 || r.weight > 100))
      throw new Error('指数权重无效。');
    const sum = items.reduce((s, r) => s + r.weight!, 0);
    if (sum < 99 || sum > 101)
      throw new Error('指数权重合计异常，可能未取全。');
  }
}
export function parseIndexComposition(
  rows: Row[],
  code: string,
  provider: 'CSI' | 'CNI',
  weights: boolean,
): IndexComposition {
  const dates: string[] = [];
  const items = rows.map((row): IndexMember => {
    const csi = provider === 'CSI';
    required(
      row,
      csi
        ? [
            '日期Date',
            '指数代码IndexCode',
            '成份券代码ConstituentCode',
            '成份券名称ConstituentName',
            '交易所Exchange',
          ]
        : ['日期', '样本代码', '样本简称'],
    );
    if (csi && officialCode(row['指数代码IndexCode']) !== code)
      throw new Error('官方文件指数身份不匹配。');
    dates.push(officialDate(row[csi ? '日期Date' : '日期']));
    const constituent = officialCode(
      row[csi ? '成份券代码ConstituentCode' : '样本代码'],
    );
    const exchangeText = officialText(row['交易所Exchange']);
    const exchange = csi
      ? /上海/.test(exchangeText)
        ? 'SH'
        : /深圳/.test(exchangeText)
          ? 'SZ'
          : /北京/.test(exchangeText)
            ? 'BJ'
            : null
      : constituent.startsWith('6')
        ? 'SH'
        : /^[03]/.test(constituent)
          ? 'SZ'
          : /^(4|8|92)/.test(constituent)
            ? 'BJ'
            : null;
    const name = officialText(
      row[csi ? '成份券名称ConstituentName' : '样本简称'],
    );
    if (!exchange || !name) throw new Error('指数成分名称或交易所缺失。');
    const weightKey = csi ? '权重(%)weight' : '权重（%）';
    if (weights) required(row, [weightKey]);
    return {
      code: constituent,
      name,
      exchange,
      weight: weights ? officialNumber(row[weightKey]) : null,
    };
  });
  checkItems(items, weights);
  return { date: singleDate(dates), items };
}
export function parseIndexValuation(rows: Row[], code: string): IndexValuation {
  const values = rows.map((row) => {
    required(row, [
      '日期Date',
      '指数代码IndexCode',
      '市盈率1（总股本）P/E1',
      '市盈率2（计算用股本）P/E2',
      '股息率1（总股本）D/P1',
      '股息率2（计算用股本）D/P2',
    ]);
    if (officialCode(row['指数代码IndexCode']) !== code)
      throw new Error('估值文件指数身份不匹配。');
    return {
      date: officialDate(row['日期Date']),
      peTotal: officialNumber(row['市盈率1（总股本）P/E1']),
      peCalculation: officialNumber(row['市盈率2（计算用股本）P/E2']),
      dividendYieldTotalPercent: officialNumber(row['股息率1（总股本）D/P1']),
      dividendYieldCalculationPercent: officialNumber(
        row['股息率2（计算用股本）D/P2'],
      ),
    };
  });
  if (
    !values.length ||
    new Set(values.map((v) => v.date)).size !== values.length
  )
    throw new Error('指数估值日期为空或重复。');
  return values.sort((a, b) => b.date.localeCompare(a.date))[0];
}
export type OfficialIndexDetail = {
  symbol: string;
  members: SignalSnapshot<IndexComposition> | null;
  weights: SignalSnapshot<IndexComposition> | null;
  valuation: SignalSnapshot<IndexValuation> | null;
  warnings: string[];
};
export async function getOfficialIndexDetail(
  symbol: string,
  signal?: AbortSignal,
): Promise<OfficialIndexDetail> {
  if (!MARKET_INDICES.some((index) => index.symbol === symbol))
    throw new Error('暂不支持该指数的官方明细。');
  const code = symbol.slice(2);
  const result: OfficialIndexDetail = {
    symbol,
    members: null,
    weights: null,
    valuation: null,
    warnings: [],
  };
  if (symbol.startsWith('sz')) {
    const url = `https://www.cnindex.com.cn/sample-detail/download-history?indexcode=${code}`;
    try {
      const snapshot = await cachedMarketSignal(
        `official:cni:${code}`,
        12 * 3600_000,
        '国证指数',
        url,
        async (s) => {
          const file = await officialWorkbook(
            url,
            'https://www.cnindex.com.cn/',
            s,
          );
          if (!file.name.includes(code))
            throw new Error('国证文件指数身份不匹配。');
          return parseIndexComposition(file.rows, code, 'CNI', true);
        },
        signal,
        10_000,
      );
      result.members = result.weights = snapshot;
    } catch {
      result.warnings.push('国证指数成分及权重暂不可用。');
    }
    result.warnings.push(
      '该官方接口未提供此指数的 PE／股息率，不以其他指数代替。',
    );
  } else {
    await Promise.all(
      (['cons', 'closeweight', 'indicator'] as const).map(async (kind) => {
        const url = `https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/${kind}/${code}${kind}.xls`;
        try {
          if (kind === 'indicator')
            result.valuation = await cachedMarketSignal(
              `official:csi:${code}:${kind}`,
              6 * 3600_000,
              '中证指数',
              url,
              async (s) =>
                parseIndexValuation(
                  (
                    await officialWorkbook(
                      url,
                      'https://www.csindex.com.cn/',
                      s,
                    )
                  ).rows,
                  code,
                ),
              signal,
              10_000,
            );
          else {
            const value = await cachedMarketSignal(
              `official:csi:${code}:${kind}`,
              12 * 3600_000,
              '中证指数',
              url,
              async (s) =>
                parseIndexComposition(
                  (
                    await officialWorkbook(
                      url,
                      'https://www.csindex.com.cn/',
                      s,
                    )
                  ).rows,
                  code,
                  'CSI',
                  kind === 'closeweight',
                ),
              signal,
              10_000,
            );
            if (kind === 'cons') result.members = value;
            else result.weights = value;
          }
        } catch {
          result.warnings.push(
            `${kind === 'cons' ? '指数成分' : kind === 'closeweight' ? '指数权重' : '指数估值'}官方文件暂不可用。`,
          );
        }
      }),
    );
  }
  if (!result.members && !result.weights && !result.valuation)
    throw new Error(result.warnings.join(' '));
  return result;
}

export async function getTradingSession(
  signal?: AbortSignal,
  now = new Date(),
): Promise<TradingSession> {
  const deadline = requestDeadline(5_000, signal);
  const today = chinaDate(now);
  const months = [
    today.slice(0, 7),
    shiftDate(`${today.slice(0, 7)}-01`, -1).slice(0, 7),
  ];
  try {
    const snapshots = await abortable(
      Promise.all(
        months.map((month) => {
          const url = `https://www.szse.cn/api/report/exchange/onepersistenthour/monthList?month=${Number(month.slice(0, 4))}-${Number(month.slice(5))}`;
          return cachedMarketSignal(
            `official:calendar:${month}`,
            12 * 3600_000,
            '深圳证券交易所',
            url,
            async (s) =>
              parseTradingCalendar(
                await fetchJson(
                  url,
                  { headers: headers('https://www.szse.cn/'), signal: s },
                  4_000,
                ),
                month,
              ),
            deadline.signal,
            5_000,
          );
        }),
      ),
      deadline.signal,
    );
    if (snapshots.some((snapshot) => snapshot.stale))
      throw new Error('日历缓存失效');
    return tradingSession(
      snapshots.flatMap((snapshot) => snapshot.data),
      now,
    );
  } catch {
    return tradingSession([], now);
  } finally {
    deadline.dispose();
  }
}

// Quote paths can verify dates without adding a calendar HTTP request to every
// quote. The visible-page calendar endpoint populates these same D1 snapshots.
export async function getCachedTradingSession(
  signal?: AbortSignal,
  now = new Date(),
) {
  const deadline = requestDeadline(600, signal);
  const today = chinaDate(now);
  const months = [
    today.slice(0, 7),
    shiftDate(`${today.slice(0, 7)}-01`, -1).slice(0, 7),
  ];
  try {
    const snapshots = await abortable(
      Promise.all(
        months.map((month) =>
          readDataSnapshot<TradingDay[]>(
            `signals:v1:official:calendar:${month}`,
          ),
        ),
      ),
      deadline.signal,
    );
    return tradingSession(
      snapshots.every((s) => s && !s.stale)
        ? snapshots.flatMap((s) => s!.value)
        : [],
      now,
    );
  } catch {
    return tradingSession([], now);
  } finally {
    deadline.dispose();
  }
}

export function parseSseMargin(payload: unknown, date: string): MarginData {
  const root = payload as {
    pageHelp?: { data?: Row[]; total?: number | string };
  };
  const rows = root?.pageHelp?.data;
  const rawTotal = root?.pageHelp?.total;
  if (
    !(typeof rawTotal === 'number' && Number.isInteger(rawTotal)) &&
    !(typeof rawTotal === 'string' && /^\d+$/.test(rawTotal))
  )
    throw new Error('上交所两融分页总数无效。');
  const total = Number(rawTotal);
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    !Number.isInteger(total) ||
    total !== rows.length
  )
    throw new Error('上交所两融明细未发布或分页不完整。');
  const items = rows.map((row) => {
    required(row, [
      'opDate',
      'stockCode',
      'securityAbbr',
      'rzye',
      'rzmre',
      'rqyl',
      'rqmcl',
    ]);
    if (officialDate(row.opDate) !== date)
      throw new Error('上交所两融日期不匹配。');
    return {
      code: officialCode(row.stockCode),
      name: officialText(row.securityAbbr),
      marginBalance: officialNumber(row.rzye),
      marginBuy: officialNumber(row.rzmre),
      shortBalance: officialNumber(row.rqylje),
      shortVolume: officialNumber(row.rqyl),
      shortSellVolume: officialNumber(row.rqmcl),
    };
  });
  checkMargin(items, 'SH');
  return { date, market: 'SH', dateBasis: '来源逐行日期', items };
}
export function parseSzseMargin(rows: Row[], date: string): MarginData {
  const items = rows.map((row) => {
    required(row, [
      '证券代码',
      '证券简称',
      '融资余额(元)',
      '融资买入额(元)',
      '融券余额(元)',
      '融券余量(股/份)',
      '融券卖出量(股/份)',
    ]);
    return {
      code: officialCode(row['证券代码']),
      name: officialText(row['证券简称']),
      marginBalance: officialNumber(row['融资余额(元)']),
      marginBuy: officialNumber(row['融资买入额(元)']),
      shortBalance: officialNumber(row['融券余额(元)']),
      shortVolume: officialNumber(row['融券余量(股/份)']),
      shortSellVolume: officialNumber(row['融券卖出量(股/份)']),
    };
  });
  checkMargin(items, 'SZ');
  return {
    date: officialDate(date),
    market: 'SZ',
    dateBasis: '官方文件查询日期',
    items,
  };
}
function checkMargin(items: MarginData['items'], market: 'SH' | 'SZ') {
  if (!items.length || new Set(items.map((r) => r.code)).size !== items.length)
    throw new Error('两融明细为空或重复。');
  if (
    items.some(
      (row) =>
        !row.name ||
        !(market === 'SH' ? /^(5|6|900)/ : /^[0123]/).test(row.code) ||
        [
          row.marginBalance,
          row.marginBuy,
          row.shortBalance,
          row.shortVolume,
          row.shortSellVolume,
        ].some((v) => v !== null && v < 0),
    )
  )
    throw new Error('两融明细字段或交易所异常。');
}
function marginSnapshot(
  market: 'SH' | 'SZ',
  date: string,
  signal?: AbortSignal,
) {
  const url =
    market === 'SH'
      ? `https://query.sse.com.cn/marketdata/tradedata/queryMargin.do?isPagination=true&tabType=mxtype&detailsDate=${date.replaceAll('-', '')}&pageHelp.pageSize=5000&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.cacheSize=1&pageHelp.endPage=1`
      : `https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1837_xxpl&TABKEY=tab2&txtDate=${date}`;
  return cachedMarketSignal(
    `official:margin:${market}:${date}`,
    DAY,
    market === 'SH' ? '上海证券交易所' : '深圳证券交易所',
    url,
    async (s) =>
      market === 'SH'
        ? parseSseMargin(
            await fetchJson(
              url,
              { headers: headers('https://www.sse.com.cn/'), signal: s },
              6_000,
            ),
            date,
          )
        : parseSzseMargin(
            (await officialWorkbook(url, 'https://www.szse.cn/', s)).rows,
            date,
          ),
    signal,
    8_000,
  );
}
export async function getCompanyMargin(
  input: string,
  signal?: AbortSignal,
): Promise<SignalSnapshot<CompanyMargin>> {
  const symbol = normalizeQuoteSymbol(input);
  if (
    !/^(sh|sz)/.test(symbol) ||
    MARKET_INDICES.some((index) => index.symbol === symbol)
  )
    throw new Error('官方两融明细仅适用于沪深证券。');
  const deadline = requestDeadline(16_000, signal);
  try {
    const session = await getTradingSession(deadline.signal);
    if (!session.completedDates.length)
      throw new Error('交易日历不可用，无法核定两融查询日期。');
    const market = symbol.slice(0, 2).toUpperCase() as 'SH' | 'SZ';
    // At most three publication dates; never label a prior date as today's data.
    for (const date of session.completedDates.slice(0, 3)) {
      deadline.signal.throwIfAborted();
      try {
        const snapshot = await abortable(
          marginSnapshot(market, date, deadline.signal),
          deadline.signal,
        );
        const { items, ...metadata } = snapshot.data;
        return {
          ...snapshot,
          ...(date !== session.completedDates[0]
            ? {
                notice: `${snapshot.notice ? `${snapshot.notice} ` : ''}较近交易日明细本轮未取得，当前展示 ${date} 的已取得记录；不保证已取得最新披露。`,
              }
            : {}),
          data: {
            ...metadata,
            item: items.find((r) => r.code === symbol.slice(2)) ?? null,
          },
        };
      } catch {
        deadline.signal.throwIfAborted();
      }
    }
    throw new Error(
      '最近三个已结束交易日的官方两融明细暂不可用；不代表余额为零。',
    );
  } finally {
    deadline.dispose();
  }
}
