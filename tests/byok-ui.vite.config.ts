// Isolated production-mode browser fixture: no auth or AI bypass in the app.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: join(tmpdir(), 'toujing-byok-ui-build'),
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./byok-ui-harness.tsx', import.meta.url)),
    },
  },
});
