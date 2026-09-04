// CLI-only adapter. Never imported by application code. Real HTTP/OpenAI remain
// enabled; only the unavailable Cloudflare binding is replaced outside Workers.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers')
      return {
        url: 'data:text/javascript,export const env = {};',
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});
