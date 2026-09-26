/*
 * Crack the whip, the 3D half: a braided leather whip simulated as a Verlet rope with a
 * rigid handle. The handle follows the pointer over the arena (on phones: grab the handle and
 * drag). Flick fast enough and the tip breaks the sound barrier: a crack is detected at
 * the tip's speed peak, with sparks, a motion trail and a shockwave.
 */
import {
  Group, Mesh, BufferGeometry, BufferAttribute, Float32BufferAttribute, MeshStandardMaterial, MeshPhysicalMaterial, CylinderGeometry,
  SphereGeometry, TorusGeometry, CanvasTexture, RepeatWrapping, Color, Vector3, Quaternion, Points, ShaderMaterial,
  AdditiveBlending, Line, DynamicDrawUsage,
} from './three.js';
import { drawBraid } from './textures.js';
import { clamp, damp } from '../lib/motion.js';

const N = 30;
const RADIAL = 9;
const SUBSTEPS = 3;
const ITERATIONS = 18;
const HANDLE_LENGTH = 0.62;
const TRAIL = 16;
const SPARKS = 48;

export function createWhip({ arena, grab, viewport, onCrack, onShock, reducedMotion }) {
  const group = new Group();
  const pts = Array.from({ length: N }, () => ({ p: new Vector3(), prev: new Vector3() }));
  const rest = new Float32Array(N - 1);
  let length = 3.2;

  /* ── tube geometry, rewritten every frame ── */
  const ringVerts = RADIAL + 1;
  const positions = new Float32Array(N * ringVerts * 3);
  const normals = new Float32Array(N * ringVerts * 3);
  const uvs = new Float32Array(N * ringVerts * 2);
  const indices = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= RADIAL; j++) {
      uvs[(i * ringVerts + j) * 2] = j / RADIAL;
      uvs[(i * ringVerts + j) * 2 + 1] = (i / (N - 1)) * 14;
    }
  }
  const tube = new BufferGeometry();
  tube.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  tube.setAttribute('normal', new BufferAttribute(normals, 3).setUsage(DynamicDrawUsage));
  tube.setAttribute('uv', new BufferAttribute(uvs, 2));
  tube.setIndex(indices);
  const braid = new CanvasTexture(drawBraid());
  braid.wrapS = RepeatWrapping;
  braid.wrapT = RepeatWrapping;
  const leather = new MeshStandardMaterial({ color: new Color('#2a1418'), roughness: 0.46, metalness: 0.15, bumpMap: braid, bumpScale: 3, envMapIntensity: 1.1 });
  const lash = new Mesh(tube, leather);
  lash.frustumCulled = false;
  group.add(lash);

  /* ── handle ── */
  const handle = new Group();
  const grip = new Mesh(new CylinderGeometry(0.075, 0.062, HANDLE_LENGTH, 18, 1), new MeshStandardMaterial({ color: new Color('#150a0d'), roughness: 0.4, metalness: 0.2, bumpMap: braid, bumpScale: 4 }));
  grip.position.y = HANDLE_LENGTH / 2;
  const pommel = new Mesh(new SphereGeometry(0.1, 20, 14), new MeshPhysicalMaterial({ color: new Color('#ff2e6e'), roughness: 0.18, metalness: 0.3, clearcoat: 1 }));
  const ring = new Mesh(new TorusGeometry(0.078, 0.018, 10, 28), new MeshStandardMaterial({ color: new Color('#e2b25e'), roughness: 0.2, metalness: 1 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = HANDLE_LENGTH;
  handle.add(grip, pommel, ring);
  group.add(handle);

  /* ── motion trail behind the tip ── */
  const trailPos = new Float32Array(TRAIL * 3);
  const trailAlpha = new Float32Array(TRAIL);
  const trailGeometry = new BufferGeometry();
  trailGeometry.setAttribute('position', new BufferAttribute(trailPos, 3).setUsage(DynamicDrawUsage));
  trailGeometry.setAttribute('alpha', new BufferAttribute(trailAlpha, 1).setUsage(DynamicDrawUsage));
  const trail = new Line(trailGeometry, new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color('#ff8fb3') } },
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }',
  }));
  trail.frustumCulled = false;
  group.add(trail);

  /* ── sparks ── */
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkVel = Array.from({ length: SPARKS }, () => new Vector3());
  const sparkGeometry = new BufferGeometry();
  sparkGeometry.setAttribute('position', new Float32BufferAttribute(sparkPos, 3).setUsage(DynamicDrawUsage));
  sparkGeometry.setAttribute('life', new Float32BufferAttribute(sparkLife, 1).setUsage(DynamicDrawUsage));
  const sparks = new Points(sparkGeometry, new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uScale: { value: 1 } },
    vertexShader: 'attribute float life; varying float vL; uniform float uScale; void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uScale * (4.0 + 10.0 * life) / -mv.z * 14.0; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vL; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) * vL; gl_FragColor = vec4(vec3(1.0, 0.75, 0.45) * a * 1.6, a); }',
  }));
  sparks.frustumCulled = false;
  group.add(sparks);
  let sparkCursor = 0;

  /* ── input ── */
  const hand = { target: new Vector3(), pos: new Vector3(), vel: new Vector3(), dir: new Vector3(0.45, 0.9, 0).normalize(), held: false, over: false };
  const pointer = { x: 0, y: 0 };
  let arenaRect = arena.getBoundingClientRect();
  let visible = false;
  let lastCrack = 0;
  let prevTipSpeed = 0;
  let peak = 0;
  let initialized = false;
  const tmp = new Vector3();
  const quat = new Quaternion();
  const up = new Vector3(0, 1, 0);

  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (e.pointerType === 'mouse') {
      const r = arenaRect;
      hand.over = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
    }
  }, { passive: true });
  grab?.addEventListener('pointerdown', (e) => {
    hand.held = true;
    grab.setPointerCapture(e.pointerId);
    grab.classList.add('is-held');
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    e.preventDefault();
  });
  const letGo = () => { hand.held = false; grab?.classList.remove('is-held'); };
  grab?.addEventListener('pointerup', letGo);
  grab?.addEventListener('pointercancel', letGo);

  function restPose() {
    viewport.toWorld(arenaRect.left + arenaRect.width * 0.42, arenaRect.top + arenaRect.height * 0.22, hand.target);
    hand.pos.copy(hand.target);
    let y = hand.pos.y + HANDLE_LENGTH;
    pts.forEach((pt, i) => {
      if (i === 0) pt.p.copy(hand.pos);
      else if (i === 1) pt.p.set(hand.pos.x, hand.pos.y + HANDLE_LENGTH, 0);
      else { y -= rest[i - 1]; pt.p.set(hand.pos.x + 0.06 * i, y + HANDLE_LENGTH * 0.5, 0); }
      pt.prev.copy(pt.p);
    });
  }

  function layout() {
    arenaRect = arena.getBoundingClientRect();
    length = clamp(arenaRect.height * viewport.unit * 0.95, 1.6, 4.2);
    let sum = 0;
    for (let i = 0; i < N - 1; i++) {
      rest[i] = i === 0 ? HANDLE_LENGTH : 1.3 - 0.75 * (i / (N - 2));
      if (i) sum += rest[i];
    }
    for (let i = 1; i < N - 1; i++) rest[i] *= (length - HANDLE_LENGTH) / sum;
  }

  function step(h) {
    const g = 17;
    for (let i = 2; i < N; i++) {
      const pt = pts[i];
      tmp.copy(pt.p).sub(pt.prev).multiplyScalar(0.992);
      pt.prev.copy(pt.p);
      pt.p.add(tmp);
      pt.p.y -= g * h * h;
      pt.p.z *= 0.96; // stay near the plane, with a little depth for life
    }
    for (let k = 0; k < ITERATIONS; k++) {
      for (let i = 1; i < N - 1; i++) {
        const a = pts[i].p;
        const b = pts[i + 1].p;
        tmp.copy(b).sub(a);
        const d = tmp.length() || 1e-6;
        const diff = (d - rest[i]) / d;
        if (i === 1) {
          b.addScaledVector(tmp, -diff);
        } else {
          a.addScaledVector(tmp, diff * 0.5);
          b.addScaledVector(tmp, -diff * 0.5);
        }
      }
      // stiff near the handle, loose at the tip
      for (let i = 1; i < 4; i++) {
        const a = pts[i - 1].p;
        const b = pts[i].p;
        const c = pts[i + 1].p;
        tmp.copy(b).sub(a).normalize().multiplyScalar(rest[i]).add(b);
        c.lerp(tmp, 0.11 / i);
      }
    }
  }

  function writeTube() {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const p = pts[i].p;
      const a = pts[Math.max(1, i - 1)].p;
      const b = pts[Math.min(N - 1, i + 1)].p;
      const t = tmp.copy(b).sub(a).normalize();
      // frame: the normal is the camera-facing axis made perpendicular to the tangent
      const nx = -t.x * t.z;
      const ny = -t.y * t.z;
      const nz = 1 - t.z * t.z;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const Nx = nx / nl; const Ny = ny / nl; const Nz = nz / nl;
      const Bx = t.y * Nz - t.z * Ny; const By = t.z * Nx - t.x * Nz; const Bz = t.x * Ny - t.y * Nx;
      const f = i / (N - 1);
      const r = i <= 1 ? 0.06 : 0.056 * Math.pow(1 - f, 0.85) + 0.006;
      for (let j = 0; j <= RADIAL; j++) {
        const th = (j / RADIAL) * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const ox = c * Nx + s * Bx;
        const oy = c * Ny + s * By;
        const oz = c * Nz + s * Bz;
        positions[w * 3] = p.x + ox * r;
        positions[w * 3 + 1] = p.y + oy * r;
        positions[w * 3 + 2] = p.z + oz * r;
        normals[w * 3] = ox;
        normals[w * 3 + 1] = oy;
        normals[w * 3 + 2] = oz;
        w++;
      }
    }
    tube.attributes.position.needsUpdate = true;
    tube.attributes.normal.needsUpdate = true;
  }

  function burst(at, power) {
    for (let k = 0; k < 18; k++) {
      const i = sparkCursor++ % SPARKS;
      sparkPos[i * 3] = at.x;
      sparkPos[i * 3 + 1] = at.y;
      sparkPos[i * 3 + 2] = at.z;
      sparkVel[i].set(Math.random() - 0.5, Math.random() - 0.3, (Math.random() - 0.5) * 0.4).normalize().multiplyScalar(2 + Math.random() * 5 * power);
      sparkLife[i] = 1;
    }
  }

  layout();
  window.addEventListener('resize', () => { layout(); restPose(); });

  return {
    group,
    update(time, dt) {
      arenaRect = arena.getBoundingClientRect();
      visible = arenaRect.bottom > 0 && arenaRect.top < viewport.height && arenaRect.width > 0;
      group.visible = visible;
      if (!visible) { initialized = false; return; }
      if (!initialized) { layout(); restPose(); initialized = true; }

      // where the hand wants to be
      const active = hand.held || hand.over;
      if (active) {
        viewport.toWorld(pointer.x, pointer.y, hand.target);
      } else {
        viewport.toWorld(arenaRect.left + arenaRect.width * 0.42, arenaRect.top + arenaRect.height * 0.22, hand.target);
        hand.target.x += Math.sin(time * 0.9) * 0.18;
        hand.target.y += Math.sin(time * 1.3) * 0.05;
      }
      const before = tmp.copy(hand.pos);
      const bx = before.x;
      const by = before.y;
      hand.pos.x = damp(hand.pos.x, hand.target.x, active ? 40 : 3, dt);
      hand.pos.y = damp(hand.pos.y, hand.target.y, active ? 40 : 3, dt);
      hand.vel.set((hand.pos.x - bx) / dt, (hand.pos.y - by) / dt, 0);
      // the wrist leads: the handle leans into the motion
      const lean = new Vector3(0.45, 0.9, 0).addScaledVector(hand.vel, 0.035);
      hand.dir.lerp(lean.normalize(), 1 - Math.exp(-dt * 14)).normalize();

      const h = dt / SUBSTEPS;
      const start = pts[0].p.clone();
      const startTip = pts[1].p.clone();
      const endTip = hand.pos.clone().addScaledVector(hand.dir, HANDLE_LENGTH);
      const tipBefore = pts[N - 1].p.clone();
      for (let s = 1; s <= SUBSTEPS; s++) {
        const k = s / SUBSTEPS;
        pts[0].p.lerpVectors(start, hand.pos, k);
        pts[1].p.lerpVectors(startTip, endTip, k);
        step(h);
      }
      pts[0].prev.copy(pts[0].p);
      pts[1].prev.copy(pts[1].p);

      // crack: the tip's speed peaks above the threshold while the hand is actually moving
      const tipSpeed = pts[N - 1].p.distanceTo(tipBefore) / dt;
      const handSpeed = hand.vel.length();
      if (tipSpeed > peak) peak = tipSpeed;
      const threshold = 24 * (length / 3.2);
      if (!reducedMotion && prevTipSpeed > threshold && tipSpeed < prevTipSpeed && time - lastCrack > 0.22 && (handSpeed > 3 || hand.held)) {
        lastCrack = time;
        const power = clamp((peak - threshold) / threshold + 0.5, 0.3, 1.5);
        const tip = pts[N - 1].p.clone();
        const screen = viewport.toScreen(tip);
        burst(tip, power);
        onCrack?.(screen.x, screen.y, power);
        onShock?.(screen.uv, power);
        peak = 0;
      }
      prevTipSpeed = tipSpeed;
      if (time - lastCrack > 0.5) peak *= 0.9;

      writeTube();
      handle.position.copy(hand.pos);
      quat.setFromUnitVectors(up, hand.dir);
      handle.quaternion.copy(quat);

      // trail: recent tip positions, brighter when fast
      trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
      trailAlpha.copyWithin(1, 0, TRAIL - 1);
      const tip = pts[N - 1].p;
      trailPos[0] = tip.x; trailPos[1] = tip.y; trailPos[2] = tip.z;
      trailAlpha[0] = clamp((tipSpeed - 6) / 30, 0, 0.9);
      for (let i = 1; i < TRAIL; i++) trailAlpha[i] *= 0.82;
      trailGeometry.attributes.position.needsUpdate = true;
      trailGeometry.attributes.alpha.needsUpdate = true;

      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) continue;
        sparkLife[i] = Math.max(0, sparkLife[i] - dt * 1.6);
        sparkVel[i].y -= 9 * dt;
        sparkPos[i * 3] += sparkVel[i].x * dt;
        sparkPos[i * 3 + 1] += sparkVel[i].y * dt;
        sparkPos[i * 3 + 2] += sparkVel[i].z * dt;
      }
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkGeometry.attributes.life.needsUpdate = true;

      // keep the touch handle's grab zone on top of the 3D handle
      if (grab) {
        const s = viewport.toScreen(hand.pos.clone().addScaledVector(hand.dir, HANDLE_LENGTH * 0.4));
        grab.style.left = `${s.x - arenaRect.left}px`;
        grab.style.top = `${s.y - arenaRect.top}px`;
      }
    },
  };
}
