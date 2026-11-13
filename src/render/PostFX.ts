import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RENDER, PresetName } from '../config';
import { Lighting } from './Lighting';

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Renders the scene into a private target that owns a depth texture, then copies colour into
 * the composer chain. Keeping depth off the ping-pong buffers avoids framebuffer feedback loops
 * when later passes sample it.
 */
class ScenePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private copy: FullScreenQuad;
  private copyMat: THREE.ShaderMaterial;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, w: number, h: number) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.target.texture } },
      vertexShader: quadVert,
      // Guard on the way out: replace any NaN/Inf pixel and clamp extreme highlights, so a single
      // bad pixel can never be blurred across the screen (by depth of field or bloom) into a flash.
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(min(c.rgb, vec3(48.0)), c.a); }',
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new FullScreenQuad(this.copyMat);
  }
  get depth(): THREE.DepthTexture | null {
    return this.target.depthTexture;
  }
  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }
  override render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(readBuffer);
    this.copy.render(renderer);
  }
}

const dofFrag = (samples: number) => /* glsl */ `
  #define SAMPLES ${samples}
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocus;
  uniform float uAperture;
  uniform float uMaxBlur;
  uniform float uFg;
  uniform float uTilt;
  uniform float uStrength;
  varying vec2 vUv;
  float linDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  float cocAt(vec2 uv, float d) {
    float c = (d - uFocus) / d;
    c = c < 0.0 ? -c * uFg : c;
    c = max(c - 0.035, 0.0); // sharp band around the focus distance
    float ty = abs(uv.y - 0.5) * 2.0;
    float tilt = ty * ty * uTilt * (0.35 + 0.65 * clamp(abs(c) * 6.0, 0.0, 1.0));
    return clamp((c * uAperture + tilt) * uStrength, 0.0, 1.0) * uMaxBlur;
  }
  void main() {
    vec4 base = texture2D(tColor, vUv);
    float d = linDepth(texture2D(tDepth, vUv).x);
    float r = cocAt(vUv, d);
    if (r < 0.6) { gl_FragColor = base; return; }
    vec3 acc = base.rgb;
    float wsum = 1.0;
    for (int i = 0; i < SAMPLES; i++) {
      float fi = float(i) + 0.5;
      float rr = sqrt(fi / float(SAMPLES)) * r;
      float a = fi * 2.39996323;
      vec2 suv = vUv + vec2(cos(a), sin(a)) * rr / uRes;
      vec3 c = texture2D(tColor, suv).rgb;
      float sd = linDepth(texture2D(tDepth, suv).x);
      float rs = cocAt(suv, sd);
      // Samples only contribute if their own blur reaches this pixel (limits sharp-edge bleeding),
      // except nearer blurred samples which spill over (foreground bokeh).
      float w = clamp(rs - rr + 1.0, 0.0, 1.0);
      if (sd < d && rs > r) w = 1.0;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      w *= 1.0 + smoothstep(1.2, 4.0, lum) * 1.5; // bokeh highlights
      acc += c * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, base.a);
  }
`;


