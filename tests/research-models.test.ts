import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_RESEARCH_MODEL,
  AI_MODELS,
  defaultResearchModel,
  resolveModelPreferences,
  reasoningEffortForModel,
  resolveAIModel,
} from '../lib/ai-models';

void test('deep report default is independent and respects the permitted model list', () => {
  assert.equal(DEFAULT_AI_MODEL, 'gpt-5.6-luna');
  assert.equal(DEFAULT_RESEARCH_MODEL, 'gpt-5.6-sol');
  assert.equal(defaultResearchModel(AI_MODELS.map((x) => x.id)), 'gpt-5.6-sol');
  assert.equal(defaultResearchModel(['gpt-5.6-luna']), 'gpt-5.6-luna');
  assert.equal(defaultResearchModel(['gpt-5.6-terra']), 'gpt-5.6-terra');
  assert.equal(resolveAIModel('gpt-6-astra'), 'gpt-6-astra');
  assert.equal(reasoningEffortForModel('gpt-6-astra'), 'low');
});

void test('changing deep research never changes chat preference, including account policy changes', () => {
  const allowed = AI_MODELS.map((x) => x.id);
  assert.deepEqual(resolveModelPreferences(allowed, null, null), {
    preferredChatModel: DEFAULT_AI_MODEL,
    preferredResearchModel: DEFAULT_RESEARCH_MODEL,
  });
  assert.deepEqual(
    resolveModelPreferences(allowed, 'gpt-5.4-mini', 'gpt-6-astra'),
    {
      preferredChatModel: 'gpt-5.4-mini',
      preferredResearchModel: 'gpt-6-astra',
    },
  );
  assert.deepEqual(
    resolveModelPreferences(['gpt-5.6-luna'], 'gpt-5.4-mini', 'gpt-6-astra'),
    {
      preferredChatModel: 'gpt-5.6-luna',
      preferredResearchModel: 'gpt-5.6-luna',
    },
  );
});
