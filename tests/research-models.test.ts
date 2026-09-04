import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_RESEARCH_MODEL,
  AI_MODELS,
  defaultResearchModel,
  getPreferredAIModel,
  getPreferredResearchModel,
  setPreferredAIModel,
  setPreferredResearchModel,
} from '../lib/ai-models';

void test('deep report default is independent and respects the permitted model list', () => {
  assert.equal(DEFAULT_AI_MODEL, 'gpt-5.6-luna');
  assert.equal(DEFAULT_RESEARCH_MODEL, 'gpt-5.6-sol');
  assert.equal(defaultResearchModel(AI_MODELS.map((x) => x.id)), 'gpt-5.6-sol');
  assert.equal(defaultResearchModel(['gpt-5.6-luna']), 'gpt-5.6-luna');
  assert.equal(defaultResearchModel(['gpt-5.6-terra']), 'gpt-5.6-terra');
});

void test('changing deep research never changes chat preference, including account policy changes', () => {
  const values = new Map<string, string>();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: () => true,
    },
  });
  try {
    assert.equal(getPreferredResearchModel(), undefined);
    setPreferredAIModel('gpt-5.6-luna');
    setPreferredResearchModel('gpt-5.6-sol');
    assert.equal(getPreferredAIModel(), 'gpt-5.6-luna');
    assert.equal(getPreferredResearchModel(), 'gpt-5.6-sol');
    assert.equal(getPreferredResearchModel(['gpt-5.6-luna']), undefined);
    setPreferredAIModel('gpt-5.4-mini');
    assert.equal(getPreferredResearchModel(), 'gpt-5.6-sol');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