/** Depth-based tilt-shift depth of field with golden-angle bokeh gather. */
class DofPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  constructor(private scenePass: ScenePass, samples: number) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: RENDER.near },
        uFar: { value: RENDER.far },
        uFocus: { value: 60 },
        uAperture: { value: RENDER.dof.aperture },
        uMaxBlur: { value: RENDER.dof.maxBlur },
        uFg: { value: RENDER.dof.foregroundBoost },
        uTilt: { value: RENDER.dof.tilt },
        uStrength: { value: RENDER.dof.strength },
      },
      vertexShader: quadVert,
      fragmentShader: dofFrag(samples),
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSamples(n: number): void {
    this.material.fragmentShader = dofFrag(n);
    this.material.needsUpdate = true;
  }
  override setSize(w: number, h: number): void {
    this.material.uniforms.uRes.value.set(w, h);
    // Blur radius scales with resolution (tuned for 1080p).
    this.material.uniforms.uMaxBlur.value = RENDER.dof.maxBlur * (h / 1080);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.material.uniforms.tColor.value = readBuffer.texture;
    this.material.uniforms.tDepth.value = this.scenePass.depth;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: RENDER.grade.saturation },
    uWarm: { value: RENDER.grade.warmth },
    uTeal: { value: RENDER.grade.teal },
    uContrast: { value: RENDER.grade.contrast },
    uVig: { value: RENDER.grade.vignette },
    uNight: { value: 0 },
    /** Golden hour and blue hour (0..1 each): richer, warmer highlights; cooler, bluer shadows. */
    uGolden: { value: 0 },
    uDusk: { value: 0 },
    /** Pixel style: colour quantisation with ordered dithering (0 = off). */
    uPixel: { value: 0 },
  },
  vertexShader: quadVert.replace('gl_Position = vec4(position.xy, 0.0, 1.0);', 'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);'),
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat, uWarm, uTeal, uContrast, uVig, uNight, uPixel, uGolden, uDusk;
    varying vec2 vUv;
    float bayer4(vec2 p) {
      vec2 q = mod(floor(p), 4.0);
      float i = q.x + q.y * 4.0;
      // 4x4 Bayer matrix, row-major.
      float m[16];
      m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
      m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
      for (int k = 0; k < 16; k++) if (float(k) == i) return m[k] / 16.0 - 0.5;
      return 0.0;
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Warm highlights, teal shadows (moonlit blue at night).
      vec3 warm = mix(vec3(1.0, 0.82, 0.58), vec3(0.75, 0.85, 1.0), uNight);
      c += (warm - 0.75) * uWarm * (1.0 + 0.9 * uGolden) * smoothstep(0.35, 1.0, l);
      c += mix(vec3(-0.05, 0.28, 0.32), vec3(-0.05, 0.05, 0.35), max(uNight, uDusk)) * uTeal * (1.0 + 0.8 * uDusk) * (1.0 - smoothstep(0.0, 0.45, l));
      // Moonlight is cooler and less saturated; golden light a little richer.
      c = mix(vec3(l), c, uSat * (1.0 - uNight * 0.3) * (1.0 + 0.07 * uGolden));
      c = (c - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      c *= clamp(1.0 - dot(d, d) * uVig * 2.2, 0.0, 1.0);
      if (uPixel > 0.5) {
        // Limited palette per channel with a gentle ordered dither, like hand-made pixel art.
        float lv = 18.0;
        c = floor(c * lv + 0.5 + bayer4(gl_FragCoord.xy) * 0.85) / lv;
      }
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

/**
 * Lens flare from the sun, added over the graded picture: a glow and a soft horizontal streak at
 * the sun, a faint halo round it and a chain of tinted ghosts reflected through the middle of the
 * screen. It shows only while the sun itself is unblocked (sky behind it in the depth buffer).
 */
const FlareShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null as THREE.Texture | null },
    /** Sun position in screen uv (may lie a little off screen). */
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uK: { value: 0 },
    uCol: { value: new THREE.Color(1, 0.9, 0.75) },
    /** Light shafts: where the sun (or moon) is on screen, their strength (0 = none) and colour. */
    uRaySun: { value: new THREE.Vector2(0.5, 0.5) },
    uRays: { value: 0 },
    uRayCol: { value: new THREE.Color(1, 0.85, 0.6) },
  },
  vertexShader: quadVert.replace('gl_Position = vec4(position.xy, 0.0, 1.0);', 'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);'),
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 uSun;
    uniform float uAspect, uK, uRays;
    uniform vec2 uRaySun;
    uniform vec3 uCol, uRayCol;
    varying vec2 vUv;
    float sky(vec2 p) { return step(0.99999, texture2D(tDepth, clamp(p, 0.001, 0.999)).x); }
    /** Open sky at p (anything off screen counts as open: the light comes in from there). */
    float open(vec2 p) {
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
      return step(0.99999, texture2D(tDepth, p).x);
    }
    /**
     * Shafts of light: walk from this pixel toward the sun, counting how much open sky lies on
     * the way. Whatever stands against the sky (trees, roofs, a ridge) cuts dark gaps into the
     * glow, which fan out from the sun as rays.
     */
    float shafts() {
      const int N = 20;
      vec2 d = uRaySun - vUv;
      float len = length(d * vec2(uAspect, 1.0));
      // Never walk further than most of the way to the sun, or more than half the screen.
      vec2 stepv = d * min(0.92, 0.55 / max(len, 1e-3)) / float(N);
      // Start each pixel's walk at a different point along the first step: no banding.
      float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec2 p = vUv + stepv * j;
      float w = 1.0, sum = 0.0, wsum = 0.0;
      for (int i = 0; i < N; i++) {
        sum += open(p) * w;
        wsum += w;
        w *= 0.94;
        p += stepv;
      }
      // Brightest round the sun, dying away across the screen.
      return (sum / wsum) * exp(-len * 2.1);
    }
    float ghost(vec2 at, float r, float soft) {
      vec2 d = (vUv - at) * vec2(uAspect, 1.0);
      return 1.0 - smoothstep(r * soft, r, length(d));
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uK > 0.002) {
        // Hidden behind land, trees or buildings: only when the sun is on screen can that be seen.
        float vis = 1.0;
        if (uSun.x > 0.0 && uSun.x < 1.0 && uSun.y > 0.0 && uSun.y < 1.0) {
          vec2 o = vec2(0.012 / uAspect, 0.012);
          vis = (sky(uSun) * 2.0 + sky(uSun + o) + sky(uSun - o) + sky(uSun + vec2(o.x, -o.y)) + sky(uSun + vec2(-o.x, o.y))) / 6.0;
        }
        float k = uK * vis;
        if (k > 0.002) {
          vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
          float r = length(d);
          vec3 f = vec3(0.0);
          f += uCol * (exp(-r * 9.0) * 0.32 + exp(-r * 30.0) * 0.4);
          f += uCol * exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 3.2) * 0.22;
          float ring = exp(-pow((r - 0.3) * 26.0, 2.0));
          f += vec3(0.55, 0.75, 1.0) * ring * 0.05 + vec3(1.0, 0.6, 0.35) * exp(-pow((r - 0.27) * 26.0, 2.0)) * 0.04;
          vec2 axis = vec2(0.5) - uSun;
          f += vec3(1.0, 0.75, 0.45) * ghost(uSun + axis * 0.55, 0.035, 0.4) * 0.16;
          f += vec3(0.6, 1.0, 0.7) * ghost(uSun + axis * 0.85, 0.02, 0.2) * 0.14;
          f += vec3(0.55, 0.7, 1.0) * ghost(uSun + axis * 1.3, 0.07, 0.75) * 0.1;
          f += vec3(1.0, 0.55, 0.75) * ghost(uSun + axis * 1.65, 0.045, 0.6) * 0.1;
          f += vec3(0.7, 0.85, 1.0) * ghost(uSun + axis * 2.05, 0.11, 0.85) * 0.07;
          c += f * k;
        }
      }
      if (uRays > 0.002) {
        // Screened on rather than added: bright sky and sunlit walls keep their colour.
        vec3 r = uRayCol * shafts() * uRays;
        c += r * (1.0 - clamp(c, 0.0, 1.0) * 0.7);
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

const contactFrag = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  /** Half the view's width and height at one unit's distance (tan of the half angles). */
  uniform vec2 uProj;
  uniform float uNear, uFar, uRadius, uStrength;
  varying vec2 vUv;
  float lin(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  vec3 viewPos(vec2 uv, float d) { return vec3((uv * 2.0 - 1.0) * uProj * d, -d); }
  vec3 P, Nrm;
  vec2 R;
  /** How much the surface found at one nearby point stands over this one (0 = not at all). */
  float tap(vec2 o) {
    vec2 uv = vUv + o * R;
    vec3 v = viewPos(uv, lin(uv)) - P;
    float l2 = dot(v, v);
    // Only what is close by counts: nothing far behind or far in front casts a halo.
    float nearBy = max(0.0, 1.0 - l2 / (uRadius * uRadius * 4.0));
    return max(0.0, dot(Nrm, v) * inversesqrt(l2 + 1e-5) - 0.14) * nearBy;
  }
  void main() {
    vec4 c = texture2D(tColor, vUv);
    float raw = texture2D(tDepth, vUv).x;
    gl_FragColor = c;
    if (raw > 0.9999) return;
    float d = lin(vUv);
    // Only near the camera, where there is something to see of it.
    float fade = 1.0 - smoothstep(90.0, 200.0, d);
    if (fade <= 0.0) return;
    P = viewPos(vUv, d);
    // The surface's facing from the depth round it, taking on each axis the neighbour nearer in
    // depth (so the edge of a roof never borrows its slope from the ground behind).
    vec2 px = 1.0 / uRes;
    vec2 ex = vec2(px.x, 0.0), ey = vec2(0.0, px.y);
    float dl = lin(vUv - ex), dr = lin(vUv + ex), db = lin(vUv - ey), dt = lin(vUv + ey);
    vec3 dx = abs(dl - d) < abs(dr - d) ? P - viewPos(vUv - ex, dl) : viewPos(vUv + ex, dr) - P;
    vec3 dy = abs(db - d) < abs(dt - d) ? P - viewPos(vUv - ey, db) : viewPos(vUv + ey, dt) - P;
    Nrm = normalize(cross(dx, dy));
    // The reach in world units, as a size on screen.
    R = min(vec2(uRadius) / (2.0 * uProj * d), vec2(0.06));
    float occ = tap(vec2(1.0, 0.0)) + tap(vec2(-1.0, 0.0)) + tap(vec2(0.0, 1.0)) + tap(vec2(0.0, -1.0))
      + tap(vec2(0.39, 0.39)) + tap(vec2(-0.39, 0.39)) + tap(vec2(0.39, -0.39)) + tap(vec2(-0.39, -0.39));
    float ao = 1.0 - uStrength * fade * min(1.0, occ * 0.3);
    // Shade toward a deep, slightly cool tone rather than to black.
    gl_FragColor = vec4(c.rgb * mix(vec3(0.16, 0.19, 0.26), vec3(1.0), ao), c.a);
  }
`;

/**
 * Contact shading for the presets without full ambient occlusion (the better phones): a few
 * depth samples round each pixel darken the creases where walls, tree trunks, rocks and people
 * meet the ground. No noise and no blur pass, so it stays steady and cheap (far cheaper than the
 * depth of field that follows it). High and ultra use GTAO instead; low goes without.
 */
class ContactShadowPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  constructor(private scenePass: ScenePass, private camera: THREE.PerspectiveCamera) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uProj: { value: new THREE.Vector2(1, 1) },
        uNear: { value: RENDER.near },
        uFar: { value: RENDER.far },
        uRadius: { value: 0.9 },
        uStrength: { value: 0.6 },
      },
      vertexShader: quadVert,
      fragmentShader: contactFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  override setSize(w: number, h: number): void {
    this.material.uniforms.uRes.value.set(w, h);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms, t = Math.tan((this.camera.fov * Math.PI) / 360);
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = this.scenePass.depth;
    u.uProj.value.set(t * this.camera.aspect, t);
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * Ambient occlusion worked out at half resolution (a quarter of the pixels: it was most of the
 * cost of a frame on high-resolution screens). The soft, denoised result is scaled back up as it
 * is blended over the full-size picture, which it can't be told apart from.
 */
class HalfGTAOPass extends GTAOPass {
  override setSize(w: number, h: number): void {
    super.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
  }
}

const _fwd = new THREE.Vector3(), _proj = new THREE.Vector3();
const RAY_GOLD = new THREE.Color(1.0, 0.66, 0.36), RAY_MOON = new THREE.Color(0.5, 0.62, 0.95);

/**
 * The whole post chain: scene -> GTAO (or contact shading) -> DOF -> bloom -> tone map ->
 * grade/vignette -> lens flare and light shafts -> SMAA/FXAA.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private scenePass: ScenePass;
  private gtao: HalfGTAOPass;
  private contact: ContactShadowPass;
  /** Contact shading on presets without GTAO (medium): switch off to compare or to save the pass. */
  contactShadows = true;
  /** Light shafts in the air round a low sun or the moon (high and ultra only). */
  lightShafts = true;
  private raysOn = false;
  readonly dof: DofPass;
  private bloom: UnrealBloomPass;
  private output: OutputPass;
  private grade: ShaderPass;
  private flare: ShaderPass;
  /** Lens flare: sun position in screen uv and strength (0 = none). */
  private flareK = 0;
  /** Draw the flare pass even at zero strength (so warming up compiles it). */
  warmFlare = false;
  private smaa: SMAAPass;
  private fxaa: ShaderPass;
  dofEnabled = true;
  dofStrength = RENDER.dof.strength;
  private pixel = false;
  private preset: PresetName = 'high';
  private width = 0;
  private height = 0;
  private pixelRatio = 0;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    this.scenePass = new ScenePass(scene, camera, size.x, size.y);
    this.gtao = new HalfGTAOPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: RENDER.ssao.radius, thickness: RENDER.ssao.thickness, scale: RENDER.ssao.scale, samples: 12 });
    this.gtao.blendIntensity = RENDER.ssao.blend;
    // Use the scene pass's own depth (normals reconstructed from it): it already has the dithered
    // see-through trees cut out and leaves out clouds and spray, so AO never draws their silhouettes.
    // It also saves rendering the whole scene a second time.
    if (this.scenePass.depth) this.gtao.setGBuffer(this.scenePass.depth);
    this.contact = new ContactShadowPass(this.scenePass, camera);
    this.dof = new DofPass(this.scenePass, RENDER.presets.high.dofSamples);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.flare = new ShaderPass(FlareShader);
    this.flare.material.uniforms.tDepth.value = this.scenePass.depth;
    this.smaa = new SMAAPass();
    this.fxaa = new ShaderPass(FXAAShader);

    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.contact);
    this.composer.addPass(this.dof);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.flare);
    this.composer.addPass(this.smaa);
    this.composer.addPass(this.fxaa);
  }

  applyPreset(p: PresetName): void {
    this.preset = p;
    const cfg = RENDER.presets[p];
    this.gtao.enabled = cfg.ssao;
    // Without GTAO the better phones get the cheap contact shading; the lowest preset gets neither.
    this.contact.enabled = !cfg.ssao && p === 'medium' && this.contactShadows;
    // Shafts walk the depth buffer twenty times a pixel: for the presets that can afford it.
    this.raysOn = cfg.ssao;
    this.bloom.enabled = cfg.bloom;
    // Pixel style keeps hard pixel edges: no anti-aliasing.
    this.smaa.enabled = cfg.smaa && !this.pixel;
    this.fxaa.enabled = !cfg.smaa && !this.pixel;
    this.dof.setSamples(cfg.dofSamples);
  }

  setPixelStyle(on: boolean): void {
    this.pixel = on;
    this.grade.material.uniforms.uPixel.value = on ? 1 : 0;
    this.applyPreset(this.preset);
  }

  setSize(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    // EffectComposer keeps its own pixel ratio. It must follow quality changes,
    // otherwise lowering quality leaves every post-processing pass at the old resolution.
    if (pr !== this.pixelRatio) this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.fxaa.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
  }

  /** Sun lens flare for the next frame: the sun's screen position (uv), strength 0..1 and colour. */
  setFlare(u: number, v: number, k: number, color: THREE.Color): void {
    this.flareK = k;
    const m = this.flare.material.uniforms;
    m.uSun.value.set(u, v);
    m.uK.value = k;
    m.uCol.value.copy(color);
    m.uAspect.value = this.width > 0 && this.height > 0 ? this.width / this.height : 1;
  }

  /**
   * Light shafts for this frame: round the low sun by day (golden, strongest in morning mist),
   * faint and silver round the moon at night; only while that light is in or near the view.
   */
  private shafts(): number {
    const u = this.flare.material.uniforms, ls = Lighting.current;
    u.uRays.value = 0;
    if (!ls || !this.raysOn || !this.lightShafts || this.pixel) return 0;
    const moon = ls.moon * 0.3, bySun = ls.shafts >= moon;
    const want = bySun ? ls.shafts : moon;
    if (want < 0.01) return 0;
    const cam = this.camera, from = bySun ? ls.sunSky : ls.moonSky;
    if (from.dot(cam.getWorldDirection(_fwd)) <= 0.05) return 0;
    const p = _proj.copy(from).multiplyScalar(1000).add(cam.position).project(cam);
    const k = want * (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(p.x), Math.abs(p.y)), 1.0, 1.35));
    if (k < 0.002) return 0;
    u.uRaySun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    u.uAspect.value = this.width > 0 && this.height > 0 ? this.width / this.height : 1;
    if (bySun) u.uRayCol.value.copy(ls.sunColor).lerp(RAY_GOLD, 0.5).multiplyScalar(0.55);
    else u.uRayCol.value.copy(RAY_MOON).multiplyScalar(0.5);
    u.uRays.value = k;
    return k;
  }

  /** @param focusDistance distance from the camera to the point at screen centre. */
  render(dt: number, focusDistance: number, night: number): void {
    const u = this.dof.material.uniforms;
    u.uFocus.value = focusDistance;
    u.uAperture.value = RENDER.dof.aperture * Math.pow(RENDER.dof.refDistance / focusDistance, 0.6);
    u.uStrength.value = this.dofStrength;
    this.dof.enabled = this.dofEnabled && this.dofStrength > 0.01;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    const g = this.grade.material.uniforms, ls = Lighting.current;
    g.uNight.value = night;
    g.uGolden.value = ls ? ls.golden : 0;
    g.uDusk.value = ls ? ls.dusk : 0;
    const rays = this.shafts();
    this.flare.enabled = this.flareK > 0.002 || rays > 0.002 || this.warmFlare;
    this.composer.render(dt);
  }
}
