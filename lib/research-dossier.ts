import { getDocumentProxy } from 'unpdf';
import { deduplicateNews } from '@/lib/news-evidence';
import { cninfoOrgId } from '@/lib/a-stock-company';
import {
  eastmoneyFetch,
  eastmoneyJson,
  fetchJson,
  stripHtml,
} from '@/lib/a-stock-http';
import { listingAStockIdentity, aStockPrefix } from '@/lib/a-stock-ticker';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';
import type { ListingOption } from '@/lib/market-listings';
import type { SourceLink } from '@/lib/research-types';
import { requestDeadline } from '@/lib/request-deadline';
import {
  cashRestrictionTable,
  type CashRestrictionTable,
} from '@/lib/research-pdf-tables';

export type EvidenceDocument = SourceLink & {
  kind: '正式披露' | '财报接口' | '公司回复' | '机构研究' | '新闻';
  fetchedAt: string;
  excerpts: Array<{ page: number | null; text: string }>;
  cashRestrictions?: CashRestrictionTable[];
};
export type FinancialPeriod = {
  currency?: string;
  unit?: string;
  scope?: string;
  basis?: string;
  publishedAt?: string;
  period: string;
  statement: string;
  sourceUrl: string;
  values: Record<string, string>;
};
export type ResearchDossier = {
  fetchedAt: string;
  documents: EvidenceDocument[];
  financialHistory: FinancialPeriod[];
  attempts: Array<{
    source: string;
    status: '取得' | '未取得';
    detail: string;
  }>;
};
const headers = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://www.cninfo.com.cn/',
};
const DOCUMENT_HOSTS = new Set([
  'static.cninfo.com.cn',
  'www.cninfo.com.cn',
  'disc.static.szse.cn',
  'pdf.dfcfw.com',
]);

