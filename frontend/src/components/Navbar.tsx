import React, { useEffect, useState } from 'react';
import { socket } from '../utils/socket';

interface NavbarProps {
  roomId: string;
  nickname: string;
  userColor: string;
  hasPassword: boolean;
  password: string;
  onLeave: () => void;
}

interface UserInfo {
  socketId: string;
  nickname: string;
  color: string;
}

const Navbar: React.FC<NavbarProps> = ({ roomId, nickname, userColor, hasPassword, onLeave }) => {
  const [connected, setConnected] = useState(socket.connected);
  const [users,     setUsers]     = useState<UserInfo[]>([]);
  const [copied,    setCopied]    = useState(false);

  useEffect(() => {
    // ── Socket status ────────────────────────────────────
    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    // ── User list (includes current user after join) ─────
    const onUserList = (list: UserInfo[]) => {
      setUsers(list);
    };

    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('user-list',  onUserList);

    // Request fresh user list in case we missed the event
    if (socket.connected) {
      socket.emit('request-user-list');
    }

    return () => {
      socket.off('connect',    onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('user-list',  onUserList);
    };
  }, []);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const initials = (name: string) =>
    name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';

  const visibleUsers = users.slice(0, 6);
  const extraCount   = Math.max(0, users.length - 6);

  return (
    <nav className="app-navbar">
      {/* Brand */}
      <div className="nav-brand">
        <span className="logo-icon">✦</span>
        NexBoard
      </div>

      <div className="nav-divider" />

      {/* Room badge */}
      <button id="copy-room-code-btn" className="session-badge"
        onClick={handleCopyCode}
        title={copied ? 'Copied!' : 'Click to copy room code'}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Room</span>
        <span className="room-code">{roomId}</span>
        {hasPassword && <span className="lock-badge">🔒</span>}
        <span style={{ fontSize: '0.68rem', color: copied ? 'var(--success)' : 'var(--text-muted)' }}>
          {copied ? '✓ Copied' : '⎘'}
        </span>
      </button>

      {/* Connection status */}
      <div className="conn-status">
        <span className={`conn-dot ${connected ? '' : 'disconnected'}`} />
        <span>{connected ? 'Live' : 'Reconnecting…'}</span>
      </div>

      <div className="nav-spacer" />

      {/* Active user avatars — includes yourself */}
      {users.length > 0 && (
        <div className="users-pile" title={`${users.length} user${users.length !== 1 ? 's' : ''} in room`}>
          {visibleUsers.map(u => {
            const isMe = u.socketId === socket.id;
            return (
              <div key={u.socketId}
                className={`user-avatar ${isMe ? 'you' : ''}`}
                style={{ background: u.color }}>
                {initials(u.nickname)}
                <span className="tooltip">
                  {isMe ? <><span className="you-tag">You</span> ({u.nickname})</> : u.nickname}
                </span>
              </div>
            );
          })}
          {extraCount > 0 && (
            <div className="user-avatar" style={{ background: 'var(--text-muted)', fontSize: '9px' }}>
              +{extraCount}
            </div>
          )}
        </div>
      )}

      <div className="nav-divider" />

      {/* Current user nickname pill */}
      <div className="nav-nickname">
        <span className="dot" style={{ background: userColor }} />
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{nickname}</span>
      </div>

      {/* Leave */}
      <button id="leave-room-btn" className="btn-icon" onClick={onLeave} title="Leave room" style={{ marginLeft: 2 }}>
        ✕
      </button>
    </nav>
  );
};

export default Navbar;
