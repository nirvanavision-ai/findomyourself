/*
 * The hero: an obsidian credit card wrapped in chrome chains, locked with a brass padlock.
 * The card prints the live vault balance; the padlock springs open whenever something on
 * the list is affordable. Drag to spin it, click to flip it.
 */
import {
  Group, Mesh, Shape, ExtrudeGeometry, ShapeGeometry, TorusGeometry, TubeGeometry, PlaneGeometry, CatmullRomCurve3,
  InstancedMesh, MeshStandardMaterial, MeshPhysicalMaterial, ShaderMaterial, CanvasTexture, SRGBColorSpace,
  AdditiveBlending, DynamicDrawUsage, Matrix4, Quaternion, Vector3, Color, RoundedBoxGeometry,
} from './three.js';
import { drawCardFront, drawCardBack, drawLockFace } from './textures.js';
import { damp, clamp, ease } from '../lib/motion.js';

const W = 3.37;
const H = 2.125;
const R = 0.15;
const DEPTH = 0.028;
const BEVEL = 0.007;
const FACE_Z = DEPTH / 2 + BEVEL + 0.0012;
const LINK = { radius: 0.085, tube: 0.024, stretch: 1.42, pitch: 0.198 };

export function createCard({ anchor, renderer, reducedMotion }) {
  const group = new Group();
  const pivot = new Group();
  const tilt = new Group();
  group.add(tilt);
  tilt.add(pivot);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  /* ── card ── */
  const shape = roundedRect(W, H, R);
  const body = new Mesh(
    new ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 4, curveSegments: 14 }),
    new MeshStandardMaterial({ color: new Color('#d8aa55'), metalness: 1, roughness: 0.26, envMapIntensity: 1.2 }),
  );
  body.geometry.translate(0, 0, -DEPTH / 2);
  pivot.add(body);

  let frontLayers = drawCardFront({ balance: '$0.00', cardholder: 'FUTURE YOU' });
  const frontColor = texture(frontLayers.color[0], true, aniso);
  const frontBump = texture(frontLayers.emboss[0], false, aniso);
  const frontOrm = texture(frontLayers.orm[0], false, aniso);
  const front = new Mesh(faceGeometry(shape), new MeshPhysicalMaterial({
    map: frontColor,
    bumpMap: frontBump,
    bumpScale: 1.6,
    roughnessMap: frontOrm,
    metalnessMap: frontOrm,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    iridescence: 0.75,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [160, 540],
    envMapIntensity: 1.25,
  }));
  front.position.z = FACE_Z;
  pivot.add(front);

  const backLayers = drawCardBack();
  const back = new Mesh(faceGeometry(shape), new MeshPhysicalMaterial({
    map: texture(backLayers.color, true, aniso),
    roughnessMap: texture(backLayers.orm, false, aniso),
    metalnessMap: texture(backLayers.orm, false, aniso),
    roughness: 1,
    metalness: 1,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    iridescence: 0.9,
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: [200, 600],
    envMapIntensity: 1.2,
  }));
  back.rotation.y = Math.PI;
  back.position.z = -FACE_Z;
  pivot.add(back);

  /* ── chains ── */
  const chainSpecs = [
    { angle: 0.19, half: W / 2 / Math.cos(0.19) + 0.03, zf: 0.058 },
    { angle: 1.37, half: H / 2 / Math.sin(1.37) + 0.03, zf: 0.084 },
  ];
  const links = chainSpecs.flatMap((spec) => chainLoop(spec));
  const linkGeometry = new TorusGeometry(LINK.radius, LINK.tube, 10, 26);
  linkGeometry.scale(LINK.stretch, 1, 1);
  const chrome = new MeshStandardMaterial({ color: new Color('#dcdce3'), metalness: 1, roughness: 0.17, envMapIntensity: 1.0 });
  const chains = new InstancedMesh(linkGeometry, chrome, links.length);
  chains.instanceMatrix.setUsage(DynamicDrawUsage);
  pivot.add(chains);

  /* ── padlock ── */
  const lock = createPadlock();
  lock.group.position.set(0, 0.02, chainSpecs[1].zf + 0.13);
  pivot.add(lock.group);

  /* ── a soft glow behind, to lift it off the silk ── */
  const glow = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color('#ff2e6e') }, uStrength: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uStrength; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.4) * uStrength; gl_FragColor = vec4(uColor * a, a); }',
  }));
  glow.scale.set(8.5, 6.5, 1);
  glow.position.z = -1.6;
  group.add(glow);

  /* ── motion state ── */
  const m4 = new Matrix4();
  const q = new Quaternion();
  const wobble = new Quaternion();
  const axis = new Vector3();
  const scaleOne = new Vector3(1, 1, 1);
  const state = {
    introT: reducedMotion ? 1 : 0,
    introPlaying: false,
    spin: 0,
    spinVel: 0,
    settle: 0, // the face the card comes to rest on (a multiple of π), or null while it's spinning freely
    drag: null,
    pointer: { x: 0, y: 0 },
    rattle: 0,
    swing: 0,
    swingVel: 0,
    lastYaw: 0,
    lastBalance: '',
    open: false,
  };

  const writeLinks = (time, amount) => {
    links.forEach((link, i) => {
      axis.copy(link.tangent);
      const jiggle = amount * Math.sin(time * 9 + i * 1.7) * 0.35 + Math.sin(time * 1.3 + i) * 0.03;
      wobble.setFromAxisAngle(axis, jiggle);
      q.copy(link.quat).premultiply(wobble);
      m4.compose(link.pos, q, scaleOne);
      chains.setMatrixAt(i, m4);
    });
    chains.instanceMatrix.needsUpdate = true;
  };
  writeLinks(0, 0);

  bindDrag(anchor.element.closest('.hero'), state);

  return {
    group,
    intro() {
      if (reducedMotion) return;
      state.introT = 0;
      state.introPlaying = true;
      state.rattle = 1.2;
    },
    setState(s) {
      state.open = s.unlocked.length > 0;
      const bal = s.stats.balance;
      const masked = bal === null || new URLSearchParams(location.search).has('still'); // stills never show a real balance
      const text = masked ? '$ ••••.••' : formatBalance(bal, s.settings.baseCurrency);
      if (text !== state.lastBalance) {
        state.lastBalance = text;
        frontLayers = drawCardFront({ balance: text, cardholder: 'FUTURE YOU' }, frontLayers);
        frontColor.needsUpdate = true;
        frontBump.needsUpdate = true;
        frontOrm.needsUpdate = true;
        state.rattle = Math.max(state.rattle, 0.6);
      }
    },
    update(time, dt, { viewport, pointer }) {
      anchor.update(viewport);
      group.visible = anchor.visible;
      if (!group.visible) return;

      if (state.introPlaying) {
        state.introT = Math.min(1, state.introT + dt / 2.3);
        if (state.introT >= 1) state.introPlaying = false;
      }
      const intro = ease.outExpo(state.introT);
      const leave = clamp((anchor.progress - 0.5) * 2.2, 0, 1); // 0 while in the hero, 1 once scrolled past

      const fit = Math.min(anchor.width / 4.35, anchor.height / 3.05);
      group.position.copy(anchor.center);
      group.position.y += Math.sin(time * 0.8) * 0.05 * fit + (1 - intro) * -3.2 * fit + leave * 1.2 * fit;
      group.scale.setScalar(fit * (0.78 + 0.22 * intro) * (1 - leave * 0.18));

      state.pointer.x = damp(state.pointer.x, pointer.x, 3, dt);
      state.pointer.y = damp(state.pointer.y, pointer.y, 3, dt);
      if (!state.drag) {
        state.spinVel *= Math.exp(-dt * 1.6);
        state.spin += state.spinVel * dt;
        if (Math.abs(state.spinVel) < 0.6) { // slow enough: come to rest on the nearest face
          if (state.settle === null) state.settle = Math.round(state.spin / Math.PI) * Math.PI;
          state.spin = damp(state.spin, state.settle, 2.4, dt);
        }
      }
      const idleYaw = reducedMotion ? 0 : Math.sin(time * 0.33) * 0.32;
      const yaw = idleYaw + state.pointer.x * 0.42 + state.spin + (1 - intro) * Math.PI * 2.2 + leave * 1.3;
      const pitch = -0.1 + (reducedMotion ? 0 : Math.sin(time * 0.47) * 0.07) - state.pointer.y * 0.28 + leave * 0.75;
      tilt.rotation.set(pitch, 0, -0.07 + Math.sin(time * 0.27) * 0.04);
      pivot.rotation.y = yaw;

      // chain rattle and the padlock's swing respond to how fast the card turns
      const yawVel = (yaw - state.lastYaw) / Math.max(dt, 1e-3);
      state.lastYaw = yaw;
      state.rattle = Math.max(state.rattle * Math.exp(-dt * 2.5), clamp(Math.abs(yawVel) * 0.12, 0, 1));
      writeLinks(time, state.rattle);
      state.swingVel += (-state.swing * 38 - state.swingVel * 3.2 - yawVel * 0.9) * dt;
      state.swing += state.swingVel * dt;
      lock.group.rotation.z = clamp(state.swing, -0.8, 0.8) * 0.5;
      lock.group.rotation.x = Math.sin(time * 1.1) * 0.05 + clamp(state.swing, -0.8, 0.8) * 0.2;
      lock.update(dt, state.open);
    },
  };
}

