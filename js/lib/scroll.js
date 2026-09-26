/*
 * Smooth scrolling (Lenis) on desktop, native scrolling on touch and for reduced motion.
 * Also: in-page links that land below the fixed nav, and scroll velocity for effects.
 */
import { onFrame } from './loop.js';
import { prefersReducedMotion, isTouch, damp } from './motion.js';

let lenis = null;
const listeners = new Set();
const info = { y: 0, velocity: 0, direction: 0, progress: 0 };
let lastY = 0;

export const scrollInfo = () => info;

export function onScroll(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function initScroll() {
  if (!prefersReducedMotion() && !isTouch()) {
    try {
      const { default: Lenis } = await import('../../assets/vendor/lenis-1.3.26.min.js');
      lenis = new Lenis({ lerp: 0.095, wheelMultiplier: 0.95, smoothWheel: true, autoRaf: false, anchors: false });
      if (new URLSearchParams(location.search).has('debug')) window.__lenis = lenis;
    } catch {
      lenis = null;
    }
  }
  onFrame((time, dt) => {
    lenis?.raf(time);
    const y = window.scrollY;
    const raw = (y - lastY) / Math.max(dt, 1 / 240);
    lastY = y;
    info.velocity = damp(info.velocity, raw, 10, dt);
    if (Math.abs(raw) > 1) info.direction = Math.sign(raw);
    info.y = y;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    info.progress = max > 0 ? y / max : 0;
    for (const fn of listeners) fn(info, dt);
  }, -100);

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey) return;
    const id = link.getAttribute('href').slice(1);
    const target = id === 'top' ? document.body : document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    scrollToTarget(target);
    history.replaceState(null, '', id === 'top' ? location.pathname + location.search : '#' + id);
  });
}

export function scrollToTarget(target, { immediate = false } = {}) {
  const nav = document.getElementById('nav')?.offsetHeight || 0;
  const offset = target === document.body ? 0 : -nav + 1;
  if (lenis) {
    lenis.scrollTo(target === document.body ? 0 : target, { offset, immediate, duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
  } else {
    const top = target === document.body ? 0 : target.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: immediate || prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}

export function lockScroll(locked) {
  if (lenis) (locked ? lenis.stop() : lenis.start());
  document.documentElement.style.overflow = locked ? 'hidden' : '';
}