export function allowedDocumentUrl(input: string) {
  try {
    const u = new URL(input);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      DOCUMENT_HOSTS.has(u.hostname) &&
      /\.pdf$/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

// A bounded, same-host, non-executable document fetch. Never fetch arbitrary
// model-generated URLs, follow redirects to private hosts, or run PDF scripts.
export async function readResearchPdf(
  source: SourceLink,
  signal?: AbortSignal,
): Promise<EvidenceDocument> {
  if (!allowedDocumentUrl(source.url))
    throw new Error('文档地址不在公开披露源白名单内');
  const limit = 12 * 1024 * 1024;
  const response = await fetch(source.url, {
    headers: {
      ...headers,
      Referer: source.url.includes('dfcfw')
        ? 'https://data.eastmoney.com/'
        : headers.Referer,
    },
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > limit)
    throw new Error('披露文件不可达或过大');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('披露文件无正文');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('披露文件超出安全大小');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('披露源未返回 PDF');
  const pdfOptions = { isEvalSupported: false, useSystemFonts: false };
  const pdf = await getDocumentProxy(bytes, pdfOptions);
  const pages: string[] = [];
  const cashRestrictions: CashRestrictionTable[] = [];
  const started = Date.now();
  try {
    if (pdf.numPages > 260)
      throw new Error('报告页数超出本轮解析范围，需联网补证');
    for (let i = 1; i <= pdf.numPages; i++) {
      signal?.throwIfAborted();
      if (Date.now() - started > 15_000) throw new Error('披露正文解析超时');
      const page = await pdf.getPage(i);
      const text = await page.getTextContent();
      const table = cashRestrictionTable(
        text.items.filter((item) => 'str' in item),
        i,
      );
      if (table) cashRestrictions.push(table);
      pages.push(
        text.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      page.cleanup();
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  const excerpts = selectDocumentExcerpts(pages);
  if (!excerpts.length)
    throw new Error('PDF 无可提取正文，可能为扫描件，不能以标题代替正文');
  return {
    ...source,
    kind: source.url.includes('H3_') ? '机构研究' : '正式披露',
    fetchedAt: new Date().toISOString(),
    excerpts,
    ...(cashRestrictions.length ? { cashRestrictions } : {}),
  };
}

// Diversity matters: taking only the beginning of an annual report misses debt,
// related parties and associates. Preserve page numbers and original text.
const excerptTopics = [
  { re: /营业收入[\s\S]*营业成本[\s\S]*毛利率/, count: 2 },
  // Give accounting notes their own slots before long business narratives.
  // Broad “质押/关联方” matches otherwise crowd out actual amounts and cash restrictions.
  { re: /重要的.*联营企业|联营企业.*财务信息/, count: 2 },
  { re: /采购商品.*本期发生额|关联交易内容.*发生额/, count: 1 },
  { re: /所有权或使用权受到限制的资产/, count: 1 },
  {
    re: /主要业务和经营模式|[一二三四五六七八九0-9]\s*、\s*[^。；：，、（）()]{2,18}业务/,
    count: 5,
  },
  { re: /产品价格|产能提升|商业化落地|终端零售|已.*实现.*供货/, count: 2 },
  { re: /产能利用率|产销情况|客户优质|主要客户|前五名客户/, count: 2 },
  {
    re: /重要的.*联营企业|联营企业.*财务信息|权益法.*投资收益|系确认.*投资收益/,
    count: 2,
  },
  { re: /核心竞争力分析|客户认证|行业供需/, count: 1 },
  { re: /关联交易|募集资金|募投|行政处罚|质押/, count: 2 },
  { re: /受限货币|所有权或使用权受到限制|短期借款|非经常性损益/, count: 2 },
];
export function selectDocumentExcerpts(pages: string[], maxChars = 18_000) {
  const selected = new Map<number, { page: number; text: string }>();
  const candidates = pages
    .map((text, i) => ({
      page: i + 1,
      text: text
        .replace(/\s+/g, ' ')
        .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
        .trim(),
    }))
    .filter((x) => x.text.length > 60 && !/目\s*录/.test(x.text.slice(0, 150)));
  let used = 0;
  for (const topic of excerptTopics) {
    const matches = candidates
      .filter((x) => !selected.has(x.page) && topic.re.test(x.text))
      .sort((a, b) => {
        const score = (x: typeof a) =>
          (x.page > 8 ? 2 : 0) +
          Math.min(6, (x.text.match(/\d\.\d+%/g) || []).length) +
          (topic === excerptTopics[1] &&
          /[一二三四五六七八九0-9]\s*、\s*[^。；：，、（）()]{2,18}业务/.test(
            x.text,
          )
            ? 12
            : 0) +
          (/（二）\s*报告期内公司从事的主要业务|主要业务和经营模式/.test(x.text)
            ? 8
            : 0) +
          (/客户优质|产品价格|产能提升|商业化落地|终端零售/.test(x.text)
            ? 6
            : 0) +
          (/重要的.*联营企业|联营企业.*财务信息/.test(x.text) ? 8 : 0) -
          (/本人承诺|本承诺|本人将|公司所处行业/.test(x.text) ? 20 : 0) -
          (/母公司财务|母公司利润表/.test(x.text) ? 20 : 0);
        return score(b) - score(a) || a.page - b.page;
      });
    for (const row of matches.slice(0, topic.count)) {
      // Keep an entire table/page where possible, including its accounting scope.
      const text = row.text.slice(0, 3600);
      if (used + text.length > maxChars) continue;
      selected.set(row.page, { page: row.page, text });
      used += text.length;
    }
  }
  if (!selected.size)
    for (const row of candidates.slice(0, 3))
      selected.set(row.page, { ...row, text: row.text.slice(0, 2000) });
  // Priority order is intentional: downstream prompt budgeting must retain the
  // segment table and main businesses before generic narrative or risk boilerplate.
  return [...selected.values()];
}

type Announcement = SourceLink;
async function announcementList(
  listing: ListingOption,
  keyword: string,
  signal?: AbortSignal,
): Promise<Announcement[]> {
  const identity = listingAStockIdentity(listing);
  if (!identity) return [];
  const org = await cninfoOrgId(identity.code);
  if (!org) throw new Error('未取得公司公告主体映射');
  const body = new URLSearchParams({
    stock: `${identity.code},${org}`,
    tabName: 'fulltext',
    pageSize: '40',
    pageNum: '1',
    column: '',
    category: '',
    plate: '',
    seDate: '',
    searchkey: keyword,
    secid: '',
    sortName: 'time',
    sortType: 'desc',
    isHLtitle: 'false',
  });
  const response = await fetch(
    'https://www.cninfo.com.cn/new/hisAnnouncement/query',
    {
      method: 'POST',
      headers,
      body,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`巨潮 ${response.status}`);
  const data = (await response.json()) as {
    announcements?: Array<{
      announcementTitle?: string;
      adjunctUrl?: string;
      announcementTime?: number;
      secCode?: string;
    }>;
  };
  return (data.announcements || [])
    .filter((x) => !x.secCode || x.secCode === identity.code)
    .flatMap((x) =>
      x.adjunctUrl
        ? [
            {
              title: stripHtml(x.announcementTitle || ''),
              publisher: '巨潮资讯 · 公司披露',
              url: new URL(x.adjunctUrl, 'https://static.cninfo.com.cn/').href,
              date: x.announcementTime
                ? new Date(x.announcementTime).toISOString().slice(0, 10)
                : '发布日期待核验',
            },
          ]
        : [],
    );
}

async function announcementBackup(
  listing: ListingOption,
  signal?: AbortSignal,
) {
  const identity = listingAStockIdentity(listing);
  if (!identity) return [];
  if (identity.market === 'SZ') {
    const data = await fetchJson<{
      data?: Array<{
        title?: string;
        publishTime?: string;
        attachPath?: string;
      }>;
    }>(
      'https://www.szse.cn/api/disc/announcement/annList',
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Referer: 'https://www.szse.cn/',
        },
        body: JSON.stringify({
          channelCode: ['listedNotice_disc'],
          pageSize: 60,
          pageNum: 1,
          stock: [identity.code],
        }),
        signal,
      },
      8_000,
    ).catch(() => null);
    const rows = (data?.data || []).flatMap((x) =>
      x.attachPath
        ? [
            {
              title: stripHtml(x.title || ''),
              publisher: '深圳证券交易所',
              date: (x.publishTime || '').slice(0, 10),
              url: `https://disc.static.szse.cn/download${x.attachPath}`,
            },
          ]
        : [],
    );
    if (rows.length) return rows;
  }
  const u = new URL('https://np-anotice-stock.eastmoney.com/api/security/ann');
  for (const [k, v] of Object.entries({
    sr: '-1',
    page_size: '60',
    page_index: '1',
    ann_type: 'A',
    client_source: 'web',
    stock_list: identity.code,
  }))
    u.searchParams.set(k, v);
  const data = await eastmoneyJson<{
    data?: {
      list?: Array<{ title: string; notice_date: string; art_code: string }>;
    };
  }>(u, { signal }, 12_000);
  return (data.data?.list || []).map((x) => ({
    title: x.title,
    publisher: '东方财富 · 公司公告',
    date: x.notice_date.slice(0, 10),
    url: `https://pdf.dfcfw.com/pdf/H2_${x.art_code}_1.pdf`,
  }));
}

async function readSinaHtml(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { ...headers, Referer: 'https://finance.sina.com.cn/' },
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
  if (
    !response.ok ||
    Number(response.headers.get('content-length')) > 3_000_000
  )
    throw new Error('新浪公告正文暂不可用');
  const data = await response.arrayBuffer();
  if (data.byteLength > 3_000_000) throw new Error('新浪公告超出本轮读取大小');
  return new TextDecoder('gb18030').decode(data);
}

// Sina embeds nested divs inside the article. Stopping at the first </div>
// truncates the report to the preface and silently loses every financial table.
export function sinaDisclosureBlocks(html: string) {
  const start = html.search(/<div\s+id=["']content["']/i);
  if (start < 0) throw new Error('新浪未返回公司公告正文');
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let end = -1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += /^<\/div/i.test(tag[0]) ? -1 : 1;
    if (depth === 0) {
      end = tag.index;
      break;
    }
  }
  if (end < 0) throw new Error('新浪公告正文结构不完整');
  const body = html
    .slice(start, end)
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n');
  const pieces = body
    .split(/<\/table>|<\/p>/gi)
    .map(stripHtml)
    .filter(Boolean);
  const blocks: string[] = [];
  let pending = '';
  let heading = '';
  for (const piece of pieces) {
    if (
      piece.length < 90 &&
      /第[一二三四五六七八九十]+节|^[一二三四五六七八九十0-9]+[、.）]|^[（(][一二三四五六七八九十0-9]+[）)]/.test(
        piece,
      )
    )
      heading = piece;
    if (pending.length + piece.length > 2200) {
      if (pending) blocks.push(pending);
      pending = '';
    }
    if (piece.length > 3600) {
      // Preserve repeated table headers when a very long table needs splitting.
      const header = piece.slice(0, 220);
      const cells = piece.split(' | ');
      let chunk = `${heading} ${header} `;
      for (const cell of cells) {
        if (chunk.length + cell.length > 3200) {
          blocks.push(chunk);
          chunk = `${heading} ${header}（续表） `;
        }
        chunk += `${cell} | `;
      }
      if (chunk.length > header.length + heading.length + 10)
        blocks.push(chunk);
    } else pending += `${piece}\n`;
  }
  if (pending) blocks.push(pending);
  return blocks;
}

export async function readSinaDisclosure(
  url: string,
  title: string,
  signal?: AbortSignal,
): Promise<EvidenceDocument> {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    !['vip.stock.finance.sina.com.cn', 'money.finance.sina.com.cn'].includes(
      u.hostname,
    ) ||
    u.pathname !== '/corp/view/vCB_AllBulletinDetail.php' ||
    !/^\d+$/.test(u.searchParams.get('id') || '') ||
    !/^\d{6}$/.test(u.searchParams.get('stockid') || '')
  )
    throw new Error('不是可核验的公司披露地址');
  const html = await readSinaHtml(u.href, signal);
  const blocks = sinaDisclosureBlocks(html);
  const excerpts = selectDocumentExcerpts(blocks, 14_000).map((x) => ({
    page: null,
    text: x.text,
  }));
  if (!excerpts.length) throw new Error('新浪公告正文为空');
  return {
    title: sinaDisclosureTitle(html) || title,
    url: u.href,
    publisher: '新浪财经 · 公司公告转载',
    date:
      html.match(/公告日期[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '日期待核验',
    kind: '正式披露',
    fetchedAt: new Date().toISOString(),
    excerpts,
  };
}

export function sinaDisclosureTitle(html: string) {
  const title = stripHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  return (
    title
      .split('_公司公告_')[1]
      ?.replace(/新浪财经_新浪网.*$/, '')
      .trim() || ''
  );
}

async function sinaAnnualReport(listing: ListingOption, signal?: AbortSignal) {
  const identity = listingAStockIdentity(listing);
  if (!identity) return null;
  const indexUrl = `https://vip.stock.finance.sina.com.cn/corp/go.php/vCB_AllBulletin/stockid/${identity.code}.phtml?ftype=ndbg`;
  const html = await readSinaHtml(indexUrl, signal);
  const links = [
    ...html.matchAll(
      /<a[^>]+href=['"]([^'"]*vCB_AllBulletinDetail[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ];
  const hit = links.find(
    (x) =>
      /年度报告/.test(stripHtml(x[2])) &&
      !/摘要|董事|监事|英文/.test(stripHtml(x[2])),
  );
  if (!hit) return null;
  return readSinaDisclosure(
    new URL(hit[1].replace(/&amp;/g, '&'), indexUrl).href,
    stripHtml(hit[2]),
    signal,
  );
}

const statementFields: Record<string, string[]> = {
  lrb: [
    '营业收入',
    '营业总收入',
    '营业成本',
    '营业利润',
    '归属于母公司所有者的净利润',
    '归属于母公司股东的净利润',
    '净利润',
    '研发费用',
    '财务费用',
    '投资收益',
    '资产减值损失',
    '信用减值损失',
    '基本每股收益',
  ],
  fzb: [
    '货币资金',
    '应收账款',
    '存货',
    '资产总计',
    '负债合计',
    '短期借款',
    '长期借款',
    '一年内到期的非流动负债',
    '应付债券',
    '在建工程',
    '商誉',
    '归属于母公司股东权益合计',
  ],
  llb: [
    '经营活动产生的现金流量净额',
    '购建固定资产、无形资产和其他长期资产支付的现金',
    '购建固定资产、无形资产和其他长期资产所支付的现金',
    '投资活动产生的现金流量净额',
    '筹资活动产生的现金流量净额',
    '期末现金及现金等价物余额',
  ],
};
export function parseFinancialPeriods(
  data: unknown,
  statement: string,
  sourceUrl: string,
): FinancialPeriod[] {
  const payload = data as {
    result?: {
      data?: {
        report_list?: Record<
          string,
          { data?: Array<{ item_title?: string; item_value?: unknown }> }
        >;
      };
    };
  };
  return Object.entries(payload?.result?.data?.report_list || {})
    .filter(([p]) => /^\d{8}$/.test(p))
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 8)
    .map(([p, report]) => ({
      period: `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6)}`,
      statement,
      sourceUrl,
      currency: 'CNY',
      unit: '元',
      scope: '合并',
      basis: statement === 'fzb' ? '期末余额' : '年初累计',
      values: Object.fromEntries(
        (report.data || [])
          .filter(
            (x) =>
              statementFields[statement]?.includes(x.item_title || '') &&
              (typeof x.item_value === 'number' ||
                (typeof x.item_value === 'string' &&
                  x.item_value.trim() !== '')) &&
              Number.isFinite(Number(x.item_value)),
          )
          .map((x) => [
            x.item_title!,
            `${Number(x.item_value)}${x.item_title === '基本每股收益' ? '元/股' : '元'}`,
          ]),
      ),
    }))
    .filter((x) => Object.keys(x.values).length);
}
async function financialHistory(listing: ListingOption, signal?: AbortSignal) {
  const identity = listingAStockIdentity(listing);
  if (!identity) return [];
  const paperCode = `${aStockPrefix(identity.code, identity.market)}${identity.code}`;
  const rows = await Promise.allSettled(
    Object.keys(statementFields).map(async (statement) => {
      const u = new URL(
        'https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022',
      );
      for (const [k, v] of Object.entries({
        paperCode,
        source: statement,
        type: '0',
        page: '1',
        num: '8',
      }))
        u.searchParams.set(k, v);
      return parseFinancialPeriods(
        await fetchJson(u, { headers, signal }, 12_000),
        statement,
        u.href,
      );
    }),
  );
  return rows.flatMap((x) => (x.status === 'fulfilled' ? x.value : []));
}

async function companyNews(
  listing: ListingOption,
  signal?: AbortSignal,
): Promise<EvidenceDocument[]> {
  const u = new URL('https://search-api-web.eastmoney.com/search/jsonp');
  u.searchParams.set('cb', 'research_news');
  u.searchParams.set(
    'param',
    JSON.stringify({
      uid: '',
      keyword: listing.code,
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: {
        cmsArticleWebOld: {
          searchScope: 'default',
          sort: 'latest',
          pageIndex: 1,
          pageSize: 12,
          preTag: '',
          postTag: '',
        },
      },
    }),
  );
  const res = await eastmoneyFetch(
    u,
    { headers: { Referer: 'https://so.eastmoney.com/' }, signal },
    10_000,
  );
  if (!res.ok) return [];
  const text = await res.text();
  const data = JSON.parse(
    text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')),
  ) as {
    result?: {
      cmsArticleWebOld?: Array<{
        title: string;
        content: string;
        url: string;
        date: string;
        mediaName: string;
      }>;
    };
  };
  return deduplicateNews(
    data.result?.cmsArticleWebOld || [],
    (x) => ({
      title: x.title,
      content: x.content,
      url: x.url,
      date: x.date,
    }),
    { maxAgeDays: 30 },
  )
    .filter((x) => /^https?:\/\//.test(x.url) && x.content)
    .slice(0, 8)
    .map((x) => ({
      title: stripHtml(x.title),
      publisher: x.mediaName || '东方财富资讯',
      url: x.url,
      date: x.date,
      kind: '新闻',
      fetchedAt: new Date().toISOString(),
      excerpts: [{ page: null, text: stripHtml(x.content).slice(0, 1000) }],
    }));
}

async function collectResearchDossierWithinBudget(
  listing: ListingOption,
  signal?: AbortSignal,
): Promise<ResearchDossier> {
  const dossier: ResearchDossier = {
    fetchedAt: new Date().toISOString(),
    documents: [],
    financialHistory: [],
    attempts: [],
  };
  if (!listingAStockIdentity(listing)) {
    dossier.attempts.push({
      source: 'A 股 HTTP 财报',
      status: '未取得',
      detail: '该证券非 A 股，改由联网阶段检索对应交易所及公司投资者关系原文。',
    });
    return dossier;
  }
  const [fin, news, annual, recent, annualHtml] = await Promise.allSettled([
    financialHistory(listing, signal),
    companyNews(listing, signal),
    announcementList(listing, '年度报告', signal),
    announcementList(listing, '', signal),
    sinaAnnualReport(listing, signal),
  ]);
  dossier.financialHistory = fin.status === 'fulfilled' ? fin.value : [];
  dossier.documents = news.status === 'fulfilled' ? news.value : [];
  if (annualHtml.status === 'fulfilled' && annualHtml.value) {
    dossier.documents.unshift(annualHtml.value);
    dossier.attempts.push({
      source: annualHtml.value.title,
      status: '取得',
      detail: '通过新浪财报全文索引读取实际公告正文（HTML，非标题摘要）。',
    });
  }
  dossier.attempts.push({
    source: '新浪多期三表',
    status: dossier.financialHistory.length ? '取得' : '未取得',
    detail: `${dossier.financialHistory.length} 个报表期间；失败不等于公司未披露。`,
  });
  const newsCount = dossier.documents.filter((d) => d.kind === '新闻').length;
  dossier.attempts.push({
    source: '公司新闻接口',
    status: newsCount ? '取得' : '未取得',
    detail: `${newsCount} 条有正文的资讯。`,
  });
  let announcements = [
    ...(annual.status === 'fulfilled' ? annual.value : []),
    ...(recent.status === 'fulfilled' ? recent.value : []),
  ];
  if (!announcements.length)
    announcements = signal?.aborted
      ? []
      : await announcementBackup(listing, signal).catch(() => []);
  const unique = [
    ...new Map(announcements.map((x) => [x.url, x])).values(),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const isFullReport = (s: SourceLink) =>
    /(?:年度|半年度)报告/.test(s.title) &&
    !/摘要|取消|董事|监事|意见|提示|英文/.test(s.title);
  const selected = [
    !dossier.documents.some(
      (x) => /年度报告/.test(x.title) && x.kind === '正式披露',
    )
      ? unique.find(
          (x) =>
            isFullReport(x) &&
            /年度报告/.test(x.title) &&
            !/半年度/.test(x.title),
        )
      : undefined,
    unique.find((x) => isFullReport(x) && /半年度/.test(x.title)),
    unique.find((x) => /投资者关系活动|调研活动|业绩说明/.test(x.title)),
    unique.find((x) => /预告|关联交易|质押|减持|募集资金|处罚/.test(x.title)),
  ].filter((x): x is SourceLink => !!x);
  for (const source of selected) {
    if (signal?.aborted) break;
    try {
      const doc = await readResearchPdf(source, signal);
      dossier.documents.push(doc);
      dossier.attempts.push({
        source: source.title,
        status: '取得',
        detail: `${doc.excerpts.length} 段原文（带 PDF 页码）`,
      });
    } catch {
      dossier.attempts.push({
        source: source.title,
        status: '未取得',
        detail:
          '已找到披露文件但未能读取正文；交由定向联网补证，不能据标题作结论。',
      });
    }
  }
  if (!dossier.documents.some((x) => isFullReport(x) && x.kind === '正式披露'))
    dossier.attempts.push({
      source: '年报/半年报正文',
      status: '未取得',
      detail: '公告接口未返回完整定期报告，联网阶段优先补证。',
    });
  dossier.documents.sort(
    (a, b) =>
      Number(b.kind === '正式披露') - Number(a.kind === '正式披露') ||
      b.date.localeCompare(a.date),
  );
  return dossier;
}

export async function collectResearchDossier(
  listing: ListingOption,
  signal?: AbortSignal,
): Promise<ResearchDossier> {
  // A slow announcement mirror must not consume the entire request lifetime.
  // The caller still receives every source completed inside the fixed window.
  const deadline = requestDeadline(45_000, signal);
  try {
    const dossier = await collectResearchDossierWithinBudget(
      listing,
      deadline.signal,
    );
    if (signal?.aborted) signal.throwIfAborted();
    if (deadline.signal.aborted)
      dossier.attempts.push({
        source: 'HTTP 采集预算',
        status: '未取得',
        detail: '45 秒内未完成的来源已停止，本轮保留已取得资料并交由缺口提示。',
      });
    return dossier;
  } finally {
    deadline.dispose();
  }
}

export async function getResearchDossier(
  listing: ListingOption,
  signal?: AbortSignal,
) {
  const snapshot = await getOrRefreshDataSnapshot({
    cacheKey: `research-dossier:v5:${listing.id}`,
    category: 'research-evidence',
    ttlMs: 6 * 60 * 60 * 1000,
    sourceName: '公司披露正文 · 财报三表 · 财经资讯',
    sourceUrl: 'https://www.cninfo.com.cn/',
    refresh: async () => {
      const dossier = await collectResearchDossier(listing, signal);
      // Do not turn a failed fetch into a six-hour "fresh" empty cache.
      if (!dossier.documents.length && !dossier.financialHistory.length)
        throw new Error('HTTP 资料源本轮均不可用');
      return dossier;
    },
  });
  return {
    ...snapshot.value,
    attempts: [
      ...snapshot.value.attempts,
      ...(snapshot.stale
        ? [
            {
              source: '资料缓存',
              status: '未取得' as const,
              detail: `当前使用 ${snapshot.fetchedAt} 的旧快照；本次更新失败。`,
            },
          ]
        : []),
    ],
  };
}

export function dossierForPrompt(dossier: ResearchDossier, maxChars = 22_000) {
  // Budget by complete passages, not a slice through JSON or a financial table.
  const periods = [...new Set(dossier.financialHistory.map((x) => x.period))]
    .sort()
    .reverse();
  const latest = periods[0] || '';
  const keep = new Set([
    latest,
    `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}`,
    ...periods.filter((x) => x.endsWith('12-31')).slice(0, 2),
  ]);
  const result = {
    ...dossier,
    financialHistory: dossier.financialHistory.filter((x) =>
      keep.has(x.period),
    ),
    documents: dossier.documents.map((d) => ({
      ...d,
      excerpts: [] as EvidenceDocument['excerpts'],
    })),
  };
  let size = JSON.stringify(result).length;
  const docs = dossier.documents;
  const indexes = docs
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(docs[b].kind === '正式披露') -
          Number(docs[a].kind === '正式披露') ||
        docs[b].date.localeCompare(docs[a].date),
    );
  const latestReport = indexes.find(
    (i) =>
      docs[i].kind === '正式披露' && /年度报告|季度报告/.test(docs[i].title),
  );
  const used = docs.map(() => 0);
  const add = (j: number, i: number) => {
    const excerpt = docs[j].excerpts[i];
    if (
      !excerpt ||
      result.documents[j].excerpts.includes(excerpt) ||
      size + excerpt.text.length + 40 > maxChars
    )
      return;
    result.documents[j].excerpts.push(excerpt);
    size += excerpt.text.length + 40;
    used[j] += excerpt.text.length;
  };
  // Prioritize the latest complete report before older/mirror/third-party
  // documents; keeping two long excerpts from every secondary source first
  // had displaced the latest commercial progress and accounting notes.
  if (latestReport !== undefined)
    for (let i = 0; i < docs[latestReport].excerpts.length; i++)
      if (used[latestReport] < 19_000) add(latestReport, i);
  for (let i = 0; i < 2; i++)
    for (const j of indexes) if (docs[j].kind === '正式披露') add(j, i);
  for (const j of indexes)
    for (let i = 0; i < docs[j].excerpts.length; i++) add(j, i);
  return result;
}

export function disclosureIdentity(url: string) {
  const u = new URL(url);
  if (
    ['money.finance.sina.com.cn', 'vip.stock.finance.sina.com.cn'].includes(
      u.hostname,
    ) &&
    u.pathname === '/corp/view/vCB_AllBulletinDetail.php'
  )
    return `sina:${u.searchParams.get('stockid')}:${u.searchParams.get('id')}`;
  u.searchParams.sort();
  return u.href;
}
