/*
 * Post-processing: multisampled render → bloom (highlights only) → whip shockwaves,
 * chromatic aberration and vignette → tone mapping. Low-end devices skip all of it.
 */
import {
  WebGLRenderTarget, HalfFloatType, Vector2, Vector4, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass,
} from './three.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uShock: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] },
    uAspect: { value: 1 },
    uAberration: { value: 0.0035 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec4 uShock[4];
    uniform float uAspect;
    uniform float uAberration;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      for (int i = 0; i < 4; i++) {
        vec4 s = uShock[i];
        if (s.w <= 0.0) continue;
        vec2 d = uv - s.xy;
        d.x *= uAspect;
        float dist = length(d);
        float radius = s.z * 0.85;
        float width = 0.05 + s.z * 0.06;
        float ring = smoothstep(width, 0.0, abs(dist - radius)) * (1.0 - smoothstep(0.0, 0.8, s.z));
        vec2 push = d / max(dist, 1e-4);
        push.x /= uAspect;
        uv -= push * ring * 0.03 * s.w;
      }
      vec2 dir = uv - 0.5;
      float ca = uAberration * dot(dir, dir) * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca).b;
      float vig = smoothstep(1.1, 0.28, length(dir * vec2(uAspect * 0.8, 1.0)));
      col *= mix(0.74, 1.0, vig);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPost(renderer, scene, camera, quality) {
  const shocks = [];
  if (!quality.post) {
    return {
      render: () => renderer.render(scene, camera),
      setSize() {},
      shock() {},
      setBloom() {},
    };
  }
  const size = renderer.getDrawingBufferSize(new Vector2());
  const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: quality.msaa });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (quality.bloom) {
    bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.24, 0.5, 0.92);
    composer.addPass(bloom);
  }
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);
  composer.addPass(new OutputPass());

  return {
    render(dt) {
      for (let i = shocks.length - 1; i >= 0; i--) {
        shocks[i].age += dt;
        if (shocks[i].age > 1) shocks.splice(i, 1);
      }
      final.uniforms.uShock.value.forEach((v, i) => {
        const s = shocks[i];
        if (s) v.set(s.x, s.y, s.age, s.power);
        else v.set(0, 0, 0, 0);
      });
      composer.render(dt);
    },
    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      final.uniforms.uAspect.value = width / height;
    },
    shock([x, y], power = 1) {
      shocks.unshift({ x, y, age: 0, power });
      shocks.length = Math.min(shocks.length, 4);
    },
    setBloom(on) {
      if (bloom) bloom.enabled = on;
    },
  };
}
