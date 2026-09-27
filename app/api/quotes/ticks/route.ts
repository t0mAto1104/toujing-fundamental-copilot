import { getTradeTicks, validateTickQuery } from '@/lib/a-stock-ticks';

export async function GET(request: Request) {
  let query: ReturnType<typeof validateTickQuery>;
  try {
    const params = new URL(request.url).searchParams;
    query = validateTickQuery(
      params.get('symbol') || '',
      params.get('page') || '0',
      params.get('date'),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '参数无效' },
      { status: 400 },
    );
  }
  try {
    return Response.json(
      await getTradeTicks(query.symbol, query.page, query.date, request.signal),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '成交明细暂不可达，请稍后重试。',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
