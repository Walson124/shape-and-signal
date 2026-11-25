// The connection to a Minesweeper Duel room (/api/mines?room=CODE). Reconnects on its
// own after a drop and takes back the same seat with the id + key the room gave us.

export class Link {
  constructor(code, name, { onMessage, onStatus }) {
    this.code = code;
    this.name = name;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.seat = null;          // { id, key }
    this.closed = false;
    this.tries = 0;
    this.open();
  }

  open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/api/mines?room=${encodeURIComponent(this.code)}`); } catch { this.retry(); return; }
    this.ws = ws;
    this.onStatus(this.seat ? 'reconnecting' : 'connecting');
    ws.addEventListener('open', () => {
      this.tries = 0;
      ws.send(JSON.stringify({ t: 'hi', name: this.name, ...(this.seat ? { id: this.seat.id, key: this.seat.key } : {}) }));
      this.onStatus('online');
    });
    ws.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') this.seat = { id: m.you, key: m.key };
      if (m.t === 'full' || m.t === 'busy') this.closed = true;
      this.onMessage(m);
    });
    ws.addEventListener('close', (e) => {
      if (this.ws !== ws) return;
      // the room let us go for sitting idle: don't keep it alive by reconnecting
      if (e.code === 4002) { this.closed = true; this.onStatus('idle'); return; }
      if (this.closed) { this.onStatus('closed'); return; }
      this.retry();
    });
  }

  retry() {
    if (this.closed) return;
    this.tries++;
    // never welcomed: the server isn't there; give up quickly
    if (!this.seat && this.tries > 2) { this.closed = true; this.onStatus('unreachable'); return; }
    if (this.tries > 8) { this.closed = true; this.onStatus('lost'); return; }
    this.onStatus('reconnecting');
    setTimeout(() => this.open(), Math.min(4000, 400 * 2 ** this.tries));
  }

  send(msg) {
    if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  close() {
    this.closed = true;
    try { this.ws?.close(1000, 'bye'); } catch { /* already closed */ }
  }
}

const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => CODE_ABC[b % CODE_ABC.length]).join('');
}
