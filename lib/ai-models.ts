export const AI_MODEL_STORAGE_KEY = 'lens-ai-model-v2';
export const AI_MODEL_CHANGE_EVENT = 'lens-ai-model-change';

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
export const RESEARCH_MODEL_STORAGE_KEY = 'lens-research-model-v1';

export function defaultResearchModel(allowed: readonly AIModelId[]): AIModelId {
  return allowed.includes(DEFAULT_RESEARCH_MODEL)
    ? DEFAULT_RESEARCH_MODEL
    : allowed.includes(DEFAULT_AI_MODEL)
      ? DEFAULT_AI_MODEL
      : allowed[0] || DEFAULT_RESEARCH_MODEL;
}

// Undefined deliberately delegates the default to the server's current policy.
export function getPreferredResearchModel(
  allowed?: readonly AIModelId[],
): AIModelId | undefined {
  if (typeof window === 'undefined') return undefined;
  const stored = window.localStorage.getItem(RESEARCH_MODEL_STORAGE_KEY);
  return isAIModelId(stored) && (!allowed || allowed.includes(stored))
    ? stored
    : undefined;
}

export function setPreferredResearchModel(model: AIModelId) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RESEARCH_MODEL_STORAGE_KEY, model);
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

export function getPreferredAIModel(): AIModelId {
  if (typeof window === 'undefined') return DEFAULT_AI_MODEL;
  return resolveAIModel(window.localStorage.getItem(AI_MODEL_STORAGE_KEY));
}

export function setPreferredAIModel(model: AIModelId) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AI_MODEL_STORAGE_KEY, model);
  window.dispatchEvent(
    new CustomEvent(AI_MODEL_CHANGE_EVENT, { detail: model }),
  );
}

export function reasoningEffortForModel(model: AIModelId): 'none' | 'low' {
  return model === 'gpt-5.4-mini' || model === 'gpt-5.4' ? 'none' : 'low';
}
