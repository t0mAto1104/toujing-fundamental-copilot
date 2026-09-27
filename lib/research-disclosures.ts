import type { EvidenceDocument } from '@/lib/research-dossier';

// Classification is based on the disclosed title/cover, never on a guessed URL.
export function disclosureType(title: string) {
  const text = title.replace(/\s/g, '');
  if (/摘要/.test(text)) return 'summary' as const;
  if (/取消|董事|监事|意见|提示|英文/.test(text)) return 'other' as const;
  if (/半年度报告|中期报告/.test(text)) return 'interim' as const;
  if (/年度报告|年报全文/.test(text)) return 'annual' as const;
  return 'other' as const;
}

export function isFullDisclosure(
  doc: Pick<EvidenceDocument, 'title'> & Partial<EvidenceDocument>,
) {
  const type = doc.disclosureType ?? disclosureType(doc.title);
  return (
    (type === 'annual' || type === 'interim') &&
    (!doc.excerpts || doc.excerpts.some((e) => e.text.trim().length >= 100))
  );
}

export function hasReadFullDisclosure(doc: EvidenceDocument) {
  return (
    doc.kind === '正式披露' &&
    isFullDisclosure(doc) &&
    (doc.extraction
      ? doc.extraction.complete === true
      : doc.htmlBodyComplete === true)
  );
}

export function requiredDisclosurePeriod(latest: string) {
  return latest.endsWith('03-31')
    ? `${Number(latest.slice(0, 4)) - 1}-12-31`
    : latest.endsWith('09-30')
      ? `${latest.slice(0, 4)}-06-30`
      : latest;
}

export function expectedFinancialPeriod(asOf: string | number) {
  const date = new Date(asOf),
    year = date.getUTCFullYear(),
    month = date.getUTCMonth();
  return month >= 8 ? `${year}-06-30` : `${year - (month >= 4 ? 1 : 2)}-12-31`;
}

export function selectDisclosureSources(
  sources: Array<
    Pick<EvidenceDocument, 'title' | 'url' | 'publisher' | 'date'>
  >,
  existing: EvidenceDocument[],
) {
  const unique = [...new Map(sources.map((s) => [s.url, s])).values()].sort(
    (a, b) =>
      disclosurePeriod(b.title).localeCompare(disclosurePeriod(a.title)) ||
      b.date.localeCompare(a.date),
  );
  const newest = (type: 'annual' | 'interim') => {
    const source = unique.find((s) => disclosureType(s.title) === type);
    return source &&
      !existing.some(
        (doc) =>
          hasReadFullDisclosure(doc) &&
          (doc.disclosureType ?? disclosureType(doc.title)) === type &&
          !!disclosurePeriod(source.title) &&
          disclosurePeriod(doc.title) === disclosurePeriod(source.title) &&
          doc.date >= source.date,
      )
      ? source
      : undefined;
  };
  return [
    newest('interim'),
    newest('annual'),
    unique.find((s) => /投资者关系活动|调研活动|业绩说明/.test(s.title)),
    unique.find((s) => /预告|关联交易|质押|减持|募集资金|处罚/.test(s.title)),
  ].filter((s): s is (typeof unique)[number] => !!s);
}

export function disclosurePeriod(title: string) {
  const year = title.match(/20\d{2}/)?.[0];
  const type = disclosureType(title.replace(/摘要/g, ''));
  return year && (type === 'annual' || type === 'interim')
    ? `${year}-${type === 'annual' ? '12-31' : '06-30'}`
    : '';
}

export function missingDisclosureKinds(
  sources: Array<{ title: string }>,
  documents?: EvidenceDocument[],
) {
  return (['annual', 'interim'] as const).filter((kind) => {
    const latest = sources
      .filter((s) => disclosureType(s.title.replace(/摘要/g, '')) === kind)
      .map((s) => disclosurePeriod(s.title))
      .sort()
      .at(-1);
    return !(documents || sources).some(
      (doc) =>
        (documents
          ? hasReadFullDisclosure(doc as EvidenceDocument)
          : disclosureType(doc.title) === kind) &&
        disclosureType(doc.title.replace(/摘要/g, '')) === kind &&
        !!latest &&
        disclosurePeriod(doc.title) >= latest,
    );
  });
}

// Read the business section first, then sample the note section before a long
// report can exhaust the time budget. Physical PDF page numbers are preserved.
export function researchPdfPageOrder(total: number) {
  const range = (from: number, to: number) =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  return [
    ...new Set([
      ...range(1, Math.min(120, total)),
      ...range(
        Math.max(121, Math.floor(total * 0.6)),
        Math.min(total, Math.ceil(total * 0.9)),
      ),
      ...range(121, total),
    ]),
  ].slice(0, 1000);
}
