/*
 * The background: dark silk satin, drawn by a shader into a small render target and
 * stretched to the screen (silk is soft, so a fraction of the resolution looks the same and
 * costs a fraction of the GPU). Folds drift slowly, the cursor presses into the fabric,
 * and the colors shift per section.
 */
import {
  WebGLRenderTarget, HalfFloatType, LinearFilter, ShaderMaterial, Mesh, PlaneGeometry, Scene, OrthographicCamera, Vector2, Color,
} from './three.js';

const NOISE = /* glsl */`
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

const SILK_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform float uPress;
uniform float uScroll;
uniform vec3 uBase;
uniform vec3 uDeep;
uniform vec3 uSheen;
uniform float uSheenAmt;
varying vec2 vUv;
${NOISE}
float fabric(vec2 p) {
  float t = uTime * 0.04;
  // a slow, broad warp so the folds bend instead of marbling
  vec2 w = vec2(snoise(p * 0.32 + vec2(t, 0.0)), snoise(p * 0.32 + vec2(4.1, -t)));
  vec2 q = p + w * 0.55;
  float f1 = sin(dot(q, vec2(0.75, 1.35)) * 1.55 + t * 1.6);
  float f2 = sin(dot(q, vec2(-1.15, 0.45)) * 0.85 - t * 1.1);
  float f3 = snoise(q * 0.75 + t * 0.4);
  return f1 * 0.56 + f2 * 0.3 + f3 * 0.22;
}
float height(vec2 p, vec2 press) {
  vec2 d = p - press;
  return fabric(p) - uPress * 0.75 * exp(-dot(d, d) * 4.0);
}
void main() {
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * aspect * 1.25 + vec2(0.0, uScroll);
  vec2 press = (uPointer - 0.5) * aspect * 1.25 + vec2(0.0, uScroll);
  float e = 0.015;
  float h = height(p, press);
  float hx = height(p + vec2(e, 0.0), press);
  float hy = height(p + vec2(0.0, e), press);
  vec3 n = normalize(vec3((h - hx) / e * 0.09, (h - hy) / e * 0.09, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.65, 0.62));
  float diff = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 38.0);
  float sheen = pow(1.0 - clamp(n.z, 0.0, 1.0), 1.4);
  vec3 col = mix(uDeep, uBase, smoothstep(0.2, 1.0, diff));
  col += uSheen * uSheenAmt * (spec * 0.7 + sheen * 1.6);
  float vig = smoothstep(1.2, 0.2, length((vUv - 0.5) * vec2(1.1, 1.0)));
  col *= mix(0.4, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}
`;

const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DISPLAY_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const DISPLAY_FRAG = /* glsl */`
uniform sampler2D tSilk;
uniform float uFade;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tSilk, vUv).rgb * uFade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* Colors per section (sRGB hex, converted to linear by three.js). */
export const TONES = {
  hero: { base: '#4a0c23', deep: '#080206', sheen: '#ff6b9a', amt: 0.46 },
  rules: { base: '#230d16', deep: '#050203', sheen: '#ffb8cb', amt: 0.2 },
  vault: { base: '#34190a', deep: '#070403', sheen: '#f2c46e', amt: 0.4 },
  list: { base: '#180a10', deep: '#040102', sheen: '#ff2e6e', amt: 0.16 },
  trophies: { base: '#1f1015', deep: '#050203', sheen: '#f5dcc0', amt: 0.2 },
  whip: { base: '#560616', deep: '#0a0103', sheen: '#ff3048', amt: 0.5 },
  footer: { base: '#12070c', deep: '#030102', sheen: '#ff2e6e', amt: 0.12 },
};

const TONE_COLORS = Object.fromEntries(Object.entries(TONES).map(([name, t]) => [name, {
  base: new Color(t.base), deep: new Color(t.deep), sheen: new Color(t.sheen), amt: t.amt,
}]));

export function createSilk(renderer, { scale = 0.45 } = {}) {
  const target = new WebGLRenderTarget(4, 4, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new Vector2(1, 1) },
    uPointer: { value: new Vector2(0.5, 0.5) },
    uPress: { value: 0 },
    uScroll: { value: 0 },
    uBase: { value: new Color(TONES.hero.base) },
    uDeep: { value: new Color(TONES.hero.deep) },
    uSheen: { value: new Color(TONES.hero.sheen) },
    uSheenAmt: { value: TONES.hero.amt },
  };
  const silkScene = new Scene();
  const silkCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader: SILK_FRAG, uniforms, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  silkScene.add(quad);

  const display = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    vertexShader: DISPLAY_VERT,
    fragmentShader: DISPLAY_FRAG,
    uniforms: { tSilk: { value: target.texture }, uFade: { value: 1 } },
    depthTest: false,
    depthWrite: false,
  }));
  display.frustumCulled = false;
  display.renderOrder = -1000;

  const tmp = { base: new Color(), deep: new Color(), sheen: new Color() };
  let frame = 0;

  return {
    mesh: display,
    uniforms,
    resize(width, height) {
      const s = Math.min(scale, 900 / Math.max(width, height)); // cap the cost on huge screens
      target.setSize(Math.max(64, Math.round(width * s)), Math.max(64, Math.round(height * s)));
      uniforms.uRes.value.set(width, height);
    },
    /** weights: { toneName: weight } summing to 1. */
    update(dt, { time, pointer, press, scroll, weights, everyOther = false }) {
      uniforms.uTime.value = time;
      uniforms.uPointer.value.lerp(pointer, 1 - Math.exp(-dt * 6));
      uniforms.uPress.value += (press - uniforms.uPress.value) * (1 - Math.exp(-dt * 3));
      uniforms.uScroll.value = scroll;
      tmp.base.setRGB(0, 0, 0);
      tmp.deep.setRGB(0, 0, 0);
      tmp.sheen.setRGB(0, 0, 0);
      let amt = 0;
      for (const [name, w] of Object.entries(weights)) {
        const tone = TONE_COLORS[name];
        if (!tone || !w) continue;
        tmp.base.r += tone.base.r * w; tmp.base.g += tone.base.g * w; tmp.base.b += tone.base.b * w;
        tmp.deep.r += tone.deep.r * w; tmp.deep.g += tone.deep.g * w; tmp.deep.b += tone.deep.b * w;
        tmp.sheen.r += tone.sheen.r * w; tmp.sheen.g += tone.sheen.g * w; tmp.sheen.b += tone.sheen.b * w;
        amt += tone.amt * w;
      }
      const k = 1 - Math.exp(-dt * 2.2);
      uniforms.uBase.value.lerp(tmp.base, k);
      uniforms.uDeep.value.lerp(tmp.deep, k);
      uniforms.uSheen.value.lerp(tmp.sheen, k);
      uniforms.uSheenAmt.value += (amt - uniforms.uSheenAmt.value) * k;
      frame++;
      if (everyOther && frame % 2) return;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(silkScene, silkCamera);
      renderer.setRenderTarget(prev);
    },
    setFade(v) { display.material.uniforms.uFade.value = v; },
  };
}
