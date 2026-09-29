import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In development the API runs on :3000; the same-origin paths mirror the Nginx proxy used in Docker.
const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/docs': { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
  },
})
