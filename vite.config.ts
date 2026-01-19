import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cosPlugin from './vite-plugin-cos';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cosPlugin({
      include: ['**/vendor-react*']
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom')) {
              return 'vendor-react-dom';
            }
            if (id.includes('react')) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
})
