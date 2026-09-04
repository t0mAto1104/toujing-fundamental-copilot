import { OpenAIResearchError, runStructuredResearch } from '@/lib/openai';
import {
  acquireDailyBrief,
  failDailyBrief,
  storeDailyBrief,
} from '@/lib/daily-brief-cache';
import {
  assertResearchAccess,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';

function chinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const briefSchema = {
  type: 'object',
  properties: {
    updatedAt: { type: 'string' },
    marketView: { type: 'string' },
    marketTone: { type: 'string', enum: ['偏强', '均衡', '谨慎'] },
    drivers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['政策', '行业', '资金', '财报', '宏观'],
          },
          title: { type: 'string' },
          detail: { type: 'string' },
          sourceName: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
        required: ['category', 'title', 'detail', 'sourceName', 'sourceUrl'],
        additionalProperties: false,
      },
    },
    news: {
      type: 'array',
      minItems: 8,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['政策', '行业', '资金', '财报', '宏观'],
          },
          title: { type: 'string' },
          summary: { type: 'string' },
          implication: { type: 'string' },
          sourceName: { type: 'string' },
          sourceUrl: { type: 'string' },
          publishedAt: { type: 'string' },
        },
        required: [
          'category',
          'title',
          'summary',
          'implication',
          'sourceName',
          'sourceUrl',
          'publishedAt',
        ],
        additionalProperties: false,
      },
    },
    stockReasons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
          sourceName: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
        required: ['name', 'reason', 'sourceName', 'sourceUrl'],
        additionalProperties: false,
      },
    },
    sectorReasons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
          sourceName: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
        required: ['name', 'reason', 'sourceName', 'sourceUrl'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'updatedAt',
    'marketView',
    'marketTone',
    'drivers',
    'news',
    'stockReasons',
    'sectorReasons',
  ],
  additionalProperties: false,
};

export async function POST(request: Request) {
  let cacheKey = '';
  let leaseAcquired = false;
  try {
    const access = await assertResearchAccess();
    const snapshot = (await request.json()) as {
      stocks?: Array<{ name: string; percent: number }>;
      sectors?: Array<{ name: string; percent: number }>;
      mode?: 'market' | 'macro';
    };
    const mode = snapshot.mode === 'macro' ? 'macro' : 'market';
    const model = resolvePermittedAIModel(access, undefined);
    const dateKey = chinaDateKey();
    cacheKey = `${dateKey}|${mode}`;
    const cached = await acquireDailyBrief(
      cacheKey,
      dateKey,
      mode,
      access.user.userId,
    );
    if (cached.state === 'ready') return Response.json(cached.value);
    if (cached.state === 'generating')
      return Response.json(
        {
          error: '今日市场摘要正在由另一个请求生成，请稍后刷新。',
          code: 'brief_generating',
          retryAfter: cached.retryAfter,
          retryable: false,
        },
        { status: 503 },
      );
    if (cached.state === 'cooldown')
      return Response.json(
        {
          error:
            '今日市场摘要生成失败，已进入冷却期，系统不会持续消耗 Token 重试。',
          code: cached.code || 'brief_cooldown',
          retryAfter: cached.retryAfter,
          retryable: false,
        },
        { status: 503 },
      );
    leaseAcquired = true;
    const result = await runStructuredResearch<Record<string, unknown>>({
      name: 'a_share_market_brief',
      schema: briefSchema,
      maxOutputTokens: 4200,
      maxToolCalls: 3,
      model,
      audit: { userId: access.user.userId, endpoint: '/api/brief' },
      prompt: `现在是 ${new Date().toISOString()}，当前模式为 ${mode}。请联网检索最新与A股有关的政策、宏观数据、行业消息、可验证资金流向和财报，解释市场基本面驱动。行情快照：${JSON.stringify(snapshot)}。为领先公司与板块给出可核验原因；找不到直接证据时必须标明为板块层面推断，不得编造。news 提供8至12条按发布时间倒序的最新财经资讯，至少5条为宏观或政策，其余覆盖行业、资金与财报。每条必须来自当次实际检索，包含可打开的原始链接，publishedAt 统一使用 YYYY-MM-DD 格式；implication 用80字内说明对行业或公司基本面的可验证影响。`,
    });
    const value = { ...result.data, sources: result.sources };
    await storeDailyBrief(cacheKey, value);
    return Response.json(value);
  } catch (error) {
    if (error instanceof ResearchAccessError)
      return Response.json(
        {
          error: error.message,
          code: error.code,
          retryable: error.retryable,
        },
        { status: error.status },
      );
    const known = error instanceof OpenAIResearchError ? error : null;
    const message = error instanceof Error ? error.message : '市场研究暂不可用';
    const retryAfter =
      leaseAcquired && cacheKey
        ? await failDailyBrief(
            cacheKey,
            known?.kind || 'api_error',
            message,
          ).catch(() => null)
        : null;
    return Response.json(
      {
        error: message,
        code: known?.kind || 'api_error',
        retryAfter,
        retryable: false,
      },
      { status: known?.status || 500 },
    );
  }
}
