import type { ReadyEvidence } from '@/lib/company-research-pipeline';
import type { CustomReport, CustomSection } from '@/lib/custom-research';
import type { ModuleId } from '@/lib/report-template';
import {
  disclosurePeriod,
  disclosureType,
  hasReadFullDisclosure,
  requiredDisclosurePeriod,
} from '@/lib/research-disclosures';
import { falseMissingFacts } from '@/lib/research-review';
import { researchIndustryProfile } from '@/lib/research-industry-profile';
import {
  completeResearchProse,
  INCOMPLETE_RESEARCH_PROSE,
} from '@/lib/research-prose';

export type ConclusionReview = {
  version: 'scoped-conclusion-v1';
  status: 'conditional' | 'limited' | 'withheld';
  basis: ModuleId[];
  limitations: string[];
  resolvedGaps: Array<{ original: string; sourceUrls: string[] }>;
};
export type ResearchDiagnostic = {
  kind: '取数失败' | '不适用';
  detail: string;
  sourceUrls: string[];
};

export function distinctResearchGaps(gaps: string[]) {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    const key = gap
      .replace(
        /^(?:核心结论|公司与业务|财务质量|行业与竞争|估值与情景|风险与反证|来源与缺口)[：:]\s*/,
        '',
      )
      .replace(/[\s。；;：:，,]/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Only close a narrowly worded availability gap, never a compound claim or a
// gap about accounting scope, causes, detailed notes or historical comparisons.
export function reconcileResearchGaps(gaps: string[], evidence: ReadyEvidence) {
  const active: string[] = [];
  const resolved: ConclusionReview['resolvedGaps'] = [];
  const diagnostics: ResearchDiagnostic[] = [];
  const financial =
    researchIndustryProfile(evidence.industry || '', evidence.dossier).kind !==
    'other';
  for (const original of distinctResearchGaps(gaps)) {
    const gap = original.trim();
    // Exact matches only: compound warnings may also contain a real missing
    // metric, so they stay active. Never infer 'not disclosed' from an outage.
    const attempt = evidence.dossier.attempts.find(
      (a) =>
        a.status === '未取得' &&
        [
          a.detail,
          `${a.source}：${a.detail}`,
          `缺失：${a.source}；${a.detail}`,
        ].includes(gap),
    );
    if (attempt) {
      diagnostics.push({
        kind: '取数失败',
        detail: `${attempt.source}：${attempt.detail}（仅代表该次取数失败；可用证据与缺口另列。）`,
        sourceUrls: [],
      });
      continue;
    }
    if (
      financial &&
      /^(?:未取得|缺少|未披露)?(?:制造业)?(?:产能利用率|工厂开工率|库存周转率|存货周转率|产品毛利率|CFO净利比|经营现金流净利润兑现率)(?:数据|数值)?(?:未取得|缺失|未披露)?[。.]?$/.test(
        gap,
      )
    ) {
      diagnostics.push({
        kind: '不适用',
        detail: `${gap}：不按制造业指标评价银行/券商，仍需核验其资本和业务风险。`,
        sourceUrls: researchIndustryProfile(
          evidence.industry || '',
          evidence.dossier,
        ).sourceUrls,
      });
      continue;
    }
    let sourceUrls: string[] = [];
    if (
      /^(?:(?:最新|本期|当前|20\d{2}(?:[-/]\d{2}[-/]\d{2}|年(?:半年|全年)?)?)\s*)?(?:营业收入|归母净利润|经营现金流|应收账款|存货|货币资金)[：:，\s]*(?:未取得|未获取|缺失)(?:同口径可核验值|数据|数值)?[。.]?$/.test(
        gap,
      ) ||
      /^(?:未取得|未获取|缺少)(?:最新|本期)?(?:营业收入|归母净利润|经营现金流|应收账款|存货|货币资金)(?:数据|数值)?[。.]?$/.test(
        gap,
      )
    ) {
      sourceUrls = evidence.facts
        ? falseMissingFacts(gap, evidence.facts).flatMap((f) => f.sourceUrls)
        : [];
    }
    if (
      /^(?:未取得|未读取|缺少)?(?:最新|20\d{2}年?)?(?:年度报告|半年度报告|年报|半年报)(?:正文|全文)[：:，\s]*(?:未取得|未读取|缺失|读取失败)?[。.]?$/.test(
        gap,
      )
    ) {
      const kind = /半年/.test(gap) ? 'interim' : 'annual';
      const latest = evidence.facts?.period;
      const year = gap.match(/20\d{2}/)?.[0];
      const floor = year
        ? `${year}-${kind === 'annual' ? '12-31' : '06-30'}`
        : latest
          ? requiredDisclosurePeriod(latest)
          : '';
      sourceUrls = evidence.dossier.documents
        .filter(
          (d) =>
            hasReadFullDisclosure(d) &&
            disclosureType(d.title) === kind &&
            !!floor &&
            (year
              ? disclosurePeriod(d.title) === floor
              : disclosurePeriod(d.title) >= floor),
        )
        .map((d) => d.url);
    }
    if (sourceUrls.length)
      resolved.push({ original, sourceUrls: [...new Set(sourceUrls)] });
    else active.push(original);
  }
  return { active, resolved, diagnostics };
}

const scopeRules: Array<{
  pattern: RegExp;
  modules: ModuleId[];
  boundary: string;
}> = [
  {
    pattern: /估值|\bP[EBS]\b|市值|同业|同行|可比/i,
    modules: ['valuation', 'peers'],
    boundary: '估值或同业资料受限，不据此形成高低估判断。',
  },
  {
    pattern: /两融|融资融券|融券|资金流|股东|持股|股本/,
    modules: ['ownership', 'fiveFactors'],
    boundary: '股东或资金资料受限，不据此推断资金方向。',
  },
  {
    pattern: /产业|行业|宏观|政策|PMI|研报|题材|概念|商品|期货/i,
    modules: ['industry', 'fiveFactors', 'catalysts'],
    boundary: '外部驱动资料受限，不将行业或题材假设当作公司业绩。',
  },
  {
    pattern:
      /营业收入|净利润|现金流|财务|财报|购建|资本开支|受限|应收|存货|债务|净息差|不良|拨备|资本充足|净资本|风险覆盖|资本杠杆|流动性覆盖|净稳定资金/,
    modules: ['finance', 'valuation'],
    boundary: '相关财务口径或期间受限，不据此量化盈利、现金兑现或估值。',
  },
];

const sectionText = (s: CustomSection) =>
  [
    s.companyIntroduction,
    s.developmentHistory,
    s.facts,
    s.analysis,
    s.counterEvidence,
    s.watchFor,
  ].join(' ');

export function conflictingFinancialIssues(
  text: string,
  evidence: ReadyEvidence,
) {
  return (evidence.quality?.issues || []).filter((issue) => {
    if (issue.kind !== '冲突' && issue.kind !== '口径未核实') return false;
    const period = issue.subject.match(/20\d{2}-\d{2}-\d{2}/)?.[0];
    const namedPeriods: string[] = text.match(/20\d{2}-\d{2}-\d{2}/g) || [];
    const comparesPeriods =
      /同比|环比|TTM|单季|增长|下降|上升|趋势|连续|历史/i.test(text);
    if (
      period &&
      namedPeriods.length &&
      !namedPeriods.includes(period) &&
      !comparesPeriods
    )
      return false;
    if (
      period &&
      period !== evidence.facts?.period &&
      !namedPeriods.length &&
      /本期|当前|最新/.test(text) &&
      !comparesPeriods
    )
      return false;
    const subject = issue.subject.replace(/20\d{2}-\d{2}-\d{2}\s*/g, '');
    const aliases = /净利润/.test(subject)
      ? /净利润|净利|盈利/
      : /营业收入/.test(subject)
        ? /营业收入|营收/
        : /经营现金流/.test(subject)
          ? /经营现金流|经营活动.*现金|现金兑现/
          : /购建|资本开支/.test(subject)
            ? /购建|资本开支|自由现金流|现金结余/
            : null;
    return aliases ? aliases.test(text) : !!subject && text.includes(subject);
  });
}

function dependsOnGap(
  text: string,
  gap: string,
  rule: (typeof scopeRules)[number],
  latest: string,
) {
  if (rule.modules[0] !== 'finance') return rule.pattern.test(text);
  const periods = gap.match(/20\d{2}-\d{2}-\d{2}/g) || [];
  if (periods.length && periods.every((p) => p !== latest)) {
    // An older quarter missing from a calculation must not invalidate a current
    // disclosed amount. Unverified period/comparison claims remain excluded.
    return (
      periods.some((p) => text.includes(p)) ||
      /同比|环比|TTM|单季|增长|下降|上升|趋势|连续|历史/i.test(text)
    );
  }
  const metrics = [
    /营业收入|营收/,
    /净利润|净利|利润/,
    /现金流|现金兑现/,
    /应收|账龄/,
    /存货|库存/,
    /购建|资本开支/,
    /受限资金|受限现金/,
    /债务|负债|偿债/,
    /净息差/,
    /不良/,
    /拨备/,
    /资本充足/,
    /净资本|风险覆盖|资本杠杆|流动性覆盖|净稳定资金/,
  ];
  const named = metrics.filter((p) => p.test(gap));
  return named.length
    ? named.some((p) => p.test(text))
    : rule.pattern.test(text);
}

/** Catalogue membership isn't a semantic audit. Keep that boundary explicit;
 * never convert a missing value to zero or an incomplete report to neutrality. */
export function scopeResearchConclusion(
  custom: Pick<CustomReport, 'template' | 'sections' | 'checks' | 'gaps'>,
  evidence: ReadyEvidence,
  limits: Record<'facts' | 'analysis' | 'counterEvidence' | 'watchFor', number>,
  resolvedGaps: ConclusionReview['resolvedGaps'],
): ConclusionReview {
  const { sections, template, checks } = custom;
  const limitations = new Set<string>();
  const excluded = new Set<ModuleId>();
  const summary = sections.summary;
  let rebuild = false;
  for (const block of template.blocks) {
    const failed = checks.filter(
      (c) =>
        !c.passed &&
        (c.label === block.title || c.label === `${block.title}文字完整性`),
    );
    if (failed.length) {
      excluded.add(block.id);
      rebuild = true; // A synthesis may have depended on a rejected module.
      failed.forEach((c) => limitations.add(`${block.title}：${c.detail}`));
    }
  }
  const sheet = evidence.facts;
  const financial =
    researchIndustryProfile(evidence.industry || '', evidence.dossier).kind !==
    'other';
  const required = [
    '营业收入',
    '归母净利润',
    ...(financial ? [] : ['经营现金流']),
  ];
  const missing = required.filter(
    (label) =>
      !sheet?.facts.some(
        (f) =>
          f.label === label && f.period === sheet.period && f.sourceUrls.length,
      ),
  );
  if (missing.length) {
    limitations.add(
      `最新同口径核心财务值尚缺：${missing.join('、')}；只保留不依赖这些数值的局部分析。`,
    );
    rebuild = true;
    excluded.add('finance').add('valuation').add('drivers');
  }
  const stale = checks.find((c) => c.label === '财务资料时效' && !c.passed);
  if (stale) {
    limitations.add(
      `${stale.label}：${stale.detail}；不能据旧期间推断当前财务状况。`,
    );
    excluded.add('finance').add('valuation').add('drivers');
    rebuild = true;
  }
  if (checks.some((c) => c.label === '最新正式披露正文' && !c.passed)) {
    limitations.add(
      '最新正式披露全文尚未完整读取；以下仅基于已取得片段和接口数据，不能视为全面风险核验。',
    );
  }
  for (const gap of distinctResearchGaps(custom.gaps)) {
    const rules = scopeRules.filter((r) => r.pattern.test(gap));
    if (rules.length)
      limitations.add(
        `${rules.map((r) => r.boundary).join(' ')} 具体缺口：${gap}`,
      );
    for (const rule of rules) {
      rule.modules.forEach((id) => {
        if (
          sections[id] &&
          dependsOnGap(
            sectionText(sections[id]!),
            gap,
            rule,
            sheet?.period || '',
          )
        )
          excluded.add(id);
      });
      if (
        summary &&
        dependsOnGap(sectionText(summary), gap, rule, sheet?.period || '')
      )
        rebuild = true;
    }
    if (!rules.length) {
      limitations.add(gap);
      rebuild = true; // Unknown scope is not silently classified as harmless.
    }
  }
  // Known conflicting/missing numbers can appear outside the finance module.
  // Exclude those modules from synthesis as well; do not recycle their claims.
  for (const [id, section] of Object.entries(sections)) {
    const text = sectionText(section);
    const disputed = conflictingFinancialIssues(text, evidence).length > 0;
    const missingMentioned = missing.some((label) => text.includes(label));
    if (disputed || missingMentioned) {
      excluded.add(id as ModuleId);
      rebuild = true;
    }
  }
  if (!summary) {
    const basis = (Object.keys(sections) as ModuleId[]).filter(
      (id) => sections[id]?.sourceUrls.length && !excluded.has(id),
    );
    return {
      version: 'scoped-conclusion-v1',
      status: basis.length ? 'limited' : 'withheld',
      basis,
      limitations: [...limitations],
      resolvedGaps,
    };
  }
  if (!rebuild && !excluded.has('summary'))
    return {
      version: 'scoped-conclusion-v1',
      status: 'conditional',
      basis: ['summary'],
      limitations: [...limitations],
      resolvedGaps,
    };

  const candidates = (
    [
      'business',
      'finance',
      'industry',
      'drivers',
      'valuation',
      'peers',
      'risk',
      'governance',
      'catalysts',
      'ownership',
      'fiveFactors',
      'custom',
    ] as ModuleId[]
  ).filter((id) => sections[id]?.sourceUrls.length && !excluded.has(id));
  const used = new Set<ModuleId>();
  const compact = (field: keyof typeof limits) => {
    let text = '';
    let count = 0;
    for (const id of candidates) {
      const remaining = limits[field] - Array.from(text).length;
      const part = completeResearchProse(sections[id]![field], remaining).text;
      if (!part || part === INCOMPLETE_RESEARCH_PROSE) continue;
      if (text.includes(part)) continue;
      text += part;
      used.add(id);
      if (++count >= 3) break;
    }
    return text;
  };
  const analysis = compact('analysis');
  // Replace all four fields together: never retain a rejected summary's facts,
  // risk claims or citations beside newly reconstructed analysis.
  Object.assign(summary, {
    analysis:
      analysis ||
      '本轮尚无通过核验且适合形成结论的分析；请按下列具体原因补证，不据缺口推断公司优劣。',
    facts: analysis
      ? compact('facts') || '可追溯事实见下列通过检查的模块。'
      : '本轮核心证据不足，原综合判断未采用。',
    counterEvidence: analysis
      ? compact('counterEvidence') || '资料仍不完整，不能据此排除其他风险。'
      : '没有足够证据不等于公司没有风险。',
    watchFor: analysis
      ? compact('watchFor') || '补齐下列受限资料后再核验综合判断。'
      : '先解决下列证据和一致性问题。',
    sourceUrls: analysis
      ? [...new Set([...used].flatMap((id) => sections[id]!.sourceUrls))]
      : [],
  } satisfies Partial<CustomSection>);
  return {
    version: 'scoped-conclusion-v1',
    status: analysis ? 'limited' : 'withheld',
    basis: analysis ? [...used] : [],
    limitations: [...limitations],
    resolvedGaps,
  };
}
