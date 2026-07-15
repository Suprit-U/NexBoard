import React, { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../utils/socket';
import type { ChatMessage } from './Whiteboard';

interface ChatDrawerProps {
  open:            boolean;
  onClose:         () => void;
  nickname:        string;
  userColor:       string;
  initialMessages?: ChatMessage[];
}

const ChatDrawer: React.FC<ChatDrawerProps> = ({
  open, onClose, nickname, userColor, initialMessages = [],
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input,    setInput]    = useState('');
  const [closing,  setClosing]  = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // When Appwrite history loads (initialMessages changes), prepend it
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(prev => {
        // Avoid duplicates: only add history items not already present
        const existingTimes = new Set(prev.map(m => m.timestamp));
        const newHistory = initialMessages.filter(m => !existingTimes.has(m.timestamp));
        return [...newHistory, ...prev];
      });
    }
  }, [initialMessages]); // eslint-disable-line

  useEffect(() => {
    const handler = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    };
    socket.on('chat-message', handler);
    return () => { socket.off('chat-message', handler); };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  const sendMessage = useCallback(() => {
    const msg = input.trim();
    if (!msg) return;
    socket.emit('chat-message', msg);
    setInput('');
    inputRef.current?.focus();
  }, [input]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 280);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const initials = (name: string) => name.slice(0, 2).toUpperCase();

  if (!open && !closing) return null;

  return (
    <div className={`chat-drawer ${closing ? 'closing' : ''}`}>
      <div className="chat-header">
        <span>💬 Room Chat</span>
        <button id="close-chat-btn" className="btn-icon" onClick={handleClose} title="Close chat">✕</button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="text-muted text-center" style={{ marginTop: 40 }}>
            No messages yet. Say hello! 👋
          </p>
        )}
        {messages.map((m, i) => {
          const isMe      = m.socketId === socket.id;
          const isHistory = m.socketId === 'history';
          return (
            <div key={i} className="chat-msg">
              <div className="chat-msg-header">
                <div className="chat-msg-avatar" style={{ background: m.color }}>
                  {initials(m.nickname)}
                </div>
                <span className="chat-msg-name" style={{ color: m.color }}>
                  {isMe ? 'You' : m.nickname}
                  {isHistory && (
                    <span style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: 4 }}>•</span>
                  )}
                </span>
                <span className="chat-msg-time">{formatTime(m.timestamp)}</span>
              </div>
              <div className="chat-msg-text">{m.message}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          id="chat-input"
          className="chat-input"
          placeholder="Type a message…"
          value={input}
          rows={1}
          maxLength={500}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <button id="send-chat-btn" className="chat-send-btn" onClick={sendMessage} title="Send">
          ➤
        </button>
      </div>
    </div>
  );
};

export default ChatDrawer;
