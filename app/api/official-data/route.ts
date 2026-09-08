import {
  getCompanyMargin,
  getOfficialIndexDetail,
  getTradingSession,
} from '@/lib/a-stock-official';
import { MARKET_INDICES, normalizeQuoteSymbol } from '@/lib/quote-types';
import { abortable, requestDeadline } from '@/lib/request-deadline';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  let symbol = '';
  try {
    if (type !== 'calendar') {
      symbol = normalizeQuoteSymbol(params.get('symbol') || '');
      if (type === 'index' && !MARKET_INDICES.some((i) => i.symbol === symbol))
        throw new Error('该指数暂无官方明细支持。');
      if (
        type === 'margin' &&
        (!/^(sh|sz)/.test(symbol) ||
          MARKET_INDICES.some((i) => i.symbol === symbol))
      )
        throw new Error('两融明细仅支持沪深证券。');
    }
    if (!['calendar', 'index', 'margin'].includes(type || ''))
      throw new Error('官方数据类型无效。');
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '参数无效。' },
      { status: 400, headers },
    );
  }
  const deadline = requestDeadline(
    type === 'margin' ? 17_000 : type === 'index' ? 13_000 : 6_000,
    request.signal,
  );
  try {
    const data = await abortable<unknown>(
      type === 'calendar'
        ? getTradingSession(deadline.signal)
        : type === 'index'
          ? getOfficialIndexDetail(symbol, deadline.signal)
          : getCompanyMargin(symbol, deadline.signal),
      deadline.signal,
    );
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.name !== 'AbortError'
            ? error.message
            : '官方数据获取超时，请稍后刷新。',
      },
      { status: 503, headers },
    );
  } finally {
    deadline.dispose();
  }
}
