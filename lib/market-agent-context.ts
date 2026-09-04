import {
  getFundamentalFeed,
  type FundamentalNewsItem,
} from '@/lib/a-stock-macro';
import {
  INDUSTRY_CACHE_KEY,
  type IndustryItem,
  type IndustrySnapshot,
} from '@/lib/a-stock-industries';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';

export type MarketAgentEvidence = {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

const DOMAIN_TERMS = [
  '政策',
  '央行',
  '人民银行',
  '财政',
  '利率',
  '汇率',
  '社融',
  'PMI',
  'CPI',
  'PPI',
  '宏观',
  '资金',
  '融资',
  '北向',
  '南向',
  '财报',
  '业绩',
  '营收',
  '利润',
  '现金流',
  '分红',
  '回购',
  '行业',
  '地产',
  '消费',
  '银行',
  '证券',
  '保险',
  '半导体',
  '电子',
  '汽车',
  '新能源',
  '医药',
  '人工智能',
  '算力',
  '机器人',
  '军工',
  '有色',
  '煤炭',
  '石油',
  '黄金',
];

function relevance(question: string, text: string) {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const term of DOMAIN_TERMS) {
    if (question.includes(term) && normalized.includes(term.toLowerCase()))
      score += 3;
  }
  for (const code of question.match(/\b\d{5,6}\b/g) || []) {
    if (normalized.includes(code)) score += 8;
  }
  return score;
}

function selectNews(question: string, news: FundamentalNewsItem[]) {
  return [...news]
    .map((item) => ({
      item,
      score: relevance(
        question,
        `${item.category}${item.title}${item.summary}${item.implication}`,
      ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.publishedAt.localeCompare(left.item.publishedAt),
    )
    .slice(0, 7)
    .map(({ item }) => item);
}

function compactIndustry(
  item: IndustryItem,
  sourceUrl: string,
  updatedAt: string,
) {
  const flow =
    item.mainNetFlow === null
      ? '主力净流入待核验'
      : `主力净流入${(item.mainNetFlow / 100_000_000).toFixed(2)}亿元`;
  const leader = item.leader
    ? `，领涨公司${item.leader.name}${
        item.leader.percent === null
          ? ''
          : ` ${item.leader.percent >= 0 ? '+' : ''}${item.leader.percent.toFixed(2)}%`
      }`
    : '';
  return {
    title: `${item.name}行业快照`,
    summary: `行业涨跌${item.percent >= 0 ? '+' : ''}${item.percent.toFixed(2)}%，${flow}，上涨${item.riseCount}家、下跌${item.fallCount}家${leader}。`,
    sourceName: '东方财富行业分类 · 腾讯行情',
    sourceUrl,
    publishedAt: updatedAt,
  };
}

function selectIndustries(question: string, snapshot: IndustrySnapshot) {
  const matched = snapshot.industries.filter((item) =>
    question.includes(item.name.replace(/[ⅠⅡⅢ一二三级\s]/g, '')),
  );
  const candidates = [
    ...matched,
    ...snapshot.industries.slice(0, 2),
    ...snapshot.industries.slice(-2),
  ];
  const seen = new Set<string>();
  return candidates
    .filter((item) => !seen.has(item.code) && Boolean(seen.add(item.code)))
    .slice(0, 4)
    .map((item) =>
      compactIndustry(item, snapshot.sourceUrl, snapshot.updatedAt),
    );
}

export async function buildMarketAgentEvidence(question: string) {
  const [feedResult, industryResult] = await Promise.allSettled([
    getFundamentalFeed(),
    readDataSnapshot<IndustrySnapshot>(INDUSTRY_CACHE_KEY),
  ]);
  const rows: Array<Omit<MarketAgentEvidence, 'id'>> = [];

  if (feedResult.status === 'fulfilled') {
    for (const item of selectNews(question, feedResult.value.news)) {
      rows.push({
        title: item.title,
        summary: `${item.summary.slice(0, 140)} ${item.implication.slice(0, 100)}`,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
      });
    }
  }

  if (industryResult.status === 'fulfilled' && industryResult.value) {
    rows.push(
      ...selectIndustries(question, industryResult.value.value),
    );
  }

  const seen = new Set<string>();
  return rows
    .filter(
      (item) =>
        Boolean(item.sourceUrl) &&
        !seen.has(item.sourceUrl) &&
        Boolean(seen.add(item.sourceUrl)),
    )
    .slice(0, 10)
    .map((item, index) => ({ ...item, id: `S${index + 1}` }));
}

export function marketAgentEvidenceForPrompt(
  evidence: MarketAgentEvidence[],
) {
  return evidence.map(({ sourceUrl: _sourceUrl, ...item }) => item);
}
