import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:web` -> one self-contained HTML (demo / browser use)
export default defineConfig(({ mode }) => ({
  base: mode === 'web' ? './' : '/',
  plugins: [react(), ...(mode === 'web' ? [viteSingleFile()] : [])],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Never watch Rust build output: Windows locks those .exe while compiling (EBUSY)
    watch: {
      ignored: [
        '**/src-tauri/**',
        (p: string) => /[\\/]src-tauri([\\/]|$)/.test(p) || /[\\/](node_modules|dist|dist-web)([\\/]|$)/.test(p),
      ],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  worker: { format: 'iife' },
  build: {
    outDir: mode === 'web' ? 'dist-web' : 'dist',
    target: 'es2021',
    chunkSizeWarningLimit: 4000,
  },
}));
