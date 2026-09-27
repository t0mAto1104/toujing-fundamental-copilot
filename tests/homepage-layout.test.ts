import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('homepage matches the confirmed reference: wide research column and narrow news column', () => {
  const page = source('app/page.tsx');
  const panels = [
    'overview-workbench',
    'overview-primary',
    'overview-macro saas-panel',
    '<IndustryHeatmap',
    'overview-tables',
    '<HotStocks compact',
    '<IndustryReports',
    'overview-secondary',
    '<TradingViewPanel kind="news" compact',
    'overview-timeline saas-panel',
  ];
  const positions = panels.map((panel) => page.indexOf(panel));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  assert.equal((page.match(/<TradingViewPanel/g) || []).length, 1);
  assert.doesNotMatch(page, /kind="market"/);
  assert.match(page, /<BrandMark/);
  assert.match(page, /每 60 秒自动更新/);
  assert.match(page, /<MobileWorkspaceNav active="market"/);
});

void test('compact panels retain complete source lists, source links, and keyboard scrolling', () => {
  assert.match(source('components/industry-reports.tsx'), /reports\.map\(/);
  assert.match(
    source('components/industry-reports.tsx'),
    /aria-label="最新行业研报列表"/,
  );
  assert.match(
    source('components/industry-reports.tsx'),
    /report\.pdfUrl \|\| report\.detailUrl/,
  );
  assert.match(
    source('components/industry-heatmap.tsx'),
    /visibleIndustries\.map\(/,
  );
  assert.match(
    source('components/industry-heatmap.tsx'),
    /aria-label="全部行业热力图，可滚动查看"/,
  );
  assert.match(source('app/page.tsx'), /aria-label="财经资讯时间线列表"/);
  assert.match(source('app/page.tsx'), /aria-label="宏观与政策信号列表"/);
  assert.match(source('app/page.tsx'), /scrollTo\(\{ top: 0 \}\)/);
});

void test('workbench scopes compact styling and preserves a single-column small-screen layout', () => {
  const css = source('app/globals.css');
  assert.match(
    css,
    /\.overview-workbench,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    css,
    /grid-template-columns: minmax\(0, 1\.57fr\) minmax\(0, 1fr\)/,
  );
  assert.match(css, /grid-template-columns: 200px minmax\(0, 1fr\)/);
  assert.match(css, /\.overview-scroll,[\s\S]*?overflow-y: auto/);
  assert.match(css, /\.overview-workbench \.saas-panel:has\(details\[open\]\)/);
  assert.match(
    css,
    /\.overview-tables\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(css, /\.overview-macro\s*\{\s*height: 278px/);
  assert.match(
    css,
    /\.overview-secondary \.tradingview-compact\s*\{\s*height: 320px/,
  );
});

void test('compact controls retain search, report pagination, full heatmap detail, and timeline categories', () => {
  const reports = source('components/industry-reports.tsx');
  assert.match(reports, /<table className="report-table"/);
  assert.match(reports, /<details className="report-tools"/);
  assert.match(reports, /aria-label="研报来源"/);
  assert.match(reports, /setPage\(page \+ 1\)/);
  assert.match(
    source('components/industry-heatmap.tsx'),
    /toolsRef\.current\.open = true/,
  );
  assert.match(
    source('components/industry-heatmap.tsx'),
    /className="heatmap-hover"/,
  );
  assert.match(source('app/page.tsx'), /aria-label="财经资讯分类"/);
  assert.match(
    source('app/page.tsx'),
    /timelineCategory === '全部' \|\| item\.category === timelineCategory/,
  );
});

void test('compact news keeps vendor isolation, credit, and reload without AI requests', () => {
  const panel = source('components/tradingview-panel.tsx');
  assert.match(panel, /compact = false/);
  assert.match(panel, /sandbox=\{TRADINGVIEW_SANDBOX\}/);
  assert.match(panel, /by TradingView/);
  assert.match(panel, /重新加载/);
  assert.doesNotMatch(panel, /\/api\/|fetch\(|setInterval\(/);
});
