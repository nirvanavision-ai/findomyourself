/* A custom cursor (desktop only) and magnetic, fill-from-the-pointer buttons. */
import { $ } from '../lib/dom.js';
import { onFrame } from '../lib/loop.js';
import { damp, isTouch, prefersReducedMotion } from '../lib/motion.js';
import { sound } from '../audio.js';

const pointer = { x: -100, y: -100, active: false };
export const pointerState = () => pointer;

export function initCursor() {
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  }, { passive: true });

  if (isTouch() || prefersReducedMotion()) return;
  const root = $('#cursor');
  const dot = root.querySelector('.cursor__dot');
  const ring = root.querySelector('.cursor__ring');
  const label = $('#cursor-label');
  document.documentElement.classList.add('has-cursor');
  const ringPos = { x: -100, y: -100 };

  onFrame((t, dt) => {
    ringPos.x = damp(ringPos.x, pointer.x, 14, dt);
    ringPos.y = damp(ringPos.y, pointer.y, 14, dt);
    dot.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
    ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`;
  }, 10);

  document.addEventListener('pointerover', (e) => {
    const hide = e.target.closest('[data-cursor-hide]');
    root.classList.toggle('is-hidden', Boolean(hide));
    const hit = e.target.closest('a, button, select, [data-cursor]');
    root.classList.toggle('is-hover', Boolean(hit) && !hide);
    label.textContent = hit ? (hit.dataset.cursor || (hit.classList.contains('card__hit') ? 'View' : '')) : '';
    if (hit && !hide) sound.tick();
  });
  document.addEventListener('pointerdown', () => root.classList.add('is-down'));
  document.addEventListener('pointerup', () => root.classList.remove('is-down'));
  document.documentElement.addEventListener('pointerleave', () => root.classList.add('is-hidden'));
  document.documentElement.addEventListener('pointerenter', () => root.classList.remove('is-hidden'));
}

/** Buttons fill from where the pointer enters and lean toward it a little. */
export function initButtons(root = document) {
  const magnetic = !isTouch() && !prefersReducedMotion();
  root.addEventListener('pointermove', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    btn.style.setProperty('--mx', `${x}px`);
    btn.style.setProperty('--my', `${y}px`);
    if (magnetic) btn.style.transform = `translate3d(${(x - r.width / 2) * 0.12}px, ${(y - r.height / 2) * 0.22}px, 0)`;
  });
  root.addEventListener('pointerout', (e) => {
    const btn = e.target.closest('.btn');
    if (btn && !btn.contains(e.relatedTarget)) btn.style.transform = '';
  });
}
