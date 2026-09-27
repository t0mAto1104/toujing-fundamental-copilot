import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCompanySinaDisclosure,
  selectDisclosureSupplementCandidates,
} from '../lib/research-disclosure-supplement';
import type {
  EvidenceDocument,
  ResearchDossier,
} from '../lib/research-dossier';
import type { SourceLink } from '../lib/research-types';

const listing = { name: '农业银行', code: '601288' };
const source = (
  title: string,
  id: string,
  date = '2026-08-30',
): SourceLink => ({
  title,
  date,
  publisher: '离线披露样本',
  url: `https://static.cninfo.com.cn/finalpage/${id}.PDF`,
});
const annual = source('农业银行2025年年度报告', 'annual');
const interim = source('农业银行2026年半年度报告', 'interim');
const sina = (stockid = listing.code, host = 'vip.stock.finance.sina.com.cn') =>
  `https://${host}/corp/view/vCB_AllBulletinDetail.php?stockid=${stockid}&id=12345`;
function doc(s: SourceLink, complete = true): EvidenceDocument {
  return {
    ...s,
    fetchedAt: '2026-09-25T00:00:00.000Z',
    kind: '正式披露',
    excerpts: [{ page: 1, text: '离线测试正文。'.repeat(30) }],
    extraction: { totalPages: 1, pagesRead: 1, complete, warnings: [] },
  };
}
function dossier(documents: EvidenceDocument[] = []): ResearchDossier {
  return {
    fetchedAt: '2026-09-25T00:00:00.000Z',
    documents,
    financialHistory: [],
    attempts: [],
  };
}
function select(d: ResearchDossier, sources: SourceLink[]) {
  return selectDisclosureSupplementCandidates({
    listing,
    dossier: d,
    trustedSearchSources: sources,
  });
}

void test('latest missing annual takes priority; fully read interim does not consume a slot', () => {
  const result = select(dossier([doc(interim)]), [interim, annual]);
  assert.deepEqual(result, [annual]);
  assert.deepEqual(
    select(dossier([doc(annual)]), [
      annual,
      source('农业银行2024年年度报告', 'old'),
      interim,
    ]),
    [interim],
  );
});

void test('read ceiling is two, covering both latest periods before same-period mirrors', () => {
  const mirror = { ...annual, url: sina() };
  const candidates = [
    source('农业银行2024年年度报告', 'old'),
    mirror,
    interim,
    annual,
  ];
  const result = select(dossier(), candidates);
  assert.equal(result.length, 2);
  assert.match(result[0].title, /2025年年度报告/);
  assert.match(result[1].title, /2026年半年度报告/);
  const annualOnly = select(dossier([doc(interim)]), candidates);
  assert.equal(annualOnly.length, 2);
  assert.ok(annualOnly.every((s) => /2025年年度报告/.test(s.title)));
});

void test('partial company-scoped reports and URL-backed failed attempts remain retry candidates', () => {
  const generic = { ...annual, title: '2025年年度报告' };
  assert.deepEqual(select(dossier([doc(generic, false)]), []), [generic]);
  const d = dossier();
  d.attempts.push({
    source: generic.title,
    status: '未取得',
    detail: '离线模拟超时',
    url: generic.url,
    date: generic.date,
    publisher: generic.publisher,
  });
  assert.deepEqual(select(d, []), [generic]);
  const withoutUrl = dossier();
  withoutUrl.attempts.push({
    source: generic.title,
    status: '未取得',
    detail: '没有留存网址的旧记录',
  });
  assert.deepEqual(
    select(withoutUrl, []),
    [],
    'do not manufacture an unobserved URL',
  );
  assert.deepEqual(
    select(withoutUrl, [source('农业银行2024年年度报告', 'old')]),
    [],
    'an older annual cannot close a known latest-annual gap',
  );
});

void test('third-party research, wrong company, summaries and future reports cannot become company full disclosures', () => {
  const wrong = source('工商银行2025年年度报告', 'wrong');
  const unrelated = [
    wrong,
    source('2025年年度报告', 'generic-search'),
    source('农业银行2025年年度报告摘要', 'summary'),
    source('农业银行2025年年度报告点评', 'review'),
    source('农业银行2026年年度报告', 'future'),
    source('银行行业报告与农业银行2025年年度报告研究', 'industry'),
    { ...annual, url: 'https://pdf.dfcfw.com/pdf/H3_AP1234_1.pdf' },
    { ...annual, url: sina('601398') },
    { ...annual, url: 'https://www.abchina.com.cn/annual.pdf' },
    {
      ...annual,
      url: 'https://static.cninfo.com.cn/annual.pdf?next=http://127.0.0.1',
    },
  ];
  // Query strings do not bypass transport's existing manual no-redirect policy;
  // they are not a new host allowlist and are not dereferenced by this selector.
  assert.deepEqual(select(dossier(), unrelated.slice(0, -1)), []);
  assert.equal(select(dossier(), unrelated.slice(-1)).length, 1);
});

void test('Sina identity is exact and mirror URLs are deduplicated without fetching', () => {
  for (const url of [
    sina('601398'),
    sina().replace('https:', 'http:'),
    sina().replace('https://', 'https://user:pass@'),
    sina().replace('.com.cn/', '.com.cn:8443/'),
    sina().replace('Detail.php?', 'Detail.php.evil?'),
    sina().replace('id=12345', 'id=not-a-number'),
    `${sina()}&stockid=601398`,
    `${sina()}&id=67890`,
    sina().replace('finance.sina.com.cn', 'finance.sina.com.cn.attacker.test'),
  ])
    assert.equal(isCompanySinaDisclosure(url, listing.code), false);
  assert.equal(isCompanySinaDisclosure(sina(), listing.code), true);
  const one = { ...annual, url: sina(), title: '2025年年度报告' };
  const other = {
    ...one,
    url: sina(listing.code, 'money.finance.sina.com.cn'),
  };
  assert.equal(select(dossier(), [one, other]).length, 1);
  assert.deepEqual(select(dossier([doc(one)]), [other]), []);
});
