/* Two crossed latex ribbons of mantras. They run faster the harder you scroll. */
import { $$, el } from '../lib/dom.js';
import { onFrame } from '../lib/loop.js';
import { scrollInfo } from '../lib/scroll.js';
import { prefersReducedMotion, clamp } from '../lib/motion.js';

const MANTRAS = {
  a: ['No work, no treats', 'Pay up, darling', 'Earn it or burn it', 'Stop scrolling, start billing', 'Tribute is due', 'Your card’s safeword is “done”'],
  b: ['Receipts or it didn’t happen', 'Discipline is the new luxury', 'Kneel before your to-do list', 'Lazy is expensive', 'Every hour counts', 'Obey the timer'],
};

export function initRibbons() {
  const tracks = $$('[data-ribbon]');
  const state = tracks.map((track) => {
    const words = MANTRAS[track.dataset.ribbon];
    const group = () => words.flatMap((w) => [el('span', { text: w }), el('b', { text: '✦' })]);
    // Enough copies to cover the widest screens twice, so the loop never shows a gap.
    for (let i = 0; i < 4; i++) track.append(...group());
    return { track, x: 0, width: 0, dir: track.dataset.ribbon === 'a' ? -1 : 1, visible: false };
  });

  const measure = () => state.forEach((r) => { r.width = r.track.scrollWidth / 2; });
  measure();
  window.addEventListener('resize', measure);
  document.fonts?.ready.then(measure);

  const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
    state.forEach((r) => { if (entry.target.contains(r.track)) r.visible = entry.isIntersecting; });
  }));
  io.observe(document.getElementById('ribbons'));

  if (prefersReducedMotion()) return;
  onFrame((t, dt) => {
    const boost = clamp(Math.abs(scrollInfo().velocity) / 900, 0, 4);
    for (const r of state) {
      if (!r.visible || !r.width) continue;
      r.x += r.dir * (46 + boost * 260) * dt;
      if (r.x <= -r.width) r.x += r.width;
      if (r.x > 0) r.x -= r.width;
      r.track.style.transform = `translate3d(${r.x}px, 0, 0)`;
    }
  });
}
