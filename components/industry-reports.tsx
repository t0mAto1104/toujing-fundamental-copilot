'use client';

import {
  ArrowUpRight,
  BookOpenText,
  Database,
  FileText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

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

export function IndustryReports() {
  const [snapshot, setSnapshot] = useState<IndustryReportsSnapshot | null>(
    null,
  );
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (search = '') => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const currentRequest = ++requestId.current;
    setLoading(true);
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const params = new URLSearchParams();
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
      if (controller.signal.aborted || currentRequest !== requestId.current)
        return;
      setSnapshot((current) =>
        current?.reports.length
          ? current
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
  }, []);

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

  const reports = (snapshot?.reports || []).slice(0, 12);

  return (
    <section className="saas-panel mt-5">
      <div className="saas-panel-header">
        <div>
          <p className="eyebrow">INDUSTRY RESEARCH</p>
          <h2 className="mt-1 text-lg font-semibold">最新行业研报</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            券商原始研报 · 行业、机构、评级与 PDF 均可追溯
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block sm:w-64">
            <span className="sr-only">搜索行业研报</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索行业、标题或机构"
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <button
            type="button"
            onClick={() => void load(query)}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            刷新
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Database className="size-3" />
          {snapshot?.provider || '正在连接研报源'}
        </span>
        <span>·</span>
        <span>{displayTime(snapshot?.updatedAt)}</span>
        {loading && query.trim() ? <span>正在扩展检索…</span> : null}
        {snapshot?.stale ? (
          <span className="text-amber-700 dark:text-amber-300">
            正在后台核验更新
          </span>
        ) : null}
        {snapshot?.total ? (
          <span className="ml-auto">
            {query.trim() ? '行业检索结果' : '近两年共收录'} {snapshot.total} 篇
          </span>
        ) : null}
      </div>

      {reports.length ? (
        <div className="grid sm:grid-cols-2 2xl:grid-cols-3">
          {reports.map((report) => (
            <article
              key={report.id}
              className="group flex min-h-[206px] flex-col border-b border-r border-border bg-card/35 p-4"
            >
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <time className="font-mono">{report.publishedAt}</time>
                <span className="max-w-32 truncate rounded bg-primary/8 px-2 py-0.5 font-medium text-primary">
                  {report.industryName}
                </span>
                {report.rating ? (
                  <span className="ml-auto">{report.rating}</span>
                ) : null}
              </div>
              <a
                href={report.detailUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-start gap-2"
              >
                <h3 className="line-clamp-3 text-sm font-semibold leading-6 group-hover:text-primary">
                  {report.title}
                </h3>
                <ArrowUpRight className="mt-1.5 size-3 shrink-0 text-muted-foreground" />
              </a>
              <div className="mt-3 text-[11px] leading-5 text-muted-foreground">
                <p>{report.organization}</p>
                {report.researcher ? <p>研究员：{report.researcher}</p> : null}
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-[10px] text-muted-foreground">
                <span>
                  {[
                    report.pages ? `${report.pages}页` : '',
                    displaySize(report.sizeKb),
                  ]
                    .filter(Boolean)
                    .join(' · ') || '原始研报'}
                </span>
                <a
                  href={report.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <FileText className="size-3" />
                  查看 PDF
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center bg-card/35 px-4 text-center">
          <div>
            <BookOpenText className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {loading
                ? '正在获取最新行业研报…'
                : snapshot?.error || '没有找到匹配的行业研报。'}
            </p>
          </div>
        </div>
      )}

      <p className="px-5 py-3 text-[10px] leading-5 text-muted-foreground">
        {snapshot?.methodology ||
          '研报列表由公开金融数据接口获取，不对机构原始观点进行AI改写。'}{' '}
        研报观点仅供信息参考，不构成投资建议。
      </p>
    </section>
  );
}
