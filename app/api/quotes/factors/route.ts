import { getAdjustmentFactors } from '@/lib/a-stock-factors';
import { isMarketIndex, normalizeQuoteSymbol } from '@/lib/quote-types';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let symbol: string;
  const mode = params.get('adjust') || 'qfq';
  try {
    symbol = normalizeQuoteSymbol(params.get('symbol') || '');
    if (isMarketIndex(symbol) || symbol.startsWith('bj'))
      throw new Error('指数无复权因子；当前因子源暂不支持北交所。');
    if (mode !== 'qfq' && mode !== 'hfq')
      throw new Error('请选择 qfq 或 hfq。');
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '因子参数无效' },
      { status: 400 },
    );
  }
  try {
    return Response.json(
      await getAdjustmentFactors(symbol, mode as 'qfq' | 'hfq', request.signal),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: '新浪暂未提供有效复权因子，不影响独立来源的 K 线。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
