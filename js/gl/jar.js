/*
 * The vault: a glass tribute jar that fills with gold coins toward the current goal.
 * Where each coin comes to rest is worked out once (a seeded heightfield pile), so the
 * heap looks the same on every visit; coins then fall into those spots with gravity, a
 * tumble, a bounce and a clink. Spending takes coins off the top.
 */
import {
  Group, Mesh, InstancedMesh, LatheGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry, Vector2, Vector3,
  Quaternion, Euler, Matrix4, Color, MeshStandardMaterial, MeshPhysicalMaterial, ShaderMaterial, CanvasTexture,
  SRGBColorSpace, RepeatWrapping, DynamicDrawUsage,
} from './three.js';
import { drawCoinFace, drawCoinEdge, drawJarLabel } from './textures.js';
import { damp, clamp } from '../lib/motion.js';

const COIN_R = 0.155;
const COIN_T = 0.042;
const INNER_R = 0.672;
const FLOOR = 0.066;
const FULL_HEIGHT = 1.52;
const JAR_HEIGHT = 2.12;
const GRAVITY = 11;

export function createJar({ anchor, quality, sound, reducedMotion }) {
  const group = new Group();
  const tilt = new Group();
  group.add(tilt);

  /* ── glass ── */
  const outer = [[0, 0], [0.56, 0], [0.645, 0.02], [0.69, 0.075], [0.702, 0.2], [0.702, 1.62], [0.684, 1.76], [0.625, 1.86], [0.555, 1.92], [0.532, 1.99], [0.556, 2.05], [0.562, 2.1], [0.548, JAR_HEIGHT]];
  const inner = [[0.532, 2.1], [0.516, 2.02], [0.526, 1.94], [0.6, 1.86], [0.656, 1.76], [0.674, 1.62], [0.674, 0.2], [0.662, 0.1], [0.62, 0.078], [0.55, FLOOR], [0, FLOOR]];
  const profile = [...outer, ...inner].map(([x, y]) => new Vector2(x, y));
  const glassMaterial = quality.transmission
    ? new MeshPhysicalMaterial({
      color: new Color('#fff4f6'), metalness: 0, roughness: 0.035, transmission: 1, thickness: 0.22, ior: 1.5,
      attenuationColor: new Color('#ffe0ea'), attenuationDistance: 5, specularIntensity: 1, envMapIntensity: 1.9,
      clearcoat: 0.6, clearcoatRoughness: 0.04, iridescence: 0.25, iridescenceIOR: 1.3,
    })
    : new MeshPhysicalMaterial({
      color: new Color('#ffe6ee'), metalness: 0, roughness: 0.06, transparent: true, opacity: 0.26,
      envMapIntensity: 1.6, specularIntensity: 1, depthWrite: false,
    });
  const glass = new Mesh(new LatheGeometry(profile, 96), glassMaterial);
  glass.renderOrder = 2;
  tilt.add(glass);

  const rim = new Mesh(new TorusGeometry(0.552, 0.022, 14, 96), new MeshStandardMaterial({ color: new Color('#e2b25e'), metalness: 1, roughness: 0.22 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = JAR_HEIGHT - 0.004;
  tilt.add(rim);

  const labelTexture = new CanvasTexture(drawJarLabel());
  labelTexture.colorSpace = SRGBColorSpace;
  const labelArc = 1.55;
  const label = new Mesh(
    new CylinderGeometry(0.708, 0.708, 0.43, 64, 1, true, -labelArc / 2, labelArc),
    new MeshStandardMaterial({ map: labelTexture, roughness: 0.75, metalness: 0 }),
  );
  label.position.y = 0.52;
  tilt.add(label);

  const shadow = new Mesh(new PlaneGeometry(2.6, 2.6), new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.1, d) * 0.55; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.01;
  tilt.add(shadow);

  /* ── coins ── */
  const faceBump = new CanvasTexture(drawCoinFace(512));
  const edgeBump = new CanvasTexture(drawCoinEdge());
  edgeBump.wrapS = RepeatWrapping;
  edgeBump.repeat.set(3, 1);
  const goldBase = { color: new Color('#f2bd55'), metalness: 1, roughness: 0.24, envMapIntensity: 1.4 };
  const coinGeometry = new CylinderGeometry(COIN_R, COIN_R, COIN_T, 40, 1);
  const coinMaterials = [
    new MeshStandardMaterial({ ...goldBase, bumpMap: edgeBump, bumpScale: 1.5 }),
    new MeshStandardMaterial({ ...goldBase, bumpMap: faceBump, bumpScale: 2.4 }),
    new MeshStandardMaterial({ ...goldBase, bumpMap: faceBump, bumpScale: 2.4 }),
  ];
  const { slots, capacity } = simulatePile();
  const coins = new InstancedMesh(coinGeometry, coinMaterials, slots.length);
  coins.instanceMatrix.setUsage(DynamicDrawUsage);
  coins.count = 0;
  coins.frustumCulled = false;
  tilt.add(coins);

  const live = []; // per active coin: its animation state
  const m4 = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  const euler = new Euler();

  const state = {
    target: 0,
    poured: false,
    spawnCarry: 0,
    shake: 0,
    shakeVel: 0,
    hover: 0,
    fill: 0,
  };

  const stage = anchor.element.closest('.vault__stage');
  stage?.addEventListener('pointerdown', () => {
    state.shakeVel += 7;
    for (let i = 0; i < 3; i++) setTimeout(() => sound.coin(0.8), i * 70);
  });

  function restMatrix(i) {
    const s = slots[i];
    euler.set(s.rx, s.ry, s.rz);
    quat.setFromEuler(euler);
    pos.set(s.x, s.y, s.z);
    m4.compose(pos, quat, scl.setScalar(1));
    coins.setMatrixAt(i, m4);
  }

  function spawn(i, immediate) {
    const s = slots[i];
    if (immediate || reducedMotion) {
      live[i] = { phase: 'rest' };
      restMatrix(i);
      return;
    }
    const drop = JAR_HEIGHT + 0.15 + Math.random() * 0.45;
    live[i] = {
      phase: 'fall',
      t: 0,
      fallTime: Math.sqrt((2 * (drop - s.y)) / GRAVITY),
      y0: drop,
      x0: s.x * 0.55 + (Math.random() - 0.5) * 0.1,
      z0: s.z * 0.55 + (Math.random() - 0.5) * 0.1,
      spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spinSpeed: 8 + Math.random() * 10,
    };
  }

  function animate(i, dt) {
    const c = live[i];
    const s = slots[i];
    if (!c || c.phase === 'rest') return false;
    c.t += dt;
    euler.set(s.rx, s.ry, s.rz);
    const rest = new Quaternion().setFromEuler(euler);
    if (c.phase === 'fall') {
      const k = Math.min(1, c.t / c.fallTime);
      pos.set(c.x0 + (s.x - c.x0) * k, c.y0 - 0.5 * GRAVITY * c.t * c.t, c.z0 + (s.z - c.z0) * k);
      quat.setFromAxisAngle(c.spin, c.t * c.spinSpeed).slerp(rest, k * k);
      scl.setScalar(1);
      if (k >= 1) {
        c.phase = 'bounce';
        c.t = 0;
        if (Math.random() < 0.55) sound.coin(0.6 + Math.random() * 0.4);
      }
    } else if (c.phase === 'bounce') {
      const k = Math.min(1, c.t / 0.28);
      pos.set(s.x, s.y + Math.abs(Math.sin(k * Math.PI)) * 0.07 * (1 - k), s.z);
      quat.copy(rest);
      scl.setScalar(1);
      if (k >= 1) c.phase = 'rest';
    } else if (c.phase === 'leave') {
      const k = Math.min(1, c.t / 0.4);
      pos.set(s.x, s.y + k * 0.35, s.z);
      quat.copy(rest);
      scl.setScalar(Math.max(0.001, 1 - k));
      if (k >= 1) c.phase = 'gone';
    }
    m4.compose(pos, quat, scl);
    coins.setMatrixAt(i, m4);
    return true;
  }

  return {
    group,
    capacity,
    setState(s) {
      const g = s.goal;
      let fill = 0;
      if (g && !g.priceMissing) fill = g.affordable ? 1.08 : g.progress;
      state.fill = fill;
      state.target = Math.min(slots.length, Math.round(fill * capacity));
      if (fill > 0 && state.target === 0) state.target = 1; // a single coin beats an empty jar
    },
    update(time, dt, { viewport, pointer }) {
      anchor.update(viewport);
      group.visible = anchor.visible;
      if (!group.visible) return;

      const fit = Math.min((anchor.height * 0.78) / JAR_HEIGHT, (anchor.width * 0.74) / 1.5);
      group.position.copy(anchor.center);
      group.position.y -= (JAR_HEIGHT / 2) * fit;
      group.scale.setScalar(fit);

      const r = anchor.rect;
      const over = pointer.clientX > r.left && pointer.clientX < r.right && pointer.clientY > r.top && pointer.clientY < r.bottom;
      state.hover = damp(state.hover, over ? 1 : 0, 4, dt);
      state.shakeVel += (-state.shake * 60 - state.shakeVel * 5) * dt;
      state.shake += state.shakeVel * dt;
      const sway = reducedMotion ? 0 : Math.sin(time * 0.35) * 0.22;
      tilt.rotation.set(0.16 + (reducedMotion ? 0 : Math.sin(time * 0.6) * 0.02), sway + state.hover * 0.35, state.shake * 0.08);

      // Start pouring once the jar is properly on screen.
      if (!state.poured && anchor.progress > 0.18 && anchor.progress < 0.95) state.poured = true;
      if (!state.poured) return;

      let changed = false;
      const active = coins.count;
      if (reducedMotion && active < state.target) {
        for (let i = active; i < state.target; i++) spawn(i, true);
        coins.count = state.target;
        changed = true;
      } else if (active < state.target) {
        const rate = clamp(state.target / 1.7, 40, 260); // coins per second: the whole pour takes ~2s
        state.spawnCarry += rate * dt;
        while (state.spawnCarry >= 1 && coins.count < state.target) {
          state.spawnCarry -= 1;
          spawn(coins.count, false);
          coins.count += 1;
          changed = true;
        }
      } else if (active > state.target) {
        for (let i = state.target; i < active; i++) {
          if (live[i] && live[i].phase !== 'leave' && live[i].phase !== 'gone') {
            live[i] = { phase: 'leave', t: Math.random() * -0.2 };
          }
        }
        while (coins.count > state.target && live[coins.count - 1]?.phase === 'gone') {
          coins.count -= 1;
          changed = true;
        }
      }
      for (let i = 0; i < coins.count; i++) {
        if (animate(i, dt)) changed = true;
      }
      if (changed) coins.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * Pre-computes where coins come to rest: each coin tries a few random spots and takes the
 * lowest, tilted to the local slope, then raises the heightfield under it. Runs until the jar
 * is full (that count is the capacity), plus 15% more for an overflowing heap. Deterministic.
 */
function simulatePile() {
  const rand = mulberry32(20260926);
  const cell = 0.045;
  const half = INNER_R + 0.05;
  const n = Math.ceil((half * 2) / cell);
  const heights = new Float32Array(n * n).fill(FLOOR);
  const inside = [];
  for (let k = 0; k < heights.length; k++) {
    const x = (k % n) * cell - half;
    const z = Math.floor(k / n) * cell - half;
    if (x * x + z * z < (INNER_R - 0.08) ** 2) inside.push(k);
  }
  const idx = (x, z) => {
    const i = Math.floor((x + half) / cell);
    const j = Math.floor((z + half) / cell);
    return i >= 0 && j >= 0 && i < n && j < n ? j * n + i : -1;
  };
  const surfaceAt = (x, z, r = COIN_R * 0.92) => {
    let top = FLOOR;
    for (let dz = -r; dz <= r; dz += cell) {
      for (let dx = -r; dx <= r; dx += cell) {
        if (dx * dx + dz * dz > r * r) continue;
        const k = idx(x + dx, z + dz);
        if (k >= 0 && heights[k] > top) top = heights[k];
      }
    }
    return top;
  };
  const raise = (x, z, h) => {
    for (let dz = -COIN_R; dz <= COIN_R; dz += cell) {
      for (let dx = -COIN_R; dx <= COIN_R; dx += cell) {
        if (dx * dx + dz * dz > COIN_R * COIN_R) continue;
        const k = idx(x + dx, z + dz);
        if (k >= 0 && heights[k] < h) heights[k] = h;
      }
    }
  };
  const averageHeight = () => inside.reduce((sum, k) => sum + heights[k], 0) / inside.length;

  const slots = [];
  let capacity = 0;
  let level = FLOOR;
  while (slots.length < 900 && (!capacity || slots.length < Math.round(capacity * 1.15))) {
    const neck = level > 1.58 ? 0.52 : INNER_R; // past the shoulder, the heap climbs out through the neck
    const maxR = Math.max(0.02, neck - COIN_R - 0.012);
    let best = null;
    for (let t = 0; t < 7; t++) {
      const r = Math.sqrt(rand()) * maxR;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const surf = surfaceAt(x, z);
      const score = surf + rand() * 0.025;
      if (!best || score < best.score) best = { x, z, surf, score };
    }
    const d = 0.12;
    const slopeX = (surfaceAt(best.x + d, best.z, COIN_R * 0.5) - surfaceAt(best.x - d, best.z, COIN_R * 0.5)) / (2 * d);
    const slopeZ = (surfaceAt(best.x, best.z + d, COIN_R * 0.5) - surfaceAt(best.x, best.z - d, COIN_R * 0.5)) / (2 * d);
    const rx = clamp(slopeZ * 0.9 + (rand() - 0.5) * 0.3, -0.55, 0.55);
    const rz = clamp(-slopeX * 0.9 + (rand() - 0.5) * 0.3, -0.55, 0.55);
    const y = best.surf + COIN_T / 2 + Math.max(Math.abs(rx), Math.abs(rz)) * COIN_R * 0.35;
    slots.push({ x: best.x, y, z: best.z, rx, ry: rand() * Math.PI * 2, rz });
    raise(best.x, best.z, y + COIN_T * 0.5);
    level = averageHeight();
    if (!capacity && level >= FULL_HEIGHT) capacity = slots.length;
  }
  return { slots, capacity: capacity || slots.length };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
