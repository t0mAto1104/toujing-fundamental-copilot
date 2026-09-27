import type { CommodityEvidence } from '@/lib/research-commodities';
import { SeriesChart } from '@/components/research-history-chart';

export function ResearchCommodityEvidence({
  evidence,
}: {
  evidence?: CommodityEvidence;
}) {
  if (!evidence?.items.length) return null;
  return (
    <section className="research-history" aria-label="产业商品价格参照">
      <h3 className="mb-3 font-semibold">产业商品价格参照</h3>
      {evidence.items.map((item) => (
        <div key={item.code}>
          <p className="research-history-note">
            {item.name} · 数据截至 {item.asOf}
            {item.stale ? ' · 旧快照，请核验最新价格' : ''}
            。程序计算一年价格变化：
            {item.statistics.change1yPct === null
              ? '数据不足'
              : `${item.statistics.change1yPct.toFixed(2)}%`}
            {item.statistics.change1yPct !== null
              ? `（基期 ${item.statistics.baseDate}）`
              : ''}
            。
          </p>
          <p className="research-history-note">
            候选关联来自披露原文：“{item.disclosure.text}”{' '}
            <a
              href={item.disclosure.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              公司披露 · {item.disclosure.date}
              {item.disclosure.page ? ` · 第 ${item.disclosure.page} 页` : ''}
            </a>
          </p>
          <SeriesChart series={item.history} selected />
        </div>
      ))}
    </section>
  );
}
