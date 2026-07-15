import { Server, Socket } from 'socket.io';
import { databases, DATABASE_ID, COLLECTION_SNAPSHOTS, ID, Query } from './config/appwrite';

// ── Appwrite collection IDs ────────────────────────────────────
const COLLECTION_ROOMS = 'rooms';
const COLLECTION_CHATS = 'chats';
const CHAT_HISTORY_LIMIT = 50;

interface UserInfo {
  socketId: string;
  nickname: string;
  color:    string;
}

interface RoomState {
  users:           UserInfo[];
  password:        string | null;
  canvasSnapshot:  any | null;
  savePending:     boolean;
  appwriteRoomId:  string | null; // Appwrite document $id for the room record
}

const rooms: Record<string, RoomState> = {};

const getRoom = (roomId: string): RoomState => {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users:          [],
      password:       null,
      canvasSnapshot: null,
      savePending:    false,
      appwriteRoomId: null,
    };
  }
  return rooms[roomId];
};

const broadcastUserList = (io: Server, roomId: string) => {
  const room = rooms[roomId];
  if (room) io.to(roomId).emit('user-list', room.users);
};

// ── Appwrite: Canvas Snapshots ─────────────────────────────────

async function loadSnapshotFromAppwrite(roomId: string): Promise<any | null> {
  try {
    const result = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_SNAPSHOTS,
      [Query.equal('roomId', roomId), Query.limit(1)]
    );
    if (result.documents.length > 0) {
      return JSON.parse(result.documents[0].canvasData);
    }
  } catch (err: any) {
    if (err?.code !== 404) {
      console.warn(`⚠ Appwrite snapshot load failed for "${roomId}":`, err?.message || err);
    }
  }
  return null;
}

async function saveSnapshotToAppwrite(roomId: string, data: any): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data);
    const existing = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_SNAPSHOTS,
      [Query.equal('roomId', roomId), Query.limit(1)]
    );
    if (existing.documents.length > 0) {
      await databases.updateDocument(
        DATABASE_ID, COLLECTION_SNAPSHOTS, existing.documents[0].$id,
        { canvasData: jsonStr, updatedAt: new Date().toISOString() }
      );
    } else {
      await databases.createDocument(
        DATABASE_ID, COLLECTION_SNAPSHOTS, ID.unique(),
        { roomId, canvasData: jsonStr, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      );
    }
  } catch (err: any) {
    console.warn(`⚠ Appwrite snapshot save failed for "${roomId}":`, err?.message || err);
  }
}

async function deleteSnapshotFromAppwrite(roomId: string): Promise<void> {
  try {
    const existing = await databases.listDocuments(
      DATABASE_ID, COLLECTION_SNAPSHOTS,
      [Query.equal('roomId', roomId), Query.limit(1)]
    );
    if (existing.documents.length > 0) {
      await databases.deleteDocument(DATABASE_ID, COLLECTION_SNAPSHOTS, existing.documents[0].$id);
    }
  } catch (err: any) {
    console.warn(`⚠ Appwrite snapshot delete failed for "${roomId}":`, err?.message || err);
  }
}

// ── Appwrite: Room Metadata ────────────────────────────────────

async function upsertRoomMetadata(
  roomId: string, hasPassword: boolean, userCount: number
): Promise<string | null> {
  try {
    const now = new Date().toISOString();
    const existing = await databases.listDocuments(
      DATABASE_ID, COLLECTION_ROOMS,
      [Query.equal('roomId', roomId), Query.limit(1)]
    );
    if (existing.documents.length > 0) {
      await databases.updateDocument(
        DATABASE_ID, COLLECTION_ROOMS, existing.documents[0].$id,
        { lastActive: now, userCount }
      );
      return existing.documents[0].$id;
    } else {
      const doc = await databases.createDocument(
        DATABASE_ID, COLLECTION_ROOMS, ID.unique(),
        { roomId, createdAt: now, lastActive: now, userCount, hasPassword }
      );
      return doc.$id;
    }
  } catch (err: any) {
    console.warn(`⚠ Appwrite room metadata failed for "${roomId}":`, err?.message || err);
    return null;
  }
}

