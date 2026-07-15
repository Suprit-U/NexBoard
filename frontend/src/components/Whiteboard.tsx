import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { socket } from '../utils/socket';
import ChatDrawer from './ChatDrawer';

interface WhiteboardProps {
  roomId:    string;
  nickname:  string;
  userColor: string;
  password:  string;
}

type Tool      = 'select' | 'pencil' | 'rect' | 'circle' | 'line' | 'text' | 'eraser' | 'pan';
type GridMode  = 'none' | 'dots' | 'lines';
type CanvasTheme = 'light' | 'dark' | 'blueprint';

const THEME_BG: Record<CanvasTheme, string> = {
  light:     '#ffffff',
  dark:      '#1a1a2e',
  blueprint: '#0d3b6e',
};

const KEY_SHORTCUTS: Record<string, Tool> = {
  v:'select', s:'select', p:'pencil', d:'pencil',
  e:'eraser', r:'rect', c:'circle', l:'line', t:'text',
};

const uid = () => Math.random().toString(36).slice(2, 11);

interface RemoteCursor { el: HTMLDivElement; timeout: ReturnType<typeof setTimeout>; }

const TOOL_DEFS: { id: Tool; icon: string; label: string; key: string; desc: string }[] = [
  { id:'select', icon:'↖',  label:'Select',    key:'V', desc:'Select & move objects' },
  { id:'pencil', icon:'✏',  label:'Pencil',    key:'P', desc:'Freehand drawing' },
  { id:'eraser', icon:'◻',  label:'Eraser',    key:'E', desc:'Erase by painting over' },
  { id:'rect',   icon:'▭',  label:'Rectangle', key:'R', desc:'Draw a rectangle' },
  { id:'circle', icon:'◯',  label:'Circle',    key:'C', desc:'Draw a circle' },
  { id:'line',   icon:'╱',  label:'Line',      key:'L', desc:'Draw a straight line' },
  { id:'text',   icon:'T',  label:'Text',      key:'T', desc:'Add editable text' },
  { id:'pan',    icon:'🖐', label:'Pan',       key:'H', desc:'Pan canvas' },
];

export interface ChatMessage {
  socketId:  string;
  nickname:  string;
  color:     string;
  message:   string;
  timestamp: string;
}

