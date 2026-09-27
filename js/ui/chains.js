/*
 * Chained up: a locked item's photo stays in full view, with two glossy black chains
 * crossed over it and a brass padlock at the crossing. The ring around the lock fills
 * as the vault does; when an item unlocks while the page is open, the shackle pops and
 * the chains fall away.
 *
 * The drawing lives once in a hidden SVG sprite (gradients, the chain, the lock), tinted
 * from the site's palette. Every card only carries a handful of <use>s, and all motion is
 * CSS or the Web Animations API (the % counts up as a CSS counter), so fifty chained
 * cards stay light and nothing runs per frame in JS.
 */
import { clamp, prefersReducedMotion } from '../lib/motion.js';

/* Chain geometry, in chain units: a link is ~6% of the card wide (see css/chains.css). */
const WIRE = 1.25;              // thickness of the wire
const PITCH = 3.4;              // centre to centre of neighbouring links (= a link's inner length)
const INNER_W = 1.35;           // inner width of a face-on link
const OUTER_L = PITCH + 2 * WIRE;
const OUTER_W = INNER_W + 2 * WIRE;
const BAR = 1.4;                // an edge-on link seen from above
const LINKS = 28;               // per half: enough to leave any card (or the modal) past its corner
const RING = 2 * Math.PI * 46;  // circumference of the progress ring (r = 46 in a 100 box)

const FILL_MS = 1600;
const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';
const EASE_IN = 'cubic-bezier(.55, 0, .85, .25)';
const EASE_BACK = 'cubic-bezier(.34, 1.56, .64, 1)';

const n = (v) => Number(v.toFixed(2));

/** A stadium (a rounded bar) centred on the chain's axis. */
function stadium(cx, length, height) {
  const r = height / 2;
  const straight = length - height;
  return `M${n(cx - length / 2 + r)} ${n(-r)}h${n(straight)}a${n(r)} ${n(r)} 0 0 1 0 ${n(height)}h${n(-straight)}a${n(r)} ${n(r)} 0 0 1 0 ${n(-height)}z`;
}

/**
 * Half a chain, starting at the crossing (x = 0) and running along +x. Face-on links
 * alternate with links standing on edge; each kind is one path, so a whole half is six
 * elements. Gradients are per bounding box, and every link shares the same height, so
 * each wire gets its own lacquer highlight on top and a latex-pink rim underneath.
 * The shadow the chain casts on the photo is one band with a soft gradient, not a blur:
 * a blurred element (CSS or SVG) under the card's glare, which has a blend mode, costs
 * every card its own compositing layer, and blurs are slow to repaint.
 */
function chainMarkup() {
  let faces = '';
  let faceGlints = '';
  let bars = '';
  let barShade = '';
  let barGlints = '';
  for (let i = 0; i <= LINKS; i++) {
    const cx = i * PITCH;
    if (i % 2 === 0) {
      faces += stadium(cx, OUTER_L, OUTER_W) + stadium(cx, PITCH, INNER_W);
      faceGlints += `M${n(cx - OUTER_L / 2 + 1.15)} ${n(-OUTER_W / 2 + 0.36)}h${n(OUTER_L * 0.3)}`;
    } else {
      bars += stadium(cx, OUTER_L, BAR);
      barShade += stadium(cx, OUTER_L + 0.5, BAR + 0.9);
      barGlints += `M${n(cx - OUTER_L / 2 + 1)} ${n(-BAR / 2 + 0.3)}h${n(OUTER_L * 0.34)}`;
    }
  }
  return `
    <rect y="-2.3" width="${n(LINKS * PITCH + OUTER_L / 2)}" height="6.6" fill="url(#fy-cast)"/>
    <path d="${faces}" fill="url(#fy-link)" fill-rule="evenodd" stroke="#000" stroke-opacity=".55" stroke-width=".12"/>
    <path d="${faceGlints}" fill="none" stroke="#fff" stroke-width=".26" stroke-linecap="round"/>
    <path d="${barShade}" fill="#050304" opacity=".38"/>
    <path d="${bars}" fill="url(#fy-bar)" stroke="#000" stroke-opacity=".6" stroke-width=".1"/>
    <path d="${barGlints}" fill="none" stroke="#fff" stroke-width=".22" stroke-linecap="round"/>`;
}

