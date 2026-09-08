import { reasoningEffortForModel, resolveAIModel } from '@/lib/ai-models';
import { recordAIUsage } from '@/lib/ai-usage';
import { reserveResearchCall } from '@/lib/research-tasks';

type JsonSchema = Record<string, unknown>;

export type ResearchOptions = {
  name: string;
  schema: JsonSchema;
  prompt: string;
  maxOutputTokens?: number;
  maxToolCalls?: number;
  webSearch?: boolean;
  instructions?: string;
  promptCacheKey?: string;
  cacheStableInstructions?: boolean;
  signal?: AbortSignal;
  model?: unknown;
  audit: {
    userId: string;
    endpoint: string;
    researchTaskId?: string;
    leaseId?: string;
    reservationId?: string;
  };
  timeoutMs?: number;
  searchContextSize?: 'low' | 'medium';
  requireSearch?: boolean;
  verbosity?: 'low' | 'medium';
  reasoningEffort?: 'low' | 'medium';
};

type OpenAIContent = {
  type?: string;
  text?: string;
  annotations?: Array<{ type?: string; url?: string; title?: string }>;
};

type OpenAIOutput = {
  type?: string;
  content?: OpenAIContent[];
  action?: { sources?: Array<{ url?: string; title?: string }> };
};

export type OpenAIErrorKind =
  | 'missing_key'
  | 'authentication'
  | 'credits'
  | 'rate_limit'
  | 'access'
  | 'invalid_output'
  | 'api_error';

export class OpenAIResearchError extends Error {
  constructor(
    public kind: OpenAIErrorKind,
    public status: number,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'OpenAIResearchError';
  }
}

function classifyOpenAIError(status: number, code: string, message = '') {
  if (status === 401 || code === 'invalid_api_key') {
    return new OpenAIResearchError(
      'authentication',
      status,
      '网站使用的 API 密钥未通过认证，请更新站点密钥。',
      false,
    );
  }
  if (
    code === 'credit_balance_exhausted' ||
    code === 'insufficient_quota' ||
    /no credits|quota/i.test(message)
  ) {
    return new OpenAIResearchError(
      'credits',
      status,
      '当前站点密钥所属的 API 项目没有可用额度；请确认余额与密钥属于同一组织和项目。',
      false,
    );
  }
  if (
    code === 'rate_limit_exceeded' ||
    /rate limit|tokens per min/i.test(message)
  ) {
    const retry = message.match(/try again in ([^.]+(?:\.[0-9]+s)?)/i)?.[1];
    return new OpenAIResearchError(
      'rate_limit',
      status,
      `当前 API 项目已达到模型令牌限额${retry ? `，预计 ${retry} 后可重试` : ''}。请稍后手动重试。`,
      true,
    );
  }
  if (status === 403 || code === 'model_not_found') {
    return new OpenAIResearchError(
      'access',
      status,
      '当前 API 项目没有所选模型或工具的访问权限。',
      false,
    );
  }
  return new OpenAIResearchError(
    'api_error',
    status,
    'OpenAI 研究请求暂时没有完成，请稍后重试。',
    status >= 500,
  );
}

async function errorFromResponse(response: Response) {
  let code = 'api_error';
  let message = '';
  try {
    const body = (await response.json()) as {
      error?: { code?: string; type?: string; message?: string };
    };
    code = body.error?.code || body.error?.type || code;
    message = body.error?.message || '';
  } catch {}
  return classifyOpenAIError(response.status, code, message);
}

