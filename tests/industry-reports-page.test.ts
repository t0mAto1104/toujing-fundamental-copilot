import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('homepage and shared navigation link to the dedicated industry research page', () => {
  assert.match(
    source('components/industry-reports.tsx'),
    /href="\/industry-reports"/,
  );
  assert.match(
    source('components/industry-reports.tsx'),
    /aria-label="查看全部行业研报"/,
  );
  assert.match(
    source('components/workspace-nav.tsx'),
    /href: '\/industry-reports',[\s\S]*?label: '行业研报',[\s\S]*?key: 'industry-reports'/,
  );
  assert.match(
    source('components/mobile-workspace-nav.tsx'),
    /<WorkspaceNav active=\{active\}/,
  );
  const page = source('app/industry-reports/page.tsx');
  assert.match(page, /<WorkspaceShell active="industry-reports">/);
  assert.match(page, /<IndustryReports fullPage/);
});

void test('full page reuses the existing query, source, pagination, and provenance without AI', () => {
  const reports = source('components/industry-reports.tsx');
  assert.match(reports, /fullPage = false/);
  assert.match(reports, /open=\{fullPage \|\| undefined\}/);
  assert.match(
    reports,
    /new URLSearchParams\(\{ source, page: String\(page\) \}\)/,
  );
  assert.match(reports, /params\.set\('query', search\.trim\(\)\)/);
  assert.match(reports, /setPage\(page \+ 1\)/);
  assert.match(reports, /report\.pdfUrl \|\| report\.detailUrl/);
  assert.match(
    reports,
    /fullPage\s*\? report\.publishedAt\s*: report\.publishedAt\.slice/,
  );
  assert.doesNotMatch(reports, /\/api\/(analyze|chat|brief)|openai/i);
});

void test('full report titles and bounded scrolling are scoped away from the compact homepage', () => {
  const css = source('app/globals.css');
  assert.match(
    css,
    /\.industry-reports-full \.report-list\s*\{[^}]*max-height:[^}]*overflow: auto/,
  );
  assert.match(
    css,
    /\.industry-reports-full \.report-table\s*\{[^}]*min-width: 640px/,
  );
  assert.match(
    css,
    /\.industry-reports-full \.report-details summary\s*\{[^}]*white-space: normal/,
  );
});
