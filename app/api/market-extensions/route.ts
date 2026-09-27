import { getCompanyEvents } from '@/lib/a-stock-events';
import { getMacroExtension, type MacroKind } from '@/lib/a-stock-rates';
import { eventKinds, type EventKind } from '@/lib/market-extension-types';
import { getEtfShares } from '@/lib/a-stock-etf-shares';
import { checkedDate, chinaDate, stockSignalSymbol } from '@/lib/signal-types';
import { isMarketETF, normalizeQuoteSymbol } from '@/lib/quote-types';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams,
    kind = params.get('kind') ?? '';
  const page = Number(params.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000)
    return Response.json({ error: '页码无效' }, { status: 400 });
  try {
    const symbol = params.get('symbol');
    if (kind === 'etf') {
      if (!isMarketETF(normalizeQuoteSymbol(symbol ?? '')))
        throw new Error('请选择沪深 ETF');
      const day = params.get('date');
      if (day && checkedDate(day) > chinaDate())
        throw new Error('不能查询未来份额');
    } else if (Object.hasOwn(eventKinds, kind) && symbol) {
      const code = stockSignalSymbol(symbol);
      if (kind === 'pledge' && code.startsWith('bj'))
        throw new Error('质押统计仅覆盖沪深市场');
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '参数无效' },
      { status: 400 },
    );
  }
  try {
    const data =
      kind === 'etf'
        ? await getEtfShares(
            params.get('symbol') ?? '',
            params.get('date') || undefined,
            request.signal,
          )
        : Object.hasOwn(eventKinds, kind)
          ? await getCompanyEvents(
              kind as EventKind,
              params.get('symbol') || undefined,
              page,
              request.signal,
            )
          : ['lpr', 'fr', 'fdr', 'curve', 'calendar'].includes(kind)
            ? await getMacroExtension(kind as MacroKind, request.signal)
            : null;
    if (!data)
      return Response.json({ error: '不支持的数据类型' }, { status: 400 });
    return Response.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '数据源暂不可用' },
      { status: 503 },
    );
  }
}
