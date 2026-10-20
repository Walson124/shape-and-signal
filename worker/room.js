import { DurableObject } from 'cloudflare:workers';
import { MAX_PEERS, MAX_MESSAGE, STATE_GAP_MS, cleanName, cleanChat, cleanState, takeChatToken } from './room-protocol.js';

// One multiplayer room: everyone in the same star system, on the same world (or in
// its open space). It relays where each player is and what they say to the others.
// Sockets hibernate between messages, so an idle room costs nothing; each socket's
// attachment carries that player's id, name, last state and chat allowance.

export class Room extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (this.ctx.getWebSockets().length >= MAX_PEERS) {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4001, 'Room full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: null, realm: 0, s: null, sAt: 0, chat: {} });
    return new Response(null, { status: 101, webSocket: client });
  }

  others(ws) {
    return this.ctx.getWebSockets().filter((o) => o !== ws && o.readyState === 1 && o.deserializeAttachment()?.name);
  }

  broadcast(ws, msg) {
    const text = JSON.stringify(msg);
    for (const o of this.others(ws)) {
      try { o.send(text); } catch { /* closing */ }
    }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment();
    if (!a) return;
    const now = Date.now();
    if (m.t === 'hi') {
      if (a.name) return;
      a.name = cleanName(m.name);
      a.realm = Math.max(0, Math.min(20, Math.round(Number(m.realm) || 0)));
      ws.serializeAttachment(a);
      const peers = this.others(ws).map((o) => { const b = o.deserializeAttachment(); return { id: b.id, name: b.name, realm: b.realm, s: b.s }; });
      ws.send(JSON.stringify({ t: 'w', id: a.id, peers }));
      this.broadcast(ws, { t: 'j', id: a.id, name: a.name, realm: a.realm });
      return;
    }
    if (!a.name) return;
    if (m.t === 's') {
      if (now - a.sAt < STATE_GAP_MS) return;
      const s = cleanState(m);
      if (!s) return;
      a.sAt = now;
      a.realm = s.realm;
      // keep the pose for late joiners, without the one-shot moves
      a.s = { ...s, ev: [] };
      ws.serializeAttachment(a);
      this.broadcast(ws, { t: 's', id: a.id, ...s });
    } else if (m.t === 'c') {
      const text = cleanChat(m.text);
      if (!text) return;
      const take = takeChatToken(a.chat, now);
      a.chat = take.bucket;
      ws.serializeAttachment(a);
      if (!take.ok) return;
      this.broadcast(ws, { t: 'c', id: a.id, name: a.name, text });
    }
  }

  async webSocketClose(ws, code) {
    const a = ws.deserializeAttachment();
    if (a?.name) this.broadcast(ws, { t: 'l', id: a.id });
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    const a = ws.deserializeAttachment();
    if (a?.name) this.broadcast(ws, { t: 'l', id: a.id });
  }
}