const SPRITE = () => `<svg xmlns="http://www.w3.org/2000/svg" class="chains-sprite" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="fy-link" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1c1318"/><stop offset=".035" stop-color="#6e5b65"/><stop offset=".065" stop-color="#fff"/>
    <stop offset=".095" stop-color="#6e5b65"/><stop offset=".14" stop-color="#150d11"/><stop offset=".25" stop-color="#050304"/>
    <stop offset=".3" stop-color="#2b1d25"/><stop offset=".33" stop-color="#0b0709"/><stop offset=".67" stop-color="#0b0709"/>
    <stop offset=".7" stop-color="#3b2a33"/><stop offset=".735" stop-color="#140c10"/><stop offset=".88" stop-color="#040203"/>
    <stop offset=".945" stop-color="#2a0715"/><stop offset=".975" stop-color="#8c1d46"/><stop offset="1" stop-color="#1a040c"/>
  </linearGradient>
  <linearGradient id="fy-bar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#150d11"/><stop offset=".08" stop-color="#8a7680"/><stop offset=".15" stop-color="#fff"/>
    <stop offset=".24" stop-color="#4a3942"/><stop offset=".4" stop-color="#0d080b"/><stop offset=".76" stop-color="#040203"/>
    <stop offset=".88" stop-color="#300817"/><stop offset=".95" stop-color="#861c44"/><stop offset="1" stop-color="#1a040c"/>
  </linearGradient>
  <linearGradient id="fy-brass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fdebb8"/><stop offset=".2" style="stop-color: var(--gold)"/><stop offset=".48" stop-color="#d3a24c"/>
    <stop offset=".74" style="stop-color: var(--gold-2)"/><stop offset="1" stop-color="#6f4a14"/>
  </linearGradient>
  <linearGradient id="fy-brass-sheen" x1="0" y1="0" x2="1" y2="1">
    <stop offset=".24" stop-color="#fff" stop-opacity="0"/><stop offset=".34" stop-color="#fffaf0" stop-opacity=".6"/>
    <stop offset=".42" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".76" stop-color="#fff" stop-opacity=".18"/><stop offset=".8" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="fy-cast" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1e0610" stop-opacity="0"/><stop offset=".3" stop-color="#1e0610" stop-opacity=".08"/>
    <stop offset=".52" stop-color="#1e0610" stop-opacity=".26"/><stop offset=".66" stop-color="#1e0610" stop-opacity=".24"/>
    <stop offset=".84" stop-color="#1e0610" stop-opacity=".07"/><stop offset="1" stop-color="#1e0610" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="fy-cast-round">
    <stop offset="0" stop-color="#1e0610" stop-opacity=".34"/><stop offset=".62" stop-color="#1e0610" stop-opacity=".2"/>
    <stop offset="1" stop-color="#1e0610" stop-opacity="0"/>
  </radialGradient>
  <symbol id="fy-chain" overflow="visible">${chainMarkup()}</symbol>
  <symbol id="fy-shackle" overflow="visible">
    <path d="M18 47V27a14 14 0 0 1 28 0v20" fill="none" stroke="#1e0610" stroke-width="7.5" stroke-opacity=".14" transform="translate(.8 2.4)"/>
    <path d="M18 47V27a14 14 0 0 1 28 0v20" fill="none" stroke="#050304" stroke-width="7.4"/>
    <path d="M18 47V27a14 14 0 0 1 28 0v20" fill="none" stroke="#2e2228" stroke-width="3" transform="translate(-1.2 -.6)"/>
    <path d="M16.2 45V27.5a15.8 15.8 0 0 1 10.2-14.8" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".92"/>
    <path d="M37.6 13.6a15.6 15.6 0 0 1 11.3 13.6V46" fill="none" style="stroke: var(--latex)" stroke-width=".9" stroke-linecap="round" opacity=".55"/>
  </symbol>
  <symbol id="fy-lockbody" overflow="visible">
    <ellipse cx="33" cy="62.5" rx="34" ry="26" fill="url(#fy-cast-round)"/>
    <rect x="5" y="40" width="54" height="38" rx="8" fill="url(#fy-brass)"/>
    <rect x="5" y="40" width="54" height="38" rx="8" fill="url(#fy-brass-sheen)"/>
    <rect x="7.5" y="41.1" width="49" height="1.5" rx=".75" fill="#fff8e1" opacity=".9"/>
    <rect x="11" y="47" width="42" height="25" rx="4.5" fill="none" stroke="#7a5418" stroke-opacity=".4" stroke-width=".8"/>
    <path d="M58.4 49v21a7.6 7.6 0 0 1-7.6 7.6H16" fill="none" style="stroke: var(--latex)" stroke-width=".8" opacity=".4"/>
    <rect x="5.4" y="40.4" width="53.2" height="37.2" rx="7.6" fill="none" stroke="#4d3209" stroke-opacity=".75" stroke-width=".8"/>
    <path d="M32 51.3a4.4 4.4 0 0 0-2.35 8.12L28.6 67h6.8l-1.05-7.58A4.4 4.4 0 0 0 32 51.3z" fill="#fff4d2" opacity=".55" transform="translate(0 .8)"/>
    <path d="M32 51.3a4.4 4.4 0 0 0-2.35 8.12L28.6 67h6.8l-1.05-7.58A4.4 4.4 0 0 0 32 51.3z" fill="#140b0e"/>
  </symbol>
</defs></svg>`;

