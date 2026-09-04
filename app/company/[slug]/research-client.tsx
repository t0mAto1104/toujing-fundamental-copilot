'use client';

/* oxlint-disable next/no-html-link-for-pages -- full-page navigation is intentional for hosted auth state. */

import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Download,
  ExternalLink,
  FileText,
  Landmark,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { BrandMark } from '@/components/brand-mark';
import { readResearchResponse } from '@/lib/research-stream';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { CompanyResearchDepth } from '@/components/company-research-depth';
import {
  getPreferredAIModel,
  getPreferredResearchModel,
} from '@/lib/ai-models';
import { useWorkspaceSession } from '@/components/workspace-session';
import type { ListingOption } from '@/lib/market-listings';
import {
  readStoredReport,
  saveReport,
  type SavedReport,
} from '@/lib/report-storage';
import type { CompanyReport, FactorGroup } from '@/lib/research-types';

const factorIcons = {
  政策: Landmark,
  行业: TrendingUp,
  资金: WalletCards,
  财报: FileText,
  宏观: CalendarClock,
};

const signalStyle = {
  正面: 'bg-red-50 text-red-700 border-red-100',
  中性: 'bg-stone-50 text-stone-600 border-stone-200',
  负面: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

type Followup = {
  question: string;
  answer?: string;
  keyPoints?: string[];
  sources?: Array<{ title: string; url: string }>;
  loading?: boolean;
  error?: boolean;
};

type FollowupResponse = {
  answer: string;
  keyPoints: string[];
  sources: Array<{ title: string; url: string }>;
  error?: string;
};

async function fetchListingOptions(input: string): Promise<ListingOption[]> {
  try {
    const response = await fetch(
      `/api/listings?query=${encodeURIComponent(input)}`,
      { cache: 'no-store' },
    );
    const payload = (await response.json()) as { listings?: ListingOption[] };
    return response.ok ? payload.listings || [] : [];
  } catch {
    return [];
  }
}

function AnalysisSkeleton({ progress }: { progress: string }) {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <output
        aria-live="polite"
        className="flex items-start gap-4 rounded-2xl border border-primary/15 bg-primary/[0.045] p-5"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <RefreshCw className="size-4 animate-spin" />
        </span>
        <div>
          <h1 className="text-base font-semibold">研究正在进行中，请稍后</h1>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            {progress}{' '}
            深度研究分阶段执行，通常比普通问答耗时更长；请保持此页打开。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              '识别公司与证券代码',
              '检索官方来源',
              '梳理利润驱动与反证',
              '生成条件分析与结论',
            ].map((item) => (
              <span
                key={item}
                className="rounded-full border border-primary/15 bg-background px-2.5 py-1 text-[10px] text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </output>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    </div>
  );
}

function FactorSection({ factor }: { factor: FactorGroup }) {
  const Icon = factorIcons[factor.category];
  return (
    <article className="grid gap-4 border-b border-border py-6 last:border-b-0 md:grid-cols-[118px_minmax(0,1fr)]">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Icon className="size-4 text-primary" />
          {factor.category}
        </div>
        <span
          className={`mt-2 inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium ${signalStyle[factor.signal]}`}
        >
          {factor.signal}
        </span>
      </div>
      <div>
        <h3 className="text-base font-semibold">{factor.title}</h3>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {factor.summary}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {factor.evidence.map((item) => (
            <a
              key={`${item.label}-${item.sourceUrl}`}
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="group border-l-2 border-primary/25 bg-muted/45 px-3 py-2.5 transition-colors hover:border-primary hover:bg-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {item.label}
                </span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground/60 group-hover:text-primary" />
              </div>
              <p className="mt-1 text-xs font-medium leading-5">{item.value}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {item.sourceName} · {item.date}
              </p>
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function CompanyResearch() {
  const { user } = useWorkspaceSession();
  const [progress, setProgress] = useState('正在确认研究对象…');
  const researchController = useRef<AbortController | null>(null);
  useEffect(() => () => researchController.current?.abort(), []);
  const [report, setReport] = useState<CompanyReport | null>(null);
  const [legacyReport, setLegacyReport] = useState<SavedReport | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [saved, setSaved] = useState(false);
  const [listings, setListings] = useState<ListingOption[]>([]);
  const [selectedListingId, setSelectedListingId] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [listingNotice, setListingNotice] = useState('');

  const analysisQuery = useMemo(() => {
    if (typeof window === 'undefined') return '帮我分析小米集团的基本面信息';
    return (
      new URLSearchParams(window.location.search).get('query') ||
      '帮我分析小米集团的基本面信息'
    );
  }, []);

  const loadReport = async (
    input: string,
    listingId?: string,
    listing?: ListingOption,
  ) => {
    setError('');
    setReport(null);
    setLegacyReport(null);
    setSaved(false);
    researchController.current?.abort();
    const controller = new AbortController();
    researchController.current = controller;
    setProgress('正在确认研究对象…');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        signal: controller.signal,
        body: JSON.stringify({
          query: input,
          listingId,
          listing: listing || listings.find((item) => item.id === listingId),
          model: getPreferredResearchModel(user?.allowedAIModels),
        }),
      });
      const payload = await readResearchResponse(response, setProgress);
      if (controller.signal.aborted) return;
      setReport(payload as CompanyReport);
      await saveReport(payload as CompanyReport, input);
      setSaved(true);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '分析服务暂不可用');
    }
  };

  const resolveListingsAndLoad = async (
    input: string,
    preferredListingId?: string,
  ) => {
    setActiveQuery(input);
    setListingNotice('');
    const resolvedListings = await fetchListingOptions(input);
    setListings(resolvedListings);
    const selected =
      resolvedListings.find((item) => item.id === preferredListingId) ||
      resolvedListings[0];
    setSelectedListingId(selected?.id || '');
    if (resolvedListings.length > 1)
      setListingNotice(
        `识别到 ${resolvedListings.length} 个可选上市证券，请确认上市地与币种。`,
      );
    await loadReport(input, selected?.id, selected);
  };

  /* oxlint-disable react-hooks/exhaustive-deps -- URL initialization intentionally runs once per routed query. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preferredListingId = params.get('listing') || undefined;
    const savedId = params.get('saved');
    const initialResearch = window.setTimeout(async () => {
      const savedEntry = savedId ? await readStoredReport(savedId) : null;
      if (savedEntry?.report) {
        setActiveQuery(savedEntry.query);
        setReport(savedEntry.report);
        setSaved(true);
        setSelectedListingId(
          savedEntry.listingId || savedEntry.report.selectedListingId || '',
        );
        void fetchListingOptions(savedEntry.query).then((resolvedListings) => {
          setListings(resolvedListings);
          if (resolvedListings.length > 1)
            setListingNotice(
              `识别到 ${resolvedListings.length} 个可选上市证券，请确认上市地与币种。`,
            );
        });
        return;
      }
      if (savedEntry) {
        setActiveQuery(savedEntry.query);
        setLegacyReport(savedEntry);
        setSaved(true);
        setSelectedListingId(savedEntry.listingId || '');
        return;
      }
      void resolveListingsAndLoad(analysisQuery, preferredListingId);
    }, 0);
    return () => window.clearTimeout(initialResearch);
  }, [analysisQuery]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  const savePdf = () => {
    const originalTitle = document.title;
    if (report)
      document.title = `${report.companyName}-基本面分析-${new Date().toISOString().slice(0, 10)}`;
    else if (legacyReport)
      document.title = `${legacyReport.companyName}-历史基本面报告`;
    window.print();
    window.setTimeout(() => {
      document.title = originalTitle;
    }, 500);
  };

  const submitCompany = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!companySearch.trim()) return;
    const next = companySearch.trim();
    window.history.replaceState(
      {},
      '',
      `/company/research?query=${encodeURIComponent(next)}`,
    );
    void resolveListingsAndLoad(next);
  };

  const chooseListing = (listingId: string) => {
    setSelectedListingId(listingId);
    const params = new URLSearchParams(window.location.search);
    params.delete('saved');
    params.set('query', activeQuery);
    params.set('listing', listingId);
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
    void loadReport(
      activeQuery,
      listingId,
      listings.find((item) => item.id === listingId),
    );
  };

  const submitFollowup = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    const question = query.trim();
    if (!question || !report) return;
    setQuery('');
    setFollowups((current) => [...current, { question, loading: true }]);
    try {
      const response = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: report.companyName,
          question,
          context: `${report.thesis} ${report.conclusion}`,
          model: getPreferredAIModel(),
        }),
      });
      const payload = (await response.json()) as FollowupResponse;
      if (!response.ok) throw new Error(payload.error || '追问暂时失败');
      setFollowups((current) =>
        current.map((item) =>
          item.question === question && item.loading
            ? {
                question,
                answer: payload.answer,
                keyPoints: payload.keyPoints,
                sources: payload.sources,
              }
            : item,
        ),
      );
    } catch {
      setFollowups((current) =>
        current.map((item) =>
          item.question === question && item.loading
            ? { question, error: true }
            : item,
        ),
      );
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="print-hidden sticky top-0 z-30 border-b border-border bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="flex items-center gap-2.5"
            aria-label="返回首页"
          >
            <BrandMark />
            <span className="font-semibold tracking-[-0.04em]">透镜</span>
          </a>
          <form
            onSubmit={submitCompany}
            className="mx-auto hidden w-full max-w-xl md:block"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={companySearch}
                onChange={(event) => setCompanySearch(event.target.value)}
                className="h-10 rounded-xl bg-muted/55 pl-9"
                placeholder="继续分析另一家公司"
              />
            </div>
          </form>
          {saved ? (
            <a
              href="/reports"
              className="hidden items-center gap-1.5 text-[10px] text-emerald-700 sm:flex"
            >
              <CheckCircle2 className="size-3.5" />
              已保存到我的报告
            </a>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={savePdf}
            disabled={!report && !legacyReport}
          >
            <Download className="size-3.5" />
            另存为 PDF
          </Button>
        </div>
      </header>

      {!report && !legacyReport && !error && (
        <AnalysisSkeleton progress={progress} />
      )}

      {error && (
        <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
          <ShieldAlert className="size-10 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">分析暂时没有完成</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {error}
          </p>
          <Button
            className="mt-5"
            onClick={() =>
              loadReport(
                activeQuery || analysisQuery,
                selectedListingId || undefined,
                listings.find((item) => item.id === selectedListingId),
              )
            }
          >
            <RefreshCw className="size-4" />
            重新分析
          </Button>
        </div>
      )}

      {legacyReport && !report ? (
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <a
            href="/reports"
            className="print-hidden mb-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            返回我的报告
          </a>
          <section className="border border-border bg-card p-6 sm:p-8">
            <div className="flex flex-col justify-between gap-5 border-b border-border pb-6 sm:flex-row sm:items-start">
              <div>
                <p className="eyebrow">SAVED REPORT</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                  {legacyReport.companyName}
                </h1>
                <p className="mt-2 text-xs text-muted-foreground">
                  {legacyReport.exchange} · {legacyReport.companyCode} ·{' '}
                  {legacyReport.industry}
                </p>
              </div>
              <span className="w-fit bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {legacyReport.stance}
              </span>
            </div>
            {legacyReport.quote ? (
              <div className="mt-6 grid gap-4 border-b border-border pb-6 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    保存时价格
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold">
                    {legacyReport.quote.price} {legacyReport.quote.currency}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">当日涨跌</p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {legacyReport.quote.change}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">市值</p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {legacyReport.quote.marketCap}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="mt-6">
              <p className="eyebrow">SAVED CONCLUSION</p>
              <h2 className="mt-2 text-lg font-semibold">已保存的分析结论</h2>
              <p className="mt-3 text-sm leading-8 text-muted-foreground">
                {legacyReport.conclusion}
              </p>
            </div>
            <div className="print-hidden mt-7 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-950 dark:bg-amber-950/45 dark:text-amber-100">
              这份记录来自旧版存储，当时仅保留了行情与结论摘要。已展示全部可恢复内容，不会自动重新生成。
            </div>
            <Button
              className="print-hidden mt-5"
              onClick={() =>
                resolveListingsAndLoad(
                  legacyReport.query,
                  legacyReport.listingId,
                )
              }
            >
              <RefreshCw className="size-4" />
              主动重新研究完整报告
            </Button>
            <p className="mt-8 text-[10px] text-muted-foreground">
              更新于 {legacyReport.updatedAt}
              。本报告仅供信息参考，不构成投资建议。
            </p>
          </section>
        </div>
      ) : null}

      {report && (
        <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
          <a
            href="/"
            className="print-hidden mb-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            返回市场总览
          </a>
          {listings.length > 1 ? (
            <div className="print-hidden mb-5 flex flex-col gap-3 border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-xs font-semibold">选择上市证券</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {listingNotice}
                  </p>
                </div>
              </div>
              <NativeSelect
                aria-label="选择公司上市地"
                value={selectedListingId}
                onChange={(event) => chooseListing(event.target.value)}
                className="w-full sm:w-[310px]"
              >
                {listings.map((listing) => (
                  <NativeSelectOption key={listing.id} value={listing.id}>
                    {listing.exchange} · {listing.code} · {listing.currency}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <section className="flex flex-col justify-between gap-6 border-b border-border pb-7 lg:flex-row lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {report.exchange} · {report.companyCode}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {report.industry}
                </span>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
                {report.companyName}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                更新于 {report.updatedAt} · 行情截至 {report.quote.asOf}
              </p>
              {report.quote.sourceUrl ? (
                <a
                  href={report.quote.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="print-hidden mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                >
                  {report.quote.sourceName || '查看行情来源'}
                  <ExternalLink className="size-2.5" />
                </a>
              ) : null}
            </div>
            <div className="flex items-end gap-6">
              <div>
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground">
                  参考价格
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold">
                  {report.quote.price}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {report.quote.currency}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground">
                  当日涨跌
                </p>
                <p
                  className={`mt-1 font-mono text-sm font-semibold ${report.quote.change.startsWith('-') ? 'text-emerald-700' : 'text-red-600'}`}
                >
                  {report.quote.change}
                </p>
              </div>
              <div className="hidden sm:block">
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground">
                  市值
                </p>
                <p className="mt-1 font-mono text-sm font-semibold">
                  {report.quote.marketCap}
                </p>
              </div>
            </div>
          </section>

          {report.notice ? (
            <div className="mt-5 border-l-2 border-amber-500 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900">
              {report.notice}
            </div>
          ) : null}

          <div className="research-report-columns mt-7 grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0">
              <section className="overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.045]">
                <div className="grid md:grid-cols-[1fr_180px]">
                  <div className="p-6">
                    <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                      <Sparkles className="size-4" />
                      基本面主线
                    </div>
                    <h2 className="mt-3 text-xl font-semibold leading-8 tracking-tight">
                      {report.thesis}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">
                      {report.overview}
                    </p>
                  </div>
                  <div className="border-t border-primary/10 p-6 md:border-l md:border-t-0">
                    <p className="text-[10px] font-medium tracking-wider text-muted-foreground">
                      综合判断
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {report.stance}
                    </p>
                    <p className="mt-6 text-[10px] text-muted-foreground">
                      分析口径
                    </p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {report.deepResearch
                        ? '业务拆分、利润驱动、竞争壁垒、盈利质量与反证条件'
                        : '政策、行业、资金、财报与宏观五类基本面证据'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="mt-8">
                <div className="mb-4 flex items-end justify-between">
                  <div>
                    <p className="eyebrow">FINANCIAL SNAPSHOT</p>
                    <h2 className="mt-1 text-xl font-semibold">
                      核心财务与经营数据
                    </h2>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    点击指标查看来源
                  </span>
                </div>
                <div className="overflow-x-auto border-y border-border">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="text-[10px] tracking-wider text-muted-foreground">
                      <tr>
                        <th className="py-3 pr-4 font-medium">指标</th>
                        <th className="px-4 py-3 font-medium">数值</th>
                        <th className="px-4 py-3 font-medium">报告期</th>
                        <th className="px-4 py-3 font-medium">同比/变化</th>
                        <th className="px-4 py-3 font-medium">解读</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.metrics.map((metric) => (
                        <tr
                          key={`${metric.label}-${metric.period}`}
                          className="border-t border-border/75"
                        >
                          <td className="py-3.5 pr-4 font-medium">
                            <a
                              href={metric.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:text-primary"
                            >
                              {metric.label}
                              <ExternalLink className="size-2.5" />
                            </a>
                          </td>
                          <td className="px-4 py-3.5 font-mono">
                            {metric.value}
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground">
                            {metric.period}
                          </td>
                          <td className="px-4 py-3.5 font-medium">
                            {metric.change}
                          </td>
                          <td className="max-w-[300px] px-4 py-3.5 leading-5 text-muted-foreground">
                            {metric.assessment}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!report.metrics.length ? (
                    <p className="py-5 text-xs text-muted-foreground">
                      本轮未取得可追溯的核心财务数据，未使用估算值填补。
                    </p>
                  ) : null}
                </div>
              </section>

              {report.deepResearch ? (
                <CompanyResearchDepth
                  research={report.deepResearch}
                  sources={report.sources}
                />
              ) : null}

              <section className="mt-10">
                <div>
                  <p className="eyebrow">FIVE-FACTOR EVIDENCE</p>
                  <h2 className="mt-1 text-xl font-semibold">
                    五维基本面证据链
                  </h2>
                  <p className="mt-2 text-xs text-muted-foreground">
                    每项判断均回到政策、行业、资金、财报或宏观事实，不使用技术指标。
                  </p>
                </div>
                <div className="mt-3 border-t border-border">
                  {report.factors.map((factor) => (
                    <FactorSection key={factor.category} factor={factor} />
                  ))}
                </div>
              </section>

              <section className="mt-10 grid gap-6 md:grid-cols-3">
                {[
                  {
                    title: '基本面优势',
                    icon: CheckCircle2,
                    items: report.strengths,
                    color: 'text-primary',
                  },
                  {
                    title: '主要风险',
                    icon: ShieldAlert,
                    items: report.risks,
                    color: 'text-destructive',
                  },
                  {
                    title: '待验证催化剂',
                    icon: Target,
                    items: report.catalysts,
                    color: 'text-amber-700',
                  },
                ].map((group) => {
                  const Icon = group.icon;
                  return (
                    <div
                      key={group.title}
                      className="border-t border-border pt-4"
                    >
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Icon className={`size-4 ${group.color}`} />
                        {group.title}
                      </h3>
                      <ul className="mt-3 space-y-2.5">
                        {group.items.map((item) => (
                          <li
                            key={item}
                            className="flex gap-2 text-xs leading-5 text-muted-foreground"
                          >
                            <span className="mt-2 size-1 shrink-0 rounded-full bg-border" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </section>

              <section className="mt-10 border-y border-border py-7">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <CircleDot className="size-4" />
                  分析结论
                </div>
                <p className="mt-3 text-lg font-medium leading-8">
                  {report.conclusion}
                </p>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  {report.disclaimer}
                </p>
              </section>

              <section className="mt-10 pb-12">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="eyebrow">SOURCES</p>
                    <h2 className="mt-1 text-xl font-semibold">
                      源数据与参考来源
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {report.sources.length} SOURCES
                  </span>
                </div>
                <div className="mt-4 grid gap-x-8 border-t border-border md:grid-cols-2">
                  {report.sources.map((source, index) => (
                    <a
                      key={`${source.url}-${index}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group grid grid-cols-[24px_1fr_auto] gap-2 border-b border-border py-3.5"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span>
                        <span className="block text-xs font-medium leading-5 group-hover:text-primary">
                          {source.title}
                        </span>
                        <span className="mt-1 block text-[10px] text-muted-foreground">
                          {source.publisher} · {source.date}
                        </span>
                      </span>
                      <ArrowUpRight className="mt-0.5 size-3 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </section>
            </div>

            <aside className="print-hidden xl:sticky xl:top-24 xl:h-fit">
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_20px_55px_-42px_rgba(15,45,55,.5)]">
                <div className="border-b border-border p-5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                      <Bot className="size-4" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold">
                        继续追问 Copilot
                      </h2>
                      <p className="text-[10px] text-muted-foreground">
                        围绕这份报告深入验证
                      </p>
                    </div>
                  </div>
                </div>
                <div className="max-h-[480px] space-y-4 overflow-y-auto p-5">
                  {followups.length === 0 && (
                    <div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        可以追问财报口径、行业竞争、政策影响或风险变量。
                      </p>
                      <div className="mt-4 space-y-2">
                        {[
                          '最关键的利润驱动因素如何验证？',
                          '毛利率变化的主要原因是什么？',
                          '哪些宏观变量最值得跟踪？',
                        ].map((item) => (
                          <button
                            key={item}
                            onClick={() => setQuery(item)}
                            className="block w-full border-b border-border py-2 text-left text-xs hover:text-primary"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {followups.map((item, index) => (
                    <div
                      key={`${item.question}-${index}`}
                      className="space-y-3"
                    >
                      <div className="ml-7 rounded-lg bg-muted px-3 py-2 text-xs leading-5">
                        {item.question}
                      </div>
                      <div className="flex gap-2">
                        <Sparkles className="mt-1 size-3.5 shrink-0 text-primary" />
                        <div className="min-w-0 text-xs leading-6 text-muted-foreground">
                          {item.loading && (
                            <span className="inline-flex items-center gap-2">
                              <RefreshCw className="size-3 animate-spin" />
                              正在核验来源…
                            </span>
                          )}
                          {item.error && (
                            <span>这次追问暂时没有完成，请稍后重试。</span>
                          )}
                          {item.answer && (
                            <>
                              <p>{item.answer}</p>
                              {item.keyPoints && (
                                <ul className="mt-2 space-y-1">
                                  {item.keyPoints.map((point) => (
                                    <li key={point}>• {point}</li>
                                  ))}
                                </ul>
                              )}
                              {item.sources && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.sources.map((source) => (
                                    <a
                                      key={source.url}
                                      href={source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-primary underline underline-offset-2"
                                    >
                                      {source.title}
                                    </a>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  onSubmit={submitFollowup}
                  className="border-t border-border p-4"
                >
                  <div className="relative">
                    <MessageSquareText className="absolute left-3 top-3 size-4 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="h-11 rounded-xl pl-9 pr-11"
                      placeholder="追问这家公司…"
                    />
                    <Button
                      type="submit"
                      size="icon-sm"
                      className="absolute right-2 top-2"
                      disabled={!query.trim()}
                      aria-label="发送追问"
                    >
                      <Send className="size-3.5" />
                    </Button>
                  </div>
                </form>
              </div>
              <Button
                onClick={savePdf}
                variant="outline"
                className="mt-3 h-10 w-full rounded-xl"
              >
                <Download className="size-4" />
                另存为基本面分析 PDF
              </Button>
              <p className="mt-3 text-center text-[10px] leading-4 text-muted-foreground">
                保存时会调用浏览器打印，可选择“存储为 PDF”
              </p>
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
