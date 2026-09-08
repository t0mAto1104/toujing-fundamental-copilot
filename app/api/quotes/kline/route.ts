import { getMarketKline } from '@/lib/a-stock-quotes';
import { normalizeKlineOptions, normalizeQuoteSymbol } from '@/lib/quote-types';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let symbol: string;
  let options: ReturnType<typeof normalizeKlineOptions>;
  try {
    symbol = normalizeQuoteSymbol(params.get('symbol') || 'sh000001');
    options = normalizeKlineOptions(
      symbol,
      params.get('period') || 'day',
      params.get('adjust') || 'none',
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'K 线参数无效。' },
      { status: 400 },
    );
  }
  try {
    return Response.json(
      await getMarketKline(
        symbol,
        options.period,
        options.adjustment,
        request.signal,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: '所选周期或复权行情暂不可用，请稍后刷新或切换周期。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