// ── Appwrite: Chat History ────────────────────────────────────

async function saveChatMessage(
  roomId: string, nickname: string, color: string, message: string
): Promise<void> {
  try {
    await databases.createDocument(
      DATABASE_ID, COLLECTION_CHATS, ID.unique(),
      { roomId, nickname, color, message, timestamp: new Date().toISOString() }
    );
  } catch (err: any) {
    console.warn(`⚠ Appwrite chat save failed for "${roomId}":`, err?.message || err);
  }
}

async function loadChatHistory(roomId: string): Promise<any[]> {
  try {
    const result = await databases.listDocuments(
      DATABASE_ID, COLLECTION_CHATS,
      [
        Query.equal('roomId', roomId),
        Query.orderAsc('timestamp'),
        Query.limit(CHAT_HISTORY_LIMIT),
      ]
    );
    return result.documents.map(d => ({
      socketId:  'history', // marker so client knows it's history
      nickname:  d.nickname,
      color:     d.color,
      message:   d.message,
      timestamp: d.timestamp,
    }));
  } catch (err: any) {
    if (err?.code !== 404) {
      console.warn(`⚠ Appwrite chat load failed for "${roomId}":`, err?.message || err);
    }
    return [];
  }
}

// ── Debounced snapshot save helper ────────────────────────────

function scheduleSave(roomId: string) {
  const room = rooms[roomId];
  if (!room || room.savePending) return;
  room.savePending = true;
  setTimeout(async () => {
    if (rooms[roomId]) {
      await saveSnapshotToAppwrite(roomId, rooms[roomId].canvasSnapshot);
      rooms[roomId].savePending = false;
    }
  }, 2000);
}

// ── Socket.IO ──────────────────────────────────────────────────

