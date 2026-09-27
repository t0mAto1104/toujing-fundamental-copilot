import { fetchJson } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { checkedDate, chinaDate, shiftDate } from '@/lib/signal-types';
import { isMarketETF, normalizeQuoteSymbol } from '@/lib/quote-types';
import {
  sourceObject,
  sourceCount,
  sourceDay,
  sourceNumber,
  uniqueRows,
} from '@/lib/source-validation';
import { abortableDelay } from '@/lib/request-deadline';
import type { DataTable } from '@/lib/market-extension-types';

type Shares = { code: string; name: string; date: string; shares: number };
const shUrl = 'https://query.sse.com.cn/commonQuery.do',
  szUrl = 'https://fund.szse.cn/api/report/ShowReport/data';
async function shDay(day: string, signal: AbortSignal) {
  return cachedMarketSignal(
    `etf-shares:sh:v39:${day}`,
    3600_000,
    '上交所 ETF 份额',
    shUrl,
    async (abort) => {
      const url = new URL(shUrl);
      url.search = new URLSearchParams({
        sqlId: 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L',
        STAT_DATE: day,
        isPagination: 'true',
        'pageHelp.pageSize': '10000',
        'pageHelp.pageNo': '1',
        'pageHelp.beginPage': '1',
        'pageHelp.cacheSize': '1',
        'pageHelp.endPage': '1',
      }).toString();
      const root = sourceObject(
        await fetchJson(
          url,
          {
            headers: {
              Referer: 'https://www.sse.com.cn/',
              'User-Agent': 'Mozilla/5.0',
            },
            signal: abort,
          },
          4000,
        ),
      );
      const total = sourceCount(sourceObject(root.pageHelp).total);
      if (!Array.isArray(root.result) || root.result.length !== total)
        throw new Error('上交所 ETF 份额快照不完整');
      return uniqueRows(
        root.result.map((v) => {
          const r = sourceObject(v),
            code = String(r.SEC_CODE),
            date = sourceDay(r.STAT_DATE),
            shares = sourceNumber(r.TOT_VOL, true)!;
          if (date !== day || !/^5\d{5}$/.test(code) || shares < 0)
            throw new Error('ETF 日期、代码或份额异常');
          return { code, name: String(r.SEC_NAME ?? ''), date, shares };
        }),
        (r) => r.code,
      );
    },
    signal,
  );
}
async function szCurrent(signal: AbortSignal) {
  return cachedMarketSignal(
    `etf-shares:sz:v39:${chinaDate()}`,
    3600_000,
    '深交所 ETF 份额',
    szUrl,
    async (abort) => {
      const rows: Shares[] = [];
      let pages = 1,
        total = 0,
        date = '';
      for (let page = 1; page <= pages; page++) {
        const url = new URL(szUrl);
        url.search = new URLSearchParams({
          SHOWTYPE: 'JSON',
          CATALOGID: '1000_lf',
          TABKEY: 'tab1',
          selectJjlb: 'ETF',
          PAGENO: String(page),
        }).toString();
        const payload = await fetchJson(
          url,
          {
            headers: {
              Referer: 'https://fund.szse.cn/',
              'User-Agent': 'Mozilla/5.0',
            },
            signal: abort,
          },
          4000,
        );
        if (!Array.isArray(payload) || !payload.length)
          throw new Error('深交所 ETF 快照结构异常');
        const table = sourceObject(payload[0]),
          meta = sourceObject(table.metadata);
        const currentDate = sourceDay(meta.subname),
          currentPages = sourceCount(meta.pagecount),
          currentTotal = sourceCount(meta.recordcount);
        if (page === 1) {
          date = currentDate;
          pages = currentPages;
          total = currentTotal;
          if (pages < 1 || pages > 50)
            throw new Error('深交所 ETF 分页超出支持范围');
        } else if (
          date !== currentDate ||
          pages !== currentPages ||
          total !== currentTotal
        )
          throw new Error('深交所 ETF 分页期间快照变化');
        if (!Array.isArray(table.data) || !table.data.length)
          throw new Error('深交所 ETF 分页提前结束');
        for (const value of table.data) {
          const r = sourceObject(value),
            code = String(r.sys_key).match(/<u>(\d{6})<\/u>/)?.[1],
            name = String(r.jjjcurl).match(/<u>(.*?)<\/u>/)?.[1],
            amount = String(r.dqgm).match(/>([\d,.]+)<\/a>/)?.[1];
          if (!code || !name || !amount)
            throw new Error('深交所 ETF 字段格式变化');
          const shares = sourceNumber(amount, true)!;
          if (shares < 0) throw new Error('ETF 份额不能为负');
          rows.push({ code, name, date, shares });
        }
        if (page < pages) await abortableDelay(300, abort);
      }
      if (rows.length !== total) throw new Error('深交所 ETF 份额总数不完整');
      return uniqueRows(rows, (r) => r.code);
    },
    signal,
    24000,
  );
}
export async function getEtfShares(
  input: string,
  date?: string,
  signal?: AbortSignal,
) {
  const symbol = normalizeQuoteSymbol(input);
  if (!symbol || !isMarketETF(symbol)) throw new Error('请选择沪深 ETF');
  const day = date ? checkedDate(date) : chinaDate();
  if (day > chinaDate()) throw new Error('不能查询未来份额');
  const sh = symbol.startsWith('sh');
  return cachedMarketSignal(
    `etf-shares:detail:v39:${symbol}:${day}`,
    3600_000,
    sh ? '上交所 ETF 份额' : '深交所 ETF 份额',
    sh ? shUrl : szUrl,
    async (abort) => {
      const observations: Shares[] = [];
      if (sh) {
        for (let i = 0; i < 7; i++) {
          const snapshot = await shDay(shiftDate(day, -i), abort);
          if (snapshot.stale) throw new Error('ETF 份额源刷新失败');
          const row = snapshot.data.find((r) => r.code === symbol.slice(2));
          if (row) observations.push(row);
        }
      } else {
        const snapshot = await szCurrent(abort);
        if (snapshot.stale) throw new Error('ETF 份额源刷新失败');
        const row = snapshot.data.find((r) => r.code === symbol.slice(2));
        if (row) {
          if (date && row.date !== day)
            throw new Error(
              `深交所只提供当前快照（${row.date}），不提供指定历史日期。`,
            );
          observations.push(row);
        }
      }
      if (!observations.length)
        throw new Error(
          '所选区间未获得该 ETF 的份额记录（未发布、非交易日或来源未覆盖）',
        );
      const rows = observations
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((r, i, all) => ({
          date: r.date,
          name: r.name,
          shares: r.shares,
          change: all[i + 1] ? r.shares - all[i + 1].shares : null,
          comparison: all[i + 1]?.date ?? null,
        }));
      return {
        columns: [
          { key: 'date', label: '统计日期' },
          { key: 'name', label: 'ETF' },
          { key: 'shares', label: '份额（万份）' },
          { key: 'change', label: '较上一记录变化（万份）' },
          { key: 'comparison', label: '对比日期' },
        ],
        rows,
        total: rows.length,
        page: 1,
        pages: 1,
        coverage: sh
          ? '所选日期向前 7 个自然日的官方记录；份额变化不等于资金净流入金额。'
          : '仅当前快照；T 日晚可能为预估，T+1 早确认。无历史对比时不计算变化；份额不是资金净流入金额。',
      } satisfies DataTable;
    },
    signal,
    26000,
  );
}
