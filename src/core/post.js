import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { settings } from './settings.js';

// Display-space finishing pass: chromatic aberration, speed blur, grading,
// damage tint, vignette, glitch and film grain.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    aberration: { value: 0.0025 },
    vignette: { value: 0.45 },
    grain: { value: 0.035 },
    damage: { value: 0 },
    speed: { value: 0 },
    tint: { value: new THREE.Color(0, 0, 0) },
    tintAmt: { value: 0 },
    flash: { value: 0 },
    glitch: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float aberration;
    uniform float vignette;
    uniform float grain;
    uniform float damage;
    uniform float speed;
    uniform vec3 tint;
    uniform float tintAmt;
    uniform float flash;
    uniform float glitch;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec2 uv = vUv;
      if (glitch > 0.0) {
        float band = floor(uv.y * 28.0 + floor(time * 13.0) * 5.0);
        float r = hash(vec2(band, floor(time * 17.0)));
        if (r < glitch * 0.3) uv.x += (hash(vec2(band, floor(time * 31.0))) - 0.5) * 0.05 * glitch;
      }
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec2 dir = c * (aberration * (0.4 + r2 * 4.0) + damage * 0.01 + glitch * 0.006);
      vec3 col;
      if (speed > 0.002) {
        vec3 acc = vec3(0.0);
        float fall = smoothstep(0.02, 0.45, sqrt(r2));
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          vec2 suv = uv - c * speed * t * 0.11 * fall;
          acc.r += texture2D(tDiffuse, suv + dir).r;
          acc.g += texture2D(tDiffuse, suv).g;
          acc.b += texture2D(tDiffuse, suv - dir).b;
        }
        col = acc / 8.0;
      } else {
        col.r = texture2D(tDiffuse, uv + dir).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - dir).b;
      }
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.9, 1.0, 1.12), (1.0 - smoothstep(0.0, 0.45, lum)) * 0.55);
      col = mix(col, col * vec3(1.06, 1.0, 0.93), smoothstep(0.45, 1.0, lum) * 0.4);
      col = (col - 0.5) * 1.07 + 0.5;
      float edge = smoothstep(0.05, 0.6, r2 * 2.0);
      col = mix(col, tint, tintAmt * edge);
      col = mix(col, vec3(1.0, 0.06, 0.16), damage * edge * 0.75);
      col *= 1.0 - vignette * smoothstep(0.12, 0.9, r2 * 2.2);
      col += vec3(flash);
      col += (hash(uv * resolution + fract(time * 7.13) * 100.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

// Replaces NaN/Inf texels before bloom so one bad pixel can't spread into a black box.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = !(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)
        || !(abs(c.r) < 60000.0) || !(abs(c.g) < 60000.0) || !(abs(c.b) < 60000.0);
      gl_FragColor = vec4(bad ? vec3(0.0) : clamp(c.rgb, 0.0, 60000.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, vmScene, vmCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.vmScene = vmScene;
    this.vmCamera = vmCamera;
    this.overlays = [];
    this.fx = { speed: 0, damage: 0, tintAmt: 0, flash: 0, glitch: 0, tint: new THREE.Color(0.35, 0.15, 0.85) };
    this.composer = null;
  }

  build(width, height, pixelRatio) {
    const preset = settings.preset;
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.bloom.dispose();
    }
    const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(width * pixelRatio)), Math.max(1, Math.floor(height * pixelRatio)), {
      type: THREE.HalfFloatType,
      samples: preset.msaa,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width * pixelRatio, height * pixelRatio), preset.bloomStrength * 0.85, 0.55, 0.86);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.vmPass);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.final);
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.final.uniforms.resolution.value.set(width * pixelRatio, height * pixelRatio);
  }

  setSize(width, height, pixelRatio) {
    if (!this.composer || pixelRatio !== this.pixelRatio) {
      this.build(width, height, pixelRatio);
      return;
    }
    this.composer.setSize(width, height);
    this.width = width;
    this.height = height;
    this.final.uniforms.resolution.value.set(width * pixelRatio, height * pixelRatio);
  }

  set vmEnabled(v) {
    if (this.vmPass) this.vmPass.enabled = v;
  }

  render(time) {
    const u = this.final.uniforms;
    const fx = this.fx;
    u.time.value = time;
    u.aberration.value = settings.get('aberration') ? 0.0028 : 0;
    u.grain.value = settings.get('grain') ? 0.04 : 0;
    u.speed.value = settings.get('speedBlur') ? fx.speed : 0;
    u.damage.value = fx.damage;
    u.tint.value.copy(fx.tint);
    u.tintAmt.value = fx.tintAmt;
    u.flash.value = fx.flash;
    u.glitch.value = fx.glitch;
    this.composer.render();
    if (this.overlays.length) {
      const r = this.renderer;
      const auto = r.autoClear;
      r.autoClear = false;
      for (const o of this.overlays) if (o.visible) r.render(o.scene, o.camera);
      r.autoClear = auto;
    }
  }
}
