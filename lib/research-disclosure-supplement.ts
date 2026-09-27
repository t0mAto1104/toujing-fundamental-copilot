import {
  allowedDocumentUrl,
  disclosureIdentity,
  type ResearchDossier,
} from '@/lib/research-dossier';
import {
  disclosurePeriod,
  disclosureType,
  hasReadFullDisclosure,
} from '@/lib/research-disclosures';
import { canonicalSourceUrl } from '@/lib/research-integrity';
import type { ListingOption } from '@/lib/market-listings';
import type { SourceLink } from '@/lib/research-types';

// Same boundary as readSinaDisclosure, plus the requested company's security ID.
// This only selects a candidate; reading it does not prove all its claims.
export function isCompanySinaDisclosure(url: string, code: string) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      ['vip.stock.finance.sina.com.cn', 'money.finance.sina.com.cn'].includes(
        u.hostname,
      ) &&
      u.pathname === '/corp/view/vCB_AllBulletinDetail.php' &&
      u.searchParams.getAll('id').length === 1 &&
      u.searchParams.getAll('stockid').length === 1 &&
      /^\d+$/.test(u.searchParams.get('id') || '') &&
      /^\d{6}$/.test(code) &&
      u.searchParams.get('stockid') === code
    );
  } catch {
    return false;
  }
}

/** No network or model calls. Retry only already-observed safe disclosure URLs;
 * company-scoped HTTP metadata is stronger identity evidence than search titles.
 */
export function selectDisclosureSupplementCandidates(options: {
  listing: Pick<ListingOption, 'name' | 'code'>;
  dossier: ResearchDossier;
  trustedSearchSources: SourceLink[];
}): SourceLink[] {
  const { dossier, listing } = options;
  const attempts = dossier.attempts;
  const scoped = [
    ...dossier.documents.filter((d) => d.kind === '正式披露'),
    ...attempts.flatMap((a) =>
      a.status === '未取得' && a.url
        ? [
            {
              title: a.source,
              url: a.url,
              date: a.date || '',
              publisher: a.publisher || '公司披露源',
            },
          ]
        : [],
    ),
  ];
  const scopedUrls = new Set(
    scoped.flatMap((s) => canonicalSourceUrl(s.url) || []),
  );
  const asOf = dossier.fetchedAt.slice(0, 10);
  const notFuture = (period: string) => !!period && period <= asOf;
  const eligible = [...options.trustedSearchSources, ...scoped].flatMap(
    (source) => {
      const url = canonicalSourceUrl(source.url);
      if (!url) return [];
      const isSina = isCompanySinaDisclosure(url, listing.code);
      if (!allowedDocumentUrl(url) && !isSina) return [];
      const title = source.title.replace(/\s/g, '');
      const kind = disclosureType(title);
      const period = disclosurePeriod(title);
      if (
        !['annual', 'interim'].includes(kind) ||
        !notFuture(period) ||
        /研报|研究报告|行业报告|点评|解读|投资策略|跟踪报告/.test(title) ||
        /\/H3_/i.test(new URL(url).pathname)
      )
        return [];
      // Never fetch a search result whose title gives no company identity. A
      // trusted search URL alone is provenance, not proof it belongs to this firm.
      const named =
        listing.name.trim() && title.includes(listing.name.replace(/\s/g, ''));
      const coded =
        /^\d{6}$/.test(listing.code) &&
        new RegExp(`(?:^|[^0-9])${listing.code}(?:[^0-9]|$)`).test(title);
      if (!scopedUrls.has(url) && !isSina && !named && !coded) return [];
      const identity = disclosureIdentity(url);
      if (
        dossier.documents.some(
          (doc) =>
            hasReadFullDisclosure(doc) &&
            ((canonicalSourceUrl(doc.url) &&
              disclosureIdentity(doc.url) === identity) ||
              (disclosureType(doc.title) === kind &&
                disclosurePeriod(doc.title) >= period)),
        )
      )
        return [];
      return [
        {
          source: {
            title: source.title,
            url,
            publisher: source.publisher,
            date: source.date,
          },
          kind,
          period,
          identity,
        },
      ];
    },
  );
  const observedTitles = [
    ...dossier.documents
      .filter((d) => d.kind === '正式披露')
      .map((d) => d.title),
    ...attempts.filter((a) => a.status === '未取得').map((a) => a.source),
    ...eligible.map((c) => c.source.title),
  ];
  const ranked = [...new Map(eligible.map((c) => [c.identity, c])).values()]
    .filter(
      (c) =>
        !observedTitles.some((title) => {
          const period = disclosurePeriod(title);
          return (
            disclosureType(title) === c.kind &&
            notFuture(period) &&
            period > c.period
          );
        }),
    )
    .sort(
      (a, b) =>
        Number(b.kind === 'annual') - Number(a.kind === 'annual') ||
        b.period.localeCompare(a.period) ||
        b.source.date.localeCompare(a.source.date),
    );
  // Cover the latest missing annual and interim before spending the second
  // slot on another mirror of the same report. Hard ceiling stays at two reads.
  const selected = ranked.filter(
    (c, i) => ranked.findIndex((x) => x.kind === c.kind) === i,
  );
  if (selected.length < 2)
    selected.push(
      ...ranked
        .filter((c) => !selected.includes(c))
        .slice(0, 2 - selected.length),
    );
  return selected.slice(0, 2).map((c) => c.source);
}
