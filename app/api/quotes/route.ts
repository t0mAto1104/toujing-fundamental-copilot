import { getMarketQuotes } from '@/lib/a-stock-quotes';
import { MARKET_INDICES, normalizeQuoteSymbol } from '@/lib/quote-types';

export async function GET(request: Request) {
  let symbols: string[];
  try {
    const raw = new URL(request.url).searchParams.get('symbols');
    if (raw && raw.length > 700) throw new Error('一次最多查询 64 个标的。');
    symbols =
      raw === null
        ? MARKET_INDICES.map((item) => item.symbol)
        : raw.split(',').map(normalizeQuoteSymbol);
    if (!symbols.length || symbols.length > 64)
      throw new Error('一次最多查询 64 个标的。');
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '证券参数无效。' },
      { status: 400 },
    );
  }
  try {
    return Response.json(await getMarketQuotes(symbols, request.signal), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      { error: '行情数据源暂不可达，请稍后刷新。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
