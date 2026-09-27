'use client';

/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The named scroll region must remain keyboard-scrollable. */
/* oxlint-disable next/no-html-link-for-pages -- Preserve reliable full navigation on hosted routes. */

import { BookOpenText, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type IndustryReportItem = {
  id: string;
  title: string;
  publishedAt: string;
  industryName: string;
  industryCode: string;
  organization: string;
  researcher: string;
  rating: string;
  pages: number | null;
  sizeKb: number | null;
  detailUrl: string;
  pdfUrl: string;
};

type IndustryReportsSnapshot = {
  reports: IndustryReportItem[];
  total: number;
  updatedAt: string;
  provider: string;
  methodology: string;
  stale?: boolean;
  error?: string;
  hasMore?: boolean;
};

function displayTime(value?: string) {
  if (!value) return '尚未更新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function displaySize(value: number | null) {
  if (!value) return '';
  return value >= 1024
    ? `${(value / 1024).toFixed(1)} MB`
    : `${Math.round(value)} KB`;
}

export function IndustryReports({ fullPage = false }: { fullPage?: boolean }) {
  const [snapshot, setSnapshot] = useState<IndustryReportsSnapshot | null>(
    null,
  );
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('eastmoney');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (search = '') => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const currentRequest = ++requestId.current;
      setLoading(true);
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 25_000);
      try {
        const params = new URLSearchParams({ source, page: String(page) });
        if (search.trim()) params.set('query', search.trim());
        const response = await fetch(
          `/api/industry-reports?${params.toString()}`,
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error('行业研报请求失败');
        const payload = (await response.json()) as IndustryReportsSnapshot;
        if (currentRequest === requestId.current) setSnapshot(payload);
      } catch {
        if (
          (!timedOut && controller.signal.aborted) ||
          currentRequest !== requestId.current
        )
          return;
        setSnapshot((current) =>
          current?.reports.length
            ? {
                ...current,
                stale: true,
                error: '刷新失败，保留上次结果，请核对数据日期。',
              }
            : {
                reports: [],
                total: 0,
                updatedAt: new Date().toISOString(),
                provider: '行业研报源暂不可用',
                methodology: '未取得可验证研报，不展示模拟内容。',
                error: '行业研报请求失败，请稍后重试。',
              },
        );
      } finally {
        window.clearTimeout(timeout);
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [source, page],
  );

  useEffect(() => {
    const initial = window.setTimeout(
      () => void load(query),
      query.trim() ? 380 : 0,
    );
    const timer = window.setInterval(() => void load(query), 30 * 60 * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load, query]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reports = snapshot?.reports || [];

  return (
    <section
      className={`industry-reports saas-panel ${fullPage ? 'industry-reports-full' : ''}`}
    >
      <div className="saas-panel-header">
        <h2 className="text-base font-semibold">最新行业研报</h2>
        <details className="report-tools" open={fullPage || undefined}>
          <summary>
            筛选 <Search className="size-3.5" aria-hidden="true" />
          </summary>
          <div className="report-filters">
            <label>
              来源{' '}
              <select
                aria-label="研报来源"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setPage(1);
                  setSnapshot(null);
                }}
              >
                <option value="eastmoney">东方财富</option>
                <option value="sina">新浪财经</option>
              </select>
            </label>
            <label>
              <span className="sr-only">搜索行业研报</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                  setSnapshot(null);
                }}
                placeholder="搜索行业、标题或机构"
              />
            </label>
            <button
              type="button"
              onClick={() => void load(query)}
              disabled={loading}
              aria-label="刷新行业研报"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              刷新
            </button>
          </div>
        </details>
        {!fullPage && (
          <a
            href="/industry-reports"
            className="report-view-all inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
            aria-label="查看全部行业研报"
          >
            查看全部 <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      {fullPage && (
        <p className="report-full-hint px-4 py-2 text-xs text-muted-foreground">
          按来源分页浏览 · 点击标题查看原文，展开机构名称查看研究员及报告详情
          <span className="sm:hidden"> · 表格可左右滑动</span>
        </p>
      )}
      {snapshot?.stale || snapshot?.error || (loading && query.trim()) ? (
        <p className="report-notice text-xs text-amber-700 dark:text-amber-300">
          {snapshot?.error ||
            (snapshot?.stale ? '显示缓存，请核对研报日期。' : '正在扩展检索…')}
        </p>
      ) : null}
      {reports.length ? (
        <section
          className="report-list"
          tabIndex={0}
          aria-label="最新行业研报列表"
        >
          <table className="report-table">
            <thead>
              <tr>
                <th>行业</th>
                <th>研报标题</th>
                <th>来源</th>
                <th>日期</th>
                <th>
                  <span className="sr-only">原文</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    <span title={report.industryName}>
                      {report.industryName}
                    </span>
                  </td>
                  <td>
                    <a
                      href={report.detailUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={report.title}
                    >
                      {report.title}
                    </a>
                  </td>
                  <td
                    aria-label={`研报来源 ${report.organization || '未提供'}`}
                  >
                    <details className="report-details">
                      <summary title={report.organization}>
                        {report.organization}
                      </summary>
                      <p>
                        {report.researcher || '研究员未提供'}
                        {report.rating ? ` · ${report.rating}` : ''}
                        {report.pages ? ` · ${report.pages}页` : ''}{' '}
                        {displaySize(report.sizeKb)}
                      </p>
                    </details>
                  </td>
                  <td>
                    <time title={report.publishedAt}>
                      {fullPage
                        ? report.publishedAt
                        : report.publishedAt.slice(5, 10)}
                    </time>
                  </td>
                  <td>
                    <a
                      className="report-pdf"
                      href={report.pdfUrl || report.detailUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${report.title}：${report.pdfUrl ? '查看 PDF' : '来源详情'}`}
                    >
                      {report.pdfUrl ? 'PDF' : '原文'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">
          <BookOpenText className="mb-2 size-5" />
          {loading
            ? '正在获取最新行业研报…'
            : snapshot?.error || '没有找到匹配的行业研报。'}
        </div>
      )}
      <div className="report-footer">
        <div className="report-pagination">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => {
              setPage(page - 1);
              setSnapshot(null);
            }}
            aria-label="上一页行业研报"
          >
            上一页
          </Button>
          <span>
            第 {page} 页 · {reports.length} 篇
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!snapshot?.hasMore || loading}
            onClick={() => {
              setPage(page + 1);
              setSnapshot(null);
            }}
            aria-label="下一页行业研报"
          >
            下一页
          </Button>
        </div>
        <details className="report-methodology">
          <summary>来源</summary>
          <p>
            {displayTime(snapshot?.updatedAt)} ·{' '}
            {snapshot?.provider || '正在连接研报源'} ·{' '}
            {snapshot?.methodology ||
              '研报列表由公开金融数据接口获取，不对机构原始观点进行AI改写。'}{' '}
            研报观点仅供信息参考，不构成投资建议。
          </p>
        </details>
      </div>
    </section>
  );
}
