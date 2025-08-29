// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'renderer/index.html'),
        loading: path.resolve(__dirname, 'renderer/loading.html'), // ⬅️ důležité
      },
    },
  },
  server: { port: 5173, host: true, strictPort: true },
})