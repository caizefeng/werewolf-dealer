// WebSocket connection with automatic reconnect. The server always sends the
// full view, so a reconnect needs no special resync.
import type { ClientMsg, ServerMsg } from '../../../shared/types.ts';
import { clientId, ownerKey, savedName } from './ids.ts';
import { setState, store, toast } from './store.ts';

export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  start(): void {
    this.open();
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);
    window.addEventListener('pageshow', this.onWake);
    this.ping = setInterval(() => this.send({ t: 'ping' }), 20000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ping) clearInterval(this.ping);
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('pageshow', this.onWake);
    this.ws?.close();
  }

  private onWake = (): void => {
    if (document.visibilityState !== 'visible') return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.retry = 0;
      this.open();
    }
  };

  private open(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    setState({ conn: 'connecting' });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      setState({ conn: 'open' });
      this.send({
        t: 'hello',
        room: this.roomId,
        client: clientId(),
        name: savedName() || undefined,
        ownerKey: ownerKey(this.roomId) ?? undefined,
      });
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.t === 'state') {
        const offset = msg.view.now - Date.now();
        // smooth the clock offset; jumps of more than 2s are taken directly
        const o = store.view && Math.abs(offset - store.offset) < 2000 ? store.offset * 0.7 + offset * 0.3 : offset;
        setState({ view: msg.view, offset: o, fatal: null });
      } else if (msg.t === 'error') {
        if (!store.view && /房间不存在/.test(msg.message)) {
          this.stopped = true;
          setState({ fatal: msg.message });
        } else toast(msg.message);
      } else if (msg.t === 'pong') {
        // keep-alive only
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      setState({ conn: 'closed' });
      if (this.stopped) return;
      const delay = Math.min(5000, 400 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ping') toast('连接已断开，正在重连…');
  }
}

let current: Connection | null = null;
export function connect(roomId: string): Connection {
  current?.stop();
  current = new Connection(roomId);
  current.start();
  return current;
}
export function conn(): Connection | null {
  return current;
}
export function send(msg: ClientMsg): void {
  current?.send(msg);
}
