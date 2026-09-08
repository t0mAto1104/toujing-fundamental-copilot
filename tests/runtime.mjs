// Node-only resolution for the project's existing TS tests; no new dependency.
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
registerHooks({
  load(url, context, next) {
    if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
      const path = fileURLToPath(url);
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(path, 'utf8'), {
          fileName: path,
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    }
    return next(url, context);
  },
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers')
      return {
        url: 'data:text/javascript,export const env = {};',
        shortCircuit: true,
      };
    if (specifier.startsWith('@/') || specifier.startsWith('.')) {
      const base = specifier.startsWith('@/')
        ? new URL(specifier.slice(2), root)
        : new URL(specifier, context.parentURL);
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        const url = new URL(base.href + suffix);
        if (url.protocol === 'file:' && existsSync(fileURLToPath(url)))
          return next(url.href, context);
      }
      if (specifier.startsWith('@/')) return next(base.href, context);
    }
    return next(specifier, context);
  },
});
