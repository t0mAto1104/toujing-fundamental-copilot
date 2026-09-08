'use client';

import {
  ArrowUpRight,
  GitCompareArrows,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { WorkspaceShell } from '@/components/workspace-shell';
import { BoardFunds } from '@/components/market-signals';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getPreferredAIModel } from '@/lib/ai-models';
import {
  popularIndustryNames,
  standardIndustryNames,
} from '@/lib/research-data';

type AIComparison = {
  updatedAt: string;
  summary: string;
  dimensions: Array<{
    category: string;
    leftView: string;
    rightView: string;
    judgment: string;
  }>;
  conclusion: string;
  sources: Array<{ title: string; url: string }>;
  disclaimer: string;
};

type LiveIndustry = {
  code: string;
  name: string;
  percent: number;
  mainNetFlow: number | null;
  riseCount: number;
  fallCount: number;
  flatCount: number;
  leader: {
    name: string;
    code: string;
    price: number | null;
    percent: number | null;
  } | null;
};

export default function IndustryPage() {
  return (
    <WorkspaceShell active="industry">
      <Tabs defaultValue="compare">
        <TabsList aria-label="行业数据视图">
          <TabsTrigger value="compare">行业比较</TabsTrigger>
          <TabsTrigger value="funds">板块资金</TabsTrigger>
        </TabsList>
        <TabsContent value="compare" keepMounted>
          <IndustryComparison />
        </TabsContent>
        <TabsContent value="funds">
          <BoardFunds />
        </TabsContent>
      </Tabs>
    </WorkspaceShell>
  );
}

