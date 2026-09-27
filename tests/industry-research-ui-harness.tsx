// Offline fixture only: every network request is intercepted; never imported by app.
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import IndustryPage from '../app/industry/page';
import { WorkspaceSessionProvider } from '../components/workspace-session';
import { TradingSessionProvider } from '../components/trading-session';
import { INDUSTRY_DIMENSIONS } from '../lib/industry-research';
const asOf = new Date().toISOString();
const industries = ['测试半导体', '测试银行'].map((name, i) => ({
  code: `BK000${i + 1}`,
  name,
  percent: 1.23,
  mainNetFlow: 123e6,
  riseCount: 12,
  fallCount: 5,
  flatCount: 1,
  asOf,
  leader: null,
}));
window.fetch = async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.origin,
  );
  const industry =
    industries.find((x) => x.code === url.searchParams.get('board')) ||
    industries[0];
  const snapshot = {
    sourceUrl: 'https://quote.eastmoney.com/',
    sourceName: '离线合成数据',
    stale: false,
    fetchedAt: asOf,
  };
  if (url.pathname === '/api/industries')
    return Response.json({ industries, updatedAt: asOf, stale: false });
  if (url.pathname === '/api/official-data')
    return Response.json({
      date: asOf.slice(0, 10),
      expectedQuoteDate: asOf.slice(0, 10),
      state: 'trading',
      completedDates: [],
      sourceUrl: snapshot.sourceUrl,
    });
  if (url.pathname === '/api/industry-stocks')
    return Response.json({
      ...snapshot,
      data: {
        sourceAsOf: asOf,
        total: 20,
        items: Array.from({ length: 20 }, (_, i) => ({
          symbol: `sh${600000 + i}`,
          name: `${industry.name}样本${i + 1}`,
          rank: i + 1,
          price: 10 + i,
          percent: 10 - i,
          amount: 1e8,
          turnover: 2,
          marketCap: 10e8,
          asOf,
        })),
      },
    });
  if (url.pathname === '/api/market-signals')
    return Response.json({
      ...snapshot,
      data: {
        date: asOf,
        total: 1,
        page: 1,
        pages: 1,
        items: [
          {
            code: 'BK0001',
            name: '离线测试板块',
            percent: 1.23,
            mainNet: 123e6,
            mainRatio: 2,
          },
        ],
      },
    });
  if (url.pathname === '/api/industry-research') {
    if (typeof init?.body !== 'string')
      throw Error('Fixture requires JSON body');
    const body = JSON.parse(init.body);
    const target = industries.find((x) => x.code === body.board)!;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 800);
      init?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
    return Response.json({
      industry: target,
      generatedAt: asOf,
      summary: '这是离线交互测试报告，所有内容均为合成验收数据。',
      dimensions: INDUSTRY_DIMENSIONS.map((category) => ({
        category,
        facts: '测试事实：本段不属于实际投资研究。',
        analysis: '测试传导机制：检查事实、逻辑和风险能否完整呈现。',
        counterEvidence: '测试反证：资料覆盖存在局限。',
        watchIndicators: '测试验证：核对最新正式披露。',
        sources: [{ title: '离线来源标签', url: snapshot.sourceUrl }],
      })),
      conclusion: {
        assessment: '测试综合结论：该内容用于界面验收，不作为真实市场判断。',
        drivers: ['驱动变量。'],
        risks: ['风险变量。'],
        verification: ['验证途径。'],
      },
      gaps: ['离线测试数据，不包含实际金融事实。'],
      sources: [{ title: '来源展示测试', url: snapshot.sourceUrl }],
      disclaimer: '离线测试，不构成投资建议。',
    });
  }
  return Response.json(
    { error: 'Offline fixture rejects unknown endpoint' },
    { status: 400 },
  );
};
createRoot(document.getElementById('root')!).render(
  <WorkspaceSessionProvider
    user={{
      id: 'offline-qa',
      name: '离线验收',
      allowedAIModels: ['gpt-5.6-sol'],
      preferredResearchModel: 'gpt-5.6-sol',
    }}
  >
    <TradingSessionProvider>
      <div className="p-2 text-center text-amber-300">
        离线合成数据验收 · 无外部 HTTP / AI 请求
      </div>
      <IndustryPage />
    </TradingSessionProvider>
  </WorkspaceSessionProvider>,
);
