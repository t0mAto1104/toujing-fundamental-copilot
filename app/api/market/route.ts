import { fetchWithTimeout } from '@/lib/a-stock-http';
import {
  INDUSTRY_CACHE_KEY,
  type IndustrySnapshot,
} from '@/lib/a-stock-industries';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';

const stockUniverse = [
  { symbol: 'sh601138', code: '601138', name: '工业富联', sector: 'AI算力' },
  { symbol: 'sz300308', code: '300308', name: '中际旭创', sector: 'AI算力' },
  { symbol: 'sz300502', code: '300502', name: '新易盛', sector: 'AI算力' },
  { symbol: 'sh688981', code: '688981', name: '中芯国际', sector: '半导体' },
  { symbol: 'sz002371', code: '002371', name: '北方华创', sector: '半导体' },
  { symbol: 'sh688041', code: '688041', name: '海光信息', sector: '半导体' },
  { symbol: 'sz300750', code: '300750', name: '宁德时代', sector: '新能源' },
  { symbol: 'sz002594', code: '002594', name: '比亚迪', sector: '新能源' },
  { symbol: 'sz300274', code: '300274', name: '阳光电源', sector: '新能源' },
  { symbol: 'sh600519', code: '600519', name: '贵州茅台', sector: '消费' },
  { symbol: 'sz000333', code: '000333', name: '美的集团', sector: '消费' },
  { symbol: 'sh600887', code: '600887', name: '伊利股份', sector: '消费' },
  { symbol: 'sh600036', code: '600036', name: '招商银行', sector: '金融' },
  { symbol: 'sh601318', code: '601318', name: '中国平安', sector: '金融' },
  { symbol: 'sz300059', code: '300059', name: '东方财富', sector: '金融' },
  { symbol: 'sh600276', code: '600276', name: '恒瑞医药', sector: '创新药' },
  { symbol: 'sh688235', code: '688235', name: '百济神州', sector: '创新药' },
  { symbol: 'sh603259', code: '603259', name: '药明康德', sector: '创新药' },
];

const indexUniverse = [
  { symbol: 's_sh000001', code: '000001', name: '上证指数' },
  { symbol: 's_sz399001', code: '399001', name: '深证指数' },
  { symbol: 's_bj899050', code: '899050', name: '北证50' },
  { symbol: 's_sz399006', code: '399006', name: '创业板指' },
  { symbol: 's_sh000016', code: '000016', name: '上证50' },
  { symbol: 's_sh000300', code: '000300', name: '沪深300' },
  { symbol: 's_sh000905', code: '000905', name: '中证500' },
];

function readRows(text: string) {
  const rows = new Map<string, string[]>();
  for (const line of text.split(';')) {
    const match = line.match(/v_([^=]+)="([\s\S]*)"/);
    if (match) rows.set(match[1], match[2].split('~'));
  }
  return rows;
}

function number(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  try {
    const query = [
      ...indexUniverse.map((item) => item.symbol),
      ...stockUniverse.map((item) => `s_${item.symbol}`),
    ].join(',');
    const [quoteOutcome, industryOutcome] = await Promise.allSettled([
      fetchWithTimeout(
        `https://qt.gtimg.cn/q=${query}`,
        {
          headers: {
            Referer: 'https://gu.qq.com/',
            'User-Agent': 'Mozilla/5.0',
          },
          cf: { cacheTtl: 20, cacheEverything: true },
        } as RequestInit & {
          cf: { cacheTtl: number; cacheEverything: boolean };
        },
        8_000,
      ),
      // 行业全量刷新由 /api/industries 独立负责。市场接口只读取共享快照，
      // 避免 496 个行业的冷启动抓取阻塞实时指数行情。
      readDataSnapshot<IndustrySnapshot>(INDUSTRY_CACHE_KEY),
    ]);
    if (quoteOutcome.status === 'rejected')
      throw new Error('market source unavailable');
    const response = quoteOutcome.value;
    if (!response.ok) throw new Error('market source unavailable');
    const rows = readRows(await response.text());

    const indices = indexUniverse.map((item) => {
      const row = rows.get(item.symbol) ?? [];
      return {
        ...item,
        value: number(row[3]),
        change: number(row[5]),
        percent: number(row[5]),
        volume: number(row[6]),
        amount: number(row[9]),
      };
    });

    const stocks = stockUniverse.map((item) => {
      const row = rows.get(`s_${item.symbol}`) ?? [];
      return {
        ...item,
        price: number(row[3]),
        change: number(row[4]),
        percent: number(row[5]),
        volume: number(row[6]),
        amount: number(row[9]),
      };
    });

    const fallbackRankedStocks = stocks
      .filter((item) => item.price > 0)
      .sort((a, b) => b.percent - a.percent);
    const industrySnapshot =
      industryOutcome.status === 'fulfilled' ? industryOutcome.value : null;
    const industries = industrySnapshot?.value.industries || [];
    const seenLeaders = new Set<string>();
    const rankedStocks = industries
      .flatMap((industry) => {
        const leader = industry.leader;
        if (
          !leader ||
          leader.price === null ||
          leader.percent === null ||
          seenLeaders.has(leader.code)
        )
          return [];
        seenLeaders.add(leader.code);
        return [
          {
            symbol: leader.code,
            code: leader.code,
            name: leader.name,
            sector: industry.name,
            price: leader.price,
            change: 0,
            percent: leader.percent,
            volume: 0,
            amount: 0,
          },
        ];
      })
      .slice(0, 18);
    const displayStocks = rankedStocks.length
      ? rankedStocks
      : fallbackRankedStocks;
    const sectors = industries.length
      ? industries.slice(0, 20).map((industry) => ({
          name: industry.name,
          percent: industry.percent,
          sampleSize:
            industry.riseCount + industry.fallCount + industry.flatCount,
          mainNetFlow: industry.mainNetFlow,
        }))
      : [];
    return Response.json(
      {
        indices,
        stocks: displayStocks.slice(0, 6),
        heatmapStocks: displayStocks,
        laggards: industries
          .slice(-3)
          .reverse()
          .map((industry) => ({
            code: industry.leader?.code || industry.code,
            name: industry.leader?.name || industry.name,
            sector: industry.name,
            price: industry.leader?.price || 0,
            percent: industry.percent,
          })),
        sectors,
        updatedAt: new Date().toISOString(),
        provider: industries.length
          ? '腾讯指数 · 东方财富全行业 · 腾讯领涨股'
          : '腾讯行情',
        methodology:
          industrySnapshot?.value.methodology ||
          '实时指数与代表公司来自腾讯行情；行业全量数据由独立接口刷新并写入D1共享缓存，本次尚无可用行业快照。',
        stale: industrySnapshot?.stale || false,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=20',
        },
      },
    );
  } catch {
    return Response.json(
      {
        indices: [],
        stocks: [],
        heatmapStocks: [],
        laggards: [],
        sectors: [],
        updatedAt: new Date().toISOString(),
        provider: '行情源暂不可用',
        methodology: '外部行情服务暂时不可达，请稍后自动重试。',
      },
      { status: 503 },
    );
  }
}
