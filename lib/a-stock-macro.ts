import {
  eastmoneyJson,
  fetchJson,
  fetchWithTimeout,
  stripHtml,
} from '@/lib/a-stock-http';
import { deduplicateNews, eventTransmission } from '@/lib/news-evidence';
import type { MacroPolicyHistory } from '@/lib/macro-policy-history';
import {
  type DataSnapshot,
  getOrRefreshDataSnapshot,
} from '@/lib/data-snapshot-cache';

export type FundamentalNewsItem = {
  category: '政策' | '行业' | '资金' | '财报' | '宏观';
  title: string;
  summary: string;
  implication: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

export type OfficialMacroSnapshot = {
  pmi: {
    period: string;
    publishedAt: string;
    manufacturing: number;
    nonManufacturing: number;
    composite: number;
    large: number | null;
    medium: number | null;
    small: number | null;
    sourceUrl: string;
  } | null;
  socialFinancing: {
    year: number;
    publishedAt: string;
    sourceUrl: string;
    attachments: string[];
  } | null;
  items: FundamentalNewsItem[];
  updatedAt: string;
};

export type FundamentalFeed = {
  updatedAt: string;
  marketView: string;
  marketTone: string;
  drivers: Array<{
    category: string;
    title: string;
    detail: string;
    sourceName: string;
    sourceUrl: string;
  }>;
  news: FundamentalNewsItem[];
  macroNews: FundamentalNewsItem[];
  macroHistory?: { from: string; complete: boolean; stale: boolean };
  stockReasons: [];
  sectorReasons: [];
  methodology: string;
  stale: boolean;
};

const NBS_INDEX = 'https://www.stats.gov.cn/sj/zxfb/';
const PBC_BASE = 'https://www.pbc.gov.cn';
const PBC_INDEX = `${PBC_BASE}/diaochatongjisi/116219/116319/index.html`;
export const FINANCE_NEWS_CACHE_KEY = 'news:finance';

export function chinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function officialMacroCacheKey(date = new Date()) {
  return `macro:official:v2:${chinaDateKey(date)}`;
}

async function fetchText(url: string, timeout = 15_000) {
  const response = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
    timeout,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function findNumber(text: string, pattern: RegExp) {
  const value = Number(pattern.exec(text)?.[1]);
  return Number.isFinite(value) ? value : null;
}

async function fetchLatestPmi() {
  const index = await fetchText(NBS_INDEX, 20_000);
  const links = Array.from(
    index.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  )
    .map((match) => ({ href: match[1], title: stripHtml(match[2]) }))
    .filter((item) => item.title.includes('采购经理指数'));
  const latest = links[0];
  if (!latest) throw new Error('国家统计局未找到最新采购经理指数条目');
  const sourceUrl = new URL(latest.href, NBS_INDEX).href;
  const html = await fetchText(sourceUrl, 20_000);
  const text = stripHtml(html).replace(/[\s\u3000\xa0]+/g, '');
  const manufacturing = findNumber(
    text,
    /(?<!非)制造业采购经理指数（PMI）为([\d.]+)%/,
  );
  const nonManufacturing = findNumber(text, /非制造业商务活动指数为([\d.]+)%/);
  const composite = findNumber(text, /综合PMI产出指数为([\d.]+)%/);
  if (manufacturing === null || nonManufacturing === null || composite === null)
    throw new Error('国家统计局PMI正文结构发生变化');

  const periodMatch = /(\d{4})年(\d{1,2})月/.exec(latest.title);
  const publishedMatch = /t(\d{4})(\d{2})(\d{2})/.exec(sourceUrl);
  const combined =
    /大、中、小型企业PMI分别为([\d.]+)%、([\d.]+)%和([\d.]+)%/.exec(text);
  return {
    period: periodMatch
      ? `${periodMatch[1]}-${String(Number(periodMatch[2])).padStart(2, '0')}`
      : chinaDateKey().slice(0, 7),
    publishedAt: publishedMatch
      ? `${publishedMatch[1]}-${publishedMatch[2]}-${publishedMatch[3]}`
      : chinaDateKey(),
    manufacturing,
    nonManufacturing,
    composite,
    large: combined
      ? Number(combined[1])
      : findNumber(text, /大型企业PMI为([\d.]+)%/),
    medium: combined
      ? Number(combined[2])
      : findNumber(text, /中型企业PMI为([\d.]+)%/),
    small: combined
      ? Number(combined[3])
      : findNumber(text, /小型企业PMI为([\d.]+)%/),
    sourceUrl,
  };
}

async function fetchSocialFinancingSource() {
  const index = await fetchText(PBC_INDEX);
  const years = Array.from(
    index.matchAll(/href=["']([^"']+)["'][^>]*>\s*(\d{4})年统计数据\s*<\/a>/g),
  ).map((match) => ({ href: match[1], year: Number(match[2]) }));
  const latest = years.sort((a, b) => b.year - a.year)[0];
  if (!latest) throw new Error('人民银行统计页未找到年度数据入口');
  const yearUrl = new URL(latest.href, PBC_BASE).href;
  const yearPage = await fetchText(yearUrl);
  const topicHref = /href=["']([^"']+)["'][^>]*>\s*社会融资规模\s*<\/a>/.exec(
    yearPage,
  )?.[1];
  if (!topicHref) throw new Error('人民银行年度页未找到社会融资规模专题');
  const sourceUrl = new URL(topicHref, PBC_BASE).href;
  const topic = await fetchText(sourceUrl);
  const attachments = Array.from(
    topic.matchAll(/href=["']([^"']+\.xlsx?)["']/gi),
  )
    .map((match) => new URL(match[1], PBC_BASE).href)
    .slice(0, 4);
  const publishedAt =
    /<meta\s+name=["']createDate["']\s+content=["']([^"']+)/i
      .exec(topic)?.[1]
      ?.slice(0, 10) || chinaDateKey();
  return {
    year: latest.year,
    publishedAt,
    sourceUrl,
    attachments,
  };
}

function pmiImplication(pmi: NonNullable<OfficialMacroSnapshot['pmi']>) {
  const manufacturing =
    pmi.manufacturing >= 50 ? '制造业处于扩张区间' : '制造业仍在荣枯线下';
  const nonManufacturing =
    pmi.nonManufacturing >= 50 ? '非制造业活动扩张' : '非制造业活动仍偏弱';
  return `${manufacturing}，${nonManufacturing}。行业分析需继续核验订单、价格、库存和现金流，不能把总量数据直接等同于公司盈利改善。`;
}

async function refreshOfficialMacro(): Promise<OfficialMacroSnapshot> {
  const [pmiResult, socialResult] = await Promise.allSettled([
    fetchLatestPmi(),
    fetchSocialFinancingSource(),
  ]);
  const pmi = pmiResult.status === 'fulfilled' ? pmiResult.value : null;
  const socialFinancing =
    socialResult.status === 'fulfilled' ? socialResult.value : null;
  const items: FundamentalNewsItem[] = [];
  if (pmi)
    items.push({
      category: '宏观',
      title: `${pmi.period} 中国采购经理指数发布`,
      summary: `制造业PMI ${pmi.manufacturing}，非制造业商务活动指数 ${pmi.nonManufacturing}，综合PMI产出指数 ${pmi.composite}。`,
      implication: pmiImplication(pmi),
      sourceName: '国家统计局',
      sourceUrl: pmi.sourceUrl,
      publishedAt: pmi.publishedAt,
    });
  if (socialFinancing)
    items.push({
      category: '宏观',
      title: `${socialFinancing.year}年社会融资规模增量官方数据集更新`,
      summary: `中国人民银行已更新${socialFinancing.year}年社会融资规模专题及官方数据附件，具体数值以人民银行原始表格为准。`,
      implication:
        '社融用于观察实体融资和流动性环境，需结合人民币贷款、政府债券和企业融资结构判断，不作为日频市场信号。',
      sourceName: '中国人民银行',
      sourceUrl: socialFinancing.sourceUrl,
      publishedAt: socialFinancing.publishedAt,
    });
  if (!items.length) throw new Error('官方宏观数据源本轮均不可用');
  return { pmi, socialFinancing, items, updatedAt: new Date().toISOString() };
}

type SinaFeedItem = {
  id?: number;
  rich_text?: string;
  create_time?: string;
  docurl?: string;
  ext?: string;
  tag?: Array<{ id?: string | number }>;
};

type EastmoneyFastNewsItem = {
  code?: string;
  title?: string;
  summary?: string;
  showTime?: string;
};

function classifyNews(text: string): FundamentalNewsItem['category'] {
  if (/政策|国务院|央行|人民银行|证监会|发改委|工信部|财政部|监管/.test(text))
    return '政策';
  if (/财报|业绩|营收|净利润|现金流|分红|年报|半年报|季报/.test(text))
    return '财报';
  if (/资金|融资|北向|南向|持股|增持|减持|回购|成交额/.test(text))
    return '资金';
  if (/GDP|PMI|CPI|PPI|社融|利率|汇率|就业|消费|投资|进出口/.test(text))
    return '宏观';
  return '行业';
}

function implicationFor(category: FundamentalNewsItem['category'], text = '') {
  const map = {
    政策: '需继续核验政策细则、执行时间和企业订单传导，政策表述本身不等同于盈利兑现。',
    行业: '需映射到具体公司的订单、价格、市场份额和成本变化，并由后续财报验证。',
    资金: '资金变化只作为风险偏好与持仓行为证据，不代表企业内在价值或未来涨跌。',
    财报: '应结合收入质量、利润率、经营现金流、库存与资本开支共同判断盈利质量。',
    宏观: '需按行业敏感度映射到需求、成本与融资环境，不宜从单一总量指标直接外推。',
  };
  return (
    (category !== '资金' ? eventTransmission(text) : null) || map[category]
  );
}

const uniqueNews = (items: FundamentalNewsItem[]) =>
  deduplicateNews(items, (item) => ({
    title: item.title,
    content: item.summary,
    date: item.publishedAt,
    url: item.sourceUrl,
  }));

function titleFromText(text: string) {
  const bracket = /^【([^】]+)】/.exec(text)?.[1];
  return bracket || text.split(/[。；]/)[0] || text;
}

function documentUrl(item: SinaFeedItem) {
  if (item.docurl) return item.docurl;
  try {
    const ext = JSON.parse(item.ext || '{}') as { docurl?: string };
    if (ext.docurl) return ext.docurl;
  } catch {}
  return `https://finance.sina.com.cn/7x24/?id=${item.id || ''}`;
}

export async function fetchSinaFinanceNewsPage(
  options: {
    tag?: '1' | '7';
    cursor?: number;
    signal?: AbortSignal;
  } = {},
) {
  const url = new URL('https://zhibo.sina.com.cn/api/zhibo/feed');
  url.searchParams.set('zhibo_id', '152');
  url.searchParams.set('page_size', options.tag ? '100' : '30');
  url.searchParams.set('dire', 'f');
  if (options.tag) url.searchParams.set('tag_id', options.tag);
  if (options.cursor) {
    url.searchParams.set('id', String(options.cursor));
    url.searchParams.set('type', '1');
  }
  const payload = await fetchJson<{
    result?: {
      status?: { code?: number };
      data?: { feed?: { list?: SinaFeedItem[]; min_id?: number } };
    };
  }>(
    url,
    {
      signal: options.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://finance.sina.com.cn/',
      },
    },
    12_000,
  );
  const feed = payload.result?.data?.feed;
  if (payload.result?.status?.code !== 0 || !Array.isArray(feed?.list))
    throw new Error('新浪财经资讯响应结构异常');
  // The API uses tag_id (not tag); reject an ignored category filter.
  if (
    options.tag &&
    feed.list.some(
      (item) => !item.tag?.some((tag) => String(tag.id) === options.tag),
    )
  )
    throw new Error('新浪宏观分类过滤未生效');
  const items = uniqueNews(
    feed.list.flatMap((item) => {
      const text = stripHtml(item.rich_text || '');
      if (!text) return [];
      const title = titleFromText(text);
      const inferred = classifyNews(text);
      const category = options.tag
        ? inferred === '政策' || options.tag === '7'
          ? '政策'
          : '宏观'
        : inferred;
      return [
        {
          category,
          title,
          summary: text.replace(/^【[^】]+】/, ''),
          implication: implicationFor(category, text),
          sourceName: '新浪财经7×24',
          sourceUrl: documentUrl(item),
          publishedAt: String(item.create_time || '').slice(0, 19),
        } satisfies FundamentalNewsItem,
      ];
    }),
  );
  return {
    items,
    cursor: Number(feed.min_id) || null,
    rawCount: feed.list.length,
  };
}

async function fetchSinaFinanceNews() {
  return (await fetchSinaFinanceNewsPage()).items.slice(0, 20);
}

async function fetchEastmoneyFinanceNews() {
  const url = new URL(
    'https://np-weblist.eastmoney.com/comm/web/getFastNewsList',
  );
  url.searchParams.set('client', 'web');
  url.searchParams.set('biz', 'web_724');
  url.searchParams.set('fastColumn', '102');
  url.searchParams.set('sortEnd', '');
  url.searchParams.set('pageSize', '30');
  url.searchParams.set('req_trace', crypto.randomUUID());
  const payload = await eastmoneyJson<{
    data?: { fastNewsList?: EastmoneyFastNewsItem[] };
  }>(
    url,
    {
      headers: {
        Referer: 'https://kuaixun.eastmoney.com/',
      },
    },
    12_000,
  );
  return (payload.data?.fastNewsList || []).flatMap((item) => {
    const title = stripHtml(item.title || item.summary || '');
    const summary = stripHtml(item.summary || item.title || '');
    if (!title || !summary) return [];
    const category = classifyNews(`${title} ${summary}`);
    return [
      {
        category,
        title,
        summary,
        implication: implicationFor(category, `${title} ${summary}`),
        sourceName: '东方财富7×24',
        sourceUrl: item.code
          ? `https://finance.eastmoney.com/a/${item.code}.html`
          : 'https://kuaixun.eastmoney.com/',
        publishedAt: String(item.showTime || '').slice(0, 19),
      } satisfies FundamentalNewsItem,
    ];
  });
}

async function refreshFinanceNews() {
  const [eastmoneyResult, sinaResult] = await Promise.allSettled([
    fetchEastmoneyFinanceNews(),
    fetchSinaFinanceNews(),
  ]);
  const merged = [
    ...(eastmoneyResult.status === 'fulfilled' ? eastmoneyResult.value : []),
    ...(sinaResult.status === 'fulfilled' ? sinaResult.value : []),
  ];
  const verified = uniqueNews(merged);
  if (!verified.length)
    throw new Error('财经资讯主源与备用源均未返回有效日期的内容');
  return verified
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 30);
}

export async function getOfficialMacroSnapshot() {
  return getOrRefreshDataSnapshot<OfficialMacroSnapshot>({
    cacheKey: officialMacroCacheKey(),
    category: 'macro',
    ttlMs: 12 * 60 * 60 * 1_000,
    sourceName: '国家统计局 · 中国人民银行',
    sourceUrl: NBS_INDEX,
    refresh: refreshOfficialMacro,
  });
}

export async function getFinanceNewsSnapshot() {
  return getOrRefreshDataSnapshot<FundamentalNewsItem[]>({
    cacheKey: FINANCE_NEWS_CACHE_KEY,
    category: 'news',
    ttlMs: 10 * 60 * 1_000,
    sourceName: '东方财富7×24 · 新浪财经7×24',
    sourceUrl: 'https://kuaixun.eastmoney.com/',
    refresh: refreshFinanceNews,
  });
}

export function composeFundamentalFeed(
  macro: DataSnapshot<OfficialMacroSnapshot> | null,
  news: DataSnapshot<FundamentalNewsItem[]> | null,
  history: DataSnapshot<MacroPolicyHistory> | null = null,
): FundamentalFeed {
  if (!macro && !news && !history) throw new Error('宏观与财经资讯源暂不可用');
  const official = macro?.value.items || [];
  const financeNews = news?.value || [];
  const combined = uniqueNews([...official, ...financeNews]).sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
  const pmi = macro?.value.pmi;
  const marketView = pmi
    ? `${pmi.period}官方数据显示，制造业PMI为${pmi.manufacturing}、非制造业商务活动指数为${pmi.nonManufacturing}、综合PMI为${pmi.composite}。当前基本面应重点核验需求、价格、库存和现金流的行业分化。`
    : '官方宏观数据本轮未完整更新；当前仅展示可核验财经资讯，不对市场方向作推测。';
  const marketTone = pmi
    ? pmi.manufacturing >= 50 && pmi.nonManufacturing >= 50
      ? '景气扩张'
      : pmi.manufacturing < 50 && pmi.nonManufacturing < 50
        ? '景气偏弱'
        : '景气分化'
    : '等待核验';
  return {
    updatedAt: [macro?.fetchedAt, news?.fetchedAt, history?.fetchedAt]
      .filter(Boolean)
      .sort((a, b) => a!.localeCompare(b!))
      .at(-1)!,
    marketView,
    marketTone,
    drivers: official.map((item) => ({
      category: item.category,
      title: item.title,
      detail: item.implication,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
    })),
    news: combined,
    // Historical news belongs to this UI, not the agent's bounded news input.
    macroNews: uniqueNews([
      ...combined.filter(
        (item) => item.category === '宏观' || item.category === '政策',
      ),
      ...(history?.value.items || []),
    ]).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    macroHistory: history
      ? {
          from: history.value.from,
          complete: history.value.complete,
          stale: history.stale,
        }
      : { from: '', complete: false, stale: true },
    stockReasons: [],
    sectorReasons: [],
    methodology:
      '宏观数据按a-stock-data规范直连国家统计局与中国人民银行；财经快讯使用东方财富7×24主源与新浪财经7×24独立备用源。数据由HTTP核验并写入D1共享缓存，不调用OpenAI。',
    stale: Boolean(macro?.stale || news?.stale),
  };
}

export async function getFundamentalFeed(): Promise<FundamentalFeed> {
  const [macroResult, newsResult] = await Promise.allSettled([
    getOfficialMacroSnapshot(),
    getFinanceNewsSnapshot(),
  ]);
  return composeFundamentalFeed(
    macroResult.status === 'fulfilled' ? macroResult.value : null,
    newsResult.status === 'fulfilled' ? newsResult.value : null,
  );
}