function IndustryComparison() {
  const [leftName, setLeftName] = useState('半导体');
  const [rightName, setRightName] = useState('创新药');
  const [comparison, setComparison] = useState<AIComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [liveIndustryNames, setLiveIndustryNames] = useState<string[]>([]);
  const [liveIndustries, setLiveIndustries] = useState<LiveIndustry[]>([]);
  const [industryUpdatedAt, setIndustryUpdatedAt] = useState('');
  const additionalIndustryNames = useMemo(() => {
    const existing = new Set([
      ...standardIndustryNames,
      ...popularIndustryNames,
    ]);
    return liveIndustryNames.filter((name) => !existing.has(name));
  }, [liveIndustryNames]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/industries', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          industries?: LiveIndustry[];
          updatedAt?: string;
        };
        const names = Array.from(
          new Set(
            (payload.industries || [])
              .map((item) => item.name?.trim())
              .filter((name): name is string => Boolean(name)),
          ),
        );
        setLiveIndustryNames(names);
        setLiveIndustries(payload.industries || []);
        setIndustryUpdatedAt(payload.updatedAt || '');
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const renderOptions = () => (
    <>
      <optgroup label="一级行业（31类）">
        {standardIndustryNames.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </optgroup>
      <optgroup label="热门细分行业">
        {popularIndustryNames.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </optgroup>
      {additionalIndustryNames.length ? (
        <optgroup label={`实时行业细分（${additionalIndustryNames.length}类）`}>
          {additionalIndustryNames.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );

  const liveIndustryFor = (name: string) =>
    liveIndustries.find((item) => item.name === name);

  const formatFlow = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return '待核验';
    return `${value >= 0 ? '+' : ''}${(value / 100_000_000).toFixed(2)}亿元`;
  };

  const runAICompare = async () => {
    setLoading(true);
    setError('');
    setComparison(null);
    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          left: leftName,
          right: rightName,
          model: getPreferredAIModel(),
        }),
      });
      const payload = (await response.json()) as AIComparison & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || '行业比较暂不可用');
      setComparison(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '行业比较暂不可用');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">INDUSTRY COMPARE</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              行业基本面比较
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              覆盖 31
              个一级行业、热门细分以及行情源返回的全部行业分类；先展示可验证的实时行业行情和资金数据，再由用户主动调用
              AI 核验政策、财报与宏观证据。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="选择左侧行业"
              value={leftName}
              onChange={(e) => {
                setLeftName(e.target.value);
                setComparison(null);
              }}
              className="h-9 max-w-[150px] rounded-lg border border-border bg-background px-3 text-xs"
            >
              {renderOptions()}
            </select>
            <GitCompareArrows className="size-4 shrink-0 text-muted-foreground" />
            <select
              aria-label="选择右侧行业"
              value={rightName}
              onChange={(e) => {
                setRightName(e.target.value);
                setComparison(null);
              }}
              className="h-9 max-w-[150px] rounded-lg border border-border bg-background px-3 text-xs"
            >
              {renderOptions()}
            </select>
          </div>
        </div>

        {leftName === rightName ? (
          <div className="mt-5 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            请选择两个不同的行业。
          </div>
        ) : null}

        <section className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
          {[leftName, rightName].map((name) => {
            const industry = liveIndustryFor(name);
            return (
              <article key={name} className="bg-card p-6">
                <h2 className="text-2xl font-semibold">{name}</h2>
                {industry ? (
                  <div className="mt-4 grid grid-cols-3 gap-px border border-border bg-border text-center text-[10px]">
                    <div className="bg-card p-2">
                      <p className="text-muted-foreground">当日涨跌</p>
                      <p className="mt-1 font-mono font-semibold">
                        {industry.percent >= 0 ? '+' : ''}
                        {industry.percent.toFixed(2)}%
                      </p>
                    </div>
                    <div className="bg-card p-2">
                      <p className="text-muted-foreground">主力净流</p>
                      <p className="mt-1 font-mono font-semibold">
                        {formatFlow(industry.mainNetFlow)}
                      </p>
                    </div>
                    <div className="bg-card p-2">
                      <p className="text-muted-foreground">领涨公司</p>
                      <p className="mt-1 truncate font-medium">
                        {industry.leader?.name || '待核验'}
                        {industry.leader?.price
                          ? ` · ${industry.leader.price}`
                          : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-xs leading-6 text-muted-foreground">
                    本轮实时行情源尚未返回该行业的可验证数据。
                  </p>
                )}
              </article>
            );
          })}
        </section>
        {industryUpdatedAt ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            实时行业数据更新于{' '}
            {new Intl.DateTimeFormat('zh-CN', {
              timeZone: 'Asia/Shanghai',
              dateStyle: 'short',
              timeStyle: 'medium',
            }).format(new Date(industryUpdatedAt))}
            ；涨跌与资金仅描述当前市场行为。
          </p>
        ) : null}

        <div className="mt-7 flex flex-col items-start justify-between gap-4 rounded-2xl bg-primary/[0.055] p-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />让 AI 核验最新行业证据
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              联网补充最新政策、行业消息、资金信息、代表性公司财报与宏观数据。
            </p>
          </div>
          <Button
            onClick={runAICompare}
            disabled={loading || leftName === rightName}
            className="h-9 px-4"
          >
            {loading ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {loading ? '正在核验…' : '生成最新比较'}
          </Button>
        </div>
        {error ? (
          <div className="mt-4 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-950">
            {error}
          </div>
        ) : null}
        {comparison ? (
          <section className="mt-7">
            <p className="eyebrow">AI VERIFIED</p>
            <h2 className="mt-1 text-xl font-semibold">联网核验结论</h2>
            <p className="mt-3 text-sm leading-7">{comparison.summary}</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {comparison.dimensions.map((item) => (
                <article
                  key={item.category}
                  className="rounded-xl border border-border p-4"
                >
                  <span className="text-[10px] font-semibold text-primary">
                    {item.category}
                  </span>
                  <p className="mt-2 text-xs leading-6">
                    <b>{leftName}：</b>
                    {item.leftView}
                  </p>
                  <p className="mt-2 text-xs leading-6">
                    <b>{rightName}：</b>
                    {item.rightView}
                  </p>
                  <p className="mt-3 border-t border-border pt-3 text-xs leading-6 text-muted-foreground">
                    {item.judgment}
                  </p>
                </article>
              ))}
            </div>
            {comparison.sources.length ? (
              <div className="mt-5">
                <p className="text-xs font-semibold">核验来源</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {comparison.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 border border-border px-2.5 py-1.5 text-[10px] text-primary"
                    >
                      <span className="truncate">{source.title}</span>
                      <ArrowUpRight className="size-3 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-6 border-y border-border py-5">
              <p className="text-sm font-semibold">分析结论</p>
              <p className="mt-2 text-sm leading-7">{comparison.conclusion}</p>
              <p className="mt-3 text-[10px] text-muted-foreground">
                {comparison.disclaimer}
              </p>
            </div>
          </section>
        ) : null}
        <p className="mt-6 text-[10px] text-muted-foreground">
          实时行情与 AI 核验均仅供信息参考，不构成技术指标、行情预测或投资建议。
        </p>
      </div>
    </>
  );
}
