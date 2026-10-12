import './styles.css';

function webgl2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const touchOnly = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const show = (title, text) => {
  document.getElementById('loading').classList.add('hidden');
  const u = document.getElementById('unsupported');
  if (title) document.getElementById('unsupported-title').textContent = title;
  if (text) document.getElementById('unsupported-text').textContent = text;
  u.classList.remove('hidden');
};

if (!webgl2()) {
  show('WebGL 2 unavailable', 'Your browser or graphics driver does not provide WebGL 2. Try a recent Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is on.');
} else if (touchOnly) {
  show();
} else {
  import('./game/game.js').then(({ Game }) => {
    window.game = new Game(document.getElementById('scene'));
  }).catch((err) => {
    console.error(err);
    show('Failed to start', 'Something went wrong while loading the game. Refresh the page to try again.');
  });
}
