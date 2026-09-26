/*
 * Crack the whip, the DOM half: counters, the "CRACK!" pops, the shake, the sound and
 * batching cracks to the server. The WebGL whip (js/gl/whip.js) calls crack(); without
 * WebGL the button does it.
 */
import { $, el } from '../lib/dom.js';
import { getState, subscribe } from '../lib/state.js';
import { prefersReducedMotion } from '../lib/motion.js';
import { sound } from '../audio.js';
import { CRACK_WORDS } from './lines.js';

const MINE_KEY = 'findom:cracks';
let mine = 0;
let pending = 0;
let flushTimer = 0;
let optimistic = { total: 0, today: 0 };
let shakeTimer = 0;

export function initWhipUI() {
  const section = $('#whip');
  try { mine = Number(localStorage.getItem(MINE_KEY)) || 0; } catch { mine = 0; }

  const sync = (s) => {
    section.hidden = s.settings.whip === false;
    optimistic = { total: (s.whips?.total ?? 0) + pending, today: (s.whips?.today ?? 0) + pending };
    renderCounts();
    const live = $('#whip-live');
    live.hidden = !s.session;
    if (s.session) live.textContent = 'Shh. They’re in a session right now. Your cracks get delivered after.';
  };
  sync(getState());
  subscribe(sync);
  if (window.matchMedia('(pointer: coarse)').matches) $('#whip-hint').textContent = 'Grab the handle. Flick hard.';

  $('#whip-button').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    crack(r.left + r.width / 2, r.top - 20, 1);
  });
  window.addEventListener('pagehide', flush);
}

function renderCounts() {
  $('#whip-mine').textContent = mine.toLocaleString('en-US');
  $('#whip-today').textContent = optimistic.today.toLocaleString('en-US');
  $('#whip-total').textContent = optimistic.total.toLocaleString('en-US');
}

/** One crack at screen position (x, y). power 0..1.5 scales the sound and the pop. */
export function crack(x, y, power = 1) {
  mine += 1;
  pending += 1;
  optimistic.total += 1;
  optimistic.today += 1;
  try { localStorage.setItem(MINE_KEY, String(mine)); } catch { /* ignore */ }
  renderCounts();
  sound.crack(Math.min(1.2, 0.7 + power * 0.4));
  pop(x, y, power);
  hideHint();
  if (!prefersReducedMotion()) {
    const section = $('#whip');
    section.classList.remove('is-shaking');
    void section.offsetWidth; // restart the animation
    section.classList.add('is-shaking');
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => section.classList.remove('is-shaking'), 420);
  }
  navigator.vibrate?.(18);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, pending >= 20 ? 0 : 1400);
}

export function hideHint() {
  $('#whip-hint')?.classList.add('is-gone');
}

function pop(x, y, power) {
  const word = CRACK_WORDS[Math.floor(Math.random() * CRACK_WORDS.length)];
  const node = el('span', {
    class: `pop${Math.random() < 0.25 ? ' is-gold' : ''}`,
    text: word,
    style: { left: `${x}px`, top: `${y}px`, '--r': `${(Math.random() * 18 - 9).toFixed(1)}deg`, 'font-size': `${(0.8 + Math.min(power, 1.4) * 0.35).toFixed(2)}em` },
  });
  $('#pops').append(node);
  node.addEventListener('animationend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 1600);
}

async function flush() {
  if (!pending) return;
  const count = Math.min(25, pending);
  pending -= count;
  try {
    const res = await fetch('api/whip.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Findom': '1' },
      body: JSON.stringify({ count }),
      keepalive: true,
    });
    const body = await res.json();
    if (body.ok) {
      optimistic = { total: body.total + pending, today: body.today + pending };
      renderCounts();
    }
  } catch {
    // offline: the local count still went up, which is what matters to the whipper
  }
  if (pending) flushTimer = setTimeout(flush, 300);
}
