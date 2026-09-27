import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { listingAStockIdentity } from '@/lib/a-stock-ticker';
import { historyWindow } from '@/lib/company-history-metrics';
import {
  sourceDay,
  sourceNumber,
  strictDatacenter,
  uniqueRows,
  type SourceRow,
} from '@/lib/source-validation';
import type { ListingOption } from '@/lib/market-listings';
import type { ValuationHistory } from '@/lib/research-history';
import {
  researchSourceFailure,
  retryResearchSourceOnce,
} from '@/lib/research-source-status';

export function valuationRows(
  rows: SourceRow[],
  secucode: string,
  from: string,
  to: string,
): ValuationHistory['rows'] {
  return uniqueRows(
    rows.map((r) => {
      if (r.SECUCODE !== secucode || r.SECURITY_CODE !== secucode.split('.')[0])
        throw new Error('历史估值证券不匹配');
      const date = sourceDay(r.TRADE_DATE);
      if (date < from || date > to) throw new Error('历史估值日期越界');
      if (
        !['PE_TTM', 'PB_MRQ', 'PS_TTM', 'TOTAL_MARKET_CAP'].some(
          (key) => key in r,
        )
      )
        throw new Error('历史估值字段全部缺失，来源结构异常');
      return {
        date,
        pe: sourceNumber(r.PE_TTM),
        pb: sourceNumber(r.PB_MRQ),
        ps: sourceNumber(r.PS_TTM),
        marketCap: sourceNumber(r.TOTAL_MARKET_CAP),
      };
    }),
    (r) => r.date,
  ).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getResearchValuationHistory(
  listing: ListingOption,
  signal?: AbortSignal,
): Promise<ValuationHistory | undefined> {
  const identity = listingAStockIdentity(listing);
  if (!identity) return undefined;
  const secucode = `${identity.code}.${identity.market}`;
  const { to } = historyWindow();
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  const from = start.toISOString().slice(0, 10);
  const sourceUrl = `https://data.eastmoney.com/gzfx/detail/${identity.code}.html`;
  let failure: unknown;
  try {
    const snapshot = await cachedMarketSignal(
      `research-valuation:v2:${secucode}`,
      86400_000,
      '东方财富历史估值',
      sourceUrl,
      async (s) => {
        const rows: SourceRow[] = [],
          rawUrls: string[] = [];
        let expected = -1;
        for (let page = 1; page <= 3; page++) {
          const response = await retryResearchSourceOnce(
            () =>
              strictDatacenter({
                report: 'RPT_VALUEANALYSIS_DET',
                sort: 'TRADE_DATE',
                order: '-1',
                filter: `(SECUCODE="${secucode}")(TRADE_DATE>='${from}')(TRADE_DATE<='${to}')`,
                page,
                pageSize: 500,
                signal: s,
                equal: { SECUCODE: secucode },
                dateField: 'TRADE_DATE',
                start: from,
                end: to,
              }),
            s,
          );
          if (expected >= 0 && expected !== response.total)
            throw new Error('估值分页期间总数改变');
          expected = response.total;
          rows.push(...response.rows);
          rawUrls.push(response.url);
          if (rows.length === expected) break;
        }
        if (!rows.length) throw new Error('来源无历史记录');
        if (rows.length !== expected) throw new Error('历史估值分页不完整');
        const parsed = valuationRows(rows, secucode, from, to);
        if (
          !parsed.some((row) =>
            [row.pe, row.pb, row.ps, row.marketCap].some(
              (value) => value !== null,
            ),
          )
        )
          throw new Error('历史估值数值全部为空，未取得可核验指标');
        const labels = {
          pe: 'PE',
          pb: 'PB',
          ps: 'PS',
          marketCap: '市值',
        } as const;
        return {
          from,
          to,
          sourceUrl,
          rawUrls,
          rows: parsed,
          notices: Object.entries(labels).flatMap(([key, label]) => {
            const missing = parsed.filter(
              (r) => r[key as keyof typeof labels] === null,
            ).length;
            return missing
              ? [
                  `历史${label}有${missing}/${parsed.length}条源侧空值或缺少字段，保留其他指标，不以零补齐。`,
                ]
              : [];
          }),
        };
      },
      signal,
      25_000,
    );
    return {
      ...snapshot.data,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
      notices: [
        ...(snapshot.data.notices || []),
        ...(snapshot.stale
          ? ['历史估值本轮刷新失败或处于冷却，保留上次成功快照及实际日期。']
          : []),
      ],
    };
  } catch (error) {
    signal?.throwIfAborted();
    failure = error;
  }
  return {
    from,
    to,
    sourceUrl,
    rawUrls: [],
    rows: [],
    fetchedAt: new Date().toISOString(),
    stale: false,
    notices: [
      `历史估值：${researchSourceFailure(failure)}；本轮未获得可核验序列，不能据此认定未披露，也不以当前报价回填。`,
    ],
  };
}