const HALF = (width) => `<svg class="chains__half" viewBox="0 -4 ${width} 8" focusable="false"><use href="#fy-chain"/></svg>`;
const OVERLAY = (width) => `<div class="chains" aria-hidden="true">
  <div class="chains__straps">
    <div class="chains__drop chains__drop--b" data-half="b1">${HALF(width)}</div>
    <div class="chains__drop chains__drop--b" data-half="b2">${HALF(width)}</div>
    <svg class="chains__padlock chains__shackle" viewBox="0 0 64 80" focusable="false"><use href="#fy-shackle"/></svg>
    <div class="chains__drop chains__drop--a" data-half="a1">${HALF(width)}</div>
    <div class="chains__drop chains__drop--a" data-half="a2">${HALF(width)}</div>
  </div>
  <div class="chains__lock">
    <svg class="chains__ring" viewBox="0 0 100 100" focusable="false">
      <circle class="chains__track" cx="50" cy="50" r="46"/>
      <g class="chains__arc" transform="rotate(-90 50 50)" stroke-dasharray="${n(RING)} ${n(RING)}">
        <circle class="chains__halo" cx="50" cy="50" r="46"/>
        <circle class="chains__fill" cx="50" cy="50" r="46"/>
      </g>
    </svg>
    <svg class="chains__padlock chains__body" viewBox="0 0 64 80" focusable="false"><use href="#fy-lockbody"/></svg>
    <span class="chains__pct"></span>
  </div>
</div>`;

let spriteReady = false;
const templates = new Map();

function ensureSprite() {
  if (spriteReady) return;
  spriteReady = true;
  document.body.append(fromMarkup(SPRITE()));
}

function fromMarkup(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim(); // static markup written here, never user data
  return tpl.content.firstElementChild;
}

/** The chain units across one half: fewer, bigger links on cards; finer ones in the modal. */
function template(large) {
  const key = large ? 'lg' : 'card';
  if (!templates.has(key)) templates.set(key, fromMarkup(OVERLAY(large ? 112 : 86)));
  return templates.get(key);
}

/**
 * The chains for a locked photo: `progress` 0–1 fills the ring; `unpriced` leaves it
 * empty with a “?”. `large` is the modal's finer chain.
 */
export function chainOverlay({ progress = 0, unpriced = false, large = false } = {}) {
  ensureSprite();
  const node = template(large).cloneNode(true);
  if (large) node.classList.add('chains--lg');
  setRing(node, progress, unpriced, null);
  return node;
}

/** Fills the ring (and counts the %) up from empty, as the item's dialog opens. */
export function introChains(node, delay = 0) {
  if (!node || prefersReducedMotion() || node.dataset.state !== 'locked') return;
  animateRing(node, RING, delay);
}

