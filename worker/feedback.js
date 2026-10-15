// Player feedback: checking what the game sends, and turning it into an email.
// Plain functions with no Cloudflare imports, so they can be tested in Node.

export const KINDS = { bug: 'Bug', idea: 'Idea', other: 'Other' };
export const MAX_MESSAGE = 4000;
const MAX_FIELD = 300;

const clean = (v, max = MAX_FIELD) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/[\r\n]+/g, ' ');
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

// Returns { ok: true, data } or { ok: false, error }.
export function validateFeedback(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Bad request.' };
  // a hidden field real players never fill in
  if (body.website) return { ok: false, error: 'Bad request.', spam: true };
  const kind = KINDS[body.kind] ? body.kind : 'other';
  const message = clean(body.message, MAX_MESSAGE);
  if (message.length < 5) return { ok: false, error: 'Please write a little more.' };
  const contact = oneLine(body.contact, 120);
  const ctx = {};
  if (body.context && typeof body.context === 'object') {
    for (const [k, v] of Object.entries(body.context).slice(0, 20)) ctx[oneLine(k, 40)] = oneLine(v, 200);
  }
  return { ok: true, data: { kind, message, contact, context: ctx } };
}

// base64 of UTF-8 text, wrapped at 76 characters as email expects
function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{1,76}/g, '$&\r\n').trimEnd();
}
const encodedWord = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}?=`);

// A complete plain-text email (RFC 5322) ready to hand to Cloudflare.
export function buildEmail({ from, to, data, now = new Date(), id = crypto.randomUUID() }) {
  const label = KINDS[data.kind];
  const preview = oneLine(data.message, 60);
  const subject = `[Starsea ${label}] ${preview}${data.message.length > 60 ? '…' : ''}`;
  const lines = [
    `${label} report from Starsea Ascension`,
    '',
    data.message,
    '',
    '-- ',
    `Contact: ${data.contact || '(none given)'}`,
    ...Object.entries(data.context).map(([k, v]) => `${k}: ${v}`),
  ];
  const domain = from.split('@')[1] || 'localhost';
  const headers = [
    `From: Starsea Feedback <${from}>`,
    `To: <${to}>`,
    ...(EMAIL.test(data.contact) ? [`Reply-To: <${data.contact}>`] : []),
    `Subject: ${encodedWord(subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${b64(lines.join('\n'))}\r\n`;
}
