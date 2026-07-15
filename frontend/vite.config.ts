import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'os'

// Get the local LAN IP to display in the console
function getLanIP(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLanIP();

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',   // Bind to all interfaces — required for LAN access
    port: 5173,
    strictPort: true,  // Fail clearly if port is taken
    // Allow connections from any host (phone's browser sends a different Host header)
    allowedHosts: 'all',
  },
})
