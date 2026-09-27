import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { chinaDate, shiftDate, stockSignalSymbol } from '@/lib/signal-types';
import {
  strictDatacenter,
  sourceDay,
  sourceNumber,
} from '@/lib/source-validation';
import { stripHtml } from '@/lib/a-stock-http';
import {
  eventKinds,
  type EventKind,
  type DataTable,
  type DataCell,
} from '@/lib/market-extension-types';

const definitions = {
  forecast: {
    report: 'RPT_PUBLIC_OP_NEWPREDICT',
    code: 'SECURITY_CODE',
    date: 'NOTICE_DATE',
    sort: 'NOTICE_DATE,SECURITY_CODE,REPORT_DATE,PREDICT_FINANCE_CODE',
    order: '-1,1,-1,1',
    name: 'SECURITY_NAME_ABBR',
    fields: [
      ['REPORT_DATE', '报告期', 'date'],
      ['PREDICT_FINANCE', '指标', 'text'],
      ['PREDICT_TYPE', '预告类型', 'text'],
      ['PREDICT_AMT_LOWER', '金额下限（元）', 'number'],
      ['PREDICT_AMT_UPPER', '金额上限（元）', 'number'],
      ['ADD_AMP_LOWER', '同比下限（%）', 'number'],
      ['ADD_AMP_UPPER', '同比上限（%）', 'number'],
      ['CHANGE_REASON_EXPLAIN', '变动原因', 'text'],
    ],
  },
  survey: {
    report: 'RPT_ORG_SURVEYNEW',
    code: 'SECURITY_CODE',
    date: 'NOTICE_DATE',
    sort: 'NOTICE_DATE,SECURITY_CODE,RECEIVE_START_DATE',
    order: '-1,1,-1',
    name: 'SECURITY_NAME_ABBR',
    fields: [
      ['RECEIVE_START_DATE', '接待日期', 'date'],
      ['SUM', '机构家数', 'number'],
      ['RECEIVE_WAY_EXPLAIN', '调研方式', 'text'],
      ['RECEPTIONIST', '接待人员', 'text'],
    ],
  },
  holders: {
    report: 'RPT_SHARE_HOLDER_INCREASE',
    code: 'SECURITY_CODE',
    date: 'NOTICE_DATE',
    sort: 'NOTICE_DATE,SECURITY_CODE,HOLDER_NAME,START_DATE,END_DATE',
    order: '-1,1,1,1,1',
    name: 'SECURITY_NAME_ABBR',
    fields: [
      ['HOLDER_NAME', '股东', 'text'],
      ['DIRECTION', '方向', 'text'],
      ['CHANGE_NUM_SYMBOL', '变动（万股）', 'number'],
      ['AFTER_CHANGE_RATE', '占总股本（%）', 'number'],
      ['MARKET', '方式', 'text'],
    ],
  },
  buyback: {
    report: 'RPTA_WEB_GETHGLIST_NEW',
    code: 'DIM_SCODE',
    date: 'UPDATEDATE',
    sort: 'UPDATEDATE,DIM_SCODE,REPURCODE',
    order: '-1,1,1',
    name: 'SECURITYSHORTNAME',
    fields: [
      ['REPURPROGRESS', '进度', 'progress'],
      ['REPURAMOUNTLOWER', '计划下限（元）', 'number'],
      ['REPURAMOUNTLIMIT', '计划上限（元）', 'number'],
      ['REPURNUM', '已回购（股）', 'number'],
      ['REPURAMOUNT', '已回购（元）', 'number'],
      ['REPUROBJECTIVE', '目的', 'text'],
    ],
  },
  pledge: {
    report: 'RPT_CSDC_LIST',
    code: 'SECURITY_CODE',
    date: 'TRADE_DATE',
    sort: 'TRADE_DATE,SECURITY_CODE',
    order: '-1,1',
    name: 'SECURITY_NAME_ABBR',
    fields: [
      ['PLEDGE_RATIO', '质押比例（%）', 'number'],
      ['REPURCHASE_BALANCE', '质押股数（万股）', 'number'],
      ['PLEDGE_MARKET_CAP', '质押市值（万元）', 'number'],
      ['PLEDGE_DEAL_NUM', '质押笔数', 'number'],
    ],
  },
} as const;
const progress: Record<string, string> = {
  '001': '董事会预案',
  '002': '股东大会通过',
  '003': '股东大会否决',
  '004': '实施中',
  '005': '停止实施',
  '006': '完成实施',
};

