import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedback, buildEmail } from '../worker/feedback.js';

const decode = (mail) => {
  const [head, body] = mail.split('\r\n\r\n');
  return { head, text: new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0))) };
};

test('feedback needs a real message and drops anything that fills the hidden field', () => {
  assert.equal(validateFeedback({ message: 'hi' }).ok, false);
  assert.equal(validateFeedback(null).ok, false);
  assert.equal(validateFeedback({ message: 'buy cheap things', website: 'x' }).spam, true);
  const v = validateFeedback({ kind: 'weird', message: '  The boss bar overlaps the timer  ', contact: 'a@b.co', context: { Version: '0.10' } });
  assert.equal(v.ok, true);
  assert.equal(v.data.kind, 'other');
  assert.equal(v.data.message, 'The boss bar overlaps the timer');
});

test('a player cannot add email headers through the contact or context fields', () => {
  const v = validateFeedback({ message: 'hello there', contact: 'x@y.co\r\nBcc: victim@z.co', context: { 'GPU\r\nBcc': 'a\r\nTo: b@c.co' } });
  const mail = buildEmail({ from: 'feedback@starsea.dev', to: 'dev@example.com', data: v.data, id: 'abc' });
  const { head } = decode(mail);
  assert.ok(!/^Bcc:/mi.test(head));
  assert.equal(head.match(/^To:/gm).length, 1);
  assert.ok(!/^Reply-To:/m.test(head), 'an invalid contact is not used as the reply address');
});

test('the email carries the message, the reply address and the game details', () => {
  const v = validateFeedback({ kind: 'bug', message: 'Fell through the floor in 基地市 ✓', contact: 'player@mail.com', context: { Version: '0.10.2', GPU: 'RTX 4070' } });
  const mail = buildEmail({ from: 'feedback@starsea.dev', to: 'dev@example.com', data: v.data, now: new Date(Date.UTC(2026, 9, 15)), id: 'abc' });
  const { head, text } = decode(mail);
  assert.match(head, /^From: Starsea Feedback <feedback@starsea\.dev>$/m);
  assert.match(head, /^Reply-To: <player@mail\.com>$/m);
  assert.match(head, /^Message-ID: <abc@starsea\.dev>$/m);
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m);
  assert.ok(text.includes('Fell through the floor in 基地市 ✓'));
  assert.ok(text.includes('GPU: RTX 4070'));
  assert.ok(text.includes('Contact: player@mail.com'));
});
