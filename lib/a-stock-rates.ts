import { fetchJson, fetchWithTimeout, stripHtml } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { chinaDate, shiftDate } from '@/lib/signal-types';
import {
  sourceObject,
  sourceDay,
  sourceNumber,
  uniqueRows,
  strictDatacenter,
} from '@/lib/source-validation';
import type { DataTable, DataCell } from '@/lib/market-extension-types';

export type MacroKind = 'lpr' | 'fr' | 'fdr' | 'curve' | 'calendar';
const names = {
  lpr: 'LPR 贷款市场报价利率',
  fr: 'FR 回购定盘利率',
  fdr: 'FDR 银银间回购定盘利率',
  curve: '中债收益率曲线',
  calendar: '宏观日历',
};
const urls = {
  lpr: 'https://data.eastmoney.com/cjsj/globalRateLPR.html',
  fr: 'https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/frr-chrt.csv',
  fdr: 'https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/fdr-chrt.csv',
  curve: 'https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyQuery',
  calendar: 'https://api-one-wscn.awtmt.com/apiv1/finance/macrodatas',
};
const headers = { 'User-Agent': 'Mozilla/5.0' };
export function parseFixingCsv(text: string, kind: 'FR' | 'FDR') {
  const rows = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const p = line.split(',');
      if (p.length !== 9 || p.slice(1, 6).some((x) => x.trim()))
        throw new Error('回购定盘利率 CSV 格式改变');
      return {
        date: sourceDay(p[0]),
        [`${kind}001`]: sourceNumber(p[6], true),
        [`${kind}007`]: sourceNumber(p[7], true),
        [`${kind}014`]: sourceNumber(p[8], true),
      };
    });
  return uniqueRows(rows, (r) => r.date).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}
