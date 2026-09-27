// Run with: node tests/openai-worker-runtime.mjs
// Actual production request code inside workerd; outbound transport is mocked.
// Does not load env files, use real keys, or contact any external service.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import ts from 'typescript';

function source(name) {
  return ts
    .transpileModule(
      readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    )
    .outputText.replaceAll("'@/lib/", "'./")
    .replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
}
const fakeKey = 'sk-test-worker-' + 'W'.repeat(32);
const modules = {
  'index.mjs': `
    import { runStructuredResearch } from './openai.mjs';
    import { events } from './ai-usage.mjs';
    export default { async fetch(request) {
      events.length = 0;
      try {
        const result = await runStructuredResearch({ name: 'runtime_test', schema: {type:'object'},
          prompt: new URL(request.url).pathname, model: 'gpt-5.6-luna', webSearch: false,
          audit: { userId:'fixture', endpoint:'/api/chat' }, maxOutputTokens: 100 });
        return Response.json({ ok:true, data:result.data, events });
      } catch(error) {
        return Response.json({ ok:false, kind:error.kind, status:error.status, retryable:error.retryable, events });
      }
    } };
  `,
  'openai.mjs': source('openai'),
  'ai-errors.mjs': source('ai-errors'),
  'ai-models.mjs': `export const reasoningEffortForModel = () => 'low';`,
  'ai-usage.mjs': `export const events = []; export async function recordAIUsage(event) { events.push(event); }`,
  'research-tasks.mjs': `export async function reserveResearchCall() { throw Error('Not used in this HTTP runtime test'); }`,
  'ai-credentials.mjs': `export async function resolveUserAICredential() { return {apiKey:${JSON.stringify(fakeKey)},billingSource:'personal'}; }`,
  'site-users.mjs': `
    export class ResearchAccessError extends Error {}
    export async function requireResearchAccess() { return {user:{userId:'fixture'}}; }
    export function resolvePermittedAIModel(_access, model) { return model; }
  `,
};
let upstreamStatus = 200;
let calls = [];
const mf = new Miniflare({
  compatibilityDate: '2026-05-15',
  modules: Object.entries(modules).map(([path, contents]) => ({
    type: 'ESModule',
    path,
    contents,
  })),
  outboundService: async (request) => {
    calls.push({
      url: request.url,
      authorization: request.headers.get('authorization'),
    });
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    assert.equal(request.headers.get('authorization'), `Bearer ${fakeKey}`);
    if (upstreamStatus !== 200)
      return new Response(null, {
        status: upstreamStatus,
        headers: { Location: 'https://untrusted.invalid/collect' },
      });
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: '{"answer":"ok"}' }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
  },
});
try {
  const successful = await (
    await mf.dispatchFetch('https://fixture.test/success')
  ).json();
  assert.equal(successful.ok, true);
  assert.deepEqual(successful.data, { answer: 'ok' });
  assert.equal(successful.events[0].status, 'succeeded');
  assert.equal(successful.events[0].billingSource, 'personal');
  assert.equal(calls.length, 1);
  for (const status of [301, 302, 303, 304, 307, 308]) {
    upstreamStatus = status;
    calls = [];
    const result = await (
      await mf.dispatchFetch('https://fixture.test/redirect')
    ).json();
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(result.retryable, false);
    assert.equal(result.events[0].errorCode, 'redirect_blocked');
    assert.equal(calls.length, 1, 'must not follow Location or retry');
    assert.ok(!JSON.stringify(result).includes(fakeKey));
  }
  console.log(
    JSON.stringify({
      pass: true,
      runtime: 'workerd',
      successCase: 1,
      blockedRedirectCases: 6,
      realModelCalls: 0,
    }),
  );
} finally {
  await mf.dispose();
}
