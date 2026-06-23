import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend (Express + tsx) runs on port 3001 by default. Override with BACKEND_PORT.
const BACKEND_PORT = process.env.BACKEND_PORT ?? '3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward all /api/* to the Express backend (login, channel, messages, reply)
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
