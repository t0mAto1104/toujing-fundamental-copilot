import { getIndustryStocks } from '@/lib/a-stock-industry-stocks';
import { industryStockOptions } from '@/lib/industry-stock-types';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let options: ReturnType<typeof industryStockOptions>;
  try {
    options = industryStockOptions(
      params.get('board') || '',
      params.get('sort') || 'percent',
      params.get('order') || 'desc',
      Number(params.get('page') || 1),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '参数无效。' },
      { status: 400, headers },
    );
  }
  try {
    return Response.json(await getIndustryStocks(options, request.signal), {
      headers,
    });
  } catch {
    return Response.json(
      {
        error: '行业股票排行暂不可用，请核对行业或稍后刷新；不会展示模拟排名。',
      },
      { status: 503, headers: { ...headers, 'Retry-After': '180' } },
    );
  }
}