export const initializeSocket = (server: any) => {
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout:  60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket: Socket) => {
    console.log(`✅ Connected: ${socket.id}`);

    // ── Check room info ───────────────────────────────
    socket.on('check-room', (roomId: string) => {
      const room = rooms[roomId];
      if (!room) {
        socket.emit('room-info', { exists: false, hasPassword: false });
      } else {
        socket.emit('room-info', {
          exists:      true,
          hasPassword: room.password !== null,
          userCount:   room.users.length,
        });
      }
    });

    // ── Join Room ─────────────────────────────────────
    // This event is safe to receive multiple times per socket (reconnect).
    // We clean up the old entry first to avoid duplicates.
    socket.on('join-room', async ({
      roomId, nickname, color, password,
    }: {
      roomId: string; nickname: string; color: string; password?: string;
    }) => {
      const room = getRoom(roomId);

      // Password check
      if (room.password !== null) {
        if ((password ?? '') !== room.password) {
          socket.emit('join-error', 'Incorrect room password. Please try again.');
          return;
        }
      } else if (password && room.users.length === 0) {
        room.password = password;
        console.log(`🔒 Room "${roomId}" locked with a password.`);
      }

      // Remove any stale entry for this socket (handles reconnects gracefully)
      room.users = room.users.filter(u => u.socketId !== socket.id);

      socket.join(roomId);
      socket.data.roomId   = roomId;
      socket.data.nickname = nickname;
      socket.data.color    = color;

      room.users.push({ socketId: socket.id, nickname, color });

      console.log(`🟢 "${nickname}" (${socket.id}) joined room "${roomId}" (${room.users.length} users)`);

      // ── Send canvas state to the new joiner ──
      if (room.canvasSnapshot) {
        socket.emit('canvas-sync-data', room.canvasSnapshot);
      } else {
        const appwriteData = await loadSnapshotFromAppwrite(roomId);
        if (appwriteData) {
          room.canvasSnapshot = appwriteData;
          socket.emit('canvas-sync-data', appwriteData);
        } else {
          socket.to(roomId).emit('request-canvas-sync', socket.id);
        }
      }

      // ── Send chat history to new joiner ──
      const history = await loadChatHistory(roomId);
      if (history.length > 0) {
        socket.emit('chat-history', history);
      }

      // ── Broadcast user list ──
      io.to(roomId).emit('user-list', room.users);

      // Notify others
      socket.to(roomId).emit('user-joined', { socketId: socket.id, nickname, color });

      // ── Persist room metadata ──
      upsertRoomMetadata(roomId, room.password !== null, room.users.length);
    });

    // ── Canvas sync response (existing user → new joiner) ──
    socket.on('canvas-sync-response', ({ to, data }: { to: string; data: any }) => {
      const roomId = socket.data.roomId;
      if (roomId && rooms[roomId]) {
        rooms[roomId].canvasSnapshot = data;
      }
      io.to(to).emit('canvas-sync-data', data);
    });

    // ── Canvas snapshot (periodic persist to Appwrite) ──
    socket.on('canvas-snapshot', (data: any) => {
      const roomId = socket.data.roomId;
      if (roomId && rooms[roomId]) {
        rooms[roomId].canvasSnapshot = data;
        scheduleSave(roomId);
      }
    });

    // ── Freehand Draw ─────────────────────────────────
    socket.on('draw', (pathData: any) => {
      const roomId = socket.data.roomId;
      if (roomId) socket.to(roomId).emit('draw', pathData);
    });

    // ── Object Added ──────────────────────────────────
    socket.on('object-added', (data: any) => {
      const roomId = socket.data.roomId;
      if (roomId) socket.to(roomId).emit('object-added', data);
    });

    // ── Object Modified ───────────────────────────────
    socket.on('object-modified', (data: any) => {
      const roomId = socket.data.roomId;
      if (roomId) socket.to(roomId).emit('object-modified', data);
    });

    // ── Object Removed ────────────────────────────────
    socket.on('object-removed', (id: string) => {
      const roomId = socket.data.roomId;
      if (roomId) socket.to(roomId).emit('object-removed', id);
    });

    // ── Clear Canvas ──────────────────────────────────
    socket.on('clear', () => {
      const roomId = socket.data.roomId;
      if (roomId) {
        socket.to(roomId).emit('clear');
        if (rooms[roomId]) rooms[roomId].canvasSnapshot = null;
        deleteSnapshotFromAppwrite(roomId);
        console.log(`🧹 Canvas cleared in room "${roomId}"`);
      }
    });

    // ── Cursor Move ───────────────────────────────────
    socket.on('cursor-move', ({ x, y }: { x: number; y: number }) => {
      const roomId = socket.data.roomId;
      if (roomId) {
        socket.to(roomId).emit('cursor-move', {
          x, y,
          socketId: socket.id,
          nickname: socket.data.nickname,
          color:    socket.data.color,
        });
      }
    });

    // ── Chat Message ──────────────────────────────────
    socket.on('chat-message', (message: string) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const payload = {
        socketId:  socket.id,
        nickname:  socket.data.nickname,
        color:     socket.data.color,
        message,
        timestamp: new Date().toISOString(),
      };

      io.to(roomId).emit('chat-message', payload);

      // Persist to Appwrite (fire-and-forget)
      saveChatMessage(roomId, socket.data.nickname, socket.data.color, message);
    });

    // ── Request user list ─────────────────────────────
    socket.on('request-user-list', () => {
      const roomId = socket.data.roomId;
      if (roomId && rooms[roomId]) {
        socket.emit('user-list', rooms[roomId].users);
      }
    });

    // ── Disconnect ────────────────────────────────────
    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (roomId && rooms[roomId]) {
        rooms[roomId].users = rooms[roomId].users.filter(u => u.socketId !== socket.id);
        socket.to(roomId).emit('user-disconnected', socket.id);
        io.to(roomId).emit('user-list', rooms[roomId].users);
        console.log(
          `❌ "${socket.data.nickname}" left room "${roomId}" (${rooms[roomId].users.length} remaining)`
        );

        // Persist snapshot when room empties
        if (rooms[roomId].users.length === 0 && rooms[roomId].canvasSnapshot) {
          saveSnapshotToAppwrite(roomId, rooms[roomId].canvasSnapshot);
        }

        // Update room metadata
        if (rooms[roomId]) {
          upsertRoomMetadata(roomId, rooms[roomId].password !== null, rooms[roomId].users.length);
        }
      }
    });
  });

  return io;
};
