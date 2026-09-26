/*
 * The intro counter. It tracks real work (fonts, the 3D engine, the first frame) and
 * never holds the page hostage: after a few seconds it lets go regardless.
 */
import { $, } from '../lib/dom.js';
import { onFrame } from '../lib/loop.js';
import { damp, prefersReducedMotion } from '../lib/motion.js';

const LINES = [
  'Hiding your credit card…',
  'Counting your excuses…',
  'Polishing the chains…',
  'Checking your receipts…',
  'Judging your screen time…',
  'Warming up the whip…',
];

export function createLoader() {
  const root = $('#loader');
  const count = $('#loader-count');
  const bar = $('#loader-bar');
  const line = $('#loader-line');
  const started = performance.now();
  let target = 0.06;
  let shown = 0;
  let totalWeight = 0;
  let doneWeight = 0;
  let lineIndex = 0;

  const lineTimer = setInterval(() => {
    lineIndex = (lineIndex + 1) % LINES.length;
    line.textContent = LINES[lineIndex];
  }, 720);

  const stop = onFrame((time, dt) => {
    shown = damp(shown, target, 4.2, dt);
    count.textContent = String(Math.round(shown * 100)).padStart(3, '0');
    bar.style.transform = `scaleX(${shown})`;
  });

  return {
    /** Counts a promise toward the progress. Resolves/rejects like the promise. */
    track(promise, weight = 1) {
      totalWeight += weight;
      const settle = () => {
        doneWeight += weight;
        target = Math.max(target, 0.06 + 0.84 * (doneWeight / totalWeight));
      };
      promise.then(settle, settle);
      return promise;
    },

    async finish({ minTime = 1500 } = {}) {
      const wait = prefersReducedMotion() ? 0 : Math.max(0, minTime - (performance.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      target = 1;
      await new Promise((resolve) => {
        const deadline = performance.now() + 900;
        const check = () => (shown > 0.995 || performance.now() > deadline ? resolve() : requestAnimationFrame(check));
        check();
      });
      count.textContent = '100';
      clearInterval(lineTimer);
      line.textContent = 'Kneel.';
      await new Promise((r) => setTimeout(r, prefersReducedMotion() ? 0 : 260));
      root.classList.add('is-done');
      document.documentElement.classList.add('is-loaded');
      setTimeout(() => { stop(); root.remove(); }, 1300);
    },
  };
}
