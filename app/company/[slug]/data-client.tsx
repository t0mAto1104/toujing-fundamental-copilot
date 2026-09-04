'use client';

import {
  ArrowUpRight,
  Bot,
  Building2,
  FileText,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CompanySearchField } from '@/components/company-search-field';
import { WorkspaceShell } from '@/components/workspace-shell';
import type { CompanyFundamentalPacket } from '@/lib/a-stock-company';
import type { ListingOption, VerifiedQuote } from '@/lib/market-listings';

type CompanyDataResponse = {
  listing: ListingOption;
  listings: ListingOption[];
  quote: VerifiedQuote | null;
  packet: CompanyFundamentalPacket | null;
  packetFetchedAt: string | null;
  packetStale: boolean;
  packetPending?: boolean;
  quotePending?: boolean;
  updatedAt: string;
  methodology: string;
  error?: string;
};

function displayTime(value?: string | null) {
  if (!value) return '尚未取得';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export default function CompanyData() {
  const [data, setData] = useState<CompanyDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [companySearch, setCompanySearch] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('query') || '';
  });
  const selectedListingRef = useRef('');
  const requestControllerRef = useRef<AbortController | null>(null);

  const pageQuery = useMemo(() => {
    if (typeof window === 'undefined') return { query: '', listing: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      query: params.get('query')?.trim() || '',
      listing: params.get('listing')?.trim() || '',
    };
  }, []);

  const load = useCallback(
    async (quiet = false, listingId?: string) => {
      if (!pageQuery.query) {
        setError('缺少公司名称或证券代码。');
        setLoading(false);
        return;
      }
      if (
        quiet &&
        (document.visibilityState !== 'visible' || requestControllerRef.current)
      )
        return;
      requestControllerRef.current?.abort();
      if (quiet) setRefreshing(true);
      else setLoading(true);
      const controller = new AbortController();
      requestControllerRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const params = new URLSearchParams({ query: pageQuery.query });
        const selected =
          (listingId ?? selectedListingRef.current) || pageQuery.listing;
        if (selected) params.set('listing', selected);
        const response = await fetch(`/api/company-data?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = (await response.json()) as CompanyDataResponse;
        if (!response.ok) throw new Error(payload.error || '公司数据暂不可用');
        if (requestControllerRef.current !== controller) return;
        selectedListingRef.current = payload.listing.id;
        setData((previous) => {
          if (!previous || previous.listing.id !== payload.listing.id)
            return payload;
          return {
            ...payload,
            quote:
              payload.quote ||
              (previous.quote
                ? {
                    ...previous.quote,
                    isStale: true,
                    staleReason:
                      '本轮行情尚未更新，显示上次取得的真实报价，请留意行情时间。',
                  }
                : null),
            packet: payload.packet || previous.packet,
            packetFetchedAt: payload.packet
              ? payload.packetFetchedAt
              : previous.packetFetchedAt,
            packetStale: payload.packet
              ? payload.packetStale
              : Boolean(previous.packet),
          };
        });
        setError('');
      } catch (cause) {
        if (
          controller.signal.aborted &&
          requestControllerRef.current !== controller
        )
          return;
        setError(
          cause instanceof Error && cause.name !== 'AbortError'
            ? cause.message
            : '公司数据源响应超时，请稍后刷新。',
        );
      } finally {
        window.clearTimeout(timeout);
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [pageQuery.listing, pageQuery.query],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const quoteTimer = window.setInterval(() => void load(true), 20_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(quoteTimer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [load]);

  const chooseListing = (listingId: string) => {
    const selected = data?.listings.find((item) => item.id === listingId);
    if (!selected) return;
    selectedListingRef.current = selected.id;
    const params = new URLSearchParams({
      query: pageQuery.query,
      listing: selected.id,
    });
    window.history.replaceState({}, '', `/company/data?${params.toString()}`);
    void load(false, selected.id);
  };

  const startAIResearch = () => {
    if (!data) return;
    const params = new URLSearchParams({
      query: data.listing.name,
      listing: data.listing.id,
    });
    window.location.assign(`/company/research?${params.toString()}`);
  };

  const openCompanyData = (value: string, listing?: ListingOption) => {
    const params = new URLSearchParams({ query: value.trim() });
    if (listing) params.set('listing', listing.id);
    window.location.assign(`/company/data?${params.toString()}`);
  };

  return (
    <WorkspaceShell
      active="market"
      headerSearch={
        <CompanySearchField
          value={companySearch}
          onValueChange={setCompanySearch}
          onResearch={openCompanyData}
          className="mx-auto hidden w-full max-w-xl md:block"
          inputClassName="h-10 rounded-xl border-border bg-muted/55 shadow-none focus-visible:bg-background focus-visible:ring-2"
          placeholder="继续搜索公司或证券代码"
        />
      }
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">A-STOCK-DATA · NO AI</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              {data?.listing.name || pageQuery.query || '上市公司数据'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data?.listings && data.listings.length > 1 ? (
              <select
                aria-label="选择上市地"
                value={data.listing.id}
                onChange={(event) => chooseListing(event.target.value)}
                className="h-9 border border-border bg-background px-3 text-xs"
              >
                {data.listings.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.exchange} · {listing.code} · {listing.currency}
                  </option>
                ))}
              </select>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
              刷新数据
            </Button>
            <Button onClick={startAIResearch} disabled={!data}>
              <Bot />
              是否需要 AI 研究？
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mt-5 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:bg-amber-950/50 dark:text-amber-100">
            {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" />
            正在连接 a-stock-data 数据源，请稍后…
          </div>
        ) : null}

        {data ? (
          <>
            <section className="mt-7 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {[
                [
                  '当前价格',
                  data.quote
                    ? `${data.quote.price} ${data.quote.currency}`
                    : data.quotePending
                      ? '正在更新…'
                      : '暂不可达',
                ],
                ['涨跌幅', data.quote?.change || '—'],
                [
                  '总市值',
                  data.quote?.marketCap ||
                    data.packet?.companyInfo?.marketCap ||
                    '待核验',
                ],
                ['行情时间', data.quote?.asOf || displayTime(data.updatedAt)],
              ].map(([label, value]) => (
                <div key={label} className="bg-card p-4">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="mt-2 font-mono text-base font-semibold">
                    {value}
                  </p>
                </div>
              ))}
            </section>
            {data.quote?.isStale ? (
              <p className="mt-3 border-l-2 border-amber-500 px-3 text-xs leading-6 text-muted-foreground">
                {data.quote.staleReason}
              </p>
            ) : null}
            {data.packetPending ? (
              <div className="mt-4 flex items-center gap-2 border-l-2 border-primary bg-primary/[0.045] px-4 py-3 text-xs text-muted-foreground">
                <RefreshCw className="size-3.5 animate-spin text-primary" />
                财务、公告、资金流与研报正在后台汇总，已取得的数据会保留显示，完成后自动更新。
              </div>
            ) : null}

            <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
              <div className="space-y-8">
                <section>
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-primary" />
                    <h2 className="text-lg font-semibold">公司与估值资料</h2>
                  </div>
                  <div className="mt-4 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                    {data.packet?.companyInfo ? (
                      Object.entries({
                        所属行业: data.packet.companyInfo.industry,
                        总股本: data.packet.companyInfo.totalShares,
                        流通股本: data.packet.companyInfo.floatShares,
                        '市盈率（TTM）': data.packet.companyInfo.peTtm,
                        市净率: data.packet.companyInfo.pb,
                        上市日期: data.packet.companyInfo.listingDate,
                      }).map(([label, value]) => (
                        <div key={label} className="bg-card p-4">
                          <p className="text-[10px] text-muted-foreground">
                            {label}
                          </p>
                          <p className="mt-1 text-sm font-medium">{value}</p>
                        </div>
                      ))
                    ) : (
                      <p className="bg-card p-4 text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
                        {data.packetPending
                          ? '公司结构化资料正在汇总…'
                          : '该上市证券暂无可用的A股结构化公司资料。'}
                      </p>
                    )}
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-primary" />
                    <h2 className="text-lg font-semibold">最新财务科目</h2>
                  </div>
                  <div className="mt-4 overflow-x-auto border-y border-border">
                    <table className="w-full min-w-[620px] text-left text-xs">
                      <thead className="text-[10px] text-muted-foreground">
                        <tr>
                          <th className="py-3">指标</th>
                          <th>数值</th>
                          <th>报告期</th>
                          <th>同比</th>
                          <th>来源</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.packet?.financialMetrics || []).map((metric) => (
                          <tr
                            key={`${metric.label}-${metric.period}`}
                            className="border-t border-border"
                          >
                            <td className="py-3 font-medium">{metric.label}</td>
                            <td>{metric.value}</td>
                            <td>{metric.period}</td>
                            <td>{metric.change}</td>
                            <td>
                              <a
                                href={metric.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary"
                              >
                                原始报表{' '}
                                <ArrowUpRight className="inline size-3" />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.packet?.financialMetrics.length ? (
                      <p className="py-6 text-xs text-muted-foreground">
                        {data.packetPending
                          ? '财务科目正在汇总…'
                          : '本轮未取得可用财务科目，请以公司正式公告为准。'}
                      </p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-primary" />
                    <h2 className="text-lg font-semibold">最新公告</h2>
                  </div>
                  <div className="mt-3 divide-y divide-border border-y border-border">
                    {(data.packet?.announcements || []).map((item) => (
                      <a
                        key={`${item.date}-${item.title}`}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-start justify-between gap-3 py-3 text-xs hover:text-primary"
                      >
                        <span>{item.title}</span>
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {item.date}
                        </span>
                      </a>
                    ))}
                    {!data.packet?.announcements.length ? (
                      <p className="py-4 text-xs text-muted-foreground">
                        {data.packetPending
                          ? '公司公告正在汇总…'
                          : '本轮未取得可用公告。'}
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>

              <aside className="space-y-6">
                <section className="border border-border p-4">
                  <div className="flex items-center gap-2">
                    <WalletCards className="size-4 text-primary" />
                    <h2 className="font-semibold">资金流数据</h2>
                  </div>
                  {data.packet?.fundFlow ? (
                    <div className="mt-4">
                      <p className="font-mono text-xl font-semibold">
                        {data.packet.fundFlow.mainNet}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {data.packet.fundFlow.period} ·{' '}
                        {data.packet.fundFlow.direction}
                      </p>
                      <a
                        href={data.packet.fundFlow.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-xs text-primary"
                      >
                        查看原始数据 <ArrowUpRight className="inline size-3" />
                      </a>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {data.packetPending
                        ? '资金流数据正在汇总…'
                        : '本轮未取得资金流数据。'}
                    </p>
                  )}
                </section>

                <section className="border border-border p-4">
                  <h2 className="font-semibold">券商研报索引</h2>
                  <div className="mt-3 space-y-3">
                    {(data.packet?.researchReports || [])
                      .slice(0, 5)
                      .map((item) => (
                        <a
                          key={`${item.date}-${item.title}`}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block border-l-2 border-primary/25 pl-3 text-xs hover:border-primary"
                        >
                          <p className="font-medium leading-5">{item.title}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {item.publisher} · {item.date} · {item.rating}
                          </p>
                        </a>
                      ))}
                    {!data.packet?.researchReports.length ? (
                      <p className="text-xs text-muted-foreground">
                        {data.packetPending
                          ? '券商研报正在汇总…'
                          : '本轮未取得可用券商研报。'}
                      </p>
                    ) : null}
                  </div>
                </section>

                <section className="border border-border p-4">
                  <h2 className="font-semibold">数据说明</h2>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    {data.methodology}
                  </p>
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    基本面包更新：{displayTime(data.packetFetchedAt)}
                    {data.packetStale ? ' · 当前为过期缓存' : ''}
                  </p>
                  {(data.packet?.warnings || []).map((warning) => (
                    <p
                      key={warning}
                      className="mt-2 text-[10px] leading-5 text-amber-700 dark:text-amber-300"
                    >
                      {warning}
                    </p>
                  ))}
                </section>
              </aside>
            </div>
            <p className="mt-8 border-t border-border pt-4 text-[10px] leading-5 text-muted-foreground">
              数据只用于信息展示，不能保证交易所之外的第三方源绝对连续；页面不构成投资建议。
            </p>
          </>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
