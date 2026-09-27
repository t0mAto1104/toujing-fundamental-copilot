import { reasoningEffortForModel } from '@/lib/ai-models';
import { recordAIUsage } from '@/lib/ai-usage';
import { reserveResearchCall } from '@/lib/research-tasks';
import { resolveUserAICredential } from '@/lib/ai-credentials';
import {
  requireResearchAccess,
  resolvePermittedAIModel,
  ResearchAccessError,
} from '@/lib/site-users';
import { OpenAIResearchError, redactAISecrets } from '@/lib/ai-errors';
export { OpenAIResearchError } from '@/lib/ai-errors';
export type { OpenAIErrorKind } from '@/lib/ai-errors';

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
    billingSource?: 'personal' | 'site';
  };
  timeoutMs?: number;
  searchContextSize?: 'low' | 'medium';
  requireSearch?: boolean;
  // Server-owned allowlist. Never accept these domains from request bodies.
  searchAllowedDomains?: readonly string[];
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

function classifyOpenAIError(status: number, code: string, message = '') {
  if (status === 401 || code === 'invalid_api_key') {
    return new OpenAIResearchError(
      'authentication',
      status,
      '当前账户使用的 API 密钥未通过认证，请在 AI 连接设置中处理；不会自动更换计费来源。',
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
      '当前账户使用的 API 项目没有可用额度；请检查该密钥所属项目，不会改用站点额度。',
      false,
    );
  }
  if (
    code === 'rate_limit_exceeded' ||
    /rate limit|tokens per min/i.test(message)
  ) {
    return new OpenAIResearchError(
      'rate_limit',
      status,
      '当前 API 项目已达到速率限额，请稍后手动重试；不会更换计费来源。',
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
  searchAllowedDomains,
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
  // Final backstop: every paid stage, including resume/retry, rechecks the
  // authenticated principal, policy and current credential. No global key cache.
  const access = await requireResearchAccess();
  if (access.user.userId !== audit.userId)
    throw new ResearchAccessError(
      '请求用户与当前登录账户不一致。',
      'request_forbidden',
      403,
    );
  const model = resolvePermittedAIModel(
    access,
    requestedModel || process.env.OPENAI_MODEL,
  );
  const { apiKey, billingSource } = await resolveUserAICredential(access.user);
  audit = { ...audit, billingSource };
  prompt = redactAISecrets(prompt, apiKey);
  if (instructions) instructions = redactAISecrets(instructions, apiKey);
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
  let requestId: string | null = null;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      // Workers supports only follow/manual. Never follow a redirect carrying
      // the user's Authorization header; reject 3xx explicitly below.
      redirect: 'manual',
      credentials: 'omit',
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
                  type:
                    requireSearch || searchAllowedDomains
                      ? 'web_search'
                      : 'web_search_preview',
                  search_context_size: searchContextSize,
                  ...(searchAllowedDomains
                    ? { filters: { allowed_domains: searchAllowedDomains } }
                    : {}),
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
    const candidateId = response.headers.get('x-request-id');
    requestId =
      candidateId &&
      /^req_[A-Za-z0-9_-]{1,180}$/.test(candidateId) &&
      redactAISecrets(candidateId, apiKey) === candidateId
        ? candidateId
        : null;
    // Keep the deadline and caller cancellation active until the response body
    // completes, not merely until its HTTP headers arrive.
    const completeBody = redactAISecrets(await response.text(), apiKey);
    const safeHeaders = new Headers(response.headers);
    if (!requestId) safeHeaders.delete('x-request-id');
    response = new Response(
      [204, 205, 304].includes(response.status) ? null : completeBody,
      {
        status: response.status,
        statusText: response.statusText,
        headers: safeHeaders,
      },
    );
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
      requestId,
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
    const redirected = response.status >= 300 && response.status < 400;
    const requestError = redirected
      ? new OpenAIResearchError(
          'api_error',
          502,
          'AI 服务返回了不允许的重定向，已安全阻止；请求未转发至其他地址。',
          false,
        )
      : await errorFromResponse(response);
    await recordAIUsage({
      ...audit,
      model,
      status: 'failed',
      requestId,
      errorCode: redirected ? 'redirect_blocked' : requestError.kind,
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
    // Scrub after decoding too: unicode-escaped provider strings must not
    // restore a credential into source metadata, usage logs or report output.
    payload = JSON.parse(
      redactAISecrets(JSON.stringify(await response.json()), apiKey),
    ) as typeof payload;
  } catch {
    await recordAIUsage({
      ...audit,
      model,
      status: 'invalid_output',
      requestId,
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
  const addSource = (source: { url?: string; title?: string }) => {
    try {
      if (!source.url) return;
      const url = new URL(source.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return;
      if (
        searchAllowedDomains &&
        !searchAllowedDomains.some(
          (domain) =>
            url.hostname === domain || url.hostname.endsWith(`.${domain}`),
        )
      )
        return;
      sourceMap.set(url.href, source.title || url.hostname);
    } catch {
      /* Invalid external metadata must not break the answer or audit. */
    }
  };

  for (const item of payload.output ?? []) {
    for (const source of item.action?.sources ?? []) {
      addSource(source);
    }
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text)
        outputText += content.text;
      for (const annotation of content.annotations ?? []) {
        addSource(annotation);
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
      requestId,
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
      requestId,
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
    data = JSON.parse(
      redactAISecrets(JSON.stringify(JSON.parse(outputText)), apiKey),
    ) as T;
  } catch {
    await recordAIUsage({
      ...audit,
      model,
      ...usageRecord,
      status: 'invalid_output',
      requestId,
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
    requestId,
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

export async function checkOpenAIStatus(requestedModel?: unknown) {
  const access = await requireResearchAccess();
  const model = resolvePermittedAIModel(access, requestedModel);
  const { billingSource } = await resolveUserAICredential(access.user);
  return { status: 'configured' as const, model, billingSource };
}
