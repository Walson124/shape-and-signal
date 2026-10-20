// What players may send to a multiplayer room, and the clean form the room passes on.
// Pure functions, no Cloudflare APIs, so they can be tested directly.
//
// Client -> room:
//   { t: 'hi', name, realm }        once, after connecting
//   { t: 's', ...state }             position and pose, a few times a second
//   { t: 'c', text }                 a chat line
// Room -> client:
//   { t: 'w', id, peers: [...] }    welcome: your id and who is here
//   { t: 'j', id, name, realm }     someone joined
//   { t: 's', id, ...state }        someone moved
//   { t: 'c', id, name, text }      someone said something
//   { t: 'l', id }                  someone left

export const MAX_PEERS = 32;
export const MAX_MESSAGE = 2048;
export const STATE_GAP_MS = 45;          // at most ~22 state updates a second per player
export const CHAT_BURST = 5, CHAT_REFILL_MS = 2000;

const MODES = new Set(['g', 'f', 's']);
const CLIP = /^[a-z_]{1,24}$/;

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const int = (v, lo, hi) => { const n = num(v, lo, hi); return n === null ? null : Math.round(n); };

// a display name: printable, no markup, 2-16 characters
export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length >= 2 ? s : 'Cultivator';
}

// a chat line: printable, no markup, at most 160 characters; empty means drop it
export function cleanChat(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

// a room key names a star system and the world (or open space) in it
export function cleanRoomKey(raw) {
  const s = String(raw ?? '');
  return /^[A-Za-z0-9:_.,-]{1,80}$/.test(s) ? s : null;
}

function weights(obj, lo, hi) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n >= 6) break;
    const x = num(v, lo, hi);
    if (!CLIP.test(k) || x === null) continue;
    out[k] = Math.round(x * 100) / 100;
    n++;
  }
  return out;
}

// A player's state, or null if it isn't one. Positions are in the frame of the room's world.
export function cleanState(m) {
  if (!m || typeof m !== 'object') return null;
  const p = Array.isArray(m.p) && m.p.length === 3 ? m.p.map((v) => num(v, -1e10, 1e10)) : null;
  const q = Array.isArray(m.q) && m.q.length === 4 ? m.q.map((v) => num(v, -1, 1)) : null;
  if (!p || !q || p.includes(null) || q.includes(null)) return null;
  const ev = [];
  if (Array.isArray(m.ev)) {
    for (const e of m.ev.slice(0, 4)) {
      if (!Array.isArray(e) || !CLIP.test(e[0])) continue;
      ev.push([e[0], num(e[1], 0.1, 4) ?? 1, !!e[2]]);
    }
  }
  return {
    p, q,
    fy: num(m.fy, -3, 3) ?? 0,
    tl: num(m.tl, -2, 2) ?? 0,
    bk: num(m.bk, -2, 2) ?? 0,
    b: weights(m.b, 0, 1),
    r: weights(m.r, 0, 4),
    ev,
    m: MODES.has(m.m) ? m.m : 'g',
    sh: int(m.sh, -1, 9) ?? -1,
    realm: int(m.realm, 0, 20) ?? 0,
  };
}

// Chat tokens: a short burst, then one line every couple of seconds.
export function takeChatToken(bucket, now) {
  const tokens = Math.min(CHAT_BURST, (bucket.tokens ?? CHAT_BURST) + (now - (bucket.at ?? now)) / CHAT_REFILL_MS);
  if (tokens < 1) return { ok: false, bucket: { tokens, at: now } };
  return { ok: true, bucket: { tokens: tokens - 1, at: now } };
}