export async function runStructuredResearch<T>({
  name,
  schema,
  prompt,
  maxOutputTokens = 5200,
  maxToolCalls = 7,
  webSearch = true,
  instructions,
  promptCacheKey,
  cacheStableInstructions = false,
  signal,
  model: requestedModel,
  audit,
  timeoutMs = 45_000,
  searchContextSize = 'low',
  requireSearch = false,
  verbosity = 'low',
  reasoningEffort,
}: ResearchOptions): Promise<{
  data: T;
  sources: Array<{ url: string; title: string }>;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    serviceTier?: string;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    webSearchRequests: number;
  };
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    throw new OpenAIResearchError(
      'missing_key',
      500,
      '站点尚未配置 OPENAI_API_KEY。',
      false,
    );

  const model = resolveAIModel(requestedModel || process.env.OPENAI_MODEL);
  signal?.throwIfAborted();
  if (audit.researchTaskId && audit.leaseId) {
    audit = {
      ...audit,
      reservationId: await reserveResearchCall({
        userId: audit.userId,
        taskId: audit.researchTaskId,
        leaseId: audit.leaseId,
        model,
        text: `${instructions || ''}${JSON.stringify(schema)}${prompt}`,
        output: maxOutputTokens,
        searches: webSearch ? maxToolCalls : 0,
      }),
    };
  }
  const explicitCache =
    cacheStableInstructions &&
    Boolean(instructions) &&
    /^(gpt-5\.6-(sol|terra|luna)|gpt-6-astra)$/.test(model);
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response: Response | undefined;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: {
          effort: reasoningEffort || reasoningEffortForModel(model),
        },
        max_output_tokens: maxOutputTokens,
        ...(webSearch
          ? {
              max_tool_calls: maxToolCalls,
              tools: [
                {
                  type: requireSearch ? 'web_search' : 'web_search_preview',
                  search_context_size: searchContextSize,
                },
              ],
              include: ['web_search_call.action.sources'],
              ...(requireSearch ? { tool_choice: 'required' } : {}),
            }
          : {}),
        ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
        instructions: explicitCache
          ? undefined
          : instructions ||
            '你是严谨的中文基本面研究助手。必须联网核验时效性信息，只引用实际检索到的可靠来源，优先监管机构、交易所、公司公告和官方统计；明确区分事实、推断与不确定性。不得使用均线、KDJ、MACD、形态等技术指标，不得给出买卖指令。所有结论仅供信息参考，不构成投资建议。',
        ...(explicitCache
          ? {
              // Only stable rules/schema are cached; changing evidence does not pay
              // a cache-write premium. Older models keep their supported API shape.
              prompt_cache_options: { mode: 'explicit', ttl: '30m' },
              input: [
                {
                  role: 'developer',
                  content: [
                    {
                      type: 'input_text',
                      text: instructions,
                      prompt_cache_breakpoint: { mode: 'explicit' },
                    },
                  ],
                },
                {
                  role: 'user',
                  content: [{ type: 'input_text', text: prompt }],
                },
              ],
            }
          : { input: prompt }),
        text: {
          verbosity,
          format: {
            type: 'json_schema',
            name,
            strict: true,
            schema,
          },
        },
      }),
    });
    // Keep the deadline and caller cancellation active until the response body
    // completes, not merely until its HTTP headers arrive.
    const completeBody = await response.arrayBuffer();
    response = new Response(completeBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    const cancelled = signal?.aborted && !timedOut;
    const errorCode = timedOut
      ? 'timeout_usage_unknown'
      : cancelled
        ? 'cancelled_usage_unknown'
        : 'network_error';
    await recordAIUsage({
      ...audit,
      model,
      status: controller.signal.aborted ? 'failed' : 'network_error',
      requestId: response?.headers.get('x-request-id'),
      errorCode,
    }).catch(() => undefined);
    console.info(
      'openai_research_request',
      JSON.stringify({
        endpoint: audit.endpoint,
        model,
        status: errorCode,
        elapsedMs: Date.now() - startedAt,
        promptChars: prompt.length,
        maxOutputTokens,
        maxToolCalls: webSearch ? maxToolCalls : 0,
      }),
    );
    if (timedOut)
      throw new OpenAIResearchError(
        'api_error',
        504,
        `本阶段超过${Math.round(timeoutMs / 1000)}秒，已停止；超时发生在响应完成前，后台显示的 0 Token 代表用量未知而不是确定未消耗。`,
        true,
      );
    if (cancelled)
      throw new OpenAIResearchError(
        'api_error',
        499,
        '页面连接已取消研究请求。',
        true,
      );
    throw new OpenAIResearchError(
      'api_error',
      502,
      '无法连接 OpenAI 研究服务，请稍后重试。',
      true,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!response)
    throw new OpenAIResearchError(
      'api_error',
      502,
      'OpenAI 研究服务未返回响应。',
      true,
    );

  if (!response.ok) {
    const requestError = await errorFromResponse(response);
    await recordAIUsage({
      ...audit,
      model,
      status: 'failed',
      requestId: response.headers.get('x-request-id'),
      errorCode: requestError.kind,
    }).catch(() => undefined);
    throw requestError;
  }

  let payload: {
    service_tier?: string;
    status?: string;
    incomplete_details?: { reason?: string } | null;
    output?: OpenAIOutput[];
    usage?: {
      input_tokens?: number;
      input_tokens_details?: {
        cached_tokens?: number;
        cache_write_tokens?: number;
      };
      output_tokens?: number;
      total_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
    };
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    await recordAIUsage({
      ...audit,
      model,
      status: 'invalid_output',
      requestId: response.headers.get('x-request-id'),
      errorCode: 'invalid_response_json',
    }).catch(() => undefined);
    throw new OpenAIResearchError(
      'invalid_output',
      502,
      'OpenAI 返回了无法解析的响应，请稍后重试。',
      true,
    );
  }
  const usageRecord = {
    inputTokens: payload.usage?.input_tokens,
    cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens,
    cacheWriteTokens:
      payload.usage?.input_tokens_details?.cache_write_tokens ??
      (payload.usage && ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'].includes(model)
        ? 0
        : undefined),
    serviceTier: payload.service_tier,
    outputTokens: payload.usage?.output_tokens,
    reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens,
    totalTokens: payload.usage?.total_tokens,
    webSearchRequests: (payload.output || []).filter(
      (item) => item.type === 'web_search_call',
    ).length,
  };
  let outputText = '';
  const sourceMap = new Map<string, string>();

  for (const item of payload.output ?? []) {
    for (const source of item.action?.sources ?? []) {
      if (source.url)
        sourceMap.set(source.url, source.title || new URL(source.url).hostname);
    }
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text)
        outputText += content.text;
      for (const annotation of content.annotations ?? []) {
        if (annotation.url)
          sourceMap.set(
            annotation.url,
            annotation.title || new URL(annotation.url).hostname,
          );
      }
    }
  }

  if (
    payload.status === 'incomplete' ||
    payload.incomplete_details?.reason === 'max_output_tokens'
  ) {
    await recordAIUsage({
      ...audit,
      model,
      ...usageRecord,
      status: 'invalid_output',
      requestId: response.headers.get('x-request-id'),
      errorCode: payload.incomplete_details?.reason || 'incomplete',
    }).catch(() => undefined);
    throw new OpenAIResearchError(
      'invalid_output',
      502,
      '所选模型未能在单次请求内完成结构化报告，请稍后重试或切换至 GPT-5.4 mini。',
      true,
    );
  }

  if (!outputText) {
    await recordAIUsage({
      ...audit,
      model,
      ...usageRecord,
      status: 'invalid_output',
      requestId: response.headers.get('x-request-id'),
      errorCode: 'missing_output_text',
    }).catch(() => undefined);
    throw new OpenAIResearchError(
      'invalid_output',
      502,
      '所选模型未返回可用的结构化报告，请稍后重试。',
      true,
    );
  }

  let data: T;
  try {
    data = JSON.parse(outputText) as T;
  } catch {
    await recordAIUsage({
      ...audit,
      model,
      ...usageRecord,
      status: 'invalid_output',
      requestId: response.headers.get('x-request-id'),
      errorCode: payload.incomplete_details?.reason || 'invalid_output',
    }).catch(() => undefined);
    throw new OpenAIResearchError(
      'invalid_output',
      502,
      '所选模型返回的报告格式不完整，请稍后重试。',
      true,
    );
  }

  await recordAIUsage({
    ...audit,
    model,
    ...usageRecord,
    status: 'succeeded',
    requestId: response.headers.get('x-request-id'),
  }).catch(() => undefined);

  console.info(
    'openai_research_request',
    JSON.stringify({
      endpoint: audit.endpoint,
      model,
      status: 'succeeded',
      elapsedMs: Date.now() - startedAt,
      promptChars: prompt.length,
      maxOutputTokens,
      maxToolCalls: webSearch ? maxToolCalls : 0,
      inputTokens: usageRecord.inputTokens,
      cachedInputTokens: usageRecord.cachedInputTokens,
      cacheWriteTokens: usageRecord.cacheWriteTokens,
      serviceTier: usageRecord.serviceTier,
      researchTaskId: audit.researchTaskId,
      outputTokens: usageRecord.outputTokens,
      reasoningTokens: usageRecord.reasoningTokens,
      totalTokens: usageRecord.totalTokens,
      webSearchRequests: usageRecord.webSearchRequests,
    }),
  );

  return {
    data,
    sources: Array.from(sourceMap, ([url, title]) => ({ url, title })),
    usage: usageRecord,
  };
}

export function checkOpenAIStatus(requestedModel?: unknown) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    throw new OpenAIResearchError(
      'missing_key',
      500,
      '站点尚未配置 OPENAI_API_KEY。',
      false,
    );
  const model = resolveAIModel(requestedModel || process.env.OPENAI_MODEL);
  return { status: 'configured' as const, model };
}