function formatBalance(value, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function texture(source, color, anisotropy) {
  const t = new CanvasTexture(source);
  if (color) t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

function roundedRect(w, h, r) {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** A flat card face whose UVs span the whole texture. */
function faceGeometry(shape) {
  const geometry = new ShapeGeometry(shape, 18);
  const uv = geometry.attributes.uv;
  const pos = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + H / 2) / H);
  return geometry;
}

/**
 * One chain wrapped around the card: a stadium-shaped loop in the plane of `angle` and z,
 * with links alternating flat against the card and standing on edge.
 */
function chainLoop({ angle, half, zf }) {
  const dir = new Vector3(Math.cos(angle), Math.sin(angle), 0);
  const Z = new Vector3(0, 0, 1);
  const loopNormal = new Vector3().crossVectors(dir, Z).normalize();
  const total = 4 * half + 2 * Math.PI * zf;
  const count = Math.round(total / LINK.pitch);
  const step = total / count;
  const out = [];
  for (let i = 0; i < count; i++) {
    let d = i * step;
    let s;
    let z;
    let ts;
    let tz;
    if (d < 2 * half) {
      s = -half + d; z = zf; ts = 1; tz = 0;
    } else if ((d -= 2 * half) < Math.PI * zf) {
      const th = Math.PI / 2 - d / zf;
      s = half + Math.cos(th) * zf; z = Math.sin(th) * zf; ts = Math.sin(th); tz = -Math.cos(th);
    } else if ((d -= Math.PI * zf) < 2 * half) {
      s = half - d; z = -zf; ts = -1; tz = 0;
    } else {
      d -= 2 * half;
      const th = (3 * Math.PI) / 2 - d / zf;
      s = -half + Math.cos(th) * zf; z = Math.sin(th) * zf; ts = Math.sin(th); tz = -Math.cos(th);
    }
    const tangent = dir.clone().multiplyScalar(ts).addScaledVector(Z, tz).normalize();
    const pos = dir.clone().multiplyScalar(s).addScaledVector(Z, z);
    const upright = i % 2 === 1;
    const yAxis = upright ? new Vector3().crossVectors(tangent, loopNormal).normalize() : loopNormal.clone();
    if (upright) { // stand the link on the flat ones: push it outward
      const clampS = Math.max(-half, Math.min(half, s));
      const outward = dir.clone().multiplyScalar(s - clampS).addScaledVector(Z, z).normalize();
      pos.addScaledVector(outward, LINK.radius * 0.72);
    }
    const zAxis = new Vector3().crossVectors(tangent, yAxis).normalize();
    const quat = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(tangent, yAxis, zAxis));
    out.push({ pos, quat, tangent });
  }
  return out;
}

