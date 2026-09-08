import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  getBoardFlows,
  getDragonSeats,
  getDragons,
  getHotStocks,
  getMemberships,
  getNorthbound,
  getNorthboundHoldings,
  getSignalEvidence,
  getStockFlow,
  getUnlocks,
} from '@/lib/a-stock-signals';
import { getReportDatabase } from '@/lib/report-database';
import { readWatchlist } from '@/lib/market-watchlist';
import {
  checkedDate,
  chinaDate,
  shiftDate,
  stockSignalSymbol,
  type BoardKind,
  type BoardPeriod,
} from '@/lib/signal-types';

const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let kind: string,
    symbol: string,
    date: string,
    start: string,
    end: string,
    type: BoardKind,
    period: BoardPeriod,
    flowPeriod: 'minute' | 'day',
    page: number,
    watch: boolean;
  try {
    kind = params.get('kind') || '';
    if (
      ![
        'hot',
        'membership',
        'flow',
        'boards',
        'dragon',
        'seats',
        'unlocks',
        'northbound',
        'holdings',
        'evidence',
      ].includes(kind)
    )
      throw new Error('数据类型无效。');
    symbol = params.get('symbol')
      ? stockSignalSymbol(params.get('symbol')!)
      : '';
    if (['membership', 'flow', 'seats', 'evidence'].includes(kind) && !symbol)
      throw new Error('请选择一只 A 股公司。');
    page = Number(params.get('page') || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100)
      throw new Error('页码无效。');
    date = params.get('date') ? checkedDate(params.get('date')!) : '';
    if (date && (date < '2020-01-01' || date > chinaDate()))
      throw new Error('请选择已过去的交易日期。');
    if (kind === 'seats' && !date) throw new Error('请选择上榜日期。');
    start = checkedDate(params.get('start') || chinaDate());
    end = checkedDate(params.get('end') || shiftDate(start, 90));
    if (
      start < '2020-01-01' ||
      start > shiftDate(chinaDate(), 366) ||
      end < start ||
      end > shiftDate(start, 90)
    )
      throw new Error('解禁日期范围最多 90 天。');
    type = (params.get('type') || 'industry') as BoardKind;
    period = (params.get('period') || 'today') as BoardPeriod;
    flowPeriod = (params.get('frequency') || 'minute') as 'minute' | 'day';
    if (
      !['industry', 'concept', 'region'].includes(type) ||
      !['today', '5d', '10d'].includes(period) ||
      !['minute', 'day'].includes(flowPeriod)
    )
      throw new Error('统计口径无效。');
    if (
      params.has('scope') &&
      !['all', 'watchlist'].includes(params.get('scope')!)
    )
      throw new Error('筛选范围无效。');
    watch = params.get('scope') === 'watchlist';
    if (
      params.has('classification') &&
      !['industry', 'concept', 'region'].includes(params.get('classification')!)
    )
      throw new Error('板块分类无效。');
    if (params.has('market') && !['sh', 'sz'].includes(params.get('market')!))
      throw new Error('请选择沪股通或深股通。');
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '参数无效。' },
      { status: 400, headers: noStore },
    );
  }
  try {
    let result: unknown;
    switch (kind) {
      case 'hot':
        result = await getHotStocks(request.signal);
        break;
      case 'membership':
        result = await getMemberships(
          symbol,
          request.signal,
          (params.get('classification') as BoardKind | undefined) || undefined,
        );
        break;
      case 'flow':
        result = await getStockFlow(symbol, flowPeriod, request.signal);
        break;
      case 'boards':
        result = await getBoardFlows(type, period, page, request.signal);
        break;
      case 'dragon':
        result = await getDragons(date, symbol, page, request.signal);
        break;
      case 'seats':
        result = await getDragonSeats(symbol, date, request.signal);
        break;
      case 'northbound':
        result = await getNorthbound(date, request.signal);
        break;
      case 'holdings':
        result = await getNorthboundHoldings(
          params.get('market') === 'sz' ? 'sz' : 'sh',
          request.signal,
        );
        break;
      case 'evidence':
        result = await getSignalEvidence(symbol, request.signal);
        break;
      case 'unlocks': {
        let symbols = symbol ? [symbol] : [];
        if (watch) {
          const user = await getChatGPTUser();
          if (!user)
            return Response.json(
              { error: '登录后查看自选股解禁。' },
              { status: 401, headers: noStore },
            );
          const db = getReportDatabase();
          if (!db) throw new Error('自选同步暂不可用。');
          symbols = (await readWatchlist(db, user.userId)).flatMap((item) => {
            try {
              return [stockSignalSymbol(item.symbol)];
            } catch {
              return [];
            }
          });
        }
        result = await getUnlocks(
          start,
          end,
          symbols,
          page,
          request.signal,
          watch,
        );
        break;
      }
    }
    return Response.json(result, { headers: noStore });
  } catch {
    return Response.json(
      { error: '数据源暂不可用或尚未披露该日数据，请稍后重试或查看原始来源。' },
      { status: 503, headers: { ...noStore, 'Retry-After': '180' } },
    );
  }
}
