import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/deepl': {
        target: 'https://api-free.deepl.com/v2',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deepl/, ''),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            // Add auth header here or pass it from frontend
          });
        }
      }
    }
  }
})