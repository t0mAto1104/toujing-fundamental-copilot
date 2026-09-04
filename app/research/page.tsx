'use client';

/* oxlint-disable next/no-html-link-for-pages -- hosted RSC client transitions can be swallowed; full navigation is required. */

import {
  Bot,
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { CompanySearchField } from '@/components/company-search-field';
import { WorkspaceShell } from '@/components/workspace-shell';
import { readStoredReports, type SavedReport } from '@/lib/report-storage';
import type { ListingOption } from '@/lib/market-listings';

type ServiceStatus = { status: string; message: string; checkedAt?: string };

const prompts = [
  '分析小米集团最新财报与汽车业务基本面',
  '分析贵州茅台的渠道库存、现金流与需求风险',
  '分析宁德时代的海外份额、盈利能力与政策影响',
  '分析招商银行的净息差、资产质量和分红能力',
];

export default function ResearchAssistantPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [recent, setRecent] = useState<SavedReport[]>([]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      setStatus((await response.json()) as ServiceStatus);
    } catch {
      setStatus({ status: 'network', message: '暂时无法连接 AI 状态检查。' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      const initial = new URLSearchParams(window.location.search).get('query');
      if (initial) setQuery(initial);
      void readStoredReports().then((items) => setRecent(items.slice(0, 4)));
      void checkStatus();
    }, 0);
    return () => {
      window.clearTimeout(hydrate);
    };
  }, []);

  const startResearch = (value: string, listing?: ListingOption) => {
    const params = new URLSearchParams({ query: value.trim() });
    if (listing) params.set('listing', listing.id);
    window.location.assign(`/company/research?${params.toString()}`);
  };

  const online = status?.status === 'online' || status?.status === 'configured';

  return (
    <WorkspaceShell active="research">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">AI RESEARCH</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              AI 研究助手
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              输入公司或问题，助手会联网核验政策、行业、资金、财报和宏观数据，并保留来源链接。
            </p>
          </div>
          <button
            onClick={checkStatus}
            disabled={checking}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${online ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
          >
            {online ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <ShieldAlert className="size-3.5" />
            )}
            {checking ? '正在复测…' : online ? 'AI 研究在线' : 'AI 研究受限'}
            <RefreshCw className={`size-3 ${checking ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {status && !online ? (
          <div className="mt-5 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-950">
            {status.message}{' '}
            可使用右上角状态按钮手动复测；页面不会定时调用模型。
          </div>
        ) : null}

        <section className="saas-panel mt-8 border-primary/15">
          <div className="border-b border-border bg-primary/[0.045] p-6 sm:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Sparkles className="size-4" />
              开始一项基本面研究
            </div>
            <CompanySearchField
              value={query}
              onValueChange={setQuery}
              onResearch={startResearch}
              className="mt-4"
              inputClassName="h-14 rounded-xl bg-background text-sm"
              placeholder="例如：小米集团、贵州茅台、600519"
              showButton
              buttonLabel="开始研究"
            />
            <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
              研究结论仅供参考，不构成投资意见。若 AI
              服务受限，小米集团仍可使用官方来源的保底报告。
            </p>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => setQuery(prompt)}
                className="flex items-start gap-3 bg-background p-5 text-left hover:bg-muted/60"
              >
                <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="text-xs leading-6">{prompt}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-9 grid gap-7 lg:grid-cols-[1.1fr_.9fr]">
          <section>
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">RECENT</p>
                <h2 className="mt-1 text-lg font-semibold">最近研究</h2>
              </div>
              <a
                href="/reports"
                className="text-xs text-primary hover:underline"
              >
                查看全部
              </a>
            </div>
            {recent.length ? (
              <div className="mt-4 border-t border-border">
                {recent.map((item) => (
                  <a
                    key={item.id}
                    href={`/company/research?saved=${encodeURIComponent(item.id)}&query=${encodeURIComponent(item.query)}`}
                    className="grid grid-cols-[1fr_auto] gap-4 border-b border-border py-4"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {item.companyName}{' '}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {item.companyCode}
                        </span>
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {item.conclusion}
                      </p>
                    </div>
                    <span className="text-xs text-primary">{item.stance}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border p-7 text-center text-xs text-muted-foreground">
                完成第一份公司研究后会自动保存在这里。
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">证据优先级</h2>
            </div>
            <ol className="mt-4 space-y-3 text-xs leading-6 text-muted-foreground">
              <li>
                <span className="mr-2 font-mono text-primary">01</span>
                公司公告、交易所文件与监管披露
              </li>
              <li>
                <span className="mr-2 font-mono text-primary">02</span>
                国家统计、政策部门与行业主管机构
              </li>
              <li>
                <span className="mr-2 font-mono text-primary">03</span>
                可靠媒体与公开资金流向数据
              </li>
            </ol>
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}
