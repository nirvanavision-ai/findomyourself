/* Motion math shared by the UI and the WebGL scenes. */

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedQuery.matches;
export const isTouch = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;

export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent smoothing toward a target. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const mapRange = (v, inMin, inMax, outMin, outMax) => outMin + (outMax - outMin) * clamp((v - inMin) / (inMax - inMin));

export const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

/** requestAnimationFrame tween. Returns a function that cancels it. */
export function tween({ duration = 1000, easing = ease.outCubic, onUpdate, onDone }) {
  if (prefersReducedMotion()) duration = 1;
  const start = performance.now();
  let raf = 0;
  const step = (now) => {
    const t = clamp((now - start) / duration);
    onUpdate(easing(t), t);
    if (t < 1) raf = requestAnimationFrame(step);
    else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Animates a number shown in `node` from its last value to `to`. */
export function countTo(node, to, format, duration = 1600) {
  const from = Number(node.dataset.value ?? 0);
  node.dataset.value = to;
  node._cancelCount?.();
  if (from === to || !Number.isFinite(from)) {
    node.textContent = format(to);
    return;
  }
  node._cancelCount = tween({
    duration,
    easing: ease.outExpo,
    onUpdate: (t) => { node.textContent = format(lerp(from, to, t)); },
  });
}

export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function onReducedMotionChange(fn) {
  reducedQuery.addEventListener?.('change', fn);
}