/**
 * Carries the chains of a card or modal photo that's being rebuilt over to its
 * replacement: the ring then slides from its old value instead of jumping (or, with
 * `slide: false` for a card nobody can see, just takes the new one), and if the
 * replacement has no chains any more (it just unlocked), they snap off.
 */
export function carryChains(from, to, { slide = true } = {}) {
  const old = from?.querySelector('.chains');
  if (!old || !to) return;
  const next = to.querySelector('.chains');
  const photo = '.card__media, .modal__media';
  const host = next?.parentElement || (to.matches(photo) ? to : to.querySelector(photo));
  if (!host) return;
  if (old.classList.contains('is-snapping')) { // mid-snap already: let it finish in its new home
    next?.remove();
    host.append(old);
    host.classList.add('is-unchaining');
    return;
  }
  if (next) {
    next.replaceWith(old);
    setRing(old, Number(next.dataset.p), next.dataset.state === 'unpriced', slide ? ringNow(old) : null);
    return;
  }
  host.append(old);
  snapChains(old);
}

/**
 * New numbers for the chains already on a photo, updated in place: the ring slides from
 * where it is (or, with `slide: false` for a card nobody can see, just takes the value).
 */
export function patchChains(host, { progress = 0, unpriced = false } = {}, { slide = true } = {}) {
  const node = host?.querySelector(':scope > .chains');
  if (!node || node.classList.contains('is-snapping')) return;
  setRing(node, progress, unpriced, slide ? ringNow(node) : null);
}

/**
 * The unlock: the shackle pops, both chains break at the lock and drop out of frame,
 * the lock falls after them; then the overlay is gone. ~900 ms, a quick fade when the
 * visitor prefers reduced motion.
 */
export function snapChains(node) {
  if (!node || node.classList.contains('is-snapping')) return;
  node.classList.add('is-snapping');
  const host = node.parentElement;
  host?.classList.add('is-unchaining');
  const finish = () => {
    node.remove();
    setTimeout(() => host?.classList.remove('is-unchaining'), 700);
  };
  if (typeof node.animate !== 'function') { finish(); return; }
  if (prefersReducedMotion()) {
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'linear', fill: 'forwards' }).finished.then(finish, finish);
    return;
  }

  const $ = (selector) => node.querySelector(selector);
  const opts = (duration, delay, easing) => ({ duration, delay, easing, fill: 'both' });
  const running = [];
  const play = (target, keyframes, options) => { if (target) running.push(target.animate(keyframes, options)); };

  // the ring flares full and fades; the % hits 100 and goes with it
  const from = ringNow(node);
  stopRing(node);
  play($('.chains__arc'), [{ strokeDashoffset: `${n(from)}px` }, { strokeDashoffset: '0px' }], opts(160, 0, EASE_OUT));
  play($('.chains__pct'), [{ '--pct': pctAt(from) }, { '--pct': 100 }], opts(160, 0, EASE_OUT));
  play($('.chains__ring'), [
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(1.12)', opacity: 1, offset: 0.35 },
    { transform: 'scale(1.5)', opacity: 0 },
  ], opts(520, 60, EASE_OUT));
  play($('.chains__pct'), [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(40%)' }], opts(200, 0, 'ease-out'));

  // a flash where the lock gives
  const spark = document.createElement('i');
  spark.className = 'chains__spark';
  $('.chains__lock').prepend(spark);
  play(spark, [
    { transform: 'scale(.2)', opacity: 0 },
    { transform: 'scale(1)', opacity: 1, offset: 0.25 },
    { transform: 'scale(1.8)', opacity: 0 },
  ], opts(560, 80, EASE_OUT));

  // (each keyframe's easing shapes the segment after it: a snap up, then gravity)
  // shackle pops open on its right leg, then falls with the body
  play($('.chains__shackle'), [
    { transform: 'translate(0, 0) rotate(0deg)', opacity: 1, easing: EASE_BACK },
    { transform: 'translate(0, -16%) rotate(0deg)', opacity: 1, offset: 0.16, easing: 'ease-in-out' },
    { transform: 'translate(0, -16%) rotate(-24deg)', opacity: 1, offset: 0.3, easing: EASE_IN },
    { transform: 'translate(-6%, 150%) rotate(-38deg)', opacity: 0 },
  ], opts(860, 0, 'linear'));
  play($('.chains__body'), [
    { transform: 'translate(0, 0) rotate(0deg)', opacity: 1, easing: 'ease-out' },
    { transform: 'translate(0, -3%) rotate(-3deg)', opacity: 1, offset: 0.18, easing: EASE_IN },
    { transform: 'translate(4%, 150%) rotate(16deg)', opacity: 0 },
  ], opts(820, 80, 'linear'));

  // the four half-chains recoil outward from the break, then drop out of frame
  node.querySelectorAll('.chains__drop').forEach((drop, i) => {
    const right = drop.dataset.half === 'a1' || drop.dataset.half === 'b1';
    const dir = right ? 1 : -1;
    const up = drop.dataset.half === 'a2' || drop.dataset.half === 'b1';
    play(drop, [
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1, easing: EASE_OUT },
      { transform: `translate(${dir * 3}cqw, ${up ? -2 : -0.5}cqh) rotate(${dir * -2}deg)`, opacity: 1, offset: 0.2, easing: EASE_IN },
      { transform: `translate(${dir * 10}cqw, 85cqh) rotate(${dir * (up ? 34 : 18)}deg)`, opacity: 0 },
    ], opts(700, 110 + i * 40, 'linear'));
  });

  Promise.all(running.map((a) => a.finished)).then(finish, finish);
}

