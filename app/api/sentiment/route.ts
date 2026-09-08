import {
  getConceptHeat,
  getInvestorQuestions,
  getPopularity,
} from '@/lib/a-stock-sentiment';
import { stockSignalSymbol } from '@/lib/signal-types';

const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let kind: string,
    symbol = '',
    period: 'hour' | 'day',
    days: 7 | 30,
    page: number;
  try {
    kind = params.get('kind') || '';
    if (!['ths', 'eastmoney', 'concepts', 'questions'].includes(kind))
      throw new Error('舆情数据类型无效。');
    period = (params.get('period') || 'hour') as 'hour' | 'day';
    days = Number(params.get('days') || 30) as 7 | 30;
    page = Number(params.get('page') || 1);
    if (
      !['hour', 'day'].includes(period) ||
      ![7, 30].includes(days) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10
    )
      throw new Error('查询范围无效：问答仅支持近 7 / 30 天，最多 10 页。');
    if (['concepts', 'questions'].includes(kind))
      symbol = stockSignalSymbol(params.get('symbol') || '');
    if (kind === 'questions' && !symbol.startsWith('sz'))
      throw new Error('互动易仅覆盖深市公司；沪市及北交所暂不支持此问答来源。');
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '参数无效。' },
      { status: 400, headers: noStore },
    );
  }
  try {
    const result =
      kind === 'concepts'
        ? await getConceptHeat(symbol, request.signal)
        : kind === 'questions'
          ? await getInvestorQuestions(symbol, days, page, request.signal)
          : await getPopularity(
              kind as 'ths' | 'eastmoney',
              period,
              request.signal,
            );
    return Response.json(result, { headers: noStore });
  } catch {
    return Response.json(
      {
        error:
          '舆情数据源暂不可用，已暂停重复请求；不会用过期信息补充，请稍后刷新。',
      },
      { status: 503, headers: { ...noStore, 'Retry-After': '180' } },
    );
  }
}
