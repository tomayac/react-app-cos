import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cosPlugin from 'vite-plugin-cross-origin-storage';

// https://vite.dev/config/
export default defineConfig({
  base: '/react-app-cos/',
  plugins: [
    react(),
    cosPlugin({
      include: [/vendor-react-.*.js/],
    }) as any
  ],
  build: {
    outDir: 'docs',
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/react-dom/")) {
            return "vendor-react-dom";
          }
          if (id.includes("/node_modules/react/")) {
            return "vendor-react";
          }
        },
      },
    },
  },
})
