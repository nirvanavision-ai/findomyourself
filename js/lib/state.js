/*
 * The page's single source of truth: the public state from the server plus a few
 * derived values (goal, what's unlocked, the domme's mood). api/state.php is polled
 * while the tab is visible; unchanged state costs a 304.
 */

const POLL_MS = 30000;
const listeners = new Set();
let state = null;
let etag = '';
let clockOffset = 0; // server time − local time, so the live timer is right on skewed phones

export const now = () => Date.now() + clockOffset;
export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setState(raw) {
  const prev = state;
  state = derive(raw);
  for (const fn of listeners) fn(state, prev);
}

function derive(raw) {
  const items = raw.items.map((item) => ({ ...item, title: [item.brand, item.name].filter(Boolean).join(' ') }));
  const byId = new Map(items.map((item) => [item.id, item]));
  const wishing = items.filter((i) => i.status === 'wishing');
  const unlocked = wishing.filter((i) => i.affordable);
  const claimed = items.filter((i) => i.status === 'claimed');
  const goal = byId.get(raw.goalId) || null;
  const locked = wishing.filter((i) => !i.affordable && !i.priceMissing);
  const next = locked.reduce((best, i) => (!best || i.hoursToGo < best.hoursToGo ? i : best), null);
  const s = { ...raw, items, byId, wishing, unlocked, claimed, goal, next, now };
  s.mood = mood(s);
  return s;
}

function mood(s) {
  const last = s.stats.lastTributeAt ? Date.parse(s.stats.lastTributeAt) : 0;
  if (s.session) return 'working';
  if (s.unlocked.length) return 'unlocked';
  if (s.stats.balance !== null && s.stats.balance <= 0) return 'empty';
  if (!last || now() - last > 24 * 3600 * 1000) return 'slacking';
  if (s.stats.activeToday) return 'praise';
  return 'taunts';
}

/** Voice lines for the current mood, mixed with general taunts. */
export function voiceLines(s) {
  const voice = s.settings.voice || {};
  const own = voice[s.mood] || [];
  const taunts = voice.taunts || [];
  const lines = s.mood === 'taunts' ? taunts : [...own, ...own, ...taunts];
  return lines.length ? lines : ['Cute wishlist. Now earn it.'];
}

export function startPolling() {
  let timer = 0;
  const poll = async () => {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') {
      try {
        const res = await fetch('api/state.php', { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store' });
        syncClock(res);
        if (res.status === 200) {
          const body = await res.json();
          etag = res.headers.get('ETag') || '';
          if (body.ok) setState(body.state);
        }
      } catch {
        // offline: try again next round
      }
    }
    timer = setTimeout(poll, POLL_MS);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });
  timer = setTimeout(poll, 4000);
}

function syncClock(res) {
  const date = Date.parse(res.headers.get('Date') || '');
  if (Number.isFinite(date)) {
    const offset = date - Date.now();
    if (Math.abs(offset) > 2000) clockOffset = offset; // headers have 1s precision: ignore jitter
  }
}
