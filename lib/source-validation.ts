import { eastmoneyJson } from '@/lib/a-stock-http';
import { checkedDate } from '@/lib/signal-types';

export type SourceRow = Record<string, unknown>;
export function sourceObject(value: unknown): SourceRow {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('数据源返回结构异常');
  return value as SourceRow;
}
export function sourceNumber(value: unknown, required = false): number | null {
  if (
    value == null ||
    (typeof value === 'string' && ['', '-', '--'].includes(value.trim()))
  ) {
    if (required) throw new Error('数据源缺少必要数值');
    return null;
  }
  if (!['number', 'string'].includes(typeof value))
    throw new Error('数据源数值类型异常');
  const number = Number(String(value).replaceAll(',', ''));
  if (!Number.isFinite(number)) throw new Error('数据源数值无效');
  return number;
}
export function sourceCount(value: unknown) {
  const number = sourceNumber(value, true)!;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error('数据源分页总数异常');
  return number;
}
export function sourceDay(value: unknown) {
  return checkedDate(String(value ?? '').slice(0, 10));
}
export function uniqueRows<T>(rows: T[], key: (row: T) => string) {
  const keys = rows.map(key);
  if (keys.some((k) => !k) || new Set(keys).size !== keys.length)
    throw new Error('数据源记录缺少标识或存在重复，不能视为完整数据');
  return rows;
}

// Bounded pages, not a claim to have downloaded the entire upstream database.
export async function strictDatacenter(options: {
  report: string;
  sort: string;
  order: string;
  filter?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
  equal?: Record<string, string>;
  dateField?: string;
  start?: string;
  end?: string;
}) {
  const page = options.page ?? 1,
    size = options.pageSize ?? 30;
  const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
  url.search = new URLSearchParams({
    reportName: options.report,
    columns: 'ALL',
    filter: options.filter ?? '',
    sortColumns: options.sort,
    sortTypes: options.order,
    pageNumber: String(page),
    pageSize: String(size),
    source: 'WEB',
    client: 'WEB',
  }).toString();
  const data = sourceObject(
    await eastmoneyJson(
      url,
      {
        signal: options.signal,
        headers: { Referer: 'https://data.eastmoney.com/' },
      },
      9000,
    ),
  );
  if (data.success !== true || data.code !== 0) {
    // Eastmoney's explicit no-record code is distinct from malformed/null results.
    if (
      String(data.code) === '9201' &&
      options.filter &&
      /无|没有|not found/i.test(String(data.message))
    )
      return {
        rows: [] as SourceRow[],
        total: 0,
        pages: 0,
        page,
        complete: true,
        url: url.href,
      };
    throw new Error('数据中心拒绝请求或未返回有效结果');
  }
  const result = sourceObject(data.result);
  const total = sourceCount(result.count),
    pages = sourceCount(result.pages);
  if (!Array.isArray(result.data)) throw new Error('数据中心缺少记录列表');
  const rows = result.data.map(sourceObject);
  if (
    rows.length !== Math.min(size, Math.max(0, total - (page - 1) * size)) ||
    pages !== Math.ceil(total / size)
  )
    throw new Error('数据中心分页不完整');
  uniqueRows(rows, (r) =>
    JSON.stringify(
      Object.keys(r)
        .sort()
        .map((k) => [k, r[k]]),
    ),
  );
  for (const row of rows) {
    for (const [key, value] of Object.entries(options.equal ?? {}))
      if (String(row[key]) !== value)
        throw new Error('数据源返回了其他证券或筛选范围之外的记录');
    if (options.dateField) {
      const day = sourceDay(row[options.dateField]);
      if (
        (options.start && day < options.start) ||
        (options.end && day > options.end)
      )
        throw new Error('数据源日期超出请求范围');
    }
  }
  return {
    rows,
    total,
    pages,
    page,
    complete: total <= size && page === 1,
    url: url.href,
  };
}
