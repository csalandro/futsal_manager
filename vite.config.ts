import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // La API (server/index.ts) corre aparte; Vite le pasa todo lo que va a /api.
    proxy: { '/api': 'http://localhost:3001' },
  },
})
