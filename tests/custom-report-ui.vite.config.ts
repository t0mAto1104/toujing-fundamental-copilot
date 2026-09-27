import { defineConfig } from 'vite';
import base from './byok-ui.vite.config';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  ...base,
  build: {
    outDir: join(tmpdir(), 'toujing-custom-report-ui-build'),
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(
        new URL('./custom-report-ui-harness.tsx', import.meta.url),
      ),
    },
  },
});
