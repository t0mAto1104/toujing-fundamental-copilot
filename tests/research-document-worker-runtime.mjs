// Real Workers runtime, mocked outbound responses. No network, keys or AI calls.
// Run: node tests/research-document-worker-runtime.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import ts from 'typescript';
const transport = ts.transpileModule(
  readFileSync(
    new URL('../lib/research-document-http.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
let status = 200,
  body = '%PDF-fixture',
  headers = {},
  calls = [];
const mf = new Miniflare({
  compatibilityDate: '2026-05-15',
  modules: [
    {
      type: 'ESModule',
      path: 'index.mjs',
      contents: `
      import { readDisclosureBytes } from './transport.mjs';
      export default { async fetch(request) {
        const mode = new URL(request.url).pathname;
        try {
          if (mode === '/old') {
            await fetch('https://static.cninfo.com.cn/test.pdf', {redirect:'error'});
            return Response.json({ok:true});
          }
          const bytes = await readDisclosureBytes('https://static.cninfo.com.cn/test.pdf', {
            headers:{}, limit:64, timeoutMs:1000,
            signal:mode === '/abort' ? AbortSignal.abort() : undefined,
          });
          return Response.json({ok:true, text:new TextDecoder().decode(bytes)});
        } catch (error) { return Response.json({ok:false, error:error.message}); }
      } }
    `,
    },
    { type: 'ESModule', path: 'transport.mjs', contents: transport },
  ],
  outboundService: async (request) => {
    calls.push(request.url);
    if (request.url !== 'https://static.cninfo.com.cn/test.pdf')
      return Response.json({
        ok: false,
        error: `Unexpected test destination: ${request.url}`,
      });
    return new Response(status === 304 ? null : body, {
      status,
      headers: { ...headers, Location: 'http://127.0.0.1/private' },
    });
  },
});
const run = async (path = '/fixed') =>
  (await mf.dispatchFetch(`https://fixture.test${path}`)).json();
try {
  const old = await run('/old');
  assert.equal(old.ok, false);
  assert.match(old.error, /Invalid redirect value/);
  assert.equal(
    calls.length,
    0,
    'old transport fails before contacting the source',
  );
  assert.deepEqual(await run(), { ok: true, text: body });
  body = '<div>HTML disclosure fixture</div>';
  assert.deepEqual(await run(), { ok: true, text: body });
  for (const code of [301, 302, 303, 304, 307, 308]) {
    status = code;
    calls = [];
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.error, /跳转/);
    assert.equal(calls.length, 1, 'no following redirect or automatic retries');
  }
  status = 200;
  body = 'x'.repeat(65);
  headers = {};
  assert.match((await run()).error, /大小/);
  body = 'short';
  headers = { 'content-length': '100' };
  assert.match((await run()).error, /大小/);
  headers = {};
  status = 503;
  assert.match((await run()).error, /不可达/);
  status = 200;
  calls = [];
  assert.equal((await run('/abort')).ok, false);
  assert.equal(calls.length, 0);
  console.log(
    'PASS: workerd reproduces old failure; PDF/HTML transport, six blocked redirects, size limits, HTTP failure and cancellation verified. No external/AI calls.',
  );
} finally {
  await mf.dispose();
}
