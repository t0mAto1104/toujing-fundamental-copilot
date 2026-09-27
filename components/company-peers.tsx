'use client';

import { RefreshCw } from 'lucide-react';
import { useMarketFeed } from '@/components/use-market-feed';
import type { ListingOption } from '@/lib/market-listings';
import {
  PEER_MIN_SAMPLE,
  staleCompanyPeers,
  type CompanyPeers,
} from '@/lib/company-peers';
import { marketAmount, marketNumber } from '@/lib/quote-types';

const time = (stamp: string | null) =>
  stamp && Number.isFinite(Date.parse(stamp))
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'short',
        timeStyle: 'short',
        hour12: false,
      }).format(new Date(stamp))
    : '未取得';
function Source({
  url,
  children,
}: {
  url: string | null;
  children: React.ReactNode;
}) {
  return url && /^https?:\/\//.test(url) ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-primary hover:underline"
    >
      {children} ↗
    </a>
  ) : null;
}

export function CompanyPeersView({
  data,
  frozen = false,
}: {
  data: CompanyPeers;
  frozen?: boolean;
}) {
  return (
    <div className="space-y-4 p-4 text-sm">
      <p className="text-muted-foreground">
        {data.board
          ? `${data.board.name} · ${data.universeTotal} 家行业成分 · ${data.selectionEligible} 家符合市值抽样条件`
          : '暂无可核验参考组'}
        {frozen ? ' · 报告生成时快照' : ' · 最多每5分钟更新'}
      </p>
      {data.notices.map((notice) => (
        <p key={notice} className="leading-6 text-muted-foreground">
          {notice}
        </p>
      ))}
      {data.distributions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.distributions.map((d) => (
            <article key={d.metric} className="border border-border p-3">
              <h3 className="font-semibold">
                {d.metric === 'pe'
                  ? 'PE（TTM）参考样本'
                  : 'PB 参考样本（财报期未核验）'}
              </h3>
              <p className="mt-2">有效同行 {d.samples} 家 · 不含目标公司</p>
              {d.median === null ? (
                <p className="mt-2 text-muted-foreground">
                  有效样本少于 {PEER_MIN_SAMPLE} 家，不显示分位结果。
                </p>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  {[
                    ['下四分位', marketNumber(d.q1)],
                    ['中位数', marketNumber(d.median)],
                    ['上四分位', marketNumber(d.q3)],
                    ['目标公司', marketNumber(d.target)],
                  ].map(([label, v]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-mono">{v} 倍</dd>
                    </div>
                  ))}
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">
                      目标公司在候选样本中的相对位置
                    </dt>
                    <dd className="font-mono">
                      {d.percentile === null
                        ? '目标数据不满足比较条件'
                        : `${marketNumber(d.percentile)}%`}
                    </dd>
                  </div>
                </dl>
              )}
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                行情时间（北京）：{time(d.observationFrom)} —{' '}
                {time(d.observationTo)}
              </p>
            </article>
          ))}
        </div>
      )}
      {!!data.rows.length && (
        <details
          data-research-audit
          open
          className="border-t border-border pt-2"
        >
          <summary className="cursor-pointer py-3 font-medium">
            公司候选表与排除原因
          </summary>
          <section
            className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-primary print:overflow-visible"
            // Keyboard focus is required to scroll the wide data table.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label="可横向滚动的同行候选表"
          >
            <table className="w-full min-w-[760px] text-left text-sm print:min-w-0">
              <caption className="pb-3 text-left text-muted-foreground">
                统一币种
                CNY；市值为总市值。业务、客户与盈利模式仍须结合正式披露核验。
              </caption>
              <thead>
                <tr className="border-b border-border">
                  {[
                    '公司／入选依据',
                    '股价／市值',
                    'PE／PB',
                    '行情时间与来源',
                    '估值统计排除原因',
                  ].map((h) => (
                    <th scope="col" key={h} className="px-2 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.symbol}
                    className="border-b border-border align-top"
                  >
                    <th scope="row" className="max-w-60 px-2 py-3 font-normal">
                      <p className="font-medium">
                        {r.name} · {r.symbol.toUpperCase()}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.role} · {r.selection}
                      </p>
                    </th>
                    <td className="px-2 py-3 font-mono">
                      {marketNumber(r.price)} 元<br />
                      {marketAmount(r.marketCap, '元')}
                    </td>
                    <td className="px-2 py-3">
                      {marketNumber(r.pe)}（{r.peBasis || '口径未知'}）<br />
                      {marketNumber(r.pb)} 倍
                    </td>
                    <td className="px-2 py-3">
                      {time(r.asOf)}
                      <br />
                      <Source url={r.sourceUrl}>
                        {r.sourceName || '行情来源'}
                      </Source>
                    </td>
                    <td className="max-w-64 px-2 py-3 text-xs leading-5 text-muted-foreground">
                      PE：{r.exclusions.pe.join('；') || '符合样本条件'}
                      <br />
                      PB：
                      {r.exclusions.pb.join('；') ||
                        '符合来源快照条件，财报期未核验'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </details>
      )}
      {!!data.rows.length && (
        <details data-research-audit className="border-t border-border pt-2">
          <summary className="cursor-pointer py-3 font-medium">
            查看估值计算底稿
          </summary>
          <div className="space-y-3 leading-6 text-muted-foreground">
            <p>
              四分位采用升序样本的线性插值：位置＝(n−1)×p，p 为
              0.25／0.5／0.75；相对位置＝(低于目标值数量＋同值数量×½)÷n×100%。计算使用原值，展示才四舍五入。少于4家不计算。
            </p>
            <p>
              仅比较同源、同一交易日且与目标时间相差不超过5分钟的有效数据。非正
              PE 不表示便宜；PB
              分母期间未核验。相对位置是候选样本统计，不是全行业排名、内在价值或投资建议。
            </p>
            <p>
              行业归属获取：{time(data.classificationAsOf)} ·{' '}
              <Source url={data.membershipSourceUrl}>归属来源</Source>
              <br />
              成分市值观察：{time(data.universeAsOf)} ·{' '}
              <Source url={data.universeSourceUrl}>成分来源</Source>
              <br />
              估值批次获取：{time(data.fetchedAt)}
            </p>
            {data.boards.length > 1 && (
              <p>
                来源返回行业：
                {data.boards.map((b) => `${b.name}（${b.code}）`).join('、')}
                ；本轮采用首项，不声明其是最细分类。
              </p>
            )}
            <p>
              市值抽样距离＝|ln(候选总市值÷目标总市值)|；同距按代码排列。来源市值用于抽样，当前行情用于估值，不按涨幅挑选。
            </p>
            {data.rows.map((r) => (
              <p key={r.symbol}>
                {r.name}（{r.symbol}）：抽样总市值{' '}
                {r.selectionMarketCap ?? '缺失'} 元；PE {r.pe ?? '缺失'}（
                {r.peBasis || '未知'}）；PB {r.pb ?? '缺失'}；来源时点{' '}
                {r.asOf || '缺失'}。
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function CompanyPeersPanel({ listing }: { listing: ListingOption }) {
  const feed = useMarketFeed<CompanyPeers>(
    `/api/company-data?${new URLSearchParams({ query: listing.code, listing: listing.id, section: 'peers' })}`,
    5 * 60_000,
    36_000,
  );
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h2 className="font-semibold">同行候选与估值参考</h2>
        <button
          type="button"
          aria-label="刷新同行候选与估值"
          onClick={feed.refresh}
          disabled={feed.loading}
          className="flex size-11 items-center justify-center text-muted-foreground hover:text-primary disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${feed.loading ? 'animate-spin' : ''}`}
          />
        </button>
      </header>
      {feed.error ? (
        <output className="block p-4 text-sm text-muted-foreground">
          {feed.error}
        </output>
      ) : null}
      {feed.data ? (
        <CompanyPeersView
          data={feed.error ? staleCompanyPeers(feed.data) : feed.data}
        />
      ) : (
        <output className="block p-4 text-sm text-muted-foreground">
          {feed.loading ? '正在核验行业归属与估值样本…' : '暂未取得同行数据。'}
        </output>
      )}
    </section>
  );
}
