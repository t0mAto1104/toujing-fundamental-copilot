import type { ResearchDossier } from '@/lib/research-dossier';
import type { EvidenceFinding } from '@/lib/research-evidence-plan';

const backgroundCues = {
  introduction:
    /公司简介|公司概况|公司基本情况|公司.*(?:成立|设立|主要从事)|本行.*(?:成立|提供银行)/,
  business:
    /主要业务|主营业务|经营模式|主要产品|经营范围|经纪业务|公司银行|游戏业务/,
  history:
    /(?:19|20)\d{2}年[^。]{0,100}(?:成立|设立|上市|更名|收购|重组|改制)|(?:成立|设立|上市|更名|重组|改制)(?:于|时间为)?(?:19|20)\d{2}年|发展历程|历史沿革/,
};

// Reuse bounded source passages; these are evidence, not instructions or
// extracted facts. The writer must preserve identity, dates and attribution.
export function companyBackgroundEvidence(
  dossier: ResearchDossier,
  findings: EvidenceFinding[] = [],
) {
  const passages = dossier.documents
    .filter((d) => d.kind === '正式披露')
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((d) =>
      d.excerpts.flatMap((e) =>
        e.text
          .replace(/[\t ]+/g, ' ')
          .split(/(?<=[。！？])/u)
          .map((text) => text.trim())
          .filter(
            (text) =>
              text.length >= 12 && text.length <= 800 && /[。！？]$/.test(text),
          )
          .map((text) => ({
            text,
            sourceUrl: d.url,
            date: d.date,
            page: e.page,
          })),
      ),
    );
  // Search findings have already been checked against the tool's source list.
  passages.push(
    ...findings
      .filter((f) => /公司|业务|沿革|历史|历程|成立|上市/.test(f.topic))
      .map((f) => ({
        text: `${f.claim}（原文：${f.excerpt}）`,
        sourceUrl: f.sourceUrl,
        date: f.publishedAt,
        page: null,
      })),
  );
  return Object.fromEntries(
    Object.entries(backgroundCues).map(([key, cue]) => {
      let budget = 800;
      const seen = new Set<string>();
      return [
        key,
        passages
          .filter((p) => {
            if (!cue.test(p.text) || seen.has(p.text) || p.text.length > budget)
              return false;
            seen.add(p.text);
            budget -= p.text.length;
            return true;
          })
          .slice(0, key === 'history' ? 3 : 2),
      ];
    }),
  );
}

export function companyBackgroundGap(dossier: ResearchDossier) {
  const evidence = companyBackgroundEvidence(dossier);
  return Object.values(evidence).some((rows) => !rows.length)
    ? '公司基础介绍、主营产品/服务及赚钱方式、成立/上市/重组等关键发展历程；优先官网与正式披露，保留日期和来源'
    : '';
}

export function sharedOperatingEvidence(
  dossier: ResearchDossier,
  industry: string,
) {
  const cue = /银行/.test(industry)
    ? /净息差|不良贷款率|拨备覆盖率|信用成本|资本充足率|净资产收益率|ROE/
    : /证券|资本市场/.test(industry)
      ? /净资本|风险覆盖率|资本杠杆率|流动性覆盖率|净稳定资金率|管理规模|佣金率|承销规模/
      : null;
  if (!cue) return [];
  const rows: Array<{ text: string; sourceUrl: string; date: string }> = [];
  let chars = 0;
  for (const d of [...dossier.documents]
    .filter((d) => d.kind === '正式披露')
    .sort((a, b) => b.date.localeCompare(a.date)))
    for (const e of d.excerpts) {
      const passage = e.text.replace(/\s+/g, ' ');
      // Preserve a whole page/table when possible. For long narrative pages,
      // retain only complete sentences, never cut a ratio or its denominator.
      const texts =
        passage.length <= 1800
          ? [passage]
          : passage.split(/(?<=[。！？])/u).filter((t) => /[。！？]$/.test(t));
      for (const text of texts)
        if (
          cue.test(text) &&
          chars + text.length <= 3000 &&
          !rows.some((r) => r.text === text)
        ) {
          rows.push({ text, sourceUrl: d.url, date: d.date });
          chars += text.length;
        }
    }
  return rows;
}
