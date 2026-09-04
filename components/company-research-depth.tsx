import type { DeepResearch, SourceLink } from '@/lib/research-types';

function SourceRefs({
  urls,
  sources,
}: {
  urls: string[];
  sources: SourceLink[];
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-primary">
      {urls.map((url) => {
        const index = sources.findIndex((source) => source.url === url);
        const source = sources[index];
        return source ? (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            [{index + 1}] {source.publisher} · {source.date}
          </a>
        ) : null;
      })}
    </div>
  );
}

export function CompanyResearchDepth({
  research,
  sources,
}: {
  research: DeepResearch;
  sources: SourceLink[];
}) {
  return (
    <>
      {research.businessSegments?.length ? (
        <section className="deep-research-section mt-10">
          <p className="eyebrow">BUSINESS & PROFIT MIX</p>
          <h2 className="mt-1 text-xl font-semibold">业务拆分与利润来源</h2>
          <div className="mt-4 space-y-5">
            {research.businessSegments.map((row, i) => (
              <article key={i} className="border-t border-border pt-4">
                <h3 className="font-semibold">
                  {row.name}{' '}
                  <span className="ml-2 text-xs font-normal text-primary">
                    {row.role}
                  </span>
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  报告期：{row.period}
                </p>
                <dl className="my-3 grid grid-cols-2 gap-3 bg-muted/40 p-3 text-xs sm:grid-cols-4">
                  {[
                    ['收入', row.revenue],
                    ['收入占比', row.share],
                    ['同比', row.growth],
                    ['毛利率', row.grossMargin],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-1 font-mono font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm leading-7">产品与客户：{row.products}</p>
                <p className="mt-2 text-sm leading-7">
                  利润驱动：{row.profitDriver}
                </p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  业务阶段与协同：{row.stage}
                </p>
                <SourceRefs urls={row.sourceUrls} sources={sources} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {research.strategicInvestments?.length ? (
        <section className="deep-research-section mt-10">
          <p className="eyebrow">INVESTMENTS & COMMERCIALIZATION</p>
          <h2 className="mt-1 text-xl font-semibold">联营业务与协同兑现</h2>
          {research.strategicInvestments.map((row, i) => (
            <article
              key={i}
              className="mt-4 border-t border-border pt-4 text-sm leading-7"
            >
              <h3 className="font-semibold">{row.entity}</h3>
              <p>持股及会计口径：{row.ownershipAndAccounting}</p>
              <p>业绩贡献：{row.contribution}</p>
              <p>业务阶段与协同：{row.stageAndSynergy}</p>
              <p className="text-muted-foreground">
                风险与验证：{row.risksAndVerification}
              </p>
              <SourceRefs urls={row.sourceUrls} sources={sources} />
            </article>
          ))}
        </section>
      ) : null}

      {research.operatingDrivers?.length ? (
        <section className="deep-research-section mt-10">
          <p className="eyebrow">OPERATING DRIVERS</p>
          <h2 className="mt-1 text-xl font-semibold">逐业务经营变量与传导</h2>
          <div className="mt-4 space-y-4">
            {research.operatingDrivers.map((row, i) => (
              <article
                key={i}
                className="border-l-2 border-primary/40 bg-muted/25 p-4"
              >
                <h3 className="text-sm font-semibold">
                  {row.business} · {row.variable}
                </h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  已知基准：{row.baseline}
                </p>
                <p className="mt-2 text-sm leading-7">{row.transmission}</p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  失效 / 证伪：{row.falsification}
                </p>
                <SourceRefs urls={row.sourceUrls} sources={sources} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {research.financialTrend?.length ? (
        <section className="deep-research-section mt-10">
          <p className="eyebrow">FINANCIAL QUALITY</p>
          <h2 className="mt-1 text-xl font-semibold">财务趋势与现金兑现</h2>
          <div className="mt-4 space-y-4">
            {research.financialTrend.map((row, i) => (
              <article key={i} className="border-t border-border py-4">
                <h3 className="text-sm font-semibold">{row.period}</h3>
                <dl className="my-3 grid gap-3 text-xs sm:grid-cols-3">
                  {[
                    ['营收', row.revenue],
                    ['归母净利润', row.netProfit],
                    ['经营现金流净额', row.operatingCashFlow],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-1 font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs leading-6">
                  现金与债务：{row.cashAndDebt}
                </p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {row.interpretation}
                </p>
                <SourceRefs urls={row.sourceUrls} sources={sources} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {research.peerComparison?.length ? (
        <section className="deep-research-section mt-10">
          <p className="eyebrow">COMPETITIVE LANDSCAPE</p>
          <h2 className="mt-1 text-xl font-semibold">同行比较与竞合关系</h2>
          <div className="mt-4 space-y-4">
            {research.peerComparison.map((row, i) => (
              <article key={i} className="border-t border-border py-4">
                <h3 className="text-sm font-semibold">
                  {row.company} · {row.business}
                </h3>
                <p className="mt-2 text-xs leading-6">定位：{row.position}</p>
                <p className="mt-2 text-sm leading-7">{row.comparison}</p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  比较边界：{row.limitation}
                </p>
                <SourceRefs urls={row.sourceUrls} sources={sources} />
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {research.governanceFindings?.length ? (
        <section className="deep-research-section mt-10">
          <p className="eyebrow">GOVERNANCE EVIDENCE</p>
          <h2 className="mt-1 text-xl font-semibold">治理与资本配置核查</h2>
          {research.governanceFindings.map((row, i) => (
            <article
              key={i}
              className="mt-4 border-t border-border pt-4 text-sm leading-7"
            >
              <h3 className="font-semibold">{row.subject}</h3>
              <p>已知事实：{row.facts}</p>
              <p>分析：{row.analysis}</p>
              <p className="text-muted-foreground">边界：{row.boundary}</p>
              <SourceRefs urls={row.sourceUrls} sources={sources} />
            </article>
          ))}
        </section>
      ) : null}
      <section className="deep-research-section mt-10">
        <p className="eyebrow">BUSINESS · DRIVERS · EVIDENCE</p>
        <h2 className="mt-1 text-xl font-semibold">深度经营分析</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          从业务和利润来源出发，区分资料事实与分析推断，并列出反证和验证变量。未取得依据的内容明确留缺。
        </p>
        <div className="mt-4 border-t border-border">
          {research.chapters.map((chapter, index) => (
            <article
              key={chapter.topic}
              className="research-chapter border-b border-border py-6"
            >
              <h3 className="flex items-center gap-3 text-base font-semibold">
                <span className="font-mono text-xs text-primary">
                  0{index + 1}
                </span>
                {chapter.topic}
              </h3>
              <dl className="mt-4 space-y-3 text-xs leading-6">
                {[
                  ['资料事实', chapter.facts],
                  ['分析推断', chapter.analysis],
                  ['反证与风险', chapter.counterEvidence],
                  ['验证变量', chapter.watchFor],
                ].map(([label, content]) => (
                  <div
                    key={label}
                    className="grid gap-1 sm:grid-cols-[80px_minmax(0,1fr)] sm:gap-3"
                  >
                    <dt className="font-medium text-foreground">{label}</dt>
                    <dd className="whitespace-pre-line text-muted-foreground">
                      {content}
                    </dd>
                  </div>
                ))}
              </dl>
              <SourceRefs urls={chapter.sourceUrls} sources={sources} />
            </article>
          ))}
        </div>
      </section>

      <section className="deep-research-section mt-10">
        <p className="eyebrow">CATALYST TIMELINE</p>
        <h2 className="mt-1 text-xl font-semibold">催化事件与验证时间线</h2>
        <div className="mt-4 border-t border-border">
          {research.timeline.length ? (
            research.timeline.map((item, index) => (
              <article
                key={`${item.period}-${index}`}
                className="border-b border-border py-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-medium">{item.period}</span>
                  <span className="border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {item.status}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-medium">{item.event}</h3>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  可能影响：{item.impact}
                </p>
                <SourceRefs urls={[item.sourceUrl]} sources={sources} />
              </article>
            ))
          ) : (
            <p className="py-4 text-xs leading-6 text-muted-foreground">
              本轮未取得有来源的关键事件日期，不预设披露或项目落地时间。
            </p>
          )}
        </div>
      </section>

      <section className="deep-research-section mt-10">
        <p className="eyebrow">CONDITIONAL SCENARIOS</p>
        <h2 className="mt-1 text-xl font-semibold">经营情景与证伪条件</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          以下是条件分析，不是盈利预测、发生概率或股价目标。
        </p>
        <div className="mt-4 space-y-4">
          {research.scenarios.map((scenario) => (
            <article key={scenario.name} className="border border-border p-4">
              <h3 className="text-sm font-semibold">{scenario.name}情景</h3>
              <dl className="mt-3 space-y-2 text-xs leading-6">
                <div>
                  <dt className="inline font-medium">条件假设：</dt>
                  <dd className="inline text-muted-foreground">
                    {scenario.assumptions}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">经营影响：</dt>
                  <dd className="inline text-muted-foreground">
                    {scenario.impact}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">验证 / 证伪：</dt>
                  <dd className="inline text-muted-foreground">
                    {scenario.validation}
                  </dd>
                </div>
              </dl>
              <SourceRefs urls={scenario.sourceUrls} sources={sources} />
            </article>
          ))}
        </div>
      </section>

      {research.dataGaps.length ? (
        <section className="deep-research-section mt-8 border-l-2 border-amber-500 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold">资料缺口与适用边界</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-6 text-muted-foreground">
            {research.dataGaps.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {research.evidenceAudit ? (
        <details className="deep-research-section mt-6 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            本轮资料采集记录
          </summary>
          <p className="mt-2">
            直接抽取正式披露正文 {research.evidenceAudit.documentsRead} 份 ·
            财报接口覆盖 {research.evidenceAudit.financialPeriods} 期 ·
            联网检索工具调用 {research.evidenceAudit.webSearches}{' '}
            次。来源可追溯不等于所有陈述已独立核实。
          </p>
          {research.evidenceAudit.gaps.map((gap, i) => (
            <p key={i}>{gap}</p>
          ))}
        </details>
      ) : null}
    </>
  );
}
