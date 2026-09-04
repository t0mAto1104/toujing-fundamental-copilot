import { waitUntil } from 'cloudflare:workers';

import {
  getCompanyFundamentalPacket,
  readCachedCompanyFundamentalPacket,
} from '@/lib/a-stock-company';
import {
  getVerifiedQuote,
  InvalidSecurityQueryError,
  resolveCompanySecurity,
  type VerifiedQuote,
} from '@/lib/market-listings';
import { readDataSnapshot, storeDataSnapshot } from '@/lib/data-snapshot-cache';
import { abortable, requestDeadline, within } from '@/lib/request-deadline';

type QuickResult<T> = { ready: true; value: T } | { ready: false; value: null };

async function settleWithin<T>(task: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<QuickResult<T>>((resolve) => {
    timeout = setTimeout(
      () => resolve({ ready: false, value: null }),
      timeoutMs,
    );
  });
  const result = await Promise.race([
    task.then((value) => ({ ready: true, value }) satisfies QuickResult<T>),
    timeoutResult,
  ]);
  if (timeout) clearTimeout(timeout);
  return result;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('query')?.trim() || '';
  const listingId = params.get('listing')?.trim() || '';
  if (!query)
    return Response.json(
      { error: '请输入上市公司名称、股票简称或证券代码。' },
      { status: 400 },
    );

  const deadline = requestDeadline(12_000, request.signal);
  try {
    const { listing, listings } = await abortable(
      resolveCompanySecurity(query, listingId, deadline.signal),
      deadline.signal,
    );
    if (!listing)
      return Response.json(
        {
          error:
            '没有识别到可核验的上市公司。非上市公司或非金融内容不会触发 AI 研究。',
        },
        { status: 422 },
      );

    const quoteKey = `company-quote:v1:${listing.id}`;
    const [cachedPacket, cachedQuote] = await abortable(
      Promise.all([
        within(readCachedCompanyFundamentalPacket(listing), 400).catch(
          () => null,
        ),
        within(readDataSnapshot<VerifiedQuote>(quoteKey), 400).catch(
          () => null,
        ),
      ]),
      deadline.signal,
    );
    // A slow quote is saved for the next poll instead of repeatedly discarded
    // when the quick response budget expires. Its original asOf is preserved.
    const quoteTask = getVerifiedQuote(listing)
      .then(async (quote) => {
        if (quote)
          await within(
            storeDataSnapshot(
              quoteKey,
              'quote',
              quote,
              20_000,
              quote.sourceName,
              quote.sourceUrl,
            ),
            500,
          ).catch(() => undefined);
        return quote;
      })
      .catch(() => null);
    const packetTask =
      !cachedPacket || cachedPacket.stale
        ? within(getCompanyFundamentalPacket(listing), 23_000).catch(() => null)
        : null;
    const [quoteResult, packetResult] = await abortable(
      Promise.all([
        settleWithin(quoteTask, 3_000),
        cachedPacket
          ? Promise.resolve({
              ready: true,
              value: cachedPacket,
            } satisfies QuickResult<typeof cachedPacket>)
          : settleWithin(packetTask!, 2_000),
      ]),
      deadline.signal,
    );
    const backgroundTasks: Array<Promise<unknown>> = [];
    if (!quoteResult.ready) backgroundTasks.push(quoteTask);
    if (packetTask && (cachedPacket || !packetResult.ready))
      backgroundTasks.push(packetTask);
    if (backgroundTasks.length)
      waitUntil(Promise.allSettled(backgroundTasks).then(() => undefined));

    let quote = quoteResult.ready ? quoteResult.value : null;
    if (
      !quote &&
      cachedQuote &&
      Date.now() - Date.parse(cachedQuote.fetchedAt) < 15 * 60_000
    ) {
      quote = {
        ...cachedQuote.value,
        isStale: true,
        staleReason:
          '本轮行情尚未更新，显示上次取得的真实报价，请留意行情时间。',
      };
    }
    const packet = packetResult.ready ? packetResult.value : null;
    const packetPending = Boolean(
      packetTask && (cachedPacket?.stale || !packetResult.ready),
    );
    return Response.json(
      {
        listing,
        listings,
        quote,
        packet: packet?.value || null,
        packetFetchedAt: packet?.fetchedAt || null,
        packetStale: packet?.stale || false,
        packetPending,
        quotePending: !quoteResult.ready,
        updatedAt: new Date().toISOString(),
        methodology:
          '本页未调用任何 AI 模型。A股实时价格优先来自腾讯行情；公司资料、资金流和行业信息来自东方财富，财务三表来自新浪财经，公告来自巨潮资讯。行情页面每20秒刷新，低频基本面数据按5分钟共享缓存更新。',
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-AI-Research': 'not-used',
        },
      },
    );
  } catch (error) {
    if (error instanceof InvalidSecurityQueryError)
      return Response.json({ error: error.message }, { status: 400 });
    return Response.json(
      { error: '公司数据源本轮暂时不可达，请稍后刷新。' },
      { status: 503 },
    );
  } finally {
    deadline.dispose();
  }
}
