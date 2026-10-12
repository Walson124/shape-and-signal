import './styles.css';
import { Game } from './game/game.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const canvas = document.getElementById('scene');
if (!webglAvailable()) {
  document.getElementById('title-screen').innerHTML =
    '<div class="title-inner"><h1 class="logo">Starsea Ascension</h1><p class="tagline">This game needs WebGL, which your browser or device does not provide. Try a recent Chrome, Edge, Firefox or Safari.</p></div>';
} else {
  window.game = new Game(canvas);
}
