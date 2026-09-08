import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getMarketQuotes } from '@/lib/a-stock-quotes';
import { getReportDatabase } from '@/lib/report-database';
import {
  addWatchlistItem,
  readWatchlist,
  removeWatchlistItem,
  updateWatchlistItem,
} from '@/lib/market-watchlist';
import { isMarketIndex, normalizeQuoteSymbol } from '@/lib/quote-types';

const noStore = { 'Cache-Control': 'private, no-store' };

async function handle(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: '登录后可保存自选股。' },
      { status: 401, headers: noStore },
    );
  const database = getReportDatabase();
  if (!database)
    return Response.json(
      { error: '自选同步暂不可用，请稍后重试。' },
      { status: 503, headers: noStore },
    );
  try {
    if (request.method === 'GET')
      return Response.json(
        { items: await readWatchlist(database, user.userId) },
        { headers: noStore },
      );
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      return Response.json(
        { error: '不允许跨站修改自选。' },
        { status: 403, headers: noStore },
      );
    let symbol: string;
    let body: { symbol?: unknown };
    try {
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        throw new Error();
      const text = await request.text();
      if (text.length > 4096) throw new Error();
      body = JSON.parse(text) as { symbol?: unknown };
      if (typeof body.symbol !== 'string') throw new Error();
      symbol = normalizeQuoteSymbol(body.symbol);
      if (isMarketIndex(symbol)) throw new Error();
    } catch {
      return Response.json(
        { error: '请选择有效的沪深北 A 股或场内 ETF。' },
        { status: 400, headers: noStore },
      );
    }
    if (request.method === 'PATCH') {
      try {
        return Response.json(
          {
            items: await updateWatchlistItem(
              database,
              user.userId,
              symbol,
              body,
            ),
          },
          { headers: noStore },
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : '更新失败。' },
          { status: 400, headers: noStore },
        );
      }
    }
    if (request.method === 'DELETE')
      return Response.json(
        { items: await removeWatchlistItem(database, user.userId, symbol) },
        { headers: noStore },
      );
    const quote = (await getMarketQuotes([symbol], request.signal)).quotes.find(
      (entry) => entry.symbol === symbol,
    );
    if (!quote)
      return Response.json(
        { error: '暂未核实该股票，请稍后再添加。' },
        { status: 422, headers: noStore },
      );
    // Names come from the market source, never from client-supplied labels.
    try {
      return Response.json(
        { items: await addWatchlistItem(database, user.userId, quote) },
        { headers: noStore },
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('自选最多'))
        return Response.json(
          { error: error.message },
          { status: 409, headers: noStore },
        );
      throw error;
    }
  } catch {
    return Response.json(
      { error: '自选同步暂不可用，未确认保存成功，请稍后重试。' },
      { status: 503, headers: noStore },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PATCH = handle;