/* ── internals ── */

const offsetFor = (p) => RING * (1 - p);
const pctAt = (offset) => Math.floor((1 - offset / RING) * 100 + 1e-6);

/**
 * Where the ring is drawn right now (its dash offset), worked out from the animation this
 * module started rather than read back from the style engine: the list patches cards in a
 * loop, and a getComputedStyle() per card would force a style and layout pass each time.
 */
function ringNow(node) {
  const anim = node.querySelector('.chains__arc')._ring;
  if (anim && (anim.playState === 'running' || anim.playState === 'paused')) {
    const { progress } = anim.effect.getComputedTiming();
    return anim.from + (anim.to - anim.from) * (progress ?? 0);
  }
  return offsetFor(Number(node.dataset.p) || 0);
}

function stopRing(node) {
  const arc = node.querySelector('.chains__arc');
  const label = node.querySelector('.chains__pct');
  arc._ring?.cancel();
  label._count?.cancel();
  arc._ring = null;
  label._count = null;
}

/**
 * Slides the ring's dash, and counts the % with it, from `from` (a dash offset) to the
 * resting value setRing() left inline. The % is a CSS counter on a registered integer
 * property (css/chains.css), so the count runs in the style engine, not in a JS loop.
 */
function animateRing(node, from, delay = 0) {
  stopRing(node);
  const arc = node.querySelector('.chains__arc');
  const label = node.querySelector('.chains__pct');
  const to = offsetFor(Number(node.dataset.p));
  if (!arc.animate || prefersReducedMotion() || Math.abs(from - to) < 0.5) return;
  const timing = { duration: FILL_MS, delay, easing: EASE_OUT, fill: 'backwards' };
  arc._ring = Object.assign(arc.animate([{ strokeDashoffset: `${n(from)}px` }, { strokeDashoffset: `${n(to)}px` }], timing), { from, to });
  if (node.dataset.state === 'locked') label._count = label.animate([{ '--pct': pctAt(from) }, { '--pct': Number(node.dataset.pct) }], timing);
}

function setRing(node, progress, unpriced, from) {
  const p = unpriced ? 0 : clamp(Number(progress) || 0);
  const pct = Math.floor(p * 100);
  node.dataset.state = unpriced ? 'unpriced' : 'locked';
  node.dataset.p = String(p);
  node.dataset.pct = String(pct);
  node.toggleAttribute('data-empty', pct < 1); // the ring stays empty while the label reads 0%

  node.querySelector('.chains__arc').style.strokeDashoffset = `${n(offsetFor(p))}px`;
  node.querySelector('.chains__pct').style.setProperty('--pct', String(pct));
  if (from !== null) animateRing(node, from);
  else stopRing(node);
}
