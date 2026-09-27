import { fetchJson, fetchWithTimeout, stripHtml } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { chinaDate, shiftDate } from '@/lib/signal-types';
import {
  sourceObject,
  sourceNumber,
  uniqueRows,
} from '@/lib/source-validation';
export type ExtraNews = {
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};
const headers = { 'User-Agent': 'Mozilla/5.0' };
export async function wallstreetNews(): Promise<ExtraNews[]> {
  const url =
    'https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=50';
  const snapshot = await cachedMarketSignal(
    'news:wscn:v39',
    5 * 60_000,
    '华尔街见闻',
    url,
    async (signal) => {
      const root = sourceObject(
        await fetchJson(url, { headers, signal }, 7000),
      );
      if (root.code !== 20000) throw new Error('华尔街见闻请求失败');
      const items = sourceObject(root.data).items;
      if (!Array.isArray(items) || !items.length)
        throw new Error('华尔街见闻列表为空');
      const seen = new Set<string>();
      return items
        .map((value) => {
          const r = sourceObject(value),
            id = String(r.id ?? ''),
            stamp = sourceNumber(r.display_time, true)!;
          if (!id || seen.has(id))
            throw new Error('华尔街见闻记录重复或缺少标识');
          seen.add(id);
          const sourceUrl = String(r.uri ?? '');
          if (
            !/^https:\/\/(?:[a-z0-9-]+\.)?wallstreetcn\.com\//.test(sourceUrl)
          )
            throw new Error('华尔街见闻来源链接异常');
          const summary = stripHtml(String(r.content_text ?? ''));
          if (!summary) throw new Error('华尔街见闻内容缺失');
          return {
            title: stripHtml(String(r.title || summary.slice(0, 80))),
            summary: summary.slice(0, 1200),
            publishedAt: new Date((stamp + 8 * 3600) * 1000)
              .toISOString()
              .slice(0, 19)
              .replace('T', ' '),
            sourceName: '华尔街见闻',
            sourceUrl,
          };
        })
        .filter(
          (r) =>
            r.publishedAt.slice(0, 10) >= shiftDate(chinaDate(), -3) &&
            r.publishedAt.slice(0, 10) <= chinaDate(),
        );
    },
  );
  if (snapshot.stale) throw new Error('华尔街见闻刷新暂不可用');
  return snapshot.data;
}
export async function cctvEconomyNews(): Promise<ExtraNews[]> {
  const now = new Date(),
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        hour12: false,
      }).format(now),
    );
  const day = shiftDate(chinaDate(), hour >= 21 ? 0 : -1),
    url = `https://tv.cctv.com/lm/xwlb/day/${day.replaceAll('-', '')}.shtml`;
  const snapshot = await cachedMarketSignal(
    `news:cctv:v39:${day}`,
    6 * 3600_000,
    '央视网新闻联播',
    url,
    async (signal) => {
      const response = await fetchWithTimeout(url, { headers, signal }, 6000);
      if (!response.ok) throw new Error('该日新闻联播尚未发布或暂不可达');
      const html = await response.text(),
        all: ExtraNews[] = [];
      for (const chunk of html.split('<li').slice(1)) {
        const href = chunk.match(/href="([^"]*\/VIDE[^"]+)"/)?.[1],
          titleRaw =
            chunk.match(/title="([^"]+)"/)?.[1] ??
            chunk.match(/class="title">([\s\S]*?)<\/div>/)?.[1];
        if (!href || !titleRaw) continue;
        const title = stripHtml(titleRaw)
            .replace(/^\[视频\]/, '')
            .trim(),
          sourceUrl = new URL(href, url).href;
        if (
          !/^https:\/\/tv\.cctv\.com\//.test(sourceUrl) ||
          !/经济|金融|财政|货币|产业|消费|投资|外贸|税|就业|制造|科技|能源|市场|政策|改革/.test(
            title,
          )
        )
          continue;
        all.push({
          title,
          summary: title,
          sourceName: '央视网新闻联播',
          sourceUrl,
          publishedAt: day,
        });
      }
      if (!html.includes('/VIDE')) throw new Error('新闻联播页面结构变化');
      const rows = uniqueRows(all, (r) => r.sourceUrl).slice(0, 5);
      // Fetch only relevant economic stories, not every video in the programme.
      for (const row of rows.slice(0, 3)) {
        try {
          const detail = await fetchWithTimeout(
            row.sourceUrl,
            { headers, signal },
            2500,
          );
          if (!detail.ok) continue;
          const body = (await detail.text()).match(
            /<div class="(?:content_area|cnt_bd)"[^>]*>([\s\S]*?)<\/div>/,
          )?.[1];
          if (body)
            row.summary = stripHtml(body)
              .replace(/&(?:ldquo|rdquo);/g, '“')
              .replace(/&(?:lsquo|rsquo);/g, '’')
              .slice(0, 1200);
        } catch {
          signal.throwIfAborted();
        }
      }
      return rows;
    },
    undefined,
    17000,
  );
  if (snapshot.stale) throw new Error('央视新闻刷新暂不可用');
  return snapshot.data;
}