function createPadlock() {
  const group = new Group();
  const brass = new MeshStandardMaterial({ color: new Color('#e2b25e'), metalness: 1, roughness: 0.2, envMapIntensity: 1.3 });
  const steel = new MeshStandardMaterial({ color: new Color('#f1f1f5'), metalness: 1, roughness: 0.1, envMapIntensity: 1.4 });

  const body = new Mesh(new RoundedBoxGeometry(0.64, 0.52, 0.2, 5, 0.075), brass);
  body.position.y = -0.4;
  group.add(body);

  const faceTexture = new CanvasTexture(drawLockFace());
  faceTexture.colorSpace = SRGBColorSpace;
  const face = new Mesh(new PlaneGeometry(0.56, 0.45), new MeshStandardMaterial({
    map: faceTexture, transparent: true, metalness: 0.4, roughness: 0.4, depthWrite: false,
  }));
  face.position.set(0, -0.4, 0.1015);
  group.add(face);

  // The shackle hinges on its right leg.
  const hinge = new Group();
  hinge.position.set(0.19, -0.2, 0);
  group.add(hinge);
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI - (i / 24) * Math.PI;
    pts.push(new Vector3(Math.cos(a) * 0.19 - 0.19, 0.2 + Math.sin(a) * 0.19, 0));
  }
  const curve = new CatmullRomCurve3([new Vector3(-0.38, -0.02, 0), ...pts, new Vector3(0, -0.02, 0)]);
  const shackle = new Mesh(new TubeGeometry(curve, 64, 0.046, 14, false), steel);
  hinge.add(shackle);

  let openness = 0;
  let velocity = 0;
  return {
    group,
    update(dt, open) {
      const target = open ? 1 : 0;
      velocity += ((target - openness) * 90 - velocity * 11) * dt; // a springy clack
      openness += velocity * dt;
      hinge.position.y = -0.2 + clamp(openness, 0, 1.2) * 0.16;
      hinge.rotation.y = -clamp(openness, 0, 1.1) * 1.05;
    },
  };
}

/** Drag the card to spin it; a click without dragging flips it over. */
function bindDrag(surface, state) {
  if (!surface) return;
  surface.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('a, button, input, select, textarea, .says, .hero__side, .hero__stats')) return;
    state.drag = { last: e.clientX, t: performance.now(), moved: 0 };
  });
  window.addEventListener('pointermove', (e) => {
    const d = state.drag;
    if (!d) return;
    const dx = e.clientX - d.last;
    d.last = e.clientX;
    d.moved += Math.abs(dx);
    if (d.moved < 6) return;
    state.settle = null;
    state.spin += dx * 0.012;
    const now = performance.now();
    state.spinVel = (dx * 0.012) / Math.max(0.008, (now - d.t) / 1000);
    d.t = now;
  });
  const release = (e) => {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    if (d.moved < 6 && e.type === 'pointerup') { // a click: flip it over
      const base = state.settle ?? Math.round(state.spin / Math.PI) * Math.PI;
      state.settle = base + Math.PI;
      state.spinVel = 0;
      return;
    }
    state.spinVel = clamp(state.spinVel, -14, 14);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}
