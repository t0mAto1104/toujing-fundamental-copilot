import { fetchWithTimeout, stripHtml } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { stockSignalSymbol } from '@/lib/signal-types';
import { abortableDelay } from '@/lib/request-deadline';
import { sourceDay, uniqueRows } from '@/lib/source-validation';
import type { IndustryReportItem } from '@/lib/a-stock-reports';

let nextStart = 0;
export function parseSinaReports(html: string): IndustryReportItem[] {
  if (!html.includes('tb_01') || !html.includes('研究员'))
    throw new Error('新浪研报页面结构变化');
  const pattern =
    /<tr>\s*<td>\d+<\/td>\s*<td class="tal f14">\s*<a[^>]*?title="([^"]*)"[^>]*?href="([^"]*?\/rptid\/(\d+)\/[^"]*)"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
  const rows = [...html.matchAll(pattern)].map((m) => {
    const link = new URL(m[2], 'https://vip.stock.finance.sina.com.cn');
    if (
      ['vip.stock.finance.sina.com.cn', 'stock.finance.sina.com.cn'].includes(
        link.hostname,
      ) &&
      link.protocol === 'http:'
    )
      link.protocol = 'https:';
    const detailUrl = link.href;
    if (
      !/^https:\/\/(?:vip\.stock|stock)\.finance\.sina\.com\.cn\//.test(
        detailUrl,
      )
    )
      throw new Error('新浪研报链接异常');
    return {
      id: `sina:${m[3]}`,
      title: stripHtml(m[1]),
      publishedAt: sourceDay(m[5].trim()),
      industryName: stripHtml(m[4]),
      industryCode: '',
      organization: stripHtml(m[6]),
      researcher: stripHtml(m[7]),
      rating: '',
      pages: null,
      sizeKb: null,
      detailUrl,
      pdfUrl: '',
    };
  });
  const count = [...html.matchAll(/<tr>\s*<td>\d+<\/td>/g)].length;
  if (
    rows.length !== count ||
    (!rows.length && !html.includes('没有找到相关内容'))
  )
    throw new Error('新浪研报列表解析不完整');
  return uniqueRows(rows, (r) => r.id);
}
export async function getSinaReports(
  input?: string,
  page = 1,
  signal?: AbortSignal,
) {
  const symbol = input ? stockSignalSymbol(input) : undefined;
  return cachedMarketSignal(
    `sina-reports:v39:${symbol ?? 'all'}:${page}`,
    30 * 60_000,
    '新浪财经研报',
    'https://vip.stock.finance.sina.com.cn/q/go.php/vReport_List/kind/lastest/index.phtml',
    async (abort) => {
      const url = new URL(
        `https://vip.stock.finance.sina.com.cn/q/go.php/vReport_List/kind/${symbol ? 'search' : 'lastest'}/index.phtml`,
      );
      url.searchParams.set('p', String(page));
      if (symbol) {
        url.searchParams.set(
          'symbol',
          symbol.startsWith('bj') ? symbol : symbol.slice(2),
        );
        url.searchParams.set('t1', 'all');
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        // ponytail: per-isolate reservation plus D1 result cache; a distributed rate limiter is needed for high multi-region traffic.
        const start = Math.max(Date.now(), nextStart);
        nextStart = start + 6000;
        await abortableDelay(Math.max(0, start - Date.now()), abort);
        const response = await fetchWithTimeout(
          url,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0',
              Referer: 'https://finance.sina.com.cn/',
            },
            signal: abort,
          },
          5000,
        );
        if (!response.ok) throw new Error('新浪研报源暂不可用');
        const rows = parseSinaReports(
          new TextDecoder('gbk').decode(await response.arrayBuffer()),
        );
        if (rows.length || attempt === 1) return rows;
      }
      throw new Error('新浪研报源暂不可用');
    },
    signal,
    22000,
  );
}
