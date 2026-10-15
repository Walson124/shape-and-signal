import { CHANGELOG } from './changelog.js';
import { REALMS, STAGES } from '../game/data.js';
import { settings } from '../core/settings.js';
import { esc } from './hud.js';

// The Feedback form: a modal that posts to the site's /api/feedback Worker,
// which emails it to the developer. Game and device details ride along so
// bug reports can be reproduced.

const COOLDOWN = 60 * 1000;
let draft = { kind: 'bug', message: '', contact: '' };
let lastSent = 0;

function context(game) {
  const out = {};
  const put = (k, fn) => { try { const v = fn(); if (v !== undefined && v !== null && v !== '') out[k] = String(v); } catch { /* not available */ } };
  put('Version', () => CHANGELOG[0].version);
  put('Where', () => (game.inGame ? `${game.frame ? game.frame.body.name : 'space'} · ${game.star.name} system` : 'title screen'));
  put('Realm', () => (game.inGame ? `${REALMS[game.state.realm].name} · ${STAGES[game.state.stage].name}` : null));
  put('Mode', () => (game.inGame ? (game.state.campaign ? 'campaign' : 'free play') : null));
  put('Graphics', () => `${settings.get('quality')} · ${Math.round(game.fps)} fps`);
  put('GPU', () => game.gpu.name);
  put('Screen', () => `${innerWidth}x${innerHeight} @${devicePixelRatio}x`);
  put('Browser', () => navigator.userAgent);
  return out;
}

export async function openFeedback(menus, game) {
  const wait = Math.ceil((COOLDOWN - (Date.now() - lastSent)) / 1000);
  if (wait > 0) {
    await menus.modal({ kicker: 'FEEDBACK', title: 'Thanks!', body: `<p>Your last message just went out. You can send another in ${wait} seconds.</p>`, actions: [{ label: 'OK', val: 'ok', cls: 'primary' }] });
    return;
  }
  const opt = (v, label) => `<option value="${v}" ${draft.kind === v ? 'selected' : ''}>${label}</option>`;
  const val = await menus.modal({
    kicker: 'FEEDBACK',
    title: 'Tell us what you think',
    wide: true,
    body: `<div class="fb-form">
      <p class="panel-note">Bugs, ideas, anything: it goes straight to the developer, with your game version and graphics details to help track down bugs.</p>
      <label class="fb-field">Type<select id="fb-kind">${opt('bug', 'Bug')}${opt('idea', 'Idea')}${opt('other', 'Other')}</select></label>
      <label class="fb-field">Message<textarea id="fb-message" rows="4" maxlength="4000" placeholder="What happened, or what would you like to see?">${esc(draft.message)}</textarea></label>
      <label class="fb-field">Contact (optional)<input id="fb-contact" maxlength="120" placeholder="Email or Discord, if you'd like a reply" value="${esc(draft.contact)}"></label>
      <input id="fb-website" class="fb-trap" tabindex="-1" autocomplete="off" aria-hidden="true">
    </div>`,
    actions: [{ label: 'Cancel', val: 'no', cls: 'ghost' }, { label: 'Send', val: 'send', cls: 'primary' }],
  });
  // the fields are still in the (hidden) modal, so read them either way and keep the draft
  const $ = (id) => document.getElementById(id);
  draft = { kind: $('fb-kind').value, message: $('fb-message').value, contact: $('fb-contact').value };
  const trap = $('fb-website').value;
  if (val !== 'send') return;
  if (draft.message.trim().length < 5) {
    if (await menus.modal({ kicker: 'FEEDBACK', title: 'A little more?', body: '<p>Please write a few words so we know what you mean.</p>', actions: [{ label: 'Cancel', val: 'no', cls: 'ghost' }, { label: 'Back to the form', val: 'back', cls: 'primary' }] }) === 'back') return openFeedback(menus, game);
    return;
  }
  // something on screen while the email goes out (the result replaces it)
  menus.modal({ kicker: 'FEEDBACK', title: 'Sending…', body: '<p>Sending your message.</p>', actions: [] });
  let result;
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft, website: trap, context: context(game) }),
    });
    const body = await res.json().catch(() => ({}));
    result = res.ok ? { ok: true } : { ok: false, error: body.error || `The server said no (${res.status}).` };
  } catch {
    result = { ok: false, error: 'Couldn\'t reach the server. Check your connection.' };
  }
  if (result.ok) {
    lastSent = Date.now();
    draft = { kind: 'bug', message: '', contact: '' };
    await menus.modal({ kicker: 'FEEDBACK', title: 'Sent. Thank you!', body: '<p>Your message is on its way. Every report gets read.</p>', actions: [{ label: 'Close', val: 'ok', cls: 'primary' }] });
    return;
  }
  const again = await menus.modal({ kicker: 'FEEDBACK', title: 'Not sent', body: `<p>${esc(result.error)}</p><p class="panel-note">Your message is saved here; try again in a moment.</p>`, actions: [{ label: 'Close', val: 'no', cls: 'ghost' }, { label: 'Try again', val: 'retry', cls: 'primary' }] });
  if (again === 'retry') return openFeedback(menus, game);
}
