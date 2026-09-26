/*
 * Every sound on the site is synthesized with WebAudio: no audio files to download.
 * Sound starts off; the nav toggle turns it on and remembers the choice.
 */

const STORE_KEY = 'findom:sound';
let ctx = null;
let master = null;
let noise = null;
let enabled = false;
let pad = null;
const lastPlayed = new Map();

function remembered() {
  try { return localStorage.getItem(STORE_KEY) === 'on'; } catch { return false; }
}

function remember(on) {
  try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

function ensure() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp).connect(ctx.destination);
  const length = ctx.sampleRate * 1.5;
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Skips a sound if the same one played less than `gap` ms ago (coins can land in bursts). */
function throttle(name, gap) {
  const t = performance.now();
  if (t - (lastPlayed.get(name) || 0) < gap) return false;
  lastPlayed.set(name, t);
  return true;
}

function ready() {
  if (!enabled || !ensure()) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

function noiseSource() {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.loopStart = Math.random();
  return src;
}

function env(gainNode, t, attack, peak, decay) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export const sound = {
  get on() { return enabled; },

  init(toggle) {
    enabled = remembered();
    const render = () => {
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.querySelector('.sound__label').textContent = enabled ? 'Sound on' : 'Sound off';
      toggle.setAttribute('aria-label', enabled ? 'Turn sound off' : 'Turn sound on');
    };
    toggle.addEventListener('click', () => {
      enabled = !enabled;
      remember(enabled);
      render();
      if (enabled) {
        ready();
        this.chime();
        this.ambient(true);
      } else {
        this.ambient(false);
      }
    });
    render();
    // Browsers only allow audio after a gesture: resume on the first one if sound was left on.
    const unlock = () => {
      if (enabled && ready()) this.ambient(true);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  },

  /** A whip crack: a hard noise transient, a bright snap and a low thwack. */
  crack(intensity = 1) {
    if (!ready() || !throttle('crack', 70)) return;
    const t = ctx.currentTime;
    const src = noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900 + Math.random() * 500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 3200;
    bp.gain.value = 9;
    const g = ctx.createGain();
    env(g, t, 0.0015, 0.9 * intensity, 0.11);
    src.connect(hp).connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.2);

    const snap = ctx.createOscillator();
    snap.type = 'square';
    snap.frequency.setValueAtTime(2400, t);
    snap.frequency.exponentialRampToValueAtTime(600, t + 0.03);
    const sg = ctx.createGain();
    env(sg, t, 0.001, 0.12 * intensity, 0.035);
    snap.connect(sg).connect(master);
    snap.start(t);
    snap.stop(t + 0.06);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(140, t);
    thud.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const tg = ctx.createGain();
    env(tg, t, 0.002, 0.35 * intensity, 0.14);
    thud.connect(tg).connect(master);
    thud.start(t);
    thud.stop(t + 0.2);
  },

  /** A small gold coin landing: two inharmonic partials and a tick. */
  coin(volume = 1) {
    if (!ready() || !throttle('coin', 55)) return;
    const t = ctx.currentTime;
    const f = 2300 + Math.random() * 1400;
    for (const [ratio, gain, decay] of [[1, 0.07, 0.22], [2.76, 0.035, 0.12], [5.4, 0.015, 0.06]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      env(g, t, 0.001, gain * volume, decay);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  },

  /** Receipt printer: a burst of tiny filtered ticks. */
  print(lines = 1) {
    if (!ready() || !throttle('print', 300)) return;
    const t = ctx.currentTime;
    const ticks = Math.min(60, 18 * lines);
    for (let i = 0; i < ticks; i++) {
      const src = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600 + Math.random() * 600;
      bp.Q.value = 3;
      const g = ctx.createGain();
      const at = t + i * 0.016;
      env(g, at, 0.001, 0.05, 0.012);
      src.connect(bp).connect(g).connect(master);
      src.start(at);
      src.stop(at + 0.03);
    }
  },

  /** A small bell arpeggio for unlocks and turning sound on. */
  chime() {
    if (!ready() || !throttle('chime', 400)) return;
    const t = ctx.currentTime;
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      env(g, t + i * 0.085, 0.004, 0.06, 0.9);
      o.connect(g).connect(master);
      o.start(t + i * 0.085);
      o.stop(t + i * 0.085 + 1);
    });
  },

  tick() {
    if (!ready() || !throttle('tick', 45)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1900;
    const g = ctx.createGain();
    env(g, t, 0.001, 0.018, 0.03);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.05);
  },

  /** A low, slow minor pad under everything while sound is on. */
  ambient(on) {
    if (on) {
      if (!ready() || pad) return;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.05, t + 4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      lp.Q.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(lp.frequency);
      lfo.start();
      const oscs = [];
      for (const f of [55, 110, 130.81, 164.81, 196]) { // A1 A2 C3 E3 G3
        for (const detune of [-7, 6]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = detune;
          const g = ctx.createGain();
          g.gain.value = f < 100 ? 0.5 : 0.22;
          o.connect(g).connect(lp);
          o.start();
          oscs.push(o);
        }
      }
      lp.connect(out).connect(master);
      pad = { out, oscs, lfo };
    } else if (pad && ctx) {
      const { out, oscs, lfo } = pad;
      pad = null;
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); }, 1400);
    }
  },
};
