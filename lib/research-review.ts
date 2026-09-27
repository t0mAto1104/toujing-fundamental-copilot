import type { CompanyReport } from '@/lib/research-types';
import type { ResearchDossier } from '@/lib/research-dossier';
import {
  hasReadFullDisclosure,
  disclosurePeriod,
  requiredDisclosurePeriod,
  expectedFinancialPeriod,
} from '@/lib/research-disclosures';
import { factText, type ResearchFacts } from '@/lib/research-facts';

export type ReportReview = {
  version: string;
  status: 'preliminary' | 'checks-passed';
  checkedAt: string;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
  corrections: Array<{
    location: string;
    original: string;
    replacement: string;
  }>;
  sharedFacts: ResearchFacts;
  withheldSummary?: { thesis: string; conclusion: string };
  boundary: string;
};

// Deliberately narrow: detect explicit claims that a supplied current value is
// missing, not whether arbitrary prose is true. Detailed disclosures still need
// their own evidence. Ambiguous claims remain for review, never auto-invented.
export function falseMissingFacts(text: string, sheet: ResearchFacts) {
  if (
    !/未(?:取得|获取|提供|披露|能取得)|缺少|缺乏|缺失|没有取得|无法获取/.test(
      text,
    )
  )
    return [];
  if (
    /账龄|减值|计提|分部|分产品|各产品|单季|历史|多年|趋势|明细|受限|原因|同比|环比|增长率|增速|扣非|结构|变动/.test(
      text,
    )
  )
    return [];
  if (
    /母公司|子公司|单体|非合并|下半年|前三季度|前九个月|[一二三四1234]季度|[Qq][1-4]|[Hh]2|单月|单日|美元|港元/.test(
      text,
    )
  )
    return [];
  const years = text.match(/20\d{2}/g) || [];
  if (years.some((year) => year !== sheet.period.slice(0, 4))) return [];
  const dates = text.match(/20\d{2}[-/]\d{2}[-/]\d{2}/g) || [];
  if (dates.some((date) => date.replace(/\//g, '-') !== sheet.period))
    return [];
  if (/全年|年报|年度/.test(text) && !sheet.period.endsWith('12-31')) return [];
  if (/半年|中报|H1/i.test(text) && !sheet.period.endsWith('06-30')) return [];
  const aliases: Record<string, RegExp> = {
    经营现金流: /经营现金流|经营活动产生的现金流量净额|\bCFO\b/i,
    合并毛利率: /毛利率/,
    应收账款: /应收账款|应收余额/,
  };
  const missingClauses = text
    .split(/[，；]/)
    .filter((s) =>
      /未(?:取得|获取|提供|披露|能取得)|缺少|缺乏|缺失|没有取得|无法获取/.test(
        s,
      ),
    );
  return sheet.facts.filter((f) =>
    missingClauses.some((s) =>
      (aliases[f.label] || new RegExp(f.label)).test(s),
    ),
  );
}

export function reviewResearchReport(
  report: CompanyReport,
  dossier: ResearchDossier,
  sheet: ResearchFacts,
) {
  const deep = report.deepResearch;
  if (!deep) return;
  const corrections: ReportReview['corrections'] = [];
  const correctedSources = new Set<string>();
  function checkText(text: string, location: string) {
    return text
      .split(/(?<=[。！？\n])/u)
      .map((sentence) => {
        const facts = falseMissingFacts(sentence, sheet);
        if (!facts.length) return sentence;
        const replacement = `【本句口径待核验，暂不采用其推断】${sentence}核对记录：已取得${facts.map(factText).join('；')}。原句中其他资料缺口保留，仍须独立补证。`;
        corrections.push({ location, original: sentence, replacement });
        facts
          .flatMap((f) => f.sourceUrls)
          .forEach((url) => correctedSources.add(url));
        return replacement;
      })
      .join('');
  }
  for (const chapter of deep.chapters)
    for (const key of [
      'facts',
      'analysis',
      'counterEvidence',
      'watchFor',
    ] as const)
      chapter[key] = checkText(chapter[key], `${chapter.topic}/${key}`);
  for (const key of ['thesis', 'conclusion', 'overview'] as const)
    report[key] = checkText(report[key], key);
  for (const key of ['strengths', 'risks', 'catalysts'] as const)
    report[key] = report[key].map((s) => checkText(s, key));
  deep.dataGaps = deep.dataGaps.map((s) => checkText(s, '资料缺口'));
  for (const factor of report.factors) {
    factor.summary = checkText(factor.summary, `${factor.category}因素`);
    if (!factor.evidence.length) factor.signal = '待核验';
  }
  for (const url of correctedSources)
    if (!report.sources.some((s) => s.url === url)) {
      const row = dossier.financialHistory.find((r) => r.sourceUrl === url);
      if (row)
        report.sources.push({
          url,
          title: `${row.period} ${row.statement} 财务原始科目`,
          date: row.period,
          publisher: '财务数据接口',
        });
    }
  const latest = sheet.period;
  const full = dossier.documents.filter(hasReadFullDisclosure);
  const availableLabels = new Set(sheet.facts.map((f) => f.label));
  const incomplete = /未取得|待补|待核|缺失|无法|未提供/;
  const financial = /银行|保险|证券/.test(report.industry);
  const checks: ReportReview['checks'] = [
    {
      label: '最新定期报告正文',
      passed:
        !!latest &&
        full.some((d) => {
          const period = disclosurePeriod(d.title);
          // Quarterly periods require the current half-year/previous annual context.
          const required = requiredDisclosurePeriod(latest);
          return !!period && period >= required;
        }),
      detail:
        '摘要、标题和部分解析不算已读全文；全文读取也不代表所有表格已独立核实。',
    },
    {
      label: '财务资料时效',
      passed:
        !!latest &&
        latest >= expectedFinancialPeriod(dossier.fetchedAt) &&
        latest <= dossier.fetchedAt.slice(0, 10),
      detail:
        '核对采集时点通常应有的年报/中报期间；旧资料或未来期间不能标成当前完整报告。',
    },
    {
      label: '五类因素证据',
      passed: ['政策', '行业', '资金', '财报', '宏观'].every((category) =>
        report.factors.some(
          (f) =>
            f.category === category &&
            f.signal !== '待核验' &&
            f.evidence.length,
        ),
      ),
      detail: '缺证据必须待核验；不适用也需说明可核验的依据，不能默认中性。',
    },
    {
      label: '核心财务事实',
      passed: [
        '归母净利润',
        '经营现金流',
        ...(financial ? [] : ['营业收入']),
      ].every((label) => availableLabels.has(label)),
      detail: '检查最新同期间、合并、币种、单位和来源冲突；不把空值当零。',
    },
    {
      label: '业务利润拆分',
      passed: !!deep.businessSegments?.some(
        (s) =>
          s.sourceUrls.length &&
          /\d/.test(s.revenue) &&
          !incomplete.test(s.revenue) &&
          (financial ||
            (/\d/.test(s.grossMargin) && !incomplete.test(s.grossMargin))),
      ),
      detail: '至少一项有来源的业务收入与毛利率；金融业不强套制造业毛利率。',
    },
    {
      label: '经营传导与反证',
      passed: !!deep.operatingDrivers?.some(
        (d) =>
          d.sourceUrls.length &&
          /\d/.test(d.baseline) &&
          !incomplete.test(d.baseline) &&
          d.transmission.length >= 12 &&
          d.falsification.length >= 8,
      ),
      detail: '检查有数据基准、经营传导和可证伪变量，而非仅罗列行业热词。',
    },
    {
      label: '六章证据结构',
      passed:
        deep.chapters.length === 6 &&
        deep.chapters.every(
          (c) =>
            c.sourceUrls.length &&
            c.facts.length >= 20 &&
            c.analysis.length >= 20,
        ),
      detail: '六章均应有可追溯事实和分析；链接存在不等于该链接支持全部陈述。',
    },
    {
      label: '跨章数据一致性',
      passed: !corrections.length && !report.degraded,
      detail: '检查已知数据被误称缺失及上游来源检查失败；不等于全面事实核验。',
    },
  ];
  const failed = checks.filter((c) => !c.passed);
  deep.review = {
    version: 'report-review-v1',
    status: failed.length ? 'preliminary' : 'checks-passed',
    checkedAt: new Date().toISOString(),
    checks,
    corrections,
    sharedFacts: sheet,
    boundary:
      '程序仅检查资料覆盖、同口径事实和结构；未独立核实每句因果或全部原文，不构成投资建议。',
  };
  if (failed.length) {
    report.stance = '待核验';
    deep.review.withheldSummary = {
      thesis: report.thesis,
      conclusion: report.conclusion,
    };
    report.degraded = true;
    report.notice = [
      ...new Set(
        [
          report.notice,
          `初步分析，尚未通过深度报告资料验收：${failed.map((c) => c.label).join('、')}。`,
        ].filter(Boolean),
      ),
    ].join(' ');
    // Do not carry forward an overall conclusion that may rely on a rejected
    // premise. Keep sourced chapters, tables and the audit trail for inspection.
    report.thesis = '现有证据支持初步分析，关键资料或一致性检查尚未完成。';
    report.conclusion = `本轮暂不形成确定的综合判断。需完成：${failed.map((c) => c.label).join('、')}。以下已保留可追溯事实和条件分析；原模型综合判断不作为结论使用。`;
    deep.dataGaps = [
      ...new Set([
        ...deep.dataGaps,
        ...failed.map((c) => `验收待完成：${c.label}。${c.detail}`),
      ]),
    ];
  }
}
