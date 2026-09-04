import { stripUrls } from '@/lib/ai-output';
import {
  RESEARCH_FRAMEWORK_VERSION,
  RESEARCH_TOPICS,
} from '@/lib/research-framework';
import type {
  CompanyMetric,
  CompanyReport,
  ResearchChapter,
  ResearchScenario,
  SourceLink,
} from '@/lib/research-types';

export function canonicalSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.hash = '';
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

// A source catalogue contains metadata only. EvidenceDocument is structurally
// a SourceLink, but spreading it duplicates all PDF excerpts into every prompt
// and into the saved report. Keep the field boundary explicit.
export function sourceMetadata(source: SourceLink): SourceLink | null {
  const url = canonicalSourceUrl(source.url);
  if (!url) return null;
  return {
    title: stripUrls(source.title, 140) || new URL(url).hostname,
    publisher: stripUrls(source.publisher, 80) || new URL(url).hostname,
    date: source.date,
    url,
  };
}

const missingChapter = (topic: ResearchChapter['topic']): ResearchChapter => ({
  topic,
  facts: '本轮未取得可追溯的足够资料。',
  analysis: '资料不足，暂不作公司特定判断。',
  counterEvidence: '证据缺口本身不代表公司没有风险或没有相关业务。',
  watchFor: `需补充${topic}相关正式披露后再评估。`,
  sourceUrls: [],
});

function sameNumericValue(left: string, right: string) {
  const parse = (input: string) => {
    const text = input.replace(/[,，\s]/g, '').replace(/^同比/, '');
    const match = text.match(/^([+-]?\d+(?:\.\d+)?)(亿|万)?(元|%|倍|元\/股)?$/);
    if (!match) return null;
    return {
      value:
        Number(match[1]) *
        (match[2] === '亿' ? 1e8 : match[2] === '万' ? 1e4 : 1),
      unit: match[3] || '',
    };
  };
  if (left === right) return true;
  const a = parse(left);
  const b = parse(right);
  return (
    !!a &&
    !!b &&
    a.unit === b.unit &&
    Math.abs(a.value - b.value) <= Math.max(1, Math.abs(a.value)) * 1e-9
  );
}

function missingScenario(name: ResearchScenario['name']): ResearchScenario {
  return {
    name,
    assumptions: '仅作条件分析：需先取得可核验的经营基准。',
    impact: '目前不能可靠判断该情景对公司业绩的影响。',
    validation: '补充正式披露和关键经营变量后再比较。',
    sourceUrls: [],
  };
}

/** Source membership is a provenance check, not a guarantee that a claim is true.
 * Never treat model-provided source metadata as evidence that a URL was retrieved.
 */
