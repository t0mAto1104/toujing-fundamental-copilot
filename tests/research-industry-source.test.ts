import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isKnownResearchIndustry,
  resolveResearchIndustry,
} from '../lib/research-industry-source';
import type { ListingOption } from '../lib/market-listings';
import type { Membership, SignalSnapshot } from '../lib/signal-types';
import type { ResearchDossier } from '../lib/research-dossier';

const listing: ListingOption = {
  id: 'SH:601288',
  code: '601288',
  name: '离线测试公司',
  exchange: '上交所',
  exchangeCode: 'SH',
  currency: 'CNY',
  securityType: '沪A',
  quoteId: '1.601288',
};
const snapshot = <T>(data: T, sourceUrl: string): SignalSnapshot<T> => ({
  data,
  fetchedAt: '2026-09-25T10:00:00Z',
  sourceName: '离线测试',
  sourceUrl,
  stale: false,
});
const membership = snapshot<Membership[]>(
  [
    { code: 'BK9999', name: '银行概念', percent: null },
    { code: 'BK0475', name: '银行', percent: null },
  ],
  'https://quote.eastmoney.com/sh601288.html',
);
const industryCatalog = snapshot(
  ['BK0475'],
  'https://quote.eastmoney.com/center/boardlist.html',
);

void test('industry fallback trusts valid company industry first and rejects placeholders', () => {
  for (const unknown of ['', ' 未取得 ', '待核验', '--', 'N/A', '未知行业'])
    assert.equal(isKnownResearchIndustry(unknown), false);
  const resolved = resolveResearchIndustry(listing, ' 化工 ', {
    membership,
    industryCatalog,
  });
  assert.equal(resolved.industry, '化工');
  assert.equal(resolved.verified, true);
  assert.deepEqual(resolved.sourceUrls, [
    'https://quote.eastmoney.com/unify/r/1.601288',
  ]);
});

void test('membership fallback uses exact industry-code intersection, never concept name', () => {
  const resolved = resolveResearchIndustry(listing, '未取得', {
    membership,
    industryCatalog,
  });
  assert.equal(resolved.industry, '银行');
  assert.deepEqual(resolved.sourceUrls, [
    membership.sourceUrl,
    industryCatalog.sourceUrl,
  ]);
  assert.match(resolved.basis, /BK0475/);
  assert.equal(
    resolveResearchIndustry(listing, '', { membership }).verified,
    false,
  );
  assert.equal(
    resolveResearchIndustry(listing, '', {
      membership: { ...membership, data: [membership.data[0]] },
      industryCatalog,
    }).verified,
    false,
  );
});

void test('stale classification, wrong company and non-A listings cannot reuse board attribution', () => {
  assert.equal(
    resolveResearchIndustry(listing, '', {
      membership: { ...membership, stale: true },
      industryCatalog,
    }).verified,
    false,
  );
  assert.equal(
    resolveResearchIndustry(listing, '', {
      membership,
      industryCatalog: { ...industryCatalog, stale: true },
    }).verified,
    false,
  );
  assert.equal(
    resolveResearchIndustry(listing, '', {
      membership: {
        ...membership,
        sourceUrl: 'https://quote.eastmoney.com/sh600000.html',
      },
      industryCatalog,
    }).verified,
    false,
  );
  assert.equal(
    resolveResearchIndustry({ ...listing, exchangeCode: 'HK' }, '', {
      membership,
      industryCatalog,
    }).verified,
    false,
  );
});

void test('formal self-business proof is last fallback; company name and news are not proof', () => {
  const namedBank = { ...listing, name: '农业银行' };
  assert.equal(resolveResearchIndustry(namedBank, '').verified, false);
  const dossier: ResearchDossier = {
    fetchedAt: '2026-09-25',
    attempts: [],
    financialHistory: [],
    documents: [
      {
        title: '2026年半年度报告',
        date: '2026-08-29',
        publisher: '公司',
        url: 'https://example.test/interim.pdf',
        kind: '正式披露',
        fetchedAt: '2026-09-25',
        excerpts: [{ page: 1, text: '本行主要从事商业银行业务。' }],
      },
    ],
  };
  const resolved = resolveResearchIndustry(namedBank, '', { dossier });
  assert.equal(resolved.industry, '银行');
  assert.match(resolved.basis, /非官方行业分类/);
  assert.deepEqual(resolved.sourceUrls, [dossier.documents[0].url]);
  dossier.documents[0].kind = '新闻';
  assert.equal(
    resolveResearchIndustry(namedBank, '', { dossier }).verified,
    false,
  );
});
