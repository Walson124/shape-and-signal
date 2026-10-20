import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, cleanChat, cleanRoomKey, cleanState, takeChatToken, CHAT_BURST } from '../worker/room-protocol.js';

test('names are short, printable and markup-free, with a fallback', () => {
  assert.equal(cleanName('  Luo   Feng '), 'Luo Feng');
  assert.equal(cleanName('<script>alert(1)</script>'), 'scriptalert(1)/s');
  assert.equal(cleanName('a'), 'Cultivator');
  assert.equal(cleanName(null), 'Cultivator');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
});

test('chat drops control characters and angle brackets and is capped', () => {
  assert.equal(cleanChat('hi\u0000 <b>there</b>'), 'hi bthere/b');
  assert.equal(cleanChat('   '), '');
  assert.equal(cleanChat('y'.repeat(500)).length, 160);
});

test('room keys are a star key plus a world id', () => {
  assert.equal(cleanRoomKey('-3,1,2:0:p2'), '-3,1,2:0:p2');
  assert.equal(cleanRoomKey('s:1:2:3:p2'), 's:1:2:3:p2');
  assert.equal(cleanRoomKey('home:space'), 'home:space');
  assert.equal(cleanRoomKey('a/b'), null);
  assert.equal(cleanRoomKey(''), null);
});

test('state must carry a finite position and rotation; everything else is clamped', () => {
  assert.equal(cleanState({ p: [1, 2], q: [0, 0, 0, 1] }), null);
  assert.equal(cleanState({ p: [1, NaN, 3], q: [0, 0, 0, 1] }), null);
  const s = cleanState({
    p: [1, 2, 3], q: [0, 0, 0, 1], fy: 99, tl: 0.5, b: { idle: 0.7, walk: 5, 'bad key': 1, '<x>': 1 }, r: { walk: 1.2 },
    ev: [['punch_jab', 1.5, false], ['<bad>', 1, true], 'nope'], m: 'f', sh: 2, realm: 4, extra: 'ignored',
  });
  assert.deepEqual(s.p, [1, 2, 3]);
  assert.equal(s.fy, 3);
  assert.deepEqual(s.b, { idle: 0.7, walk: 1 });
  assert.deepEqual(s.ev, [['punch_jab', 1.5, false]]);
  assert.equal(s.m, 'f');
  assert.equal(s.sh, 2);
  assert.equal(s.realm, 4);
  assert.equal(s.extra, undefined);
  assert.equal(cleanState({ p: [0, 0, 0], q: [0, 0, 0, 1], m: 'warp' }).m, 'g');
});

test('chat allows a burst, then refills slowly', () => {
  let bucket = {};
  let sent = 0;
  for (let i = 0; i < 10; i++) {
    const r = takeChatToken(bucket, 1000);
    bucket = r.bucket;
    if (r.ok) sent++;
  }
  assert.equal(sent, CHAT_BURST);
  assert.equal(takeChatToken(bucket, 1500).ok, false);
  assert.equal(takeChatToken(bucket, 4000).ok, true);
});
