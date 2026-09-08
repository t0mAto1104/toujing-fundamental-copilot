import { searchQuoteSecurities } from '@/lib/quote-search';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')?.trim() || '';
  if (!query) return Response.json({ listings: [] });
  if (query.length > 60)
    return Response.json({ error: '搜索内容过长。' }, { status: 400 });
  try {
    return Response.json(
      { listings: await searchQuoteSecurities(query, request.signal) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      {
        listings: [],
        error: '证券搜索暂不可用，请核对沪深北股票、ETF 或指数名称和代码。',
      },
      { status: 502 },
    );
  }
}
