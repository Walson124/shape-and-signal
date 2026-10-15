import { settings } from '../core/settings.js';
import { codeLabel } from '../core/bindings.js';

// Nix (尼克斯): an ancient intelligence sealed in a battered space ring.
// Sarcastic, vain, secretly loyal. Everything here is scripted: a line is
// picked for each situation, with cooldowns so it never nags.

const L = {
  intro: [
    ['Oh. A pulse. Hello. I\'m Nix, the ring on your finger. I used to belong to someone who could fold stars. Now I have you.', 'That\'s not an insult. It\'s a starting point. A very low one.'],
  ],
  resume: [
    'You\'re back. I counted the seconds. Not because I missed you. I just like counting.',
    'There you are. The beasts have been unsupervised. They\'ve gotten confident.',
    'Welcome back. Your body is exactly where you left it, which is the best thing I can say about it.',
    'Oh good, you remembered me. Most people who put on a strange ring and then leave don\'t come back.',
  ],
  idle: [
    'We\'re standing still. Are we waiting for something, or is this a nap with your eyes open?',
    'If you\'re not moving, at least cultivate. Standing around doesn\'t make you stronger. I\'ve checked.',
    'Somewhere, a beast is getting stronger while you admire this view.',
    'I watched a glacier cross a continent once. It had more urgency than this.',
  ],
  banter: [
    'My last owner split a moon to settle an argument. They won. Obviously.',
    'Rule one of the wilds: if it\'s bigger than you, run. Rule two: most things are bigger than you.',
    'I\'ve run the numbers on you becoming a Universe Master. I\'ll share them when you\'re emotionally ready. Maybe never.',
    'The old empire that built those ruins had flying cities. Then they had one really bad week.',
    'Cultivation is simple: gather energy, survive, repeat. It\'s the surviving part people get wrong.',
    'You talk to yourself when you think nobody\'s listening. I\'m always listening. For the record.',
    'I\'ve been a ring for nine thousand years. You\'d think I\'d be patient. You\'d be wrong.',
    'Fun fact: springs, stars and nebulae are thick with energy. Cities are not. Cities are thick with noodles.',
    'Every great cultivator started weak. Most of them stayed that way. You might be different. Might.',
    'I don\'t sleep. I just stop paying attention to you. It\'s restful.',
  ],
  hurt: [
    'You\'re badly hurt. Pill, retreat, or a very brave death. I strongly recommend the pill.',
    'Your life signs just did something I didn\'t like. Back off and heal.',
    'Low health. If you die out here, I\'m back in the dirt for another thousand years. Think of me.',
    'That\'s a lot of your blood on the outside. Heal up before the next hit.',
  ],
  strongBeast: [
    'That {beast} outclasses you. Running is a martial art too. A very old one.',
    'Careful. That {beast} is stronger than you. Fight it near cover or don\'t fight it at all.',
    '{beast}. Bad matchup. Dodge its big hits or leave. Those are the options.',
  ],
  kill: [
    'Clean. Mostly.',
    'One fewer mouth in the wilds.',
    'Its essence is yours now. Don\'t spend it all on noodles.',
    'Good. Do that again, but faster.',
    'Not bad. I\'ve seen worse. I\'ve also seen much better, but not recently.',
  ],
  streak: [
    'Five in a row. You\'re getting good at this, and I\'m not sure how I feel about it.',
    'That\'s a streak. The wilds are going to start telling stories about you.',
    'Five down. Don\'t let it go to your head. There isn\'t much room up there.',
  ],
  stageUp: [
    'Your meridians just opened a little wider. You\'re stronger. Feel it?',
    'A new stage. Slightly less fragile. I\'m proud of you, in a very measured way.',
    'Stronger. Not strong. Stronger. It\'s a start.',
  ],
  bottleneck: [
    'You\'ve hit a wall. Energy alone won\'t carry you past it now; you need a Realm Insight. Win an obelisk trial, slay an Overlord, clear five arena waves, or ask the Martial Hall for a breakthrough trial.',
  ],
  btReady: [
    'You\'re at the peak and you have the insight. Press {breakthrough} when you\'re ready. The heavens will throw lightning at you. Keep moving and you\'ll live.',
  ],
  trib: ['Lightning! Keep moving! Standing still is how you die here!', 'The heavens are testing you. Dodge, don\'t stand there!'],
  breakthrough: [
    'You did it. A new realm. I\'d cry, but I\'m jewellery.',
    'Breakthrough. The universe just got a little smaller for you.',
    'The heavens noticed you. That\'s good. Mostly.',
  ],
  firstFly: ['You can fly now. Double-tap {jump}. Try not to hit a building on your first try. I\'ll be watching. Closely.'],
  firstSpace: ['We\'re in space. Your lungs don\'t matter up here anymore. How does it feel to outgrow a planet?'],
  death: [
    'Well. That happened.',
    'You died. I\'ve put you back together. Try the part where you don\'t.',
    'Let\'s call that a tactical lie-down.',
  ],
  respawn: ['Body rebuilt. All the parts are back, roughly where they go.', 'You\'re back. Let\'s skip the dying part next time.'],
  discover: {
    ruin: ['Ruins of the old empire. They built to last; they didn\'t. Hold {interact} to search. Something might be left.'],
    spring: ['An energy spring. Stand in the light and cultivate. This is the good stuff.'],
    ore: ['Star metal. Break it open. Shipyards want it, and you\'re going to want a ship.'],
    nest: ['A beast nest. Get close and they\'ll pour out. That\'s a warning, or a buffet, depending on your mood.'],
    wreck: ['A wreck. The owners won\'t miss it. Hold {interact} to salvage.'],
    lair: ['Something huge lives here. Get much stronger before you knock.'],
    obelisk: ['A trial obelisk. Beat its guardians and you\'ll earn real insight. Touch it with {interact} when you\'re ready.'],
    camp: ['A hunters\' camp. Traders, a fire, gossip. Civilisation, in a very small dose.'],
  },
  venue: {
    exchange: ['The Exchange. Sell what you\'ve found, buy what you need. Haggling is beneath me, but feel free.'],
    forge: ['The forge. Better blades, fewer embarrassing fights.'],
    pills: ['Pill pavilion. Heal pills, energy pills. Buy a few before you go back out.'],
    clinic: ['Gene clinic. They\'ll rewrite your body a little. I have notes, if they want them.'],
    chamber: ['A gravity chamber. Pay to cultivate faster. Like an energy spring with a receipt.'],
    bar: ['A teahouse. Buy a round and the hunters will tell you where the good stuff is.'],
    food: ['A noodle bar. A full stomach helps you recover. Probably. I\'ve never had one.'],
    home: ['Apartments. Rent one and you\'ll wake up here after a bad day, instead of in a ditch.'],
    hall: ['The Martial Hall. Bounties, trainers, and people who think they\'re tougher than you.'],
    arena: ['The arena. Fight in waves, win prizes, get cheered. My favourite kind of violence: the organised kind.'],
    dealer: ['The vehicle dealer. Four wheels, or none. Either way, faster than your legs.'],
  },
  night: ['Night. The beasts get bolder. Stay near the lights if you\'re not feeling bold yourself.', 'It\'s dark out. Watch your back. I\'ll watch the rest.'],
  dawn: ['Morning. You survived the night. Well done, honestly.'],
  wilds: ['We\'re past the walls. The further from the city, the nastier the beasts. Just so you know.'],
  dangerRising: ['The beasts out here are a grade tougher. Your confidence is lovely. Your health bar disagrees.'],
  ping: {
    none: ['Nothing. Either this area is empty, or your radar is too cheap to tell.'],
    some: ['Got it: {n} signal{s}, {what}. They\'re on your compass.'],
  },
  radarHint: ['Wrecks and treasure are hard to see by eye. Scroll to your radar and let it sweep. Better radars at the Exchange see further.'],
  shop: ['Good purchase. Sensible, even. I\'m a little surprised.', 'Money well spent. Probably.'],
  ship: ['A ship. Finally, a body almost as impressive as mine used to be.'],
  warp: ['Warp drive engaged. Hold on to something. Anything.'],
  arrive: ['New system. New beasts, new mistakes. Let\'s go find them.'],
  station: ['A station. Air, trade, and terrible coffee. Civilisation.'],
  vuIntro: ['Welcome to the Virtual Universe, where everyone who matters is plugged in. Your real body is still out there, by the way. Unguarded. Just a thought.'],
  delivery: ['Ordered. It\'ll drop out of the sky near you. Literally.', 'Delivery on its way. The shipping fee is a crime, by the way.'],
  podIncoming: ['Pod incoming! Stand clear. Being crushed by your own shopping would be a very silly way to go.'],
  arenaWin: ['The crowd loves you. I\'m coming around to you myself. Slowly.'],
  trialWin: ['The obelisk yields. That insight is yours now. I felt it click into place.'],
  meditateLong: ['You\'ve been sitting a while. Cultivating, or napping? No judgement. Some judgement.'],
  path: {
    mind: ['Steer your swords with {focus}. Think of them as very sharp, very obedient pets.'],
    blade: ['Press {focus} right before a hit lands to parry. Time it well and they stagger. Time it badly and, well, you\'ll find out.'],
    psychic: ['Hold {focus} on a beast to lift it. Then let go. Physics does the rest.'],
  },
};

