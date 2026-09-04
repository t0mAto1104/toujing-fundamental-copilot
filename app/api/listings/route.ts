import {
  InvalidSecurityQueryError,
  searchListedSecurities,
} from '@/lib/market-listings';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')?.trim() || '';
  if (!query) return Response.json({ listings: [] });
  try {
    const listings = await searchListedSecurities(query, {
      signal: request.signal,
    });
    return Response.json({
      listings,
      provider: '东方财富证券搜索',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof InvalidSecurityQueryError)
      return Response.json(
        { listings: [], error: error.message },
        { status: 400 },
      );
    return Response.json(
      {
        listings: [],
        error: '证券搜索数据源暂时不可达，请稍后重试。这不代表该公司不存在。',
      },
      { status: 502 },
    );
  }
}
