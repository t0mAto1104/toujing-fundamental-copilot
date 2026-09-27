// Run with a local, user-authorized PDF fixture. No external fetches or AI calls.
// node tests/research-pdf-worker-runtime.mjs /absolute/path/to/fixture.pdf
// Optional --memory samples the local Worker inspector, --concurrent checks two
// independent requests. This is a diagnostic, not a production memory guarantee.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Miniflare } from 'miniflare';
import ts from 'typescript';
assert.ok(process.argv[2], 'Provide a local PDF fixture path');
const bytes = readFileSync(process.argv[2]);
const measureMemory = process.argv.includes('--memory');
const concurrent = process.argv.includes('--concurrent') ? 2 : 1;
const baseline = process.argv
  .find((x) => x.startsWith('--baseline='))
  ?.slice(11);
if (baseline) assert.match(baseline, /^[a-f0-9]{40}$/);
let peakBytes = 0;
let peakUsage;
let rpc;
const source = (name) =>
  ts
    .transpileModule(
      baseline && name === 'research-dossier'
        ? execFileSync('git', ['show', `${baseline}:lib/${name}.ts`], {
            encoding: 'utf8',
          })
        : readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    )
    .outputText.replaceAll("'@/lib/", "'./")
    .replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
    .replace("from 'unpdf'", "from './unpdf.mjs'");
const modules = {
  'index.mjs': `
    import { readResearchPdf } from './research-dossier.mjs';
    export default { async fetch() {
      try {
        const doc = await readResearchPdf({title:'本地PDF解析验证',
          url:'https://static.cninfo.com.cn/test.PDF',publisher:'离线测试',date:'2026-09-22'});
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(doc.excerpts))))].map(x=>x.toString(16).padStart(2,'0')).join('');
        return Response.json({ok:true, extraction:doc.extraction, excerpts:doc.excerpts.length, digest,
          textLength:doc.excerpts.reduce((n,e)=>n+e.text.length,0)});
      } catch(error) { return Response.json({ok:false,error:error.message}); }
    } }
  `,
  ...Object.fromEntries(
    [
      'research-dossier',
      'research-financial-fields',
      'research-document-http',
      'research-disclosures',
      'research-pdf-tables',
      'request-deadline',
    ].map((name) => [`${name}.mjs`, source(name)]),
  ),
  'unpdf.mjs': readFileSync(
    new URL('../node_modules/unpdf/dist/index.mjs', import.meta.url),
    'utf8',
  ).replace('import("unpdf/pdfjs")', 'import("./pdfjs.mjs")'),
  'pdfjs.mjs': readFileSync(
    new URL('../node_modules/unpdf/dist/pdfjs.mjs', import.meta.url),
    'utf8',
  ),
};
if (measureMemory)
  modules['research-dossier.mjs'] = modules['research-dossier.mjs'].replace(
    'page.cleanup();',
    "await fetch('https://fixture.test/memory'); page.cleanup();",
  );
// Discovery/cache functions are not involved in this PDF path and must never run.
for (const [name, exports] of Object.entries({
  'news-evidence': ['deduplicateNews'],
  'a-stock-company': ['cninfoOrgId'],
  'a-stock-http': ['eastmoneyFetch', 'eastmoneyJson', 'fetchJson', 'stripHtml'],
  'a-stock-ticker': ['listingAStockIdentity', 'aStockPrefix'],
  'data-snapshot-cache': ['getOrRefreshDataSnapshot'],
}))
  modules[`${name}.mjs`] = exports
    .map(
      (x) =>
        `export function ${x}(){throw Error('Unexpected discovery/cache call')}`,
    )
    .join('\n');
let calls = 0;
const mf = new Miniflare({
  ...(measureMemory ? { inspectorPort: 0 } : {}),
  compatibilityDate: '2026-05-15',
  modules: Object.entries(modules).map(([path, contents]) => ({
    type: 'ESModule',
    path,
    contents,
  })),
  outboundService: async (request) => {
    if (request.url === 'https://fixture.test/memory') {
      const usage = await rpc('Runtime.getHeapUsage');
      const size = usage.usedSize + (usage.backingStorageSize || 0);
      if (size > peakBytes) {
        peakBytes = size;
        peakUsage = usage;
      }
      return new Response('ok');
    }
    calls++;
    assert.equal(request.url, 'https://static.cninfo.com.cn/test.PDF');
    return new Response(bytes, {
      headers: { 'Content-Type': 'application/pdf' },
    });
  },
});
let socket;
try {
  if (measureMemory) {
    const url = await mf.getInspectorURL();
    url.protocol = 'http:';
    url.pathname = '/json/list';
    const targets = await (await fetch(url)).json();
    const target = targets.find((t) => t.id.startsWith('core:user:'));
    assert.ok(
      target,
      JSON.stringify(targets.map((t) => ({ id: t.id, title: t.title }))),
    );
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const result = JSON.parse(data);
      if (result.id) {
        const call = pending.get(result.id);
        pending.delete(result.id);
        if (result.error) call.reject(result.error);
        else call.resolve(result.result);
      }
    });
    rpc = (method) =>
      new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { resolve, reject });
        socket.send(JSON.stringify({ id: key, method }));
      });
  }
  const results = await Promise.all(
    Array.from({ length: concurrent }, async () =>
      (await mf.dispatchFetch('https://fixture.test/parse')).json(),
    ),
  );
  for (const result of results) {
    assert.equal(result.ok, true, result.error);
    assert.equal(result.extraction.complete, true);
    assert.equal(result.extraction.pagesRead, result.extraction.totalPages);
    assert.ok(result.textLength > 100);
    assert.equal(result.digest, results[0].digest);
  }
  assert.equal(calls, concurrent);
  console.log(
    JSON.stringify({
      runtime: 'workerd',
      ...results[0],
      concurrent,
      externalCalls: 0,
      aiCalls: 0,
      ...(measureMemory
        ? {
            sampledPeakMiB: Math.round((peakBytes / 1024 / 1024) * 10) / 10,
            peakUsage,
          }
        : {}),
    }),
  );
} finally {
  socket?.close();
  await mf.dispose();
}