const Whiteboard: React.FC<WhiteboardProps> = ({ roomId, nickname, userColor, password }) => {
  const canvasRef      = useRef<fabric.Canvas | null>(null);
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const cursorDotRef   = useRef<HTMLDivElement | null>(null);
  const isRemote       = useRef(false);
  const isDrawingShape = useRef(false);   // ← suppress object:added during drag-draw
  const cursorThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack      = useRef<string[]>([]);
  const redoStack      = useRef<string[]>([]);

  // Stable refs for socket callbacks
  const roomIdRef   = useRef(roomId);
  const nicknameRef = useRef(nickname);
  const colorRef    = useRef(userColor);
  const passwordRef = useRef(password);
  useEffect(() => { roomIdRef.current   = roomId;   }, [roomId]);
  useEffect(() => { nicknameRef.current = nickname; }, [nickname]);
  useEffect(() => { colorRef.current    = userColor;}, [userColor]);
  useEffect(() => { passwordRef.current = password; }, [password]);

  const [tool,       setTool]       = useState<Tool>('pencil');
  const [gridMode,   setGridMode]   = useState<GridMode>('dots');
  const [theme,      setTheme]      = useState<CanvasTheme>('light');
  const [brushColor, setBrushColor] = useState('#1a1a2e');
  const [brushSize,  setBrushSize]  = useState(3);
  const [zoom,       setZoom]       = useState(1);
  const [chatOpen,   setChatOpen]   = useState(false);
  const [unread,     setUnread]     = useState(0);
  const [toasts,     setToasts]     = useState<{ id:number; msg:string; type:string }[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const cursorsRef = useRef<Record<string, RemoteCursor>>({});
  const toastId    = useRef(0);
  const toolRef    = useRef<Tool>('pencil');

  const showToast = useCallback((msg: string, type = 'info') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);

  // ── Keep toolRef in sync ─────────────────────────────────
  useEffect(() => { toolRef.current = tool; }, [tool]);

  // ── Cursor label helpers ─────────────────────────────────
  const getOrCreateCursor = useCallback((socketId: string, name: string, color: string) => {
    if (cursorsRef.current[socketId]) return cursorsRef.current[socketId];
    const el = document.createElement('div');
    el.className = 'cursor-label';
    el.style.background = color;
    el.innerHTML = `<span class="cursor-dot"></span>${name}`;
    containerRef.current?.appendChild(el);
    const cur: RemoteCursor = { el, timeout: setTimeout(() => {}, 0) };
    cursorsRef.current[socketId] = cur;
    return cur;
  }, []);

  const removeCursor = useCallback((socketId: string) => {
    const cur = cursorsRef.current[socketId];
    if (cur) { cur.el.remove(); delete cursorsRef.current[socketId]; }
  }, []);

  // ── Snapshot helpers ─────────────────────────────────────
  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    undoStack.current.push(JSON.stringify((canvas as any).toJSON(['id'])));
    redoStack.current = [];
    if (undoStack.current.length > 40) undoStack.current.shift();
  }, []);

  const pushSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    socket.emit('canvas-snapshot', (canvas as any).toJSON(['id']));
  }, []);



  // ── Init Fabric canvas ───────────────────────────────────
  useEffect(() => {
    const canvasEl = document.getElementById('main-canvas') as HTMLCanvasElement;
    if (!canvasEl) return;

    const canvas = new fabric.Canvas(canvasEl, {
      isDrawingMode:         true,
      backgroundColor:       THEME_BG.light,
      selection:             true,
      preserveObjectStacking:true,
      renderOnAddRemove:     false,
    });

    const pencil = new fabric.PencilBrush(canvas);
    pencil.width = 3;
    pencil.color = '#1a1a2e';
    (pencil as any).decimate = 4;
    canvas.freeDrawingBrush = pencil;

    canvasRef.current = canvas;

    // Responsive
    const resizeCanvas = () => {
      if (containerRef.current) {
        canvas.setWidth(containerRef.current.clientWidth);
        canvas.setHeight(containerRef.current.clientHeight);
        canvas.requestRenderAll();
      }
    };
    const ro = new ResizeObserver(resizeCanvas);
    if (containerRef.current) ro.observe(containerRef.current);
    resizeCanvas();

    // Ctrl+Scroll zoom
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.11;
      const pt = new fabric.Point(e.offsetX, e.offsetY);
      const z = Math.min(Math.max(canvas.getZoom() * delta, 0.1), 8);
      canvas.zoomToPoint(pt, z);
      setZoom(Math.round(z * 100) / 100);
      canvas.requestRenderAll();
    };
    canvasEl.addEventListener('wheel', handleWheel, { passive: false });

    // Cursor dot overlay
    const dot = document.createElement('div');
    dot.className = 'canvas-cursor-dot';
    containerRef.current?.appendChild(dot);
    cursorDotRef.current = dot;

    return () => {
      canvasEl.removeEventListener('wheel', handleWheel);
      ro.disconnect();
      canvas.dispose();
      canvasRef.current = null;
      dot.remove();
      Object.values(cursorsRef.current).forEach(c => c.el.remove());
      cursorsRef.current = {};
    };
  }, []); // eslint-disable-line

  // ── Socket: connect + join room ────────────────────────────
  // IMPORTANT: We use autoConnect:false so we control timing.
  // We connect here, AFTER all event listeners below are registered,
  // so we never miss canvas-sync-data or other server responses.
  useEffect(() => {
    // join helper — always uses latest values via refs
    const doJoin = () => {
      console.log(`[NexBoard] Joining room "${roomIdRef.current}" as "${nicknameRef.current}"`);
      socket.emit('join-room', {
        roomId:   roomIdRef.current,
        nickname: nicknameRef.current,
        color:    colorRef.current,
        password: passwordRef.current || undefined,
      });
    };

    // Re-join on every (re)connect — handles mobile WiFi drops
    socket.on('connect', doJoin);

    socket.on('connect_error', (err) => {
      console.error('[NexBoard] Socket connect error:', err.message);
    });

    // If socket is already connected (e.g. navigating back to whiteboard),
    // join immediately — the connect event won't fire again
    if (socket.connected) {
      doJoin();
    } else {
      // First time: connect now (listeners are ready)
      socket.connect();
    }

    const snapshotTimer = setInterval(pushSnapshot, 10000);

    return () => {
      clearInterval(snapshotTimer);
      socket.off('connect', doJoin);
      socket.off('connect_error');
      // Disconnect when leaving the whiteboard — clean slate for next room
      socket.disconnect();
    };
  }, [pushSnapshot]); // eslint-disable-line


  // ── Canvas sync ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onRequestSync = (targetId: string) => {
      socket.emit('canvas-sync-response', { to: targetId, data: (canvas as any).toJSON(['id']) });
    };
    const onSyncData = (data: any) => {
      isRemote.current = true;
      canvas.loadFromJSON(data, () => { canvas.requestRenderAll(); isRemote.current = false; });
    };

    socket.on('request-canvas-sync', onRequestSync);
    socket.on('canvas-sync-data',    onSyncData);
    return () => {
      socket.off('request-canvas-sync', onRequestSync);
      socket.off('canvas-sync-data',    onSyncData);
    };
  }, []);

  // ── Drawing socket events ────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDraw = (pathData: any) => {
      isRemote.current = true;
      const path = new fabric.Path(pathData.path, { ...pathData, id: pathData.id ?? uid() } as any);
      canvas.add(path);
      canvas.requestRenderAll();
      isRemote.current = false;
    };

    const onObjectAdded = (data: any) => {
      isRemote.current = true;
      (fabric.util.enlivenObjects as any)([data]).then((objs: any[]) => {
        objs.forEach((o: any) => {
          o.id = data.id;
          // For ellipses received from remote, ensure rx/ry are set correctly
          if (data.type === 'ellipse' && data.rx !== undefined) {
            o.set({ rx: data.rx, ry: data.ry });
          }
          canvas.add(o);
        });
        canvas.requestRenderAll();
        isRemote.current = false;
      });
    };

    const onObjectModified = (data: any) => {
      const obj = canvas.getObjects().find((o: any) => o.id === data.id);
      if (obj) {
        obj.set(data);
        obj.setCoords();
        canvas.requestRenderAll();
      }
    };

    const onObjectRemoved = (id: string) => {
      const obj = canvas.getObjects().find((o: any) => o.id === id);
      if (obj) { canvas.remove(obj); canvas.requestRenderAll(); }
    };

    const onClear = () => {
      canvas.clear();
      canvas.backgroundColor = THEME_BG[theme];
      canvas.requestRenderAll();
    };

    let rafId = 0;
    const pending: Record<string, any> = {};
    const onCursorMove = (data: any) => {
      if (data.socketId === socket.id) return;
      pending[data.socketId] = data;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        Object.values(pending).forEach((d: any) => {
          const cur = getOrCreateCursor(d.socketId, d.nickname, d.color);
          cur.el.style.left    = `${d.x}px`;
          cur.el.style.top     = `${d.y}px`;
          cur.el.style.opacity = '1';
          clearTimeout(cur.timeout);
          cur.timeout = setTimeout(() => { cur.el.style.opacity = '0'; }, 4000);
          delete pending[d.socketId];
        });
      });
    };

    const onUserJoined        = ({ nickname: name }: any) => showToast(`${name} joined the room`, 'success');
    const onUserDisconnected  = (id: string) => removeCursor(id);

    // ── Chat history from Appwrite (on room join) ──
    const onChatHistory = (msgs: ChatMessage[]) => {
      setChatHistory(msgs);
    };

    socket.on('draw',              onDraw);
    socket.on('object-added',      onObjectAdded);
    socket.on('object-modified',   onObjectModified);
    socket.on('object-removed',    onObjectRemoved);
    socket.on('clear',             onClear);
    socket.on('cursor-move',       onCursorMove);
    socket.on('user-joined',       onUserJoined);
    socket.on('user-disconnected', onUserDisconnected);
    socket.on('chat-history',      onChatHistory);

    return () => {
      cancelAnimationFrame(rafId);
      socket.off('draw',              onDraw);
      socket.off('object-added',      onObjectAdded);
      socket.off('object-modified',   onObjectModified);
      socket.off('object-removed',    onObjectRemoved);
      socket.off('clear',             onClear);
      socket.off('cursor-move',       onCursorMove);
      socket.off('user-joined',       onUserJoined);
      socket.off('user-disconnected', onUserDisconnected);
      socket.off('chat-history',      onChatHistory);
    };
  }, [theme, getOrCreateCursor, removeCursor, showToast]);

  // ── Canvas event listeners ───────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPathCreated = (e: any) => {
      if (isRemote.current || !e.path) return;
      const path = e.path as any;
      if (!path.id) path.id = uid();
      saveSnapshot();
      socket.emit('draw', path.toObject(['id']));
      pushSnapshot();
    };

    const onObjectAdded = (e: any) => {
      // Skip if it's a remote object or a shape currently being drawn (drag not complete)
      if (isRemote.current || isDrawingShape.current) return;
      const obj = e.target as any;
      if (!obj || obj.type === 'path') return;
      if (!obj.id) obj.id = uid();
      saveSnapshot();
      socket.emit('object-added', obj.toObject(['id']));
    };

    const onObjectModified = (e: any) => {
      if (isRemote.current) return;
      const obj = e.target as any;
      if (!obj?.id) return;
      socket.emit('object-modified', obj.toObject(['id']));
    };

    // Cursor broadcast + cursor dot
    const onMouseMove = (e: any) => {
      const pointer = canvas.getPointer(e.e);

      const dot = cursorDotRef.current;
      if (dot) {
        dot.style.left = `${pointer.x}px`;
        dot.style.top  = `${pointer.y}px`;
      }

      if (cursorThrottle.current) return;
      socket.emit('cursor-move', { x: pointer.x, y: pointer.y });
      cursorThrottle.current = setTimeout(() => { cursorThrottle.current = null; }, 33);
    };

    canvas.on('path:created',    onPathCreated);
    canvas.on('object:added',    onObjectAdded);
    canvas.on('object:modified', onObjectModified);
    canvas.on('mouse:move',      onMouseMove);

    return () => {
      canvas.off('path:created',    onPathCreated);
      canvas.off('object:added',    onObjectAdded);
      canvas.off('object:modified', onObjectModified);
      canvas.off('mouse:move',      onMouseMove);
    };
  }, [saveSnapshot, pushSnapshot]);

  // ── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const newTool = KEY_SHORTCUTS[e.key.toLowerCase()];
      if (newTool && !e.ctrlKey && !e.metaKey) { setTool(newTool); return; }

      if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
      if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.key==='z'&&e.shiftKey))) { e.preventDefault(); handleRedo(); return; }

      if (e.key==='Delete'||e.key==='Backspace') {
        const active = canvas.getActiveObjects();
        if (!active.length) return;
        e.preventDefault();
        active.forEach(o => {
          const id = (o as any).id;
          canvas.remove(o);
          if (id) socket.emit('object-removed', id);
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        saveSnapshot();
        pushSnapshot();
      }
      if (e.key==='Escape') { canvas.discardActiveObject(); canvas.requestRenderAll(); }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveSnapshot, pushSnapshot]); // eslint-disable-line

  // ── Tool switching + drag-to-draw shapes ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const dot    = cursorDotRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = tool === 'pencil' || tool === 'eraser';
    canvas.selection     = tool === 'select';
    canvas.defaultCursor = tool === 'pan' ? 'grab' : tool === 'text' ? 'text' : tool === 'pencil' ? 'crosshair' : 'default';
    canvas.getObjects().forEach(o => {
      o.selectable = tool === 'select';
      o.evented    = tool === 'select';
    });

    // Update brush
    if (canvas.freeDrawingBrush) {
      if (tool === 'pencil') {
        canvas.freeDrawingBrush.color = brushColor;
        canvas.freeDrawingBrush.width = brushSize;
        (canvas.freeDrawingBrush as any).decimate = 4;
      }
      if (tool === 'eraser') {
        canvas.freeDrawingBrush.color = THEME_BG[theme];
        canvas.freeDrawingBrush.width = Math.max(brushSize * 5, 20);
        (canvas.freeDrawingBrush as any).decimate = 2;
      }
    }

    // Cursor dot visibility
    if (dot) {
      const isPencilLike = tool === 'pencil' || tool === 'eraser';
      dot.style.display = isPencilLike ? 'block' : 'none';
      if (tool === 'eraser') {
        const s = Math.max(brushSize * 5, 20);
        dot.classList.add('eraser');
        dot.style.width   = `${s}px`;
        dot.style.height  = `${s}px`;
        dot.style.background = 'transparent';
      } else {
        dot.classList.remove('eraser');
        dot.style.width   = `${Math.max(brushSize, 4)}px`;
        dot.style.height  = `${Math.max(brushSize, 4)}px`;
        dot.style.background = brushColor;
      }
    }

    // ── Drag-to-draw shapes ──────────────────────────────
    let isDragging  = false;
    let originX     = 0;
    let originY     = 0;
    let activeShape: fabric.Object | null = null;
    let isPanning   = false;
    let lastPanX    = 0;
    let lastPanY    = 0;

    const getClient = (evt: any) => {
      if (evt.touches && evt.touches.length > 0) return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
      return { x: evt.clientX, y: evt.clientY };
    };

    const handleMouseDown = (e: any) => {
      const currentTool = toolRef.current;

      if (currentTool === 'pan') {
        isPanning = true;
        canvas.defaultCursor = 'grabbing';
        const client = getClient(e.e);
        lastPanX = client.x;
        lastPanY = client.y;
        return;
      }

      // Text tool: create on single click
      if (currentTool === 'text') {
        const pointer = canvas.getPointer(e.e);
        saveSnapshot();
        const t = new fabric.IText('Type here...', {
          left:       pointer.x,
          top:        pointer.y,
          fontSize:   20,
          fill:       brushColor,
          fontFamily: 'Inter, sans-serif',
        } as any);
        (t as any).id = uid();
        canvas.add(t);
        canvas.setActiveObject(t);
        (t as any).enterEditing();
        canvas.requestRenderAll();
        return;
      }

      if (!['rect', 'circle', 'line'].includes(currentTool)) return;

      const pointer = canvas.getPointer(e.e);
      isDragging = true;
      originX    = pointer.x;
      originY    = pointer.y;

      // Signal that a shape is being drawn — suppress the object:added socket emit
      isDrawingShape.current = true;

      saveSnapshot();

      if (currentTool === 'rect') {
        activeShape = new fabric.Rect({
          left:        originX,
          top:         originY,
          width:       0,
          height:      0,
          fill:        'transparent',
          stroke:      brushColor,
          strokeWidth: brushSize,
          rx:          4,
          ry:          4,
          selectable:  false,
          evented:     false,
        } as any);
      } else if (currentTool === 'circle') {
        activeShape = new fabric.Ellipse({
          left:        originX,
          top:         originY,
          rx:          0,
          ry:          0,
          fill:        'transparent',
          stroke:      brushColor,
          strokeWidth: brushSize,
          selectable:  false,
          evented:     false,
        } as any);
      } else if (currentTool === 'line') {
        activeShape = new fabric.Line([originX, originY, originX, originY], {
          stroke:      brushColor,
          strokeWidth: brushSize,
          selectable:  false,
          evented:     false,
        } as any);
      }

      if (activeShape) {
        (activeShape as any).id = uid();
        canvas.add(activeShape);
      }

      canvas.requestRenderAll();
    };

    const handleMouseMove = (e: any) => {
      if (isPanning) {
        const client = getClient(e.e);
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += client.x - lastPanX;
          vpt[5] += client.y - lastPanY;
          canvas.setViewportTransform(vpt);
        }
        lastPanX = client.x;
        lastPanY = client.y;
        return;
      }

      if (!isDragging || !activeShape) return;

      const pointer     = canvas.getPointer(e.e);
      const currentTool = toolRef.current;

      if (currentTool === 'rect') {
        const shape = activeShape as fabric.Rect;
        const w = pointer.x - originX;
        const h = pointer.y - originY;
        shape.set({
          left:   w < 0 ? pointer.x : originX,
          top:    h < 0 ? pointer.y : originY,
          width:  Math.abs(w),
          height: Math.abs(h),
        });
      } else if (currentTool === 'circle') {
        const shape = activeShape as fabric.Ellipse;
        const rx = Math.abs(pointer.x - originX) / 2;
        const ry = Math.abs(pointer.y - originY) / 2;
        // Center the ellipse at the midpoint between origin and current pointer
        shape.set({
          left: Math.min(pointer.x, originX),
          top:  Math.min(pointer.y, originY),
          rx,
          ry,
        });
      } else if (currentTool === 'line') {
        (activeShape as fabric.Line).set({ x2: pointer.x, y2: pointer.y });
      }

      activeShape.setCoords();
      canvas.requestRenderAll();
    };

    const handleMouseUp = () => {
      if (isPanning) {
        isPanning = false;
        canvas.defaultCursor = 'grab';
        return;
      }

      if (!isDragging || !activeShape) return;
      isDragging = false;

      const currentTool = toolRef.current;
      let tooSmall = false;

      if (currentTool === 'rect') {
        const r = activeShape as fabric.Rect;
        tooSmall = (r.width ?? 0) < 3 && (r.height ?? 0) < 3;
      } else if (currentTool === 'circle') {
        const c = activeShape as fabric.Ellipse;
        tooSmall = (c.rx ?? 0) < 2 && (c.ry ?? 0) < 2;
      } else if (currentTool === 'line') {
        const l = activeShape as fabric.Line;
        const dx = (l.x2 ?? 0) - (l.x1 ?? 0);
        const dy = (l.y2 ?? 0) - (l.y1 ?? 0);
        tooSmall = Math.sqrt(dx * dx + dy * dy) < 3;
      }

      if (tooSmall) {
        canvas.remove(activeShape);
        activeShape = null;
        isDrawingShape.current = false;
        canvas.requestRenderAll();
        return;
      }

      // Shape is done — make it selectable
      activeShape.set({ selectable: true, evented: true });
      activeShape.setCoords();
      canvas.setActiveObject(activeShape);
      canvas.requestRenderAll();

      // NOW emit to remote clients with the finalized shape
      // (isDrawingShape was suppressing this earlier)
      isDrawingShape.current = false;
      socket.emit('object-added', (activeShape as any).toObject(['id']));
      pushSnapshot();

      activeShape = null;
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up',   handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up',   handleMouseUp);
      // Cleanup in case unmount happens mid-draw
      isDrawingShape.current = false;
    };
  }, [tool, brushColor, brushSize, theme, saveSnapshot, pushSnapshot]);

  // ── Sync brush ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const dot    = cursorDotRef.current;
    if (!canvas?.freeDrawingBrush || tool !== 'pencil') return;
    canvas.freeDrawingBrush.color = brushColor;
    canvas.freeDrawingBrush.width = brushSize;
    if (dot) {
      dot.style.background = brushColor;
      dot.style.width   = `${Math.max(brushSize, 4)}px`;
      dot.style.height  = `${Math.max(brushSize, 4)}px`;
    }
  }, [brushColor, brushSize, tool]);

  // ── Theme changes ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.backgroundColor = THEME_BG[theme];
    canvas.requestRenderAll();
  }, [theme]);

  // ── Chat unread ──────────────────────────────────────────
  useEffect(() => {
    const h = () => { if (!chatOpen) setUnread(u => u + 1); };
    socket.on('chat-message', h);
    return () => { socket.off('chat-message', h); };
  }, [chatOpen]);

  // ── Action handlers ──────────────────────────────────────
  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !undoStack.current.length) return;
    redoStack.current.push(JSON.stringify((canvas as any).toJSON(['id'])));
    const prev = undoStack.current.pop()!;
    isRemote.current = true;
    canvas.loadFromJSON(JSON.parse(prev), () => {
      canvas.requestRenderAll();
      isRemote.current = false;
      pushSnapshot();
    });
  }, [pushSnapshot]);

  const handleRedo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !redoStack.current.length) return;
    undoStack.current.push(JSON.stringify((canvas as any).toJSON(['id'])));
    const next = redoStack.current.pop()!;
    isRemote.current = true;
    canvas.loadFromJSON(JSON.parse(next), () => {
      canvas.requestRenderAll();
      isRemote.current = false;
      pushSnapshot();
    });
  }, [pushSnapshot]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    saveSnapshot();
    canvas.clear();
    canvas.backgroundColor = THEME_BG[theme];
    canvas.requestRenderAll();
    socket.emit('clear');
    pushSnapshot();
  }, [theme, saveSnapshot, pushSnapshot]);

  const handleZoom = (delta: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
    const z = Math.min(Math.max(canvas.getZoom() * delta, 0.1), 8);
    canvas.zoomToPoint(center, z);
    setZoom(Math.round(z * 100) / 100);
    canvas.requestRenderAll();
  };

  const handleZoomReset = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setZoom(1);
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    canvas.requestRenderAll();
    setZoom(1);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexboard-${roomId}.png`;
    a.click();
    showToast('Downloaded as PNG ✓', 'success');
  };

  const showBrushControls = ['pencil', 'eraser', 'rect', 'circle', 'line'].includes(tool);

  return (
    <>
      <div className="canvas-area">
        {/* Canvas */}
        <div className={`canvas-container cursor-${tool}`} ref={containerRef}>
          <div
            className={`canvas-bg ${gridMode==='dots'?'canvas-grid-dots':gridMode==='lines'?'canvas-grid-lines':''}`}
            style={{ background: THEME_BG[theme] }}
          />
          <canvas id="main-canvas" style={{ position: 'absolute', inset: 0 }} />
        </div>

        {/* ── Left Toolbar ────────────────────────────── */}
        <div className="toolbar">
          {TOOL_DEFS.map(({ id, icon, label, key }) => (
            <div key={id} className="tb-wrap">
              <button
                id={`tool-${id}`}
                className={`btn-icon ${tool===id?'active':''} ${id==='eraser'&&tool==='eraser'?'danger':''}`}
                onClick={() => setTool(id)}
                style={{ fontSize: id==='text' ? '13px' : '16px', fontFamily: 'monospace' }}
                aria-label={label}
              >
                {icon}
                <span className="shortcut">{key}</span>
              </button>
              <div className="tb-tooltip">
                {label}
                <span className="tb-key">{key}</span>
              </div>
            </div>
          ))}

          <div className="toolbar-separator" />

          <div className="tb-wrap">
            <button id="undo-btn" className={`btn-icon ${!undoStack.current.length?'disabled':''}`}
              onClick={handleUndo} aria-label="Undo">↩</button>
            <div className="tb-tooltip">Undo <span className="tb-key">Ctrl+Z</span></div>
          </div>
          <div className="tb-wrap">
            <button id="redo-btn" className={`btn-icon ${!redoStack.current.length?'disabled':''}`}
              onClick={handleRedo} aria-label="Redo">↪</button>
            <div className="tb-tooltip">Redo <span className="tb-key">Ctrl+Y</span></div>
          </div>
          <div className="tb-wrap">
            <button id="clear-btn" className="btn-icon" onClick={handleClear} aria-label="Clear">🗑</button>
            <div className="tb-tooltip">Clear canvas</div>
          </div>
          <div className="tb-wrap">
            <button id="download-btn" className="btn-icon" onClick={handleDownload} aria-label="Download">⬇</button>
            <div className="tb-tooltip">Download PNG</div>
          </div>
        </div>

        {/* ── Options bar ─────────────────────────────── */}
        <div className="options-bar">
          {(['light', 'dark', 'blueprint'] as CanvasTheme[]).map(t => (
            <button key={t} id={`theme-${t}`} className={`grid-btn ${theme===t?'active':''}`} onClick={() => setTheme(t)}>
              {t==='light' ? '☀ Light' : t==='dark' ? '🌙 Dark' : '📐 Blueprint'}
            </button>
          ))}
          <div style={{ width:1, height:16, background:'var(--border)', margin:'0 2px' }} />
          {(['none', 'dots', 'lines'] as GridMode[]).map(g => (
            <button key={g} id={`grid-${g}`} className={`grid-btn ${gridMode===g?'active':''}`} onClick={() => setGridMode(g)}>
              {g==='none' ? '— None' : g==='dots' ? '· Dots' : '# Grid'}
            </button>
          ))}
        </div>

        {/* ── Brush controls ───────────────────────────── */}
        {showBrushControls && (
          <div className="brush-controls">
            {tool !== 'eraser' && (
              <div className="brush-color-btn" style={{ background: brushColor }}>
                <input id="brush-color-input" type="color" value={brushColor}
                  onChange={e => setBrushColor(e.target.value)} />
              </div>
            )}
            <div className="brush-preview" style={{
              width:   `${Math.min(Math.max(brushSize, 4), 28)}px`,
              height:  `${Math.min(Math.max(brushSize, 4), 28)}px`,
              background: tool==='eraser' ? 'transparent' : brushColor,
              border:  tool==='eraser' ? '1.5px dashed var(--text-muted)' : 'none',
              borderRadius: tool==='eraser' ? '3px' : '50%',
            }} />
            <span className="brush-size-label">Size</span>
            <input id="brush-size-range" type="range" className="brush-range"
              min={1} max={40} value={brushSize}
              onChange={e => setBrushSize(Number(e.target.value))} />
            <span style={{ fontSize:'0.7rem', color:'var(--text-primary)', fontWeight:600, minWidth:20, textAlign:'right' }}>
              {brushSize}
            </span>
          </div>
        )}

        {/* ── Zoom controls ────────────────────────────── */}
        <div className="zoom-controls">
          <button className="btn-icon" style={{ width:28, height:28, fontSize:14, border:'none', background:'transparent' }}
            onClick={() => handleZoom(0.8)} title="Zoom out">−</button>
          <span className="zoom-level" onClick={handleZoomReset} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </span>
          <button className="btn-icon" style={{ width:28, height:28, fontSize:14, border:'none', background:'transparent' }}
            onClick={() => handleZoom(1.25)} title="Zoom in">+</button>
        </div>
      </div>

      {/* ── Chat FAB ─────────────────────────────────── */}
      {!chatOpen && (
        <button id="chat-fab-btn" className="chat-fab"
          onClick={() => { setChatOpen(o => !o); setUnread(0); }}
          title="Toggle chat" aria-label="Toggle chat">
          💬
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        nickname={nickname}
        userColor={userColor}
        initialMessages={chatHistory}
      />

      {/* ── Toasts ───────────────────────────────────── */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type==='success' ? '✓' : 'ℹ'} {t.msg}
          </div>
        ))}
      </div>
    </>
  );
};

export default Whiteboard;
