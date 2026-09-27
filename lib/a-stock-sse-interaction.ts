import { fetchJson, fetchWithTimeout, stripHtml } from '@/lib/a-stock-http';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';
import { chinaDate, shiftDate } from '@/lib/signal-types';
import { sourceObject, sourceDay, uniqueRows } from '@/lib/source-validation';
import type {
  InvestorQuestion,
  InvestorQuestionsData,
} from '@/lib/sentiment-types';

const base = 'https://sns.sseinfo.com';
const headers = {
  'User-Agent': 'Mozilla/5.0',
  Referer: base + '/',
  'Content-Type': 'application/x-www-form-urlencoded',
};
async function companyPage(page: number, signal: AbortSignal) {
  const snapshot = await getOrRefreshDataSnapshot({
    cacheKey: `sse-e:companies:v39:${page}`,
    category: 'sse-company-map',
    ttlMs: 86400000,
    sourceName: '上证e互动公司目录',
    sourceUrl: base + '/allcompany.do',
    requestScoped: true,
    refresh: async () => {
      const payload = sourceObject(
        await fetchJson(
          base + '/allcompany.do',
          {
            method: 'POST',
            headers,
            signal,
            body: new URLSearchParams({
              code: '0',
              order: '2',
              areaId: '0',
              page: String(page),
            }),
          },
          2500,
        ),
      );
      if (typeof payload.content !== 'string')
        throw new Error('上证e互动公司目录结构异常');
      const pairs = [
        ...payload.content.matchAll(
          /uid=['"]?(\d+)['"]?[^>]*>\s*<img[^>]*company\/(\d{6})\.png/g,
        ),
      ].map((m) => ({ code: m[2], uid: m[1] }));
      if (
        !pairs.length &&
        (page === 1 || !payload.content.includes('没有任何上市公司的信息'))
      )
        throw new Error('上证e互动公司目录解析失败');
      uniqueRows(pairs, (p) => p.code);
      if (pairs.some((p, i) => i > 0 && p.code <= pairs[i - 1].code))
        throw new Error('上证e互动公司目录排序变化');
      return pairs;
    },
  });
  if (snapshot.stale) throw new Error('上证e互动公司目录暂不可用');
  return snapshot.value;
}
async function companyUid(code: string, signal: AbortSignal) {
  const snapshot = await getOrRefreshDataSnapshot({
    cacheKey: `sse-e:uid:v39:${code}`,
    category: 'sse-company-map',
    ttlMs: 86400000,
    sourceName: '上证e互动',
    sourceUrl: base,
    requestScoped: true,
    refresh: async () => {
      let low = 1,
        high = 1;
      while (high <= 256) {
        const pairs = await companyPage(high, signal);
        const hit = pairs.find((p) => p.code === code);
        if (hit) return hit.uid;
        if (!pairs.length || pairs.at(-1)!.code >= code) break;
        low = high + 1;
        high *= 2;
      }
      if (high > 256) throw new Error('上证e互动目录超出当前覆盖范围');
      while (low <= high) {
        const mid = Math.floor((low + high) / 2),
          pairs = await companyPage(mid, signal),
          hit = pairs.find((p) => p.code === code);
        if (hit) return hit.uid;
        if (!pairs.length || code < pairs[0].code) high = mid - 1;
        else low = mid + 1;
      }
      throw new Error('上证e互动未找到目标公司的唯一身份');
    },
  });
  if (snapshot.stale) throw new Error('上证e互动身份映射已过期');
  return snapshot.value;
}
function stamp(value: string) {
  const m = value.match(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{2}:\d{2})/);
  if (!m) throw new Error('上证e互动问答时间无法识别');
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00+08:00`;
  sourceDay(iso);
  if (!Number.isFinite(Date.parse(iso))) throw new Error('上证e互动时间无效');
  return iso;
}
export function parseSseQuestions(
  html: string,
  symbol: string,
): InvestorQuestion[] {
  const chunks = html.split(/<div class="m_feed_item[^"]*" id="item-/).slice(1);
  const rows = chunks.map((chunk) => {
    const id = chunk.match(/^(\d+)/)?.[1],
      [ask, answerPart] = chunk.split('class="m_feed_detail m_qa"');
    const q = ask.match(
        /<div class="m_feed_txt"[^>]*>\s*<a[^>]*>:(.*?)\((\d{6})\)<\/a>([\s\S]*?)<\/div>/,
      ),
      time = ask.match(
        /<div class="m_feed_from"[^>]*>\s*<span>([^<]+)<\/span>/,
      );
    if (!id || !q || !time || q[2] !== symbol.slice(2))
      throw new Error('上证e互动问答结构或证券身份不匹配');
    const body = answerPart?.match(
        /<div class="m_feed_txt"[^>]*>([\s\S]*?)<\/div>/,
      ),
      reply = answerPart?.match(
        /<div class="m_feed_from"[^>]*>\s*<span>([^<]+)<\/span>/,
      );
    if (answerPart && (!body || !reply))
      throw new Error('上证e互动回复内容不完整');
    return {
      id,
      symbol,
      company: stripHtml(q[1]),
      question: stripHtml(q[3]),
      answer: body ? stripHtml(body[1]) : null,
      answerer: body ? stripHtml(q[1]) : '',
      askedAt: stamp(time[1]),
      answeredAt: reply ? stamp(reply[1]) : null,
      url: base,
    } satisfies InvestorQuestion;
  });
  if (
    !rows.length &&
    !/class="m_feed_note"[^>]*>[^<]*(暂无|暂时没有)[^<]*</.test(html)
  )
    throw new Error('上证e互动未返回可确认的问答或空结果');
  return uniqueRows(rows, (r) => r.id);
}
export async function getSseQuestions(
  symbol: string,
  days: 7 | 30,
  page: number,
  signal?: AbortSignal,
) {
  const today = chinaDate(),
    start = shiftDate(today, -days + 1);
  return cachedMarketSignal(
    `sse-e:v39:${symbol}:${days}:${today}:${page}`,
    15 * 60_000,
    '上证e互动',
    base,
    async (abort) => {
      const uid = await companyUid(symbol.slice(2), abort);
      const response = await fetchWithTimeout(
        base + '/ajax/userfeeds.do',
        {
          method: 'POST',
          headers,
          signal: abort,
          body: new URLSearchParams({
            typeCode: 'company',
            type: '10',
            pageSize: '20',
            uid,
            page: String(page),
          }),
        },
        5000,
      );
      if (!response.ok) throw new Error('上证e互动暂不可达');
      const rows = parseSseQuestions(await response.text(), symbol);
      return {
        symbol,
        days,
        start,
        end: today,
        items: rows.filter(
          (r) =>
            chinaDate(new Date(r.askedAt)) >= start &&
            chinaDate(new Date(r.askedAt)) <= today,
        ),
        page,
        hasMore:
          rows.length === 20 &&
          page < 10 &&
          rows.some((r) => chinaDate(new Date(r.askedAt)) >= start),
        coverage:
          '上证e互动沪市公司问答；按提问日期筛选近 7 / 30 天，平台仅开放近期问答，最多 10 页。公司答复不等于已审计事实。',
      } satisfies InvestorQuestionsData;
    },
    signal,
    24000,
  );
}
