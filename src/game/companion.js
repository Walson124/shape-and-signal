import { settings } from '../core/settings.js';
import { codeLabel } from '../core/bindings.js';

// Nix (尼克斯): an ancient intelligence sealed in a battered space ring.
// Sarcastic, vain, secretly loyal. Everything here is scripted: a line is
// picked for each situation, with cooldowns so it never nags.

const L = {
  intro: [
    ['Oh good, a pulse. Hello! I am Nix. I have been asleep in this ring for, conservatively, forever. You are... small.', 'Don\'t worry, I\'ll make you less small. Eventually. Possibly.'],
  ],
  resume: [
    'Back already? I was in the middle of a very important nap.',
    'You\'re alive. I had a small wager with myself that you wouldn\'t be. I lost. I\'m thrilled.',
    'Welcome back. I reorganised your inventory by smell while you were gone. Kidding. I don\'t have a nose. Yet.',
    'Ah, my favourite meat-based companion returns.',
  ],
  idle: [
    'Are we... standing here? Is this a strategy? Teach me.',
    'Fun fact: cultivating is faster than standing still. Source: me, the smartest thing within a light year.',
    'I can hear your bones getting older.',
    'If you\'re waiting for the beasts to come to you, they will. That\'s the problem.',
    'I once watched a mountain erode. It was more eventful than this.',
  ],
  banter: [
    'I used to belong to someone who could split moons. No pressure.',
    'Your posture while fighting is, and I say this lovingly, a crime.',
    'Remember: if it has more teeth than you, run. If it has fewer teeth, also consider running.',
    'I\'ve calculated your odds of becoming a Universe Master. I\'ll tell you when you\'re emotionally ready.',
    'Did you know the old civilisation on this planet had flying cities? They also had a very bad week.',
    'Your sense of direction is impressive. Impressively bad.',
    'Cultivation tip: energy is denser near springs, stars and nebulae. Also near me, spiritually.',
    'I\'m not saying I miss my old body. I\'m saying I miss having elbows.',
    'You hum when you walk. Did you know that? Now you do.',
    'Some rings hold treasure. You got me. Lucky you.',
  ],
  hurt: [
    'You\'re leaking. That\'s the red stuff. Keep it inside.',
    'Your life signs are doing a very interesting dance. Stop it.',
    'Low health! Pill, retreat, or a heroic death. I vote pill.',
    'If you die I\'m stuck in a ring in the dirt again. Think of ME.',
  ],
  strongBeast: [
    'That {beast} is a grade above you. Running away is a legitimate martial art.',
    'Warning: {beast}. It is stronger than you. Most things are, but especially that.',
    '{beast} incoming, and it outclasses you. I\'ll write a lovely eulogy.',
  ],
  kill: [
    'Neat. Messy, but neat.',
    'One less mouth in the wilds.',
    'Textbook. A very short, badly written textbook.',
    'You know, I almost felt that one.',
    'Their essence is yours now. Try not to waste it on noodles.',
  ],
  streak: [
    'Five down! Are you showing off? You\'re showing off.',
    'Look at you, a one-person beast tide in reverse.',
    'That was genuinely good. Don\'t let it go to your head. There\'s not much room up there.',
  ],
  stageUp: [
    'Your meridians just went "pop". That\'s good. Mostly.',
    'A new stage! I\'d throw confetti but I lack hands.',
    'Stronger. Slightly. Microscopically. I\'m proud anyway.',
  ],
  bottleneck: [
    'You\'ve hit a bottleneck. Raw energy won\'t push you through now; you need a Realm Insight. Win an obelisk trial, slay an Overlord, clear five arena waves, or ask the Martial Hall for a breakthrough trial.',
  ],
  btReady: [
    'You\'re at the peak and you have the insight. Press {breakthrough} and let the heavens test you. Keep moving when the lightning comes.',
  ],
  trib: ['Lightning! Move! Moving is the whole trick!', 'The heavens hate you personally. Dodge!'],
  breakthrough: [
    'You did it! I\'m not crying. I don\'t have eyes. Shut up.',
    'A new realm. The universe just got a little bit smaller for you.',
    'And the cosmos noticed. Congratulations, you\'re officially interesting.',
  ],
  firstFly: ['You can fly now. Double-tap {jump}. Please don\'t hit a building on your first try. Or do; I\'m recording.'],
  firstSpace: ['We\'re in space. Your lungs are irrelevant now. How does it feel to be cosmically upgraded?'],
  death: [
    'Well. That happened.',
    'You died. On the bright side, you got better at it.',
    'Let\'s call that a tactical lie-down.',
  ],
  respawn: ['Body reassembled. Mostly the right way round.', 'You\'re back. Try the part where you don\'t die.'],
  discover: {
    ruin: ['Ruins of the old civilisation. They built well. They died anyway. Hold {interact} to search; there might be something left.'],
    spring: ['An energy spring! Sit in the light and cultivate. This is the good stuff.'],
    ore: ['Star metal. Smash it. Shipyards love it, and you\'ll want a ship. Trust me, walking across a galaxy is overrated.'],
    nest: ['A beast nest. Get close and they\'ll come pouring out. That\'s either a warning or an invitation.'],
    wreck: ['A wreck. Salvage is ethical if the owners are long dead. Hold {interact}.'],
    lair: ['Something very large lives here. I suggest you be much stronger before you say hello.'],
    obelisk: ['A trial obelisk. Beat its guardians and you\'ll gain real insight. Touch it with {interact} when you\'re ready.'],
    camp: ['A hunters\' camp. Traders, a fire, gossip. Civilisation in miniature.'],
  },
  venue: {
    exchange: ['The Exchange. Sell your rocks, buy your pills. Capitalism, but with cultivators.'],
    forge: ['The forge. Better blades, fewer embarrassments.'],
    pills: ['Pills! Mostly herbs and optimism.'],
    clinic: ['Gene clinic. They\'ll rewrite your body a little. You could use the edits.'],
    chamber: ['A gravity chamber. Rent it, sit down, cultivate. It\'s like a spring you pay for.'],
    bar: ['A teahouse. Buy a round and the hunters will talk. Hunters love to talk.'],
    food: ['Noodles. I can\'t eat, but I can judge your order.'],
    home: ['Apartments. Rent one and you\'ll wake up here instead of somewhere embarrassing.'],
    hall: ['The Martial Hall. Bounties, trainers, and people who think they\'re tougher than you.'],
    arena: ['The arena. Violence as entertainment. My favourite genre.'],
  },
  night: ['Night falls. The beasts get bolder. So, apparently, do you.', 'It\'s dark. Very dramatic. Watch your back.'],
  dawn: ['Morning. The sun is up and so, miraculously, are you.'],
  wilds: ['We\'re outside the walls. The further from a city, the nastier the beasts. Just so you know.'],
  dangerRising: ['The beasts out here are tougher. Your confidence is admirable and medically unwise.'],
  ping: {
    none: ['Nothing. Either this area is empty or my scanner is insulted by your budget.'],
    some: ['Got it. {n} signal{s}: {what}. They\'re on your compass now.'],
  },
  radarHint: ['Wrecks and treasure are hard to spot by eye. Scroll to your radar and let it sweep. Better radars at the Exchange find more.'],
  shop: ['Lovely purchase. Very sensible. I only screamed a little.', 'Money well spent. Probably.'],
  ship: ['A ship! Finally, a body almost as impressive as mine used to be.'],
  warp: ['Warp drive engaged. Hold onto your organs.'],
  arrive: ['New system. New beasts, new mistakes. Exciting!'],
  station: ['A station! Air, commerce, terrible coffee. Civilisation.'],
  vuIntro: ['Welcome to the Virtual Universe. Everyone who matters is plugged in here. Your body is still out there, by the way. Unguarded. Just a thought.'],
  delivery: ['Delivery ordered. The shipping fee is criminal, by the way. I checked.', 'Ordered. It\'ll fall out of the sky near you. Literally.'],
  podIncoming: ['Incoming pod! Stand clear, or don\'t. It\'d be a funny way to go.'],
  arenaWin: ['The crowd loves you. I\'m warming up to you too. Slowly.'],
  trialWin: ['The obelisk yields. That insight is yours now; I could feel it click.'],
  meditateLong: ['You\'ve been sitting a long time. Are you cultivating or napping? No judgement. Some judgement.'],
  path: {
    mind: ['Steer the swords with {focus}. Think of them as very pointy pets.'],
    blade: ['Tap {focus} just before a hit lands to parry. Get it right and they stagger. Get it wrong and, well, you\'ll know.'],
    psychic: ['Hold {focus} on a beast to lift it with your mind. Then let go. Physics does the rest.'],
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
    const pick = pool[Math.floor(Math.random() * pool.length)];
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
      this.current = { text, shown: 0, hold: 2.5 + text.length * 0.045 };
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
