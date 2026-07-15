import { io, Socket } from 'socket.io-client';

// Auto-detect backend URL from the current page hostname.
// When phone opens http://192.168.1.37:5173, hostname = 192.168.1.37
// → connects to http://192.168.1.37:3001 (same machine, LAN)
const serverHost = typeof window !== 'undefined'
  ? (window.location.hostname || 'localhost')
  : 'localhost';

const isLocal = serverHost === 'localhost' || serverHost === '127.0.0.1' || serverHost.startsWith('192.168.') || serverHost.startsWith('10.') || serverHost.startsWith('172.');

export const BACKEND_URL = isLocal 
  ? `http://${serverHost}:3001`
  : 'https://nexboard-2vh5.onrender.com';

// Create socket but do NOT auto-connect yet.
// We connect explicitly when the user enters a room.
export const socket: Socket = io(BACKEND_URL, {
  autoConnect:          false,   // ← manually connect after setting up listeners
  reconnection:         true,
  reconnectionAttempts: Infinity,
  reconnectionDelay:    1000,
  reconnectionDelayMax: 5000,
  timeout:              10000,
  transports:           ['websocket', 'polling'],
});
