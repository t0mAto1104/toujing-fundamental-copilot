'use client';

/* oxlint-disable next/no-html-link-for-pages -- hosted RSC client transitions can be swallowed; full navigation is required. */

import { FileChartColumn, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { WorkspaceShell } from '@/components/workspace-shell';
import { ResearchTaskCenter } from '@/components/research-task-center';
import {
  readStoredReports,
  removeSavedReport,
  type SavedReport,
} from '@/lib/report-storage';

export default function ReportsPage() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const hydrateReports = window.setTimeout(() => {
      void readStoredReports().then(setReports);
    }, 0);
    return () => window.clearTimeout(hydrateReports);
  }, []);
  const visible = useMemo(
    () =>
      reports.filter((item) =>
        `${item.companyName}${item.companyCode}${item.industry}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [reports, query],
  );

  const remove = async (id: string) => {
    await removeSavedReport(id);
    setReports(await readStoredReports());
  };

  return (
    <WorkspaceShell active="reports">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">MY REPORTS</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              我的报告
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              新研究按任务保存到共享数据库；历史版本可直接打开、对比及另存为
              PDF。
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-9"
              placeholder="搜索已保存报告"
            />
          </div>
        </div>
        <ResearchTaskCenter />
        {visible.length ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border">
            {visible.map((report) => (
              <article
                key={report.id}
                className="group grid gap-4 border-b border-border bg-card p-5 last:border-b-0 sm:grid-cols-[1fr_auto]"
              >
                <a
                  href={`/company/research?saved=${encodeURIComponent(report.id)}&query=${encodeURIComponent(report.query)}${report.listingId ? `&listing=${encodeURIComponent(report.listingId)}` : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold group-hover:text-primary">
                      {report.companyName}
                    </h2>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {report.exchange} · {report.companyCode}
                    </span>
                    <span className="rounded bg-primary/8 px-2 py-0.5 text-[10px] text-primary">
                      {report.stance}
                    </span>
                  </div>
                  {report.quote ? (
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {report.quote.price} {report.quote.currency}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${report.quote.change.startsWith('-') ? 'text-emerald-700' : 'text-red-600'}`}
                      >
                        {report.quote.change}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        保存时行情
                      </span>
                    </div>
                  ) : null}
                  <p className="mt-2 line-clamp-2 max-w-3xl text-xs leading-6 text-muted-foreground">
                    {report.conclusion}
                  </p>
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    {report.industry} · 更新于 {report.updatedAt}
                  </p>
                </a>
                <button
                  onClick={() => remove(report.id)}
                  className="self-start rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`删除${report.companyName}报告`}
                >
                  <Trash2 className="size-4" />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-8 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-muted text-primary">
              <FileChartColumn className="size-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold">还没有已保存的报告</h2>
            <p className="mt-2 max-w-sm text-xs leading-6 text-muted-foreground">
              在公司分析页生成一份报告后会自动保存到这里；报告正文仍可通过浏览器打印另存为
              PDF。
            </p>
            <a
              href="/research"
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
            >
              开始第一份研究
            </a>
          </div>
        )}
        <p className="mt-6 text-[10px] text-muted-foreground">
          登录用户的完整报告会安全同步；未登录时仅保存在当前浏览器。
        </p>
      </div>
    </WorkspaceShell>
  );
}