export function parseYieldCurve(html: string, start: string, end: string) {
  const tables = html.replace(/<!--[\s\S]*?-->/g, '').split('<table');
  const cells = [
    ...(tables.at(-1) ?? '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g),
  ].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      stripHtml(c[1]).replace(/\s+/g, ''),
    ),
  );
  if (cells[0]?.join('|') !== '曲线名称|日期|3月|6月|1年|3年|5年|7年|10年|30年')
    throw new Error('中债收益率表头发生变化');
  const wanted = [
    '中债国债收益率曲线',
    '中债商业银行普通债收益率曲线(AAA)',
    '中债中短期票据收益率曲线(AAA)',
  ];
  const rows = cells.slice(1).map((p) => {
    if (p.length !== 10 || !wanted.includes(p[0]))
      throw new Error('中债收益率曲线字段异常');
    const date = sourceDay(p[1]);
    if (date < start || date > end) throw new Error('中债收益率日期错位');
    return {
      date,
      curve: p[0],
      ...Object.fromEntries(
        ['3m', '6m', '1y', '3y', '5y', '7y', '10y', '30y'].map((k, i) => [
          k,
          sourceNumber(p[i + 2], !(k === '30y' && p[0] === wanted[2])),
        ]),
      ),
    };
  });
  if (!rows.length) throw new Error('中债收益率尚未返回有效数据');
  uniqueRows(rows, (r) => r.date + r.curve);
  for (const day of new Set(rows.map((r) => r.date)))
    if (rows.filter((r) => r.date === day).length !== 3)
      throw new Error('中债当日曲线不完整');
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
export async function getMacroExtension(kind: MacroKind, signal?: AbortSignal) {
  const today = chinaDate();
  return cachedMarketSignal(
    `macro:v39:${kind}:${today}`,
    kind === 'calendar' ? 15 * 60_000 : 60 * 60_000,
    names[kind],
    urls[kind],
    async (abort) => {
      let columns: DataTable['columns'],
        rows: DataTable['rows'],
        coverage: string;
      if (kind === 'fr' || kind === 'fdr') {
        const response = await fetchWithTimeout(
          urls[kind],
          {
            headers: { ...headers, Referer: 'https://www.chinamoney.com.cn/' },
            signal: abort,
          },
          9000,
        );
        if (!response.ok) throw new Error('中国货币网暂不可用');
        const prefix = kind.toUpperCase() as 'FR' | 'FDR';
        rows = parseFixingCsv(await response.text(), prefix).slice(0, 30);
        columns = [
          { key: 'date', label: '统计日期' },
          ...['001', '007', '014'].map((k) => ({
            key: prefix + k,
            label: `${prefix + k}（%）`,
          })),
        ];
        coverage =
          '最近 30 个已公布统计日；中国货币网官方定盘利率，不是盘中成交利率。';
      } else if (kind === 'lpr') {
        const result = await strictDatacenter({
          report: 'RPTA_WEB_RATE',
          sort: 'TRADE_DATE',
          order: '-1',
          pageSize: 36,
          signal: abort,
        });
        rows = result.rows
          .filter((r) => r.LPR1Y != null)
          .map((r) => ({
            date: sourceDay(r.TRADE_DATE),
            one: sourceNumber(r.LPR1Y, true),
            five: sourceNumber(r.LPR5Y),
          }));
        if (!rows.length) throw new Error('未获得有效 LPR 数据');
        uniqueRows(rows, (r) => String(r.date));
        columns = [
          { key: 'date', label: '发布日期' },
          { key: 'one', label: '1 年期（%）' },
          { key: 'five', label: '5 年期以上（%）' },
        ];
        coverage = '最近 36 条来源记录中的 LPR 报价，旧贷款基准利率已剔除。';
      } else if (kind === 'curve') {
        const start = shiftDate(today, -14),
          url = new URL(urls.curve);
        url.search = new URLSearchParams({
          startDate: start,
          endDate: today,
          gjqx: '0',
          qxId: 'ycqx',
          locale: 'cn_ZH',
        }).toString();
        const response = await fetchWithTimeout(
          url,
          { headers, signal: abort },
          9000,
        );
        if (!response.ok) throw new Error('中债收益率源暂不可用');
        rows = parseYieldCurve(await response.text(), start, today);
        columns = [
          { key: 'date', label: '统计日期' },
          { key: 'curve', label: '曲线' },
          ...['3m', '6m', '1y', '3y', '5y', '7y', '10y', '30y'].map((key) => ({
            key,
            label: key.replace('m', '月').replace('y', '年') + '（%）',
          })),
        ];
        coverage =
          '近 14 天已公布曲线；中短票无 30 年期限。源不提供日历，不能保证逐交易日完整。';
      } else {
        const start = shiftDate(today, -3),
          end = shiftDate(today, 3),
          url = new URL(urls.calendar);
        const begin = Date.parse(start + 'T00:00:00+08:00') / 1000,
          finish = Date.parse(end + 'T23:59:59+08:00') / 1000;
        url.search = new URLSearchParams({
          start: String(begin),
          end: String(finish),
        }).toString();
        const payload = sourceObject(
          await fetchJson(url, { headers, signal: abort }, 9000),
        );
        if (payload.code !== 20000) throw new Error('宏观日历源暂不可用');
        const items = sourceObject(payload.data).items;
        if (!Array.isArray(items) || !items.length)
          throw new Error('宏观日历整周数据为空或结构改变');
        rows = items.map((value) => {
          const r = sourceObject(value),
            stamp = sourceNumber(r.public_date, true)!,
            importance = sourceNumber(r.importance, true)!;
          if (
            stamp < begin ||
            stamp > finish ||
            ![1, 2, 3, 4].includes(importance) ||
            r.id == null
          )
            throw new Error('宏观日历日期或重要度异常');
          const cell = (v: unknown): DataCell =>
            v == null || v === '' ? null : stripHtml(String(v));
          return {
            id: String(r.id),
            date: new Date((stamp + 8 * 3600) * 1000)
              .toISOString()
              .slice(0, 16)
              .replace('T', ' '),
            country: cell(r.country),
            title: cell(r.title),
            importance,
            actual: cell(r.actual),
            forecast: cell(r.forecast),
            previous: cell(r.previous),
            unit: cell(r.unit),
          };
        });
        uniqueRows(rows, (r) => String(r.id));
        columns = [
          { key: 'date', label: '北京时间' },
          { key: 'country', label: '国家/地区' },
          { key: 'title', label: '事件/数据' },
          { key: 'actual', label: '公布值' },
          { key: 'forecast', label: '预期值' },
          { key: 'previous', label: '前值' },
          { key: 'unit', label: '单位' },
        ];
        coverage =
          '华尔街见闻：过去 3 天至未来 3 天；预期值不是公布值，未公布保持为空。';
      }
      return {
        columns,
        rows,
        total: rows.length,
        page: 1,
        pages: 1,
        coverage,
      } satisfies DataTable;
    },
    signal,
  );
}
