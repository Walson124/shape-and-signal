// Bits every small app shares: the top bar, theme switch, toast, and the
// name people play under (remembered across apps).

export const PLATFORM = 'Shape & Signal';

const NAME_KEY = 'sas:name';
const THEME_KEY = 'sas:theme';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export { store };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const savedName = () => store.get(NAME_KEY) || '';
export const saveName = (n) => store.set(NAME_KEY, String(n || '').trim().slice(0, 24) || null);

export const LOGO = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--ink)"/>
  <rect x="7" y="7" width="8" height="8" rx="2" fill="var(--bg)"/>
  <circle cx="21" cy="21" r="4.2" fill="var(--accent)"/>
  <path d="M18 9.5c2.2 0 4.2 1.4 4.6 3.5M18 6.5c3.8 0 7.2 2.6 7.6 6.5" fill="none" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(store.get(THEME_KEY));

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

// Fills <header class="topbar"> with the brand, the app's name and a theme toggle.
// `extra` is HTML for buttons on the right.
export function topbar(appName, extra = '') {
  const bar = document.querySelector('.topbar');
  const home = new URL('../', location.href).pathname === location.pathname ? './' : '../';
  bar.innerHTML = `
    <a class="brand" href="${home}">${LOGO}<span>${PLATFORM}</span></a>
    ${appName ? `<span class="crumb">${esc(appName)}</span>` : ''}
    <span class="spacer"></span>
    ${extra}
    <button class="icon-btn" id="theme-btn" title="Switch light / dark" aria-label="Switch light or dark theme"></button>`;
  const btn = bar.querySelector('#theme-btn');
  const paint = () => { btn.innerHTML = isDark() ? SUN : MOON; };
  paint();
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    // going back to what the system wants anyway forgets the override
    const sys = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    store.set(THEME_KEY, next === sys ? null : next);
    applyTheme(next === sys ? null : next);
    paint();
    window.dispatchEvent(new Event('themechange'));
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paint(); window.dispatchEvent(new Event('themechange')); });
  return bar;
}

let toastEl, toastTimer;
export function toast(text, ms = 2200) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* nothing */ }
  ta.remove();
  return ok;
}

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
