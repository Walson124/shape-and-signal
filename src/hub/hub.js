import '../platform/base.css';
import './hub.css';
import { topbar } from '../platform/shell.js';
import { makeBoard, newPlayerBoard, OPEN } from '../mines/core.js';

topbar('');

// Minesweeper thumbnail: a real board, part opened, drawn as SVG
function minesThumb() {
  const W = 16, H = 7;
  const board = makeBoard(W, H, 18, 20261124);
  const pb = newPlayerBoard(board);
  const s = 26, ox = 0, oy = 0;
  let cells = '';
  for (let i = 0; i < W * H; i++) {
    const x = (i % W) * s + ox, y = Math.floor(i / W) * s + oy;
    if (pb.cell[i] === OPEN) {
      cells += `<rect x="${x + 1}" y="${y + 1}" width="${s - 2}" height="${s - 2}" rx="3" fill="var(--surface)" opacity="0.9"/>`;
      if (board.adj[i]) cells += `<text x="${x + s / 2}" y="${y + s / 2 + 5}" text-anchor="middle" font-family="var(--mono)" font-weight="700" font-size="14" fill="${['', '#3b5bdb', '#1f9d55', '#e5484d', '#7048e8'][Math.min(4, board.adj[i])]}">${board.adj[i]}</text>`;
    } else {
      cells += `<rect x="${x + 1}" y="${y + 1}" width="${s - 2}" height="${s - 2}" rx="3" fill="var(--mines)" opacity="${0.18 + ((i * 7) % 5) * 0.03}"/>`;
      if (board.mine[i] && (i % 3 === 0)) cells += `<path d="M${x + 8} ${y + 19}V${y + 7}l9 3.5-9 3.5" fill="var(--mines)" stroke="var(--mines)" stroke-width="1.5" stroke-linejoin="round"/>`;
    }
  }
  document.getElementById('thumb-mines').innerHTML = `<svg viewBox="0 0 ${W * s} ${H * s}" preserveAspectRatio="xMidYMid slice">${cells}</svg>`;
}

// Whereto thumbnail: soft blobs of land with spots warming up where people agree
function wheretoThumb() {
  const spots = [[90, 70, 3], [150, 120, 1], [230, 60, 5], [300, 110, 4], [360, 70, 2], [200, 140, 2], [270, 150, 5]];
  const dots = spots.map(([x, y, n]) => `
    <circle cx="${x}" cy="${y}" r="${10 + n * 3}" fill="var(--whereto)" opacity="${0.12 + n * 0.08}"/>
    <circle cx="${x}" cy="${y}" r="5" fill="var(--whereto)"/>`).join('');
  document.getElementById('thumb-whereto').innerHTML = `
    <svg viewBox="0 0 420 190" preserveAspectRatio="xMidYMid slice">
      <path d="M30 60c30-40 90-40 120-20s60 10 90-10 90-20 120 10 40 70 10 90-60 10-100 30-90 20-130 0-60-10-90-30-40-40-20-70z" fill="var(--surface)" opacity="0.85"/>
      <path d="M60 150c20-10 50-6 70 4s10 24-20 26-60-14-50-30z" fill="var(--surface)" opacity="0.7"/>
      ${dots}
      <g transform="translate(262 116)">
        <path d="M8 0c-4.4 0-8 3.4-8 7.7C0 13.5 8 22 8 22s8-8.5 8-14.3C16 3.4 12.4 0 8 0z" fill="var(--ink)"/>
        <circle cx="8" cy="7.6" r="3" fill="var(--surface)"/>
      </g>
    </svg>`;
}

// Whereform thumbnail: a dotted globe grid, a few clue cards and a pin
function whereformThumb() {
  let dots = '';
  for (let y = 18; y < 190; y += 16) for (let x = 14; x < 420; x += 16) {
    const lat = (y - 95) / 95, lon = (x - 210) / 210;
    if (lat * lat + lon * lon < 1.05) dots += `<circle cx="${x}" cy="${y}" r="1.6" fill="var(--whereform)" opacity="0.35"/>`;
  }
  const clue = (x, y, w, label, value) => `
    <g transform="translate(${x} ${y})">
      <rect width="${w}" height="34" rx="7" fill="var(--surface)" stroke="var(--line)"/>
      <text x="10" y="13" font-family="var(--mono)" font-size="8.5" font-weight="700" fill="var(--muted)" letter-spacing="0.06em">${label}</text>
      <text x="10" y="27" font-family="var(--mono)" font-size="11.5" font-weight="700" fill="var(--ink)">${value}</text>
    </g>`;
  document.getElementById('thumb-whereform').innerHTML = `
    <svg viewBox="0 0 420 190" preserveAspectRatio="xMidYMid slice">
      ${dots}
      ${clue(34, 30, 118, 'HEMISPHERE', 'NORTH · EAST')}
      ${clue(46, 78, 104, 'NEIGHBOURS', '4 BY LAND')}
      ${clue(30, 126, 112, 'AREA RANK', '#61 OF 177')}
      <g transform="translate(268 70)">
        <circle cx="12" cy="40" r="16" fill="var(--whereform)" opacity="0.18"/>
        <path d="M12 0C5.4 0 0 5.1 0 11.5 0 20.3 12 33 12 33s12-12.7 12-21.5C24 5.1 18.6 0 12 0z" fill="var(--whereform)"/>
        <circle cx="12" cy="11.4" r="4.5" fill="var(--surface)"/>
      </g>
    </svg>`;
}

whereformThumb();
minesThumb();
wheretoThumb();
