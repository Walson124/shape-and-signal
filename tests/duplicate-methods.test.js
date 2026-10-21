import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// In a JS class a second method with the same name silently replaces the first. That once
// broke every World-Eater fight: a new thunder(dist) replaced thunder(pos), and the old
// callers' arguments made Web Audio throw mid-frame.
function files(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });
}

test('no class defines the same method twice', () => {
  const problems = [];
  for (const f of files('src')) {
    const lines = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
    let cls = null, seen = null;
    for (const line of lines) {
      const c = line.match(/^(?:export )?class (\w+)/);
      if (c) { cls = c[1]; seen = new Map(); continue; }
      if (line.startsWith('}')) { cls = null; continue; }
      if (!cls) continue;
      // a method: two-space indent, name, parameters, opening brace (getters/setters keyed separately)
      const m = line.match(/^  (?:async )?(get |set |static )?(\w+)\s*\([^)]*\)\s*\{/);
      if (!m || ['if', 'for', 'while', 'switch', 'catch'].includes(m[2])) continue;
      const key = (m[1] || '') + m[2];
      if (seen.has(key)) problems.push(`${f}: ${cls}.${m[2]} defined twice (lines ${seen.get(key)} and ${lines.indexOf(line) + 1})`);
      else seen.set(key, lines.indexOf(line) + 1);
    }
  }
  assert.deepEqual(problems, []);
});
