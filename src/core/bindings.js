// Rebindable actions. Codes are KeyboardEvent.code values, plus Mouse0/1/2
// for mouse buttons.
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', group: 'Movement', def: 'KeyW' },
  { id: 'back', label: 'Move back', group: 'Movement', def: 'KeyS' },
  { id: 'left', label: 'Strafe left', group: 'Movement', def: 'KeyA' },
  { id: 'right', label: 'Strafe right', group: 'Movement', def: 'KeyD' },
  { id: 'jump', label: 'Jump · rise · double-tap to fly', group: 'Movement', def: 'Space' },
  { id: 'down', label: 'Sink while flying', group: 'Movement', def: 'KeyX' },
  { id: 'sprint', label: 'Sprint / boost', group: 'Movement', def: 'ShiftLeft' },
  { id: 'fire', label: 'Primary attack', group: 'Combat', def: 'Mouse0' },
  { id: 'focus', label: 'Secondary (guard · aim · steer swords · mind grip)', group: 'Combat', def: 'Mouse2' },
  { id: 'skill1', label: 'Technique 1', group: 'Combat', def: 'KeyQ' },
  { id: 'skill2', label: 'Technique 2', group: 'Combat', def: 'KeyR' },
  { id: 'skill3', label: 'Technique 3', group: 'Combat', def: 'KeyF' },
  { id: 'skill4', label: 'Ultimate', group: 'Combat', def: 'KeyV' },
  { id: 'weaponNext', label: 'Next weapon or radar (also the mouse wheel)', group: 'Combat', def: 'KeyY' },
  { id: 'formation', label: 'Sword formation', group: 'Combat', def: 'KeyZ' },
  { id: 'lock', label: 'Lock / cycle target', group: 'Combat', def: 'Tab' },
  { id: 'blink', label: 'Star Step blink (Stellar realm)', group: 'Movement', def: 'AltLeft' },
  { id: 'cultivate', label: 'Cultivate', group: 'Cultivation', def: 'KeyC' },
  { id: 'breakthrough', label: 'Breakthrough', group: 'Cultivation', def: 'KeyB' },
  { id: 'pill1', label: 'Rejuvenation Pill', group: 'Cultivation', def: 'Digit1' },
  { id: 'pill2', label: 'Primal Elixir', group: 'Cultivation', def: 'Digit2' },
  { id: 'pill3', label: 'Cultivation Pill', group: 'Cultivation', def: 'Digit3' },
  { id: 'interact', label: 'Interact · board ship · hold to search', group: 'World', def: 'KeyE' },
  { id: 'target', label: 'Target a marker or star', group: 'World', def: 'KeyT' },
  { id: 'virtual', label: 'Enter / leave the Virtual Universe', group: 'World', def: 'KeyO' },
  { id: 'engage', label: 'Cruise · warp', group: 'World', def: 'KeyG' },
  { id: 'camera', label: 'First / third person', group: 'Interface', def: 'KeyP' },
  { id: 'panelCult', label: 'Cultivation panel', group: 'Interface', def: 'KeyK' },
  { id: 'panelSkills', label: 'Path & skill tree', group: 'Interface', def: 'KeyU' },
  { id: 'panelBounty', label: 'Bounties', group: 'Interface', def: 'KeyJ' },
  { id: 'panelGuide', label: 'Guide', group: 'Interface', def: 'KeyH' },
  { id: 'mute', label: 'Mute sound', group: 'Interface', def: 'KeyN' },
];

export const DEFAULT_BINDINGS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));

const NAMES = {
  Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
  Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};

export function codeLabel(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
