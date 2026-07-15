import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,   // Bind to all interfaces for LAN / mobile access
    port: 5173,
  },
})
