/* oxlint-disable next/no-html-link-for-pages -- preserve the site's full-page authenticated navigation. */
import type { ReactNode } from 'react';
import type { CompanyReport } from '@/lib/research-types';
import { paginate, type ModuleId } from '@/lib/report-template';
import { ResearchHistoryChart } from '@/components/research-history-chart';
import { ResearchCommodityEvidence } from '@/components/research-commodity-evidence';

export function CustomResearchReport({ report }: { report: CompanyReport }) {
  const custom = report.customReport;
  if (!custom) return null;
  const { template } = custom;
  const planned = paginate(template.blocks);
  const fields = [
    ['facts', '资料事实'],
    ['analysis', '分析推断'],
    ['counterEvidence', '反证与风险'],
    ['watchFor', '验证变量'],
  ] as const;
  function refs(urls: string[]) {
    return (
      <span className="custom-source-refs">
        {[...new Set(urls)].map((url) => {
          const index = report.sources.findIndex((s) => s.url === url);
          return index < 0 ? null : (
            <a
              key={url}
              href={report.sources[index].url}
              target="_blank"
              rel="noreferrer"
            >
              [{index + 1}]
            </a>
          );
        })}
      </span>
    );
  }
  function program(id: ModuleId): ReactNode {
    const deep = report.deepResearch;
    if (id === 'snapshot')
      return (
        <>
          <dl className="custom-snapshot">
            {[
              [
                '公司 / 证券',
                `${report.companyName} · ${report.companyCode} · ${report.exchange}`,
              ],
              ['价格 / 币种', `${report.quote.price} ${report.quote.currency}`],
              [
                '涨跌 / 市值',
                `${report.quote.change} / ${report.quote.marketCap}`,
              ],
              ['行情时点', report.quote.asOf],
              [
                '资料时点',
                report.researchRun?.evidenceAsOf || report.updatedAt,
              ],
              [
                '模型 / 版本',
                `${report.researchRun?.model || '未记录'} / ${custom!.version}`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {report.quote.isStale && (
            <p>{report.quote.staleReason || '旧行情快照，非实时价格。'}</p>
          )}
          {refs([report.quote.sourceUrl || ''])}
        </>
      );
    if (id === 'calculations')
      return deep?.quality?.calculations.length ? (
        <div className="custom-calculations">
          {deep.quality.calculations.map((row) => (
            <article key={row.id}>
              <h3>
                {row.label} · {row.period}
              </h3>
              <p>
                公式：{row.formula}；结果：
                {row.value.toLocaleString('zh-CN', {
                  maximumFractionDigits: 2,
                })}{' '}
                {row.unit}
              </p>
              <ul>
                {row.inputs.map((x, i) => (
                  <li key={i}>
                    {x.period} {x.field}：{x.value.toLocaleString('zh-CN')}{' '}
                    {x.unit} · {x.currency} · {x.scope} · {x.basis}
                    {refs(x.sourceUrls)}
                    {x.derivedFrom?.map((d, j) => (
                      <p key={j}>
                        组成：{d.period} {d.field}{' '}
                        {d.value.toLocaleString('zh-CN')} {d.unit}
                        {refs(d.sourceUrls)}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
              {row.limitation && <p>{row.limitation}</p>}
            </article>
          ))}
        </div>
      ) : (
        <p>未取得足够可核验输入，未计算或补造数值。</p>
      );
    if (id === 'methods')
      return deep?.methodology ? (
        <>
          <p>
            {deep.methodology.version} · {deep.methodology.profile}
          </p>
          <p>
            {deep.methodology.profileBasis.label}
            {refs(deep.methodology.profileBasis.sourceUrls)}
          </p>
          <p>{deep.methodology.industryRule}</p>
          {deep.methodology.methods.map((m) => (
            <article key={m.id}>
              <h3>{m.title}</h3>
              <p>{m.text}</p>
            </article>
          ))}
          {deep.methodology.signals.map((s) => (
            <article key={s.variable}>
              <h3>
                {s.variable} · {s.status}
              </h3>
              {s.passages.map((p, i) => (
                <p key={i}>
                  {p.date} {p.page !== null ? `第${p.page}页` : ''}：{p.text}
                  {refs([p.sourceUrl])}
                </p>
              ))}
            </article>
          ))}
        </>
      ) : (
        <p>未记录研究方法，不推断已应用的方法。</p>
      );
    if (id === 'audit')
      return (
        <>
          {custom!.checks.map((c) => (
            <article key={c.label}>
              <h3>
                {c.passed ? '已通过所列检查' : '待核验'} · {c.label}
              </h3>
              <p>{c.detail}</p>
            </article>
          ))}
          <p>
            正式全文 {deep?.evidenceAudit?.documentsRead ?? 0} 份 · 财报期间{' '}
            {deep?.evidenceAudit?.financialPeriods ?? 0} 个 · 本轮补证联网{' '}
            {deep?.evidenceAudit?.webSearches ?? 0} 次
          </p>
          <p>核验时间：{deep?.evidenceAudit?.checkedAt || '未记录'}</p>
          <p className="break-all">
            证据指纹：{deep?.quality?.evidenceHash || '未记录'}
          </p>
          <ul>
            {deep?.evidenceAudit?.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </>
      );
    if (id === 'sources')
      return (
        <>
          {!!custom!.diagnostics?.length && (
            <details>
              <summary>
                取数与适用性记录（{custom!.diagnostics.length}{' '}
                项，不等同于数据缺失）
              </summary>
              <ul>
                {custom!.diagnostics.map((d, i) => (
                  <li key={i}>
                    {d.kind}：{d.detail}
                    {refs(d.sourceUrls)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!custom!.conclusionReview?.limitations.length && (
            <>
              <h3>结论受限原因</h3>
              <ul>
                {custom!.conclusionReview.limitations.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </>
          )}
          {!!custom!.conclusionReview?.resolvedGaps.length && (
            <>
              <h3>补证后已解决的缺口</h3>
              <ul>
                {custom!.conclusionReview.resolvedGaps.map((gap, i) => (
                  <li key={i}>
                    {gap.original}：已按本轮资料确认取得。{refs(gap.sourceUrls)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>来源目录</h3>
          <ol>
            {report.sources.map((source, i) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  [{i + 1}] {source.title}
                </a>{' '}
                · {source.publisher} · {source.date}
              </li>
            ))}
          </ol>
          <h3>数据缺口与适用边界</h3>
          {custom!.gaps.length ? (
            <ul>
              {custom!.gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
          ) : (
            <p>未记录额外缺口，不代表资料已穷尽或每项事实已独立核实。</p>
          )}
          <p>{report.disclaimer}</p>
        </>
      );
    return <p>未取得该模块分析，不以样例代替真实结果。</p>;
  }
  return (
    <div className="custom-research-report">
      <a className="print-hidden text-primary underline" href="/report-builder">
        返回自定义研报
      </a>
      <header className="custom-report-heading">
        <p>
          {report.companyName} · {report.exchange} · {report.companyCode}
        </p>
        <h1>{template.title}</h1>
        <p>{template.question}</p>
        <p>
          生成于 {report.updatedAt} · {report.researchRun?.model}
        </p>
        <p>{report.notice}</p>
        <p className="print-hidden">
          计划 {planned.length} 页，篇幅上限目标 {template.pageLimit}{' '}
          页；实际导出随内容自然分页，未截断证据。
        </p>
      </header>
      {template.blocks.map((block, i) => {
        const start = planned.findIndex((page) =>
          page.some((p) => p.block.id === block.id),
        );
        const previousPage =
          i > 0
            ? planned.findIndex((page) =>
                page.some((p) => p.block.id === template.blocks[i - 1].id),
              )
            : start;
        const breakPage = i > 0 && (block.breakBefore || start > previousPage);
        const section = custom.sections[block.id];
        return (
          <section
            key={block.id}
            id={`report-module-${block.id}`}
            data-module={block.id}
            className={`custom-report-module ${breakPage ? 'custom-page-break' : ''}`}
          >
            <h2>
              {String(i + 1).padStart(2, '0')} · {block.title}
            </h2>
            {block.id === 'summary' && custom.conclusionReview && (
              <div className="custom-conclusion-scope">
                <h3>
                  结论范围 ·{' '}
                  {
                    {
                      conditional: '条件分析',
                      limited: '局部分析',
                      withheld: '暂缓综合判断',
                    }[custom.conclusionReview.status]
                  }
                </h3>
                {!!custom.conclusionReview.basis.length && (
                  <p>
                    依据模块：
                    {custom.conclusionReview.basis
                      .map(
                        (id) =>
                          template.blocks.find((b) => b.id === id)?.title || id,
                      )
                      .join('、')}
                    。仅按所列来源与已取得资料分析，不代表资料完整或逐句审计。
                  </p>
                )}
                {!!custom.conclusionReview.limitations.length && (
                  <>
                    <ul>
                      {custom.conclusionReview.limitations
                        .slice(0, 3)
                        .map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                    </ul>
                    {custom.conclusionReview.limitations.length > 3 && (
                      <p>
                        <a href="#report-module-sources">
                          查看全部 {custom.conclusionReview.limitations.length}{' '}
                          项受限原因
                        </a>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {block.id ===
              template.blocks.find((b) =>
                ['drivers', 'business', 'industry'].includes(b.id),
              )?.id && (
              <ResearchCommodityEvidence
                evidence={report.deepResearch?.commodities}
              />
            )}
            {(block.id === 'finance' || block.id === 'valuation') &&
              report.deepResearch?.history && (
                <ResearchHistoryChart
                  history={report.deepResearch.history}
                  group={block.id === 'finance' ? 'finance' : 'valuation'}
                />
              )}
            {block.id === 'finance' &&
              !!report.deepResearch?.financialTrend?.length && (
                <div className="custom-financial-table">
                  <table>
                    <caption>
                      已取得的财务数据（保留原币种、单位和期间）
                    </caption>
                    <thead>
                      <tr>
                        <th>报告期</th>
                        <th>收入</th>
                        <th>净利润</th>
                        <th>经营现金流</th>
                        <th>现金与债务</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.deepResearch.financialTrend.map((row) => (
                        <tr key={row.period}>
                          <th>
                            {row.period}
                            {refs(row.sourceUrls)}
                          </th>
                          <td>{row.revenue}</td>
                          <td>{row.netProfit}</td>
                          <td>{row.operatingCashFlow}</td>
                          <td>{row.cashAndDebt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>
                    累计期、单季、全年口径不混用；不把同比变化直接解释为因果。
                  </p>
                </div>
              )}
            <div
              className={
                block.layout === 'columns' ? 'custom-module-columns' : ''
              }
            >
              {section ? (
                <>
                  {block.id === 'business' &&
                    (section.companyIntroduction !== undefined ||
                      section.developmentHistory !== undefined) && (
                      <>
                        <article>
                          <h3>公司简介与商业模式</h3>
                          <p>
                            {section.companyIntroduction ||
                              '本轮未取得可核验的公司介绍。'}
                          </p>
                        </article>
                        <article>
                          <h3>发展历程</h3>
                          <p>
                            {section.developmentHistory ||
                              '本轮未取得可核验的发展历程。'}
                          </p>
                        </article>
                      </>
                    )}
                  {fields.map(([key, label]) => (
                    <article key={key}>
                      <h3>{label}</h3>
                      <p>{section[key] || '本项未取得足够资料。'}</p>
                    </article>
                  ))}
                  {section.sourceUrls.length > 0 && (
                    <p>引用来源：{refs(section.sourceUrls)}</p>
                  )}
                  {section.dataGaps.length > 0 && (
                    <div>
                      <h3>模块缺口</h3>
                      <ul>
                        {section.dataGaps.map((gap, index) => (
                          <li key={index}>{gap}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                program(block.id)
              )}
            </div>
          </section>
        );
      })}
      <footer>{report.disclaimer}</footer>
    </div>
  );
}
