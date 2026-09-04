import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateCompanyResearch } from '../lib/company-research-pipeline';
import { DEFAULT_AI_MODEL, isAIModelId } from '../lib/ai-models';
import type { ListingOption } from '../lib/market-listings';

// Opt-in: up to three paid stages (collect + two writing halves), with reuse.
// Never run from build/test/cron.
if (!process.argv.includes('--live'))
  throw new Error(
    'Use --live only with owner authorization; this consumes API tokens.',
  );
for (const path of ['.env.local', '.env', '.dev.vars'])
  if (existsSync(path)) process.loadEnvFile(path);
if (!process.env.OPENAI_API_KEY)
  throw new Error('Existing site API key is not configured');
const requestedModel = process.argv
  .find((x) => x.startsWith('--model='))
  ?.slice(8);
if (requestedModel && !isAIModelId(requestedModel))
  throw new Error('Unknown evaluation model');
const model =
  requestedModel && isAIModelId(requestedModel)
    ? requestedModel
    : DEFAULT_AI_MODEL;
const listing: ListingOption = {
  id: 'SZ:300497',
  name: '富祥股份',
  code: '300497',
  exchange: '深圳证券交易所',
  exchangeCode: 'SZ',
  securityType: '深A',
  quoteId: '0.300497',
  currency: 'CNY',
};
const directory = `outputs/research-validation/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(directory, { recursive: true });
const started = Date.now();
console.log(
  JSON.stringify({
    evaluation: '富祥股份（仅方法验收，不注入参考报告事实）',
    model,
    directory,
  }),
);
try {
  const result = await generateCompanyResearch({
    query: '请对富祥股份进行完整深度基本面研究',
    listing,
    model,
    userId: 'owner-authorized-local-evaluation',
    onProgress: (event) =>
      console.log(
        JSON.stringify({
          elapsedSeconds: Math.round((Date.now() - started) / 1000),
          ...event,
        }),
      ),
  });
  await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
  const r = result.report;
  const deep = r.deepResearch!;
  const lines = [
    `# ${r.companyName}深度研究（真实生成验证）`,
    `生成时间：${r.updatedAt}`,
    `模型：${model}`,
    `\n${r.thesis}`,
    `\n${r.overview}`,
    '\n## 业务结构',
    ...deep.businessSegments!.map(
      (x) =>
        `### ${x.name} · ${x.role}\n${x.period}：收入 ${x.revenue}；占比 ${x.share}；同比 ${x.growth}；毛利率 ${x.grossMargin}\n\n${x.products}\n\n${x.profitDriver}\n\n${x.stage}\n\n${x.sourceUrls.map((u) => `[来源](${u})`).join(' ')}`,
    ),
    '\n## 经营驱动',
    ...deep.operatingDrivers!.map(
      (x) =>
        `### ${x.business} · ${x.variable}\n基准：${x.baseline}\n\n${x.transmission}\n\n证伪：${x.falsification}`,
    ),
    '\n## 联营及协同',
    ...(deep.strategicInvestments || []).map(
      (x) =>
        `### ${x.entity}\n${x.ownershipAndAccounting}\n\n${x.contribution}\n\n${x.stageAndSynergy}\n\n${x.risksAndVerification}\n\n${x.sourceUrls.map((u) => `[来源](${u})`).join(' ')}`,
    ),
    '\n## 治理核查',
    ...(deep.governanceFindings || []).map(
      (x) =>
        `### ${x.subject}\n${x.facts}\n\n${x.analysis}\n\n${x.boundary}\n\n${x.sourceUrls.map((u) => `[来源](${u})`).join(' ')}`,
    ),
    '\n## 财务趋势',
    ...deep.financialTrend!.map(
      (x) =>
        `### ${x.period}\n营收 ${x.revenue}；归母 ${x.netProfit}；经营现金流 ${x.operatingCashFlow}\n\n${x.cashAndDebt}\n\n${x.interpretation}`,
    ),
    '\n## 同行比较',
    ...deep.peerComparison!.map(
      (x) =>
        `### ${x.company} · ${x.business}\n${x.position}\n\n${x.comparison}\n\n${x.limitation}`,
    ),
    ...deep.chapters.map(
      (x) =>
        `\n## ${x.topic}\n事实：${x.facts}\n\n分析：${x.analysis}\n\n反证：${x.counterEvidence}\n\n验证：${x.watchFor}\n\n${x.sourceUrls.map((u) => `[来源](${u})`).join(' ')}`,
    ),
    '\n## 情景',
    ...deep.scenarios.map(
      (x) =>
        `### ${x.name}\n假设：${x.assumptions}\n\n影响：${x.impact}\n\n验证：${x.validation}`,
    ),
    '\n## 时间线',
    ...deep.timeline.map(
      (x) =>
        `- ${x.period}（${x.status}）：${x.event}；${x.impact} [来源](${x.sourceUrl})`,
    ),
    '\n## 结论',
    r.conclusion,
    '\n## 缺口',
    ...deep.dataGaps.map((x) => `- ${x}`),
    '\n## 来源',
    ...r.sources.map(
      (x, i) => `${i + 1}. [${x.title}](${x.url}) · ${x.publisher} · ${x.date}`,
    ),
    '\n' + r.disclaimer,
  ];
  await writeFile(`${directory}/report.md`, lines.join('\n\n'));
  const summary = {
    directory,
    model,
    elapsedSeconds: result.elapsedMs / 1000,
    usage: result.usage,
    documentsRead: deep.evidenceAudit?.documentsRead,
    segments: deep.businessSegments?.length,
    peers: deep.peerComparison?.length,
    financialPeriods: deep.financialTrend?.length,
    chapters: deep.chapters.length,
    sources: r.sources.length,
    bodyCharacters: lines.join('\n').length,
    gaps: deep.dataGaps,
  };
  await writeFile(
    `${directory}/summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  await writeFile(
    `${directory}/failure.json`,
    JSON.stringify({ message, elapsedSeconds: (Date.now() - started) / 1000 }),
  );
  console.error(message);
  process.exitCode = 1;
}
