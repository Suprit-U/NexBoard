import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeSocket } from './socket';

dotenv.config();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());

const server = http.createServer(app);
initializeSocket(server);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 NexBoard server running on http://0.0.0.0:${PORT}`);
});
