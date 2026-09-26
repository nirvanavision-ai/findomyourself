/*
 * Gold and pink dust drifting through the whole page at different depths. It lives in a
 * screen-sized box that wraps around, so scrolling gives endless parallax for free.
 */
import { BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, AdditiveBlending, Vector2, Color } from './three.js';

export function createDust({ count }) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random() - 0.5;
    positions[i * 3 + 1] = Math.random() - 0.5;
    positions[i * 3 + 2] = -4 + Math.random() * 7;
    seeds[i] = Math.random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new Float32BufferAttribute(seeds, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uWorld: { value: new Vector2(10, 7.5) },
      uPixel: { value: 1 },
      uGold: { value: new Color('#f2c46e') },
      uPink: { value: new Color('#ff5c8d') },
      uAlpha: { value: 0 },
    },
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float uTime;
      uniform float uScroll;
      uniform vec2 uWorld;
      uniform float uPixel;
      uniform vec3 uGold;
      uniform vec3 uPink;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float depth = (position.z + 4.0) / 7.0;
        float parallax = mix(0.35, 1.15, depth);
        float h = uWorld.y * 1.3;
        float y = position.y * h + uTime * (0.03 + seed * 0.06) + uScroll * parallax;
        y = mod(y + h * 0.5, h) - h * 0.5;
        float x = position.x * uWorld.x * 1.2 + sin(uTime * 0.23 + seed * 31.0) * 0.18;
        vec4 mv = modelViewMatrix * vec4(x, y, position.z, 1.0);
        gl_PointSize = (1.4 + seed * seed * 5.0) * uPixel * (14.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
        vTwinkle = 0.25 + 0.75 * pow(abs(sin(uTime * (0.5 + seed * 1.3) + seed * 57.0)), 4.0);
        vColor = seed > 0.72 ? uPink : uGold;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uAlpha;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vTwinkle * uAlpha;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  return {
    points,
    update(time, { scrollWorld, viewport, pixelRatio, alpha }) {
      const u = material.uniforms;
      u.uTime.value = time;
      u.uScroll.value = scrollWorld;
      u.uWorld.value.set(viewport.worldWidth, viewport.worldHeight);
      u.uPixel.value = pixelRatio;
      u.uAlpha.value = alpha;
    },
  };
}
