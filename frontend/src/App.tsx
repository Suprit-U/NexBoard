import React, { useState, useCallback, useEffect, useRef } from 'react';
import Whiteboard from './components/Whiteboard';
import Navbar from './components/Navbar';
import { socket } from './utils/socket';

/* ─── Helpers ─────────────────────────────────────────────── */
const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg(3)}-${seg(3)}`;
};

const PRESET_COLORS = [
  '#8b5cf6', '#6366f1', '#ec4899', '#f59e0b',
  '#10b981', '#38bdf8', '#f97316', '#ef4444',
];

/* ─── LocalStorage helpers ────────────────────────────────── */
const LS_KEY = 'nexboard_prefs';

interface RecentRoom {
  roomId: string;
  nickname: string;
  hasPassword: boolean;
  joinedAt: string;
}

interface Prefs {
  nickname: string;
  color: string;
  recentRooms: RecentRoom[];
}

const loadPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { nickname: '', color: PRESET_COLORS[0], recentRooms: [] };
};

const savePrefs = (prefs: Partial<Prefs>) => {
  try {
    const current = loadPrefs();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...current, ...prefs }));
  } catch {}
};

const addRecentRoom = (roomId: string, nickname: string, hasPassword: boolean) => {
  try {
    const prefs = loadPrefs();
    const filtered = prefs.recentRooms.filter(r => r.roomId !== roomId);
    const updated: RecentRoom[] = [
      { roomId, nickname, hasPassword, joinedAt: new Date().toISOString() },
      ...filtered,
    ].slice(0, 5); // keep last 5
    savePrefs({ recentRooms: updated });
  } catch {}
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/* ─── Types ───────────────────────────────────────────────── */
type Tab = 'create' | 'join';

interface UserSession {
  nickname: string;
  roomId: string;
  color: string;
  hasPassword: boolean;
}

/* ─── Component ───────────────────────────────────────────── */
const App: React.FC = () => {
  const prefs = loadPrefs();

  const [tab,           setTab]           = useState<Tab>('create');
  const [nickname,      setNickname]      = useState(prefs.nickname || '');
  const [joinInput,     setJoinInput]     = useState('');
  const [selectedColor, setSelectedColor] = useState(prefs.color || PRESET_COLORS[0]);
  const [createPwd,     setCreatePwd]     = useState('');
  const [joinPwd,       setJoinPwd]       = useState('');
  const [session,       setSession]       = useState<UserSession | null>(null);
  const [error,         setError]         = useState('');
  const [checkingRoom,  setCheckingRoom]  = useState(false);
  const [recentRooms,   setRecentRooms]   = useState<RecentRoom[]>(prefs.recentRooms || []);

  // Track if the room we're trying to join has a password
  const [roomHasPassword, setRoomHasPassword] = useState(false);

  const joinInputRef = useRef<HTMLInputElement>(null);

  /* Connect socket for landing page (check-room, join-error) */
  useEffect(() => {
    if (!socket.connected) socket.connect();
    return () => {
      // Only disconnect if we're NOT entering the whiteboard.
      // If session is set, Whiteboard will manage the socket.
      // We disconnect here only when truly unmounting the landing screen.
    };
  }, []);

  /* Socket: join-error from server */
  useEffect(() => {
    const onJoinError = (msg: string) => {
      setError(msg);
      setCheckingRoom(false);
    };
    socket.on('join-error', onJoinError);
    return () => { socket.off('join-error', onJoinError); };
  }, []);

  /* Auto-save nickname + color prefs */
  useEffect(() => {
    if (nickname) savePrefs({ nickname });
  }, [nickname]);
  useEffect(() => {
    savePrefs({ color: selectedColor });
  }, [selectedColor]);

  /* When join input changes, check if the room exists + has password */
  useEffect(() => {
    const code = joinInput.trim().toUpperCase();
    if (code.length < 5) { setRoomHasPassword(false); return; }

    const onRoomInfo = ({ hasPassword }: { hasPassword: boolean }) => {
      setRoomHasPassword(hasPassword);
    };
    socket.once('room-info', onRoomInfo);
    // Connect first if needed (socket may have been disconnected by Whiteboard unmount)
    if (!socket.connected) {
      socket.once('connect', () => socket.emit('check-room', code));
      socket.connect();
    } else {
      socket.emit('check-room', code);
    }

    return () => { socket.off('room-info', onRoomInfo); };
  }, [joinInput]);

  const handleCreate = useCallback(() => {
    const name = nickname.trim();
    if (!name) { setError('Please enter a display name.'); return; }
    const roomId = generateRoomCode();
    setSession({ nickname: name, roomId, color: selectedColor, hasPassword: !!createPwd });
    addRecentRoom(roomId, name, !!createPwd);
    setRecentRooms(loadPrefs().recentRooms);
    setError('');
  }, [nickname, selectedColor, createPwd]);

  const handleJoin = useCallback(() => {
    const name = nickname.trim();
    const room = joinInput.trim().toUpperCase();
    if (!name) { setError('Please enter a display name.'); return; }
    if (!room)  { setError('Please enter a Room Code.'); return; }
    if (roomHasPassword && !joinPwd.trim()) {
      setError('This room is password-protected. Enter the password.');
      return;
    }
    setCheckingRoom(true);
    setError('');
    // Session will be set after join-room succeeds (or error fires)
    setSession({ nickname: name, roomId: room, color: selectedColor, hasPassword: roomHasPassword });
    addRecentRoom(room, name, roomHasPassword);
    setRecentRooms(loadPrefs().recentRooms);
  }, [nickname, joinInput, selectedColor, joinPwd, roomHasPassword]);

  const handleLeave = useCallback(() => {
    setSession(null);
    setJoinInput('');
    setJoinPwd('');
    setCreatePwd('');
    setCheckingRoom(false);
    setError('');
    setRecentRooms(loadPrefs().recentRooms);
  }, []);

  const handleQuickJoin = (room: RecentRoom) => {
    setTab('join');
    setJoinInput(room.roomId);
    setTimeout(() => joinInputRef.current?.focus(), 100);
  };

  /* ── Workspace ──────────────────────────────────────────── */
  if (session) {
    return (
      <div className="workspace">
        <Navbar
          roomId={session.roomId}
          nickname={session.nickname}
          userColor={session.color}
          hasPassword={session.hasPassword}
          password={tab === 'create' ? createPwd : joinPwd}
          onLeave={handleLeave}
        />
        <Whiteboard
          roomId={session.roomId}
          nickname={session.nickname}
          userColor={session.color}
          password={tab === 'create' ? createPwd : joinPwd}
        />
      </div>
    );
  }

  /* ── Landing ────────────────────────────────────────────── */
  return (
    <div className="landing">
      <div className="landing-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <div className="landing-content">
        {/* Brand */}
        <div className="brand-header">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <div className="brand-logo">
              <span className="logo-icon">✦</span>
              NexBoard
            </div>
          </div>
          <p className="brand-tagline">Real-time collaborative canvas — no account required</p>
        </div>

        <div className="landing-card">
          {/* Tabs */}
          <div className="tab-switcher">
            <button id="tab-create" className={`tab-btn ${tab === 'create' ? 'active' : ''}`}
              onClick={() => { setTab('create'); setError(''); }}>✦ Create Room</button>
            <button id="tab-join" className={`tab-btn ${tab === 'join' ? 'active' : ''}`}
              onClick={() => { setTab('join'); setError(''); }}>→ Join Room</button>
          </div>

          {/* Nickname */}
          <div className="form-group">
            <label className="form-label" htmlFor="nickname-input">Your Name</label>
            <input id="nickname-input" className="form-input" type="text"
              placeholder="e.g. Alex, Designer…" value={nickname} maxLength={20}
              onChange={e => { setNickname(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleJoin())}
            />
          </div>

          {/* Color */}
          <div className="form-group">
            <label className="form-label">Cursor Color</label>
            <div className="color-picker-row">
              {PRESET_COLORS.map(c => (
                <button key={c} className={`color-dot ${selectedColor === c ? 'selected' : ''}`}
                  style={{ background: c }} onClick={() => setSelectedColor(c)} title={c} />
              ))}
            </div>
          </div>

          {/* Create: Room code + optional password */}
          {tab === 'create' && (
            <div className="form-group">
              <label className="form-label" htmlFor="create-pwd-input">
                Password
                <span className="password-optional-tag">optional</span>
              </label>
              <input id="create-pwd-input" className="form-input" type="password"
                placeholder="Set a password to lock your room…"
                value={createPwd} maxLength={40}
                onChange={e => setCreatePwd(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
              <p className="form-hint">Leave blank for an open room.</p>
            </div>
          )}

          {/* Join: Room code + conditional password */}
          {tab === 'join' && (<>
            <div className="form-group">
              <label className="form-label" htmlFor="room-code-input">Room Code</label>
              <input id="room-code-input" ref={joinInputRef}
                className={`form-input code-style`} type="text"
                placeholder="e.g. XG7-B9Y" value={joinInput} maxLength={10}
                onChange={e => { setJoinInput(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="join-pwd-input">
                {roomHasPassword ? <><span className="lock-icon">🔒</span> Password Required</> : 'Password'}
                {!roomHasPassword && <span className="password-optional-tag">if required</span>}
              </label>
              <input id="join-pwd-input"
                className={`form-input ${roomHasPassword ? 'error' : ''}`}
                type="password"
                placeholder={roomHasPassword ? 'Enter room password…' : 'Leave blank if none'}
                value={joinPwd} maxLength={40}
                onChange={e => { setJoinPwd(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
              />
            </div>
          </>)}

          {/* Error */}
          {error && <div className="error-msg">⚠ {error}</div>}

          {/* CTA */}
          {tab === 'create'
            ? <button id="create-room-btn" className="btn-primary" onClick={handleCreate}>
                <span>✦</span> Create New Room
              </button>
            : <button id="join-room-btn" className="btn-primary" onClick={handleJoin} disabled={checkingRoom}>
                {checkingRoom ? <><div className="spinner" style={{width:16,height:16,borderWidth:2}} />Joining…</> : <><span>→</span> Join Room</>}
              </button>
          }

          <div className="divider" />

          {/* Recent Rooms */}
          {recentRooms.length > 0 ? (
            <div className="recent-rooms">
              <p className="recent-rooms-title">Recent Rooms</p>
              {recentRooms.map(r => (
                <div key={r.roomId} className="recent-room-item" onClick={() => handleQuickJoin(r)}>
                  <span className="recent-room-code">{r.roomId}</span>
                  {r.hasPassword && <span className="recent-room-lock">🔒</span>}
                  <span className="recent-room-meta">{timeAgo(r.joinedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-center">Share the Room Code with collaborators.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;