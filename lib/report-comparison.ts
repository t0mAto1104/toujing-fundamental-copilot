import type { CompanyReport } from '@/lib/research-types';
export function compareReportVersions(
  before: CompanyReport,
  after: CompanyReport,
) {
  if (
    before.companyCode !== after.companyCode ||
    before.exchange !== after.exchange ||
    (before.selectedListingId &&
      after.selectedListingId &&
      before.selectedListingId !== after.selectedListingId)
  )
    throw new Error('请选择同一上市证券的两个报告版本。');
  const key = (metric: CompanyReport['metrics'][number]) =>
    `${metric.label}|${metric.period}`;
  const oldMetrics = new Map(
    (before.metrics || []).map((metric) => [key(metric), metric]),
  );
  const newMetrics = new Map(
    (after.metrics || []).map((metric) => [key(metric), metric]),
  );
  return {
    evidenceChanged:
      before.deepResearch?.quality && after.deepResearch?.quality
        ? before.deepResearch.quality.evidenceHash !==
          after.deepResearch.quality.evidenceHash
        : null,
    methodChanged:
      before.deepResearch?.methodology && after.deepResearch?.methodology
        ? before.deepResearch.methodology.version !==
          after.deepResearch.methodology.version
        : null,
    addedGaps: (after.deepResearch?.dataGaps ?? []).filter(
      (x) => !before.deepResearch?.dataGaps.includes(x),
    ),
    removedGaps: (before.deepResearch?.dataGaps ?? []).filter(
      (x) => !after.deepResearch?.dataGaps.includes(x),
    ),
    changedCalculations: (
      after.deepResearch?.quality?.calculations ?? []
    ).flatMap((current) => {
      const old = before.deepResearch?.quality?.calculations.find(
        (c) =>
          c.label === current.label &&
          c.period === current.period &&
          c.unit === current.unit &&
          c.formula === current.formula,
      );
      return old && old.value !== current.value
        ? [
            {
              label: current.label,
              period: current.period,
              unit: current.unit,
              before: old.value,
              after: current.value,
              sourceUrls: [
                ...new Set(current.inputs.flatMap((x) => x.sourceUrls)),
              ],
            },
          ]
        : [];
    }),
    before: {
      model: before.researchRun?.model || '旧版未记录',
      asOf: before.researchRun?.evidenceAsOf || before.updatedAt,
      conclusion: before.conclusion,
    },
    after: {
      model: after.researchRun?.model || '旧版未记录',
      asOf: after.researchRun?.evidenceAsOf || after.updatedAt,
      conclusion: after.conclusion,
    },
    metrics: [...new Set([...oldMetrics.keys(), ...newMetrics.keys()])].flatMap(
      (id) => {
        const old = oldMetrics.get(id),
          current = newMetrics.get(id);
        return old?.value === current?.value
          ? []
          : [
              {
                label: (current || old)!.label,
                period: (current || old)!.period,
                before: old?.value || '此版未列示',
                after: current?.value || '此版未列示',
              },
            ];
      },
    ),
    addedRisks: (after.risks || []).filter(
      (risk) => !before.risks?.includes(risk),
    ),
    removedRisks: (before.risks || []).filter(
      (risk) => !after.risks?.includes(risk),
    ),
    addedSources: (after.sources || []).filter(
      (source) => !before.sources?.some((old) => old.url === source.url),
    ),
    removedSources: (before.sources || []).filter(
      (source) => !after.sources?.some((current) => current.url === source.url),
    ),
  };
}