export function enforceReportIntegrity(
  input: CompanyReport,
  context: {
    sources: SourceLink[];
    metrics: Omit<CompanyMetric, 'assessment'>[];
    listing: {
      id: string;
      name: string;
      code: string;
      exchange: string;
      currency: string;
    };
    quote: CompanyReport['quote'] | null;
    warnings: string[];
    asOf: string;
  },
): CompanyReport {
  const report = structuredClone(input);
  const sourceMap = new Map<string, SourceLink>();
  for (const source of context.sources) {
    const metadata = sourceMetadata(source);
    if (metadata && !sourceMap.has(metadata.url))
      sourceMap.set(metadata.url, metadata);
  }
  const cited = new Set<string>();
  const acceptedUrl = (value: unknown) => {
    const url = canonicalSourceUrl(value);
    if (!url || !sourceMap.has(url)) return '';
    cited.add(url);
    return url;
  };
  const acceptedUrls = (values: string[]) => [
    ...new Set(values.map(acceptedUrl).filter(Boolean)),
  ];
  let blocked = false;
  const gaps = new Set(context.warnings.map((value) => stripUrls(value, 180)));

  report.companyName = context.listing.name;
  report.companyCode = context.listing.code;
  report.exchange = context.listing.exchange;
  report.selectedListingId = context.listing.id;
  report.updatedAt = context.asOf;
  report.frameworkVersion = RESEARCH_FRAMEWORK_VERSION;
  report.quote = context.quote || {
    price: '未取得',
    change: '—',
    marketCap: '未取得',
    currency: context.listing.currency,
    asOf: '行情源本轮未返回可核验报价',
  };
  if (context.quote?.sourceUrl) acceptedUrl(context.quote.sourceUrl);
  if (!context.quote) gaps.add('当前价格和市值未取得，未采用模型生成报价。');
  if (context.quote?.isStale)
    gaps.add(context.quote.staleReason || '行情为旧快照，并非实时价格。');

  const metricSources = new Set(
    context.metrics.map((m) => canonicalSourceUrl(m.sourceUrl)),
  );
  report.metrics = report.metrics
    .flatMap((metric) => {
      const labelKey = (label: string) =>
        label
          .replace(/归属于母公司(?:股东|所有者)的净利润/g, '归母净利润')
          .replace(/经营活动产生的现金流量净额/g, '经营现金流净额')
          .replace(/\s|[()（）]/g, '');
      const raw = context.metrics.find(
        (item) =>
          labelKey(item.label) === labelKey(metric.label) &&
          item.period === metric.period,
      );
      const sourceUrl = acceptedUrl(raw?.sourceUrl || metric.sourceUrl);
      if (!sourceUrl || (!raw && metricSources.has(sourceUrl))) {
        blocked = true;
        gaps.add('部分财务指标无法与本轮原始数据或检索来源对应，已移除。');
        return [];
      }
      const corrected =
        raw && (raw.value !== metric.value || raw.change !== metric.change);
      if (corrected) {
        gaps.add('财务数值和同比已按接口原始口径校正。');
        // Formatting-only differences must not erase sound analysis. A real
        // numerical conflict still invalidates a summary derived from it.
        if (
          (!sameNumericValue(raw.value, metric.value) &&
            /\d/.test(metric.value)) ||
          (!sameNumericValue(raw.change, metric.change) &&
            /\d/.test(metric.change))
        )
          blocked = true;
      }
      return [
        {
          ...metric,
          ...raw,
          sourceUrl,
          assessment: corrected
            ? '已按原始接口口径校正；相关分析需结合完整财报重新核对。'
            : stripUrls(metric.assessment, 220),
        },
      ];
    })
    .slice(0, 6);
  if (!report.metrics.length)
    gaps.add('缺少可追溯的财务指标，不推算利润或现金流。');

  report.factors = report.factors.map((factor) => {
    const evidence = factor.evidence.flatMap((item) => {
      const sourceUrl = acceptedUrl(item.sourceUrl);
      if (!sourceUrl) {
        blocked = true;
        return [];
      }
      return [
        {
          ...item,
          sourceUrl,
          sourceName: sourceMap.get(sourceUrl)!.publisher,
          label: stripUrls(item.label, 90),
          value: stripUrls(item.value, 220),
        },
      ];
    });
    if (!evidence.length)
      return {
        ...factor,
        signal: '中性',
        title: `${factor.category}资料待补充`,
        summary: '本轮未取得足以支持公司特定判断的证据，不代表不存在相关影响。',
        evidence,
      };
    return {
      ...factor,
      title: stripUrls(factor.title, 120),
      summary: stripUrls(factor.summary, 260),
      evidence,
    };
  });

  const deep = report.deepResearch;
  if (deep) {
    deep.chapters = RESEARCH_TOPICS.map((topic) => {
      const chapter = deep.chapters.find((item) => item.topic === topic);
      const sourceUrls = acceptedUrls(chapter?.sourceUrls || []);
      const hasUnknownSource = chapter?.sourceUrls.some(
        (url) => !sourceMap.has(canonicalSourceUrl(url) || ''),
      );
      if (!chapter || !sourceUrls.length || hasUnknownSource) {
        if (chapter?.sourceUrls.length) blocked = true;
        gaps.add(`${topic}：资料不足，未补造公司事实。`);
        return missingChapter(topic);
      }
      return {
        ...chapter,
        sourceUrls,
        facts: stripUrls(chapter.facts, 1100),
        analysis: stripUrls(chapter.analysis, 1600),
        counterEvidence: stripUrls(chapter.counterEvidence, 750),
        watchFor: stripUrls(chapter.watchFor, 650),
      };
    });
    deep.scenarios = (['基准', '改善', '承压'] as const).map((name) => {
      const scenario = deep.scenarios.find((item) => item.name === name);
      const sourceUrls = acceptedUrls(scenario?.sourceUrls || []);
      // Dates and disclosed operating baselines are valid in scenarios. A digit
      // is not evidence of hallucination; do not erase the whole report for it.
      const text = scenario
        ? `${scenario.assumptions} ${scenario.impact} ${scenario.validation}`
        : '';
      if (
        !scenario ||
        !sourceUrls.length ||
        scenario.sourceUrls.some(
          (url) => !sourceMap.has(canonicalSourceUrl(url) || ''),
        ) ||
        /目标价|止损|仓位|买入区间|卖出区间|概率\s*[:：]?\s*\d/.test(text)
      ) {
        if (scenario && scenario.sourceUrls.length) blocked = true;
        gaps.add('情景仅作条件讨论；无可靠基准时不量化预测、概率或收益。');
        return missingScenario(name);
      }
      return {
        ...scenario,
        sourceUrls,
        assumptions: stripUrls(scenario.assumptions, 700),
        impact: stripUrls(scenario.impact, 700),
        validation: stripUrls(scenario.validation, 600),
      };
    });
    deep.timeline = deep.timeline
      .flatMap((item) => {
        const sourceUrl = acceptedUrl(item.sourceUrl);
        if (!sourceUrl) {
          blocked = true;
          gaps.add('未附可追溯来源的催化事件已移除。');
          return [];
        }
        // A future calendar date must not be labeled as an accomplished event.
        const date = item.period.match(/\d{4}-\d{2}-\d{2}/)?.[0];
        const status =
          date && date > context.asOf.slice(0, 10) && item.status === '已披露'
            ? '计划/指引'
            : item.status;
        return [
          {
            ...item,
            sourceUrl,
            status,
            period: stripUrls(item.period, 80),
            event: stripUrls(item.event, 160),
            impact: stripUrls(item.impact, 180),
          },
        ];
      })
      .slice(0, 7);
    // New tables stay optional for saved v1 reports. Reject only the offending
    // row; an untraceable peer must not erase verified business/financial rows.
    for (const key of [
      'businessSegments',
      'operatingDrivers',
      'peerComparison',
      'financialTrend',
      'strategicInvestments',
      'governanceFindings',
    ] as const) {
      const rows = deep[key];
      if (!rows) continue;
      const kept = rows
        .filter(
          (row) =>
            row.sourceUrls.length &&
            row.sourceUrls.every((url) =>
              sourceMap.has(canonicalSourceUrl(url) || ''),
            ),
        )
        .map((row) => {
          const clean = Object.fromEntries(
            Object.entries(row).map(([field, value]) => [
              field,
              typeof value === 'string' ? stripUrls(value, 1000) : value,
            ]),
          );
          return { ...clean, sourceUrls: acceptedUrls(row.sourceUrls) };
        });
      if (kept.length !== rows.length) {
        gaps.add(`${key}：部分行未通过来源检查，已移除，其他有效内容保留。`);
        blocked = true;
      }
      Object.assign(deep, { [key]: kept });
    }
    for (const gap of deep.dataGaps) gaps.add(stripUrls(gap, 180));
    if (!deep.timeline.length)
      gaps.add('未取得有来源的催化时间表，不预设披露或投产日期。');
    deep.dataGaps = [...gaps].filter(Boolean);
    if (!deep.chapters.some((chapter) => chapter.sourceUrls.length))
      blocked = true;
  }

  report.thesis = stripUrls(report.thesis, 1000);
  report.overview = stripUrls(report.overview, 1200);
  report.conclusion = stripUrls(report.conclusion, 1400);
  report.strengths = report.strengths.map((value) => stripUrls(value, 600));
  report.risks = report.risks.map((value) => stripUrls(value, 650));
  report.catalysts = report.catalysts.map((value) => stripUrls(value, 500));
  const grounded =
    deep?.chapters.filter((chapter) => chapter.sourceUrls.length) || [];
  if (!cited.size || (deep && !grounded.length)) {
    report.stance = '中性';
    report.thesis = '证据尚不完整，暂不形成确定的基本面结论。';
    report.overview =
      '以下保留可追溯资料与条件分析；无法对应本轮来源的内容已移除。';
    report.conclusion =
      '需先补齐资料缺口，再验证利润驱动因素、持续性和反证条件；现阶段不宜据此作确定判断。';
    report.strengths = [];
    report.risks = ['信息不完整，尚不能充分识别和衡量公司风险。'];
    report.catalysts = [];
    report.notice =
      '部分内容未通过来源检查或证据不足，已降级为资料有限的研究结果。';
  } else if (blocked) {
    // Summaries may have relied on a rejected section. Rebuild them from the
    // retained, sourced chapters without another paid generation request.
    report.stance = '中性';
    report.thesis = grounded
      .slice(0, 2)
      .map((chapter) => chapter.analysis)
      .join('\n');
    report.overview = grounded[0]?.facts || report.overview;
    const conclusionChapters = [
      '业务与利润来源',
      '盈利质量与财务风险',
      '估值与预期差',
      '治理与资本配置',
    ].flatMap((topic) => grounded.filter((chapter) => chapter.topic === topic));
    report.conclusion = conclusionChapters
      .map(
        (chapter) =>
          `${chapter.topic}：${chapter.analysis} 风险与反证：${chapter.counterEvidence} 验证条件：${chapter.watchFor}`,
      )
      .join('\n');
    report.strengths = [];
    report.risks = grounded.map((chapter) => chapter.counterEvidence);
    report.catalysts =
      deep?.timeline.map(
        (item) => `${item.period}（${item.status}）：${item.event}`,
      ) || [];
    report.notice =
      '部分条目未通过来源检查，已逐项移除；结论仅依据保留的证据，不代表资料已完整。';
  } else if (context.quote?.isStale) report.notice = context.quote.staleReason;
  // Keep every referenced source; a fixed slice could otherwise orphan citations.
  report.sources = [...cited].map((url) => sourceMap.get(url)!);
  report.disclaimer =
    '本报告由 AI 基于本轮取得的资料辅助分析；来源可追溯不等于所有陈述已获独立核实。仅供信息参考，不构成任何投资建议。';
  return report;
}