const COOLDOWN = { dangerRising: 600, bottleneck: 120, btReady: 60, trib: 10, death: 5, respawn: 5, arenaWin: 20, warp: 20, arrive: 20, kill: 25, idle: 90, banter: 240, hurt: 30, strongBeast: 45, stageUp: 5, night: 120, dawn: 120, venue: 20, discover: 4, ping: 3, shop: 30, meditateLong: 300, streak: 30 };

export class Companion {
  constructor(game) {
    this.g = game;
    this.el = document.getElementById('nix');
    this.textEl = document.getElementById('nix-text');
    this.queue = [];
    this.current = null;
    this.cool = {};
    this.bags = {};
    this.time = 0;
    this.banterT = 120 + Math.random() * 120;
    this.idleT = 0;
    this.medT = 0;
    this.killTimes = [];
    this.lastDay = null;
    this.wasHurt = false;
  }

  key(action) {
    return `<kbd>${codeLabel(settings.key(action))}</kbd>`;
  }

  fill(text, vars = {}) {
    return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ['jump', 'interact', 'breakthrough', 'ping', 'focus', 'fire', 'cultivate'].includes(k) ? this.key(k) : `{${k}}`));
  }

  // Queue a line. priority 2 interrupts, 1 jumps the queue, 0 waits.
  say(text, priority = 0, force = false) {
    if (this.g.state.nixAwake === false && !force) return;
    const level = settings.get('nixChatter');
    if (level === 'off') return;
    if (level === 'quiet' && priority < 1) return;
    if (priority >= 2) {
      this.queue = [];
      this.current = null;
    }
    if (priority >= 1) this.queue.unshift(text);
    else if (this.queue.length < 3) this.queue.push(text);
  }

  // Say a line for a situation, respecting cooldowns. Returns true if spoken.
  event(name, vars = {}, priority = 0) {
    if (this.g.state.nixAwake === false) return false;
    const now = this.time;
    const cd = COOLDOWN[name.split('.')[0]] ?? 8;
    if ((this.cool[name] || -1e9) + cd > now) return false;
    let pool = L;
    for (const part of name.split('.')) pool = pool && pool[part];
    if (!pool || !pool.length) return false;
    this.cool[name] = now;
    // draw from a shuffled bag so a line never comes round again until the others have
    let bag = this.bags[name];
    if (!bag || !bag.length) {
      bag = this.bags[name] = pool.map((_, k) => k).sort(() => Math.random() - 0.5);
      if (bag.length > 1 && bag[bag.length - 1] === this.bags[name + ':last']) bag.unshift(bag.pop());
    }
    const idx = bag.pop();
    this.bags[name + ':last'] = idx;
    const pick = pool[idx];
    const lines = Array.isArray(pick) ? pick : [pick];
    lines.forEach((ln, i) => this.say(this.fill(ln, vars), i === 0 ? priority : 0));
    return true;
  }

  // Once per save: tutorial-style hints.
  once(id, name, vars, priority = 1) {
    const seen = this.g.state.nixSeen || (this.g.state.nixSeen = {});
    if (seen[id]) return false;
    if (this.event(name, vars, priority)) {
      seen[id] = true;
      return true;
    }
    return false;
  }

  onKill(b) {
    const t = this.time;
    this.killTimes = this.killTimes.filter((x) => t - x < 20);
    this.killTimes.push(t);
    if (this.killTimes.length >= 5) {
      this.killTimes = [];
      this.event('streak');
    } else if (Math.random() < 0.15) this.event('kill');
    void b;
  }

  update(dt, ctx) {
    this.time += dt;
    const g = this.g;
    // speaking: type the current line, hold, then fade
    if (!this.current && this.queue.length) {
      const text = this.queue.shift();
      this.current = { text, shown: 0, hold: Math.max(text.includes('<kbd>') ? 9 : 0, 3.5 + text.length * 0.055) };
      this.textEl.innerHTML = '';
      this.el.classList.remove('hidden', 'fade');
    }
    const c = this.current;
    if (c) {
      if (c.shown < c.text.length) {
        c.shown = Math.min(c.text.length, c.shown + dt * 70);
        // never cut through an html tag
        let n = Math.floor(c.shown);
        const open = c.text.lastIndexOf('<', n);
        if (open > c.text.lastIndexOf('>', n)) n = c.text.indexOf('>', n) + 1;
        this.textEl.innerHTML = c.text.slice(0, n);
      } else {
        c.hold -= dt;
        if (c.hold < 0.4) this.el.classList.add('fade');
        if (c.hold <= 0) {
          this.current = null;
          if (!this.queue.length) this.el.classList.add('hidden');
        }
      }
    }
    if (!ctx || g.mode !== 'playing') return;
    const { rt, state, stats, player } = { rt: g.rt, state: g.state, stats: g.stats, player: g.player };
    // health
    const hurt = rt.hp < stats.maxHp * 0.3;
    if (hurt && !this.wasHurt) this.event('hurt', {}, 1);
    this.wasHurt = hurt;
    // a stronger beast hunting you
    for (const b of g.beasts.beasts) {
      if (b.aggro && !b.static && !b.boss && b.tier - state.realm >= 0.9 && b.pos.distanceTo(player.pos) < 220) {
        this.event('strongBeast', { beast: b.name });
        break;
      }
    }
    // idle and long meditation
    if (ctx.manual || rt.meditating) this.idleT = 0;
    else this.idleT += dt;
    if (this.idleT > 60) {
      this.idleT = 0;
      this.event('idle');
    }
    this.medT = rt.meditating ? this.medT + dt : 0;
    if (this.medT > 120) {
      this.medT = 0;
      this.event('meditateLong');
    }
    // day and night on a world
    const sky = g.frame && g.frame.body.atmo ? g.frame.skyState(g.system.root.position) : null;
    if (sky) {
      const day = sky.day > 0.5;
      if (this.lastDay !== null && day !== this.lastDay) this.event(day ? 'dawn' : 'night');
      this.lastDay = day;
    } else this.lastDay = null;
    // ambient banter
    this.banterT -= dt;
    if (this.banterT <= 0) {
      this.banterT = 200 + Math.random() * 200;
      if (!this.current && !this.queue.length) this.event('banter');
    }
  }
}
