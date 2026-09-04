import { OpenAIResearchError, runStructuredResearch } from '@/lib/openai';
import { normalizeSources, stripUrls } from '@/lib/ai-output';
import {
  findIndustryEvidence,
  getIndustrySnapshot,
} from '@/lib/a-stock-industries';
import {
  assertResearchAccess,
  consumeDailyResearchQuota,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';

const comparisonSchema = {
  type: 'object',
  properties: {
    updatedAt: { type: 'string' },
    summary: { type: 'string' },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['政策', '行业', '资金', '财报', '宏观'],
          },
          leftView: { type: 'string' },
          rightView: { type: 'string' },
          judgment: { type: 'string' },
        },
        required: ['category', 'leftView', 'rightView', 'judgment'],
        additionalProperties: false,
      },
    },
    conclusion: { type: 'string' },
    disclaimer: { type: 'string' },
  },
  required: ['updatedAt', 'summary', 'dimensions', 'conclusion', 'disclaimer'],
  additionalProperties: false,
};

export async function POST(request: Request) {
  try {
    const access = await assertResearchAccess();
    const body = (await request.json()) as {
      left?: string;
      right?: string;
      model?: string;
    };
    if (!body.left || !body.right || body.left === body.right)
      return Response.json(
        { error: '请选择两个不同的行业。' },
        { status: 400 },
      );
    const model = resolvePermittedAIModel(access, body.model);
    const industrySnapshot = await getIndustrySnapshot().catch(() => null);
    const leftEvidence = industrySnapshot
      ? findIndustryEvidence(industrySnapshot.value, body.left)
      : null;
    const rightEvidence = industrySnapshot
      ? findIndustryEvidence(industrySnapshot.value, body.right)
      : null;
    const marketEvidence = JSON.stringify({
      updatedAt: industrySnapshot?.value.updatedAt || null,
      sourceUrl: industrySnapshot?.value.sourceUrl || null,
      left: leftEvidence,
      right: rightEvidence,
      note: '涨跌与资金流只用于描述当前资金行为，不代表行业内在价值或未来走势。',
    });

    await consumeDailyResearchQuota(access);
    const result = await runStructuredResearch<{
      updatedAt: string;
      summary: string;
      dimensions: Array<{
        category: string;
        leftView: string;
        rightView: string;
        judgment: string;
      }>;
      conclusion: string;
      disclaimer: string;
    }>({
      name: 'industry_fundamental_comparison',
      schema: comparisonSchema,
      maxOutputTokens: 3_000,
      maxToolCalls: 1,
      model,
      audit: { userId: access.user.userId, endpoint: '/api/compare' },
      prompt: `比较中国资本市场中的“${body.left}”与“${body.right}”行业。服务器已通过HTTP取得以下行业行情与资金事实：${marketEvidence}。该事实只用于“资金”维度，不得从涨跌幅推导未来趋势。dimensions 恰好包含政策、行业、资金、财报、宏观五类，并严格按此顺序返回；使用最近可得的官方数据、行业信息和代表性公司财报，分别解释两边的事实、差异、反证和待跟踪变量。优先使用结构化事实中的资金数字，只联网补充政策、行业、财报和宏观缺口。summary与conclusion各不超过180字，每个维度的leftView、rightView和judgment各不超过110字。正文不得输出网址。禁止技术指标、涨跌预测和买卖建议。disclaimer 固定为“本比较仅供信息参考，不构成任何投资建议。”`,
    });
    const order = ['政策', '行业', '资金', '财报', '宏观'];
    const dimensionMap = new Map(
      result.data.dimensions.map((item) => [item.category, item]),
    );
    const dimensions = order.flatMap((category) => {
      const item = dimensionMap.get(category);
      return item
        ? [
            {
              category,
              leftView: stripUrls(item.leftView, 180),
              rightView: stripUrls(item.rightView, 180),
              judgment: stripUrls(item.judgment, 180),
            },
          ]
        : [];
    });
    if (dimensions.length !== 5)
      throw new Error('行业比较结果维度不完整，请重新生成。');
    const liveSource = industrySnapshot
      ? [
          {
            title: `${body.left}与${body.right}实时行业行情及资金数据`,
            url: industrySnapshot.value.sourceUrl,
          },
        ]
      : [];
    return Response.json({
      updatedAt: result.data.updatedAt,
      summary: stripUrls(result.data.summary, 280),
      dimensions,
      conclusion: stripUrls(result.data.conclusion, 280),
      disclaimer: result.data.disclaimer,
      sources: normalizeSources([...liveSource, ...result.sources], 6),
    });
  } catch (error) {
    if (error instanceof ResearchAccessError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    const known = error instanceof OpenAIResearchError ? error : null;
    return Response.json(
      {
        error: error instanceof Error ? error.message : '行业比较暂不可用',
        code: known?.kind || 'api_error',
      },
      { status: known?.status || 500 },
    );
  }
}
