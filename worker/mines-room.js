import { DurableObject } from 'cloudflare:workers';
import { Match, MAX_MESSAGE } from './mines-match.js';

// A Minesweeper Duel room: one Durable Object per room code, holding a Match in memory.
// Sockets are accepted the ordinary way (not hibernated) so the match stays in memory
// for as long as anyone is connected; a room with nobody in it simply goes away.
//
// Because an open socket keeps the room (and its billing) alive, no socket may linger:
// it must say hello quickly, it is dropped after a long quiet spell, and a room accepts
// only a handful of sockets at once.

export const HELLO_MS = 10_000;           // time to send the first message
export const IDLE_MS = 20 * 60_000;       // no messages for this long: closed
export const MAX_SOCKETS = 12;            // 4 seats plus room for reconnects and "room full" replies
export const CLOSE_IDLE = 4002;

export class MinesRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.match = new Match({ send: (ws, msg) => { try { ws.send(JSON.stringify(msg)); } catch { /* closing */ } } });
    this.sockets = new Set();
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    if (this.sockets.size >= MAX_SOCKETS) return new Response('Room is busy.', { status: 429 });
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    this.sockets.add(ws);
    let joined = false;
    const shut = (code, reason) => { try { ws.close(code, reason); } catch { /* gone */ } };
    let quiet = setTimeout(() => shut(1008, 'Say hello'), HELLO_MS);
    const awake = () => { clearTimeout(quiet); quiet = setTimeout(() => shut(CLOSE_IDLE, 'Idle'), IDLE_MS); };
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > MAX_MESSAGE) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!joined) {
        const r = this.match.open(ws, m);
        if (r === 'close') { shut(4001, 'Room unavailable'); return; }
        joined = !!this.match.seatOf(ws);
        if (joined) awake();
        return;
      }
      awake();
      this.match.message(ws, m);
    });
    const gone = () => {
      clearTimeout(quiet);
      this.sockets.delete(ws);
      if (joined) { joined = false; this.match.close(ws); }
    };
    ws.addEventListener('close', (ev) => {
      // answer the client's close so its socket actually finishes closing (and it can
      // reconnect); older runtimes don't do this for us
      shut(ev.code >= 1000 && ev.code < 5000 && ev.code !== 1005 && ev.code !== 1006 ? ev.code : 1000, 'bye');
      gone();
    });
    ws.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
