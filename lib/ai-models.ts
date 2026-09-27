export const AI_MODELS = [
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    description: '快速，适合日常问答',
  },
  { id: 'gpt-5.4', label: 'GPT-5.4', description: '均衡，适合公司研究' },
  { id: 'gpt-5.5', label: 'GPT-5.5', description: '更强推理，耗时更长' },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: '成本最低，默认推荐',
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    description: '新一代综合模型',
  },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: '新一代深度模型' },
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    description: '复杂研究与推理，成本较高',
  },
] as const;

export type AIModelId = (typeof AI_MODELS)[number]['id'];

export const DEFAULT_AI_MODEL: AIModelId = 'gpt-5.6-luna';
// Deep company reports have an independent preference; market chat stays cheap.
export const DEFAULT_RESEARCH_MODEL: AIModelId = 'gpt-5.6-sol';

export function defaultResearchModel(allowed: readonly AIModelId[]): AIModelId {
  return allowed.includes(DEFAULT_RESEARCH_MODEL)
    ? DEFAULT_RESEARCH_MODEL
    : allowed.includes(DEFAULT_AI_MODEL)
      ? DEFAULT_AI_MODEL
      : allowed[0] || DEFAULT_RESEARCH_MODEL;
}

export function resolveModelPreferences(
  allowed: readonly AIModelId[],
  chat: unknown,
  research: unknown,
) {
  return {
    preferredChatModel:
      isAIModelId(chat) && allowed.includes(chat)
        ? chat
        : allowed.includes(DEFAULT_AI_MODEL)
          ? DEFAULT_AI_MODEL
          : allowed[0] || DEFAULT_AI_MODEL,
    preferredResearchModel:
      isAIModelId(research) && allowed.includes(research)
        ? research
        : defaultResearchModel(allowed),
  };
}

export function isAIModelId(value: unknown): value is AIModelId {
  return AI_MODELS.some((model) => model.id === value);
}

export function resolveAIModel(value: unknown): AIModelId {
  return isAIModelId(value) ? value : DEFAULT_AI_MODEL;
}

export function parseAllowedAIModels(value: unknown): AIModelId[] {
  if (typeof value !== 'string' || !value.trim())
    return AI_MODELS.map((model) => model.id);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return AI_MODELS.map((model) => model.id);
    const allowed = Array.from(new Set(parsed.filter(isAIModelId)));
    return allowed.length ? allowed : [DEFAULT_AI_MODEL];
  } catch {
    return AI_MODELS.map((model) => model.id);
  }
}

export function reasoningEffortForModel(model: AIModelId): 'none' | 'low' {
  return model === 'gpt-5.4-mini' || model === 'gpt-5.4' ? 'none' : 'low';
}
