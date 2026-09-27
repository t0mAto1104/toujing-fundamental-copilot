import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { hasReadFullDisclosure } from '../lib/research-disclosures';
const state = {
  total: 310,
  cover: '2025年年度报告',
  scan: false,
  fail: 0,
  destroyed: 0,
  cleaned: 0,
  pageCleaned: 0,
  active: 0,
  peakActive: 0,
  loadGate: null as Promise<void> | null,
  textFail: 0,
  read: [] as number[],
};
Object.assign(globalThis, { __pdfReaderFixture: state });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== 'unpdf') return next(specifier, context);
    return {
      url:
        'data:text/javascript,' +
        encodeURIComponent(
          `export async function getResolvedPDFJS() { return {getDocument(options) {
            const s=globalThis.__pdfReaderFixture;
            if(options.isEvalSupported!==false||options.disableFontFace!==true)throw Error('unsafe PDF options');
            s.active++;s.peakActive=Math.max(s.active,s.peakActive);
            const doc={numPages:s.total,cleanup:async()=>{s.cleaned++},getPage:async(i)=>{
              s.read.push(i);if(i===s.fail)throw Error('offline page failure');
              return {cleanup(){s.pageCleaned++},getTextContent:async()=>{
                if(i===s.textFail)throw Error('offline text failure');
                return {items:s.scan&&i>1?[]:[{str:i===1?s.cover+' 测试封面内容。'.repeat(25):'测试正文，营业收入、营业成本、毛利率；重要的联营企业财务信息。'.repeat(5),transform:[1,0,0,1,1,1],width:100}]};
              }};
            }};
            return {promise:(s.loadGate||Promise.resolve()).then(()=>doc),destroy:async()=>{s.destroyed++;s.active--}};
          }};}`,
        ),
      shortCircuit: true,
    };
  },
});
const { readResearchPdf, readSinaDisclosure, selectDocumentExcerpts } =
  await import('../lib/research-dossier');
const source = {
  title: '2025年年度报告',
  url: 'https://static.cninfo.com.cn/finalpage/2026-04-23/test.PDF',
  publisher: '离线测试',
  date: '2026-04-23',
};
void test('310-page extraction is bounded and preserves pages, summaries and partial diagnostics', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.redirect, 'manual');
    return new Response('%PDF-offline fixture');
  };
  try {
    const full = await readResearchPdf(source);
    assert.equal(full.extraction?.pagesRead, 310);
    assert.equal(full.extraction?.complete, true);
    assert.equal(hasReadFullDisclosure(full), true);
    assert.equal(state.destroyed, 1);
    assert.equal(state.cleaned, Math.floor(310 / 8));
    assert.equal(state.pageCleaned, 310);
    const notice = await readResearchPdf({
      ...source,
      title: '关于召开2026年半年度业绩说明会的公告',
    });
    assert.equal(notice.disclosureType, 'other');
    assert.equal(hasReadFullDisclosure(notice), false);
    for (const cover of [
      '2026年半年度报告 页眉 2026年半年度报告摘要',
      '2026年中期报告摘要',
      '2025年度报告摘要',
    ]) {
      state.total = 4;
      state.cover = cover;
      const doc = await readResearchPdf(source);
      assert.equal(doc.disclosureType, 'summary');
      assert.equal(hasReadFullDisclosure(doc), false);
    }
    state.total = 310;
    state.cover = '2025年年度报告';
    state.scan = true;
    const scanned = await readResearchPdf(source);
    assert.equal(hasReadFullDisclosure(scanned), false);
    assert.match(scanned.extraction!.warnings.join(' '), /扫描/);
    state.scan = false;
    state.fail = 187;
    const partial = await readResearchPdf(source);
    assert.equal(hasReadFullDisclosure(partial), false);
    assert.ok(partial.excerpts.length);
    assert.ok(partial.extraction!.pagesRead > 0);
    state.fail = 0;
    state.total = 1001;
    await assert.rejects(readResearchPdf(source), /1000页/);
    await assert.rejects(
      readResearchPdf({ ...source, url: 'http://127.0.0.1/private' }),
    );
  } finally {
    globalThis.fetch = original;
  }
});
void test('PDF and Sina readers reject redirects without parsing and validate hosts before fetching', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/private' },
    });
  };
  try {
    await assert.rejects(readResearchPdf(source), /跳转/);
    await assert.rejects(
      readSinaDisclosure(
        'https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=123&stockid=600160',
        '2025年年度报告',
      ),
      /跳转/,
    );
    assert.equal(calls, 2);
    await assert.rejects(
      readResearchPdf({ ...source, url: 'https://untrusted.invalid/test.pdf' }),
    );
    await assert.rejects(
      readSinaDisclosure(
        'https://untrusted.invalid/corp/view/vCB_AllBulletinDetail.php?id=123&stockid=600160',
        '2025年年度报告',
      ),
    );
    assert.equal(calls, 2, 'non-allowlisted hosts are never fetched');
  } finally {
    globalThis.fetch = original;
  }
});
void test('oversize high-ranking page cannot starve smaller relevant financial passages', () => {
  const pages = [
    '营业收入 营业成本 毛利率 ' + '123.12%'.repeat(1000),
    '营业收入 营业成本 毛利率 ' + '第二页真实测试表格内容。'.repeat(20),
    '主要业务和经营模式 ' + '合成业务说明。'.repeat(20),
  ];
  assert.ok(selectDocumentExcerpts(pages).some((e) => e.page === 2));
});

void test('PDF lane serializes parsers, cancels queued work without fetching and destroys an unfinished loader', async (t) => {
  state.total = 8;
  state.peakActive = 0;
  state.loadGate = new Promise(() => {});
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('%PDF-fixture');
  });
  const firstAbort = new AbortController();
  const first = readResearchPdf(source, firstAbort.signal);
  const rejected = assert.rejects(first, /abort/i);
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(state.active, 1);
  const queuedAbort = new AbortController();
  const queued = readResearchPdf(source, queuedAbort.signal);
  const queueRejected = assert.rejects(queued, /abort/i);
  queuedAbort.abort();
  await queueRejected;
  assert.equal(calls, 1, 'waiting request never buffers another PDF');
  assert.equal(
    state.active,
    1,
    'cancelled waiter must not unlock another parser',
  );
  firstAbort.abort();
  await rejected;
  assert.equal(
    state.active,
    0,
    'destroy works even when opening never resolves',
  );
  state.loadGate = null;
  const docs = await Promise.all([
    readResearchPdf(source),
    readResearchPdf(source),
  ]);
  assert.ok(docs.every((d) => d.extraction?.complete));
  assert.equal(state.peakActive, 1);
  assert.equal(state.active, 0);
  const cleaned = state.pageCleaned;
  state.textFail = 1;
  await assert.rejects(readResearchPdf(source), /text failure/);
  assert.equal(state.pageCleaned, cleaned + 1);
  assert.equal(state.active, 0);
  state.textFail = 0;
  assert.ok((await readResearchPdf(source)).extraction?.complete);
});