export async function getCompanyEvents(
  kind: EventKind,
  input?: string,
  page = 1,
  signal?: AbortSignal,
) {
  const symbol = input ? stockSignalSymbol(input) : undefined;
  if (input && !symbol) throw new Error('该接口只支持沪深北 A 股公司');
  if (kind === 'pledge' && symbol?.startsWith('bj'))
    throw new Error('股权质押统计只覆盖沪深，不覆盖北交所');
  const spec = definitions[kind],
    end = chinaDate(),
    start = shiftDate(end, -90);
  const sourceUrl = new URL(
    'https://datacenter-web.eastmoney.com/api/data/v1/get',
  );
  sourceUrl.search = new URLSearchParams({
    reportName: spec.report,
    columns: 'ALL',
    pageNumber: String(page),
    pageSize: '30',
    sortColumns: spec.sort,
    sortTypes: spec.order,
    filter: `${symbol ? `(${spec.code}="${symbol.slice(2)}")` : ''}${kind === 'survey' ? '(IS_SOURCE="1")(NUMBERNEW="1")' : ''}(${spec.date}>='${start}')(${spec.date}<='${end}')`,
  }).toString();
  return cachedMarketSignal(
    `events:v39:${kind}:${symbol ?? 'market'}:${end}:${page}`,
    30 * 60_000,
    kind === 'pledge' ? '中国结算（经东方财富）' : '东方财富数据中心',
    sourceUrl.href,
    async (abort) => {
      const equal: Record<string, string> = symbol
        ? { [spec.code]: symbol.slice(2) }
        : {};
      if (kind === 'survey')
        Object.assign(equal, { IS_SOURCE: '1', NUMBERNEW: '1' });
      const filter =
        Object.entries(equal)
          .map(([k, v]) => `(${k}="${v}")`)
          .join('') + `(${spec.date}>='${start}')(${spec.date}<='${end}')`;
      const result = await strictDatacenter({
        report: spec.report,
        sort: spec.sort,
        order: spec.order,
        filter,
        equal,
        dateField: spec.date,
        start,
        end,
        page,
        signal: abort,
      });
      const rows = result.rows.map((r) => {
        const code = String(r[spec.code]);
        if (!/^\d{6}$/.test(code) || !stockSignalSymbol(code))
          throw new Error('公司事件证券代码异常');
        const row: Record<string, DataCell> = {
          date: sourceDay(r[spec.date]),
          code,
          name: String(r[spec.name] ?? ''),
        };
        for (const [field, , type] of spec.fields) {
          const value = r[field];
          row[field] =
            type === 'number'
              ? sourceNumber(value)
              : type === 'date'
                ? value
                  ? sourceDay(value)
                  : null
                : type === 'progress'
                  ? (progress[String(value)] ??
                    `未识别进度（${value ?? '缺失'}）`)
                  : value == null
                    ? null
                    : stripHtml(String(value)).slice(0, 1600);
        }
        if (kind === 'holders') {
          const amount = sourceNumber(r.CHANGE_NUM_SYMBOL);
          if (
            amount !== null &&
            amount !== 0 &&
            ['增持', '减持'].includes(String(r.DIRECTION)) &&
            amount < 0 !== (r.DIRECTION === '减持')
          )
            throw new Error('增减持方向与股数符号不一致');
        }
        if (kind === 'pledge') {
          const total = sourceNumber(r.REPURCHASE_BALANCE),
            free = sourceNumber(r.REPURCHASE_UNLIMITED_BALANCE),
            locked = sourceNumber(r.REPURCHASE_LIMITED_BALANCE);
          if (
            total !== null &&
            free !== null &&
            locked !== null &&
            Math.abs(free + locked - total) > Math.max(1, total * 0.001)
          )
            throw new Error('质押股数分项与合计不一致');
        }
        return row;
      });
      return {
        columns: [
          { key: 'date', label: kind === 'pledge' ? '统计日期' : '公告日期' },
          { key: 'code', label: '代码' },
          { key: 'name', label: '公司' },
          ...spec.fields.map(([key, label]) => ({ key, label })),
        ],
        rows,
        total: result.total,
        page,
        pages: result.pages,
        coverage: `近 90 天${eventKinds[kind]}；${kind === 'pledge' ? '周频统计，仅沪深；' : ''}每页 30 条。未披露数值保持为空，预告或回购计划不等于实际业绩或已执行金额。`,
      } satisfies DataTable;
    },
    signal,
  );
}
