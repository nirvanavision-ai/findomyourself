/*
 * The 3D stage: one full-screen canvas behind the page. Objects are anchored to DOM
 * elements (the card to the hero, the jar to the vault, the whip to its arena), the silk
 * background changes color per section, and quality adapts to the device.
 */
import { WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, SRGBColorSpace, ACESFilmicToneMapping, Vector2, Color } from './three.js';
import { onFrame } from '../lib/loop.js';
import { scrollInfo } from '../lib/scroll.js';
import { pointerState } from '../ui/cursor.js';
import { sound } from '../audio.js';
import { $, el } from '../lib/dom.js';
import { clamp, damp } from '../lib/motion.js';
import { Viewport, Anchor } from './anchor.js';
import { createEnvironment } from './env.js';
import { createSilk } from './silk.js';
import { createCard } from './card.js';
import { createJar } from './jar.js';
import { createWhip } from './whip.js';
import { createDust } from './dust.js';
import { createPost } from './post.js';

export async function createStage({ canvas, getState, subscribe, onCrack, reducedMotion }) {
  const quality = pickQuality();
  // ?still renders the objects alone on a transparent canvas: used to make the fallback images
  const still = new URLSearchParams(location.search).has('still');
  if (still) Object.assign(quality, { post: false, dust: 0, transmission: false });
  await fontsForCanvas();

  const renderer = new WebGLRenderer({
    canvas,
    antialias: !quality.post,
    alpha: still,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: still,
  });
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setClearColor(new Color('#0b0709'), still ? 0 : 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 14);
  const viewport = new Viewport(camera);
  viewport.update();

  scene.environment = createEnvironment(renderer);
  const key = new DirectionalLight(new Color('#fff1e8'), 1.4);
  key.position.set(-4, 6, 8);
  scene.add(key);

  const silk = createSilk(renderer, { scale: quality.silkScale });
  if (!still) scene.add(silk.mesh);
  const dust = createDust({ count: reducedMotion ? 0 : quality.dust });
  scene.add(dust.points);

  const card = createCard({ anchor: new Anchor($('#hero-anchor')), renderer, reducedMotion });
  scene.add(card.group);
  const jar = createJar({ anchor: new Anchor($('#vault-anchor')), quality, sound, reducedMotion });
  scene.add(jar.group);

  const post = createPost(renderer, scene, camera, quality);
  const arena = $('#whip-arena');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const grab = coarse ? el('div', { class: 'whip__grab', 'aria-hidden': 'true' }) : null;
  if (grab) arena.append(grab);
  const whip = createWhip({
    arena,
    grab,
    viewport,
    reducedMotion,
    onCrack,
    onShock: (uv, power) => post.shock(uv, power),
  });
  scene.add(whip.group);

  const apply = (s) => {
    card.setState(s);
    jar.setState(s);
    whip.group.visible = s.settings.whip !== false;
  };
  apply(getState());
  subscribe(apply);

  const tones = [...document.querySelectorAll('[data-tone]')];
  const weights = {};
  const pointerUv = new Vector2(0.5, 0.5);
  let press = 0;
  let lastScroll = 0;
  let fade = 0;
  let introStarted = false;

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    viewport.update();
    silk.resize(w, h);
    post.setSize(w, h);
  };
  resize();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  // Frame-time watchdog: if the device struggles, trade sparkle for smoothness.
  const perf = { frames: 0, time: 0, stage: 0 };
  const degrade = () => {
    perf.stage += 1;
    if (perf.stage === 1) post.setBloom(false);
    if (perf.stage === 2) { renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.75)); resize(); }
    if (perf.stage === 3) quality.silkEveryOther = true;
  };

  let running = true;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    document.documentElement.classList.add('no-webgl');
    document.documentElement.classList.remove('gl-ready');
  });

  const render = (time, dt) => {
    if (!running) return;
    const t = time / 1000;
    viewport.update();

    // section colors: how much of the middle of the screen each section covers
    const vh = viewport.height;
    let total = 0;
    for (const node of tones) {
      const r = node.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(r.bottom, vh * 0.75) - Math.max(r.top, vh * 0.25));
      weights[node.dataset.tone] = overlap;
      total += overlap;
    }
    for (const k of Object.keys(weights)) weights[k] = total ? weights[k] / total : (k === 'hero' ? 1 : 0);

    const ptr = pointerState();
    pointerUv.set(ptr.x / viewport.width, 1 - ptr.y / viewport.height);
    const scroll = scrollInfo();
    press = damp(press, clamp(Math.abs(scroll.y - lastScroll) * 0.02, 0, 0.6) + (ptr.active ? 0.35 : 0), 3, dt);
    lastScroll = scroll.y;
    fade = damp(fade, 1, 1.5, dt);
    silk.setFade(fade);
    silk.update(dt, {
      time: t,
      pointer: pointerUv,
      press,
      scroll: (scroll.y / vh) * 0.35,
      weights,
      everyOther: quality.silkEveryOther,
    });
    dust.update(t, { scrollWorld: scroll.y * viewport.unit, viewport, pixelRatio: renderer.getPixelRatio(), alpha: fade });

    const normPointer = { x: (ptr.x / viewport.width - 0.5) * 2, y: (ptr.y / viewport.height - 0.5) * 2 };
    card.update(t, dt, { viewport, pointer: ptr.active ? normPointer : { x: 0, y: 0 } });
    jar.update(t, dt, { viewport, pointer: { clientX: ptr.x, clientY: ptr.y } });
    whip.update(t, dt);
    post.render(dt);

    if (introStarted && perf.stage < 3) {
      perf.frames += 1;
      perf.time += dt;
      if (perf.frames === 120) {
        if (perf.time / perf.frames > 1 / 38) degrade();
        perf.frames = 0;
        perf.time = 0;
      }
    }
  };

  // Compile every shader before the curtain lifts, so the first seconds don't stutter.
  try {
    await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    // compileAsync is an optimization; rendering compiles lazily anyway
  }
  render(performance.now(), 1 / 60);
  onFrame(render, 50);

  return {
    quality,
    jarCapacity: jar.capacity,
    intro() {
      introStarted = true;
      card.intro();
    },
  };
}

function pickQuality() {
  const params = new URLSearchParams(location.search);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    gpu = '';
  }
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu);
  let tier = 2;
  if (coarse || cores <= 4 || memory <= 4) tier = 1;
  if (software || navigator.connection?.saveData || (coarse && memory <= 2)) tier = 0;
  const forced = { low: 0, mid: 1, high: 2 }[params.get('quality')];
  if (forced !== undefined) tier = forced;
  const tiers = [
    { name: 'low', dpr: Math.min(dpr, 1.25), post: false, bloom: false, msaa: 0, transmission: false, dust: 160, silkScale: 0.3, silkEveryOther: true },
    { name: 'mid', dpr: Math.min(dpr, 1.6), post: true, bloom: true, msaa: 2, transmission: true, dust: 360, silkScale: 0.36, silkEveryOther: false },
    { name: 'high', dpr: Math.min(dpr, 2), post: true, bloom: true, msaa: 4, transmission: true, dust: 620, silkScale: 0.45, silkEveryOther: false },
  ];
  return { ...tiers[tier], tier, gpu };
}

/** Canvas text needs the web fonts loaded first, or the card prints in Times. */
function fontsForCanvas() {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = ['italic 500 100px "Bodoni Moda"', '600 100px "Bodoni Moda"', '800 100px "Archivo"', '600 100px "Archivo"', '500 100px "JetBrains Mono"'];
  return Promise.race([
    Promise.all(faces.map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]).catch(() => {});
}
