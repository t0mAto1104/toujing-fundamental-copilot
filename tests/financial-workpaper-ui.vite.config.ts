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
    target: 'esnext',
    outDir: join(tmpdir(), 'toujing-workpaper-ui-build'),
    emptyOutDir: false,
    rolldownOptions: {
      input: fileURLToPath(
        new URL('./financial-workpaper-ui-harness.tsx', import.meta.url),
      ),
    },
  },
});
