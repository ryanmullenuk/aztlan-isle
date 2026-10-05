import * as THREE from 'three';
import { FX } from '../render/materials';
import { SEA_SURFACE } from '../water/Water';

/** A moment in a boat's recent course: where it was, which way it faced, how hard it was going. */
interface Sample {
  x: number;
  z: number;
  /** Unit heading (sin, cos). */
  fx: number;
  fz: number;
  /** Clock time it was laid down. */
  t: number;
  /** Speed against the boat's cruising speed (0..1.2), and in world units per second. */
  s: number;
  v: number;
}

interface Trail {
  samples: Sample[];
  /** Half length and half beam of the hull (world units) and its size against a fishing canoe. */
  half: number;
  beam: number;
  size: number;
  /** Seconds foam lasts behind this boat. */
  life: number;
  /** Where the boat is right now (the head of the trail), refreshed every frame it moves. */
  head: Sample | null;
  lastSeen: number;
}

/** Laid every this far (scaled by hull size) or this often, whichever comes first. */
const STEP = 0.16;
const STEP_SECONDS = 0.12;
const MAX_SAMPLES = 64;
const MAX_TRAILS = 32;
/** Three ribbons per trail (port arm, starboard arm, churned centre), two vertices per sample. */
const MAX_VERTS = MAX_TRAILS * 3 * (MAX_SAMPLES + 1) * 2;
const MAX_INDEX = MAX_TRAILS * 3 * MAX_SAMPLES * 6;

/**
 * Animated foam wakes behind every boat on the sea, drawn as ribbons along each boat's recent
 * course: two crisp arms of broken white foam peeling away from the bow in a V and spreading as
 * they go (bending with the boat's path), and a churned, frothy trail of aerated water straight
 * behind the stern. The foam is lacy rather than solid: ridged noise that drifts and boils, and
 * breaks into scattered flecks as it ages before fading out.
 */
export class WakeTrails {
  readonly mesh: THREE.Mesh;
  private trails = new Map<object, Trail>();
  private clock = 0;
  private pos = new Float32Array(MAX_VERTS * 3);
  /** x: across the ribbon (-1..1), y: age (0 new .. 1 gone), z: strength, w: 0 arm / 1 centre. */
  private info = new Float32Array(MAX_VERTS * 4);
  private index = new Uint32Array(MAX_INDEX);

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWake', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: FX.uTime }]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec4 aWake;
        varying vec4 vWake;
        varying vec2 vW;
        void main() {
          vWake = aWake;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        varying vec4 vWake;
        varying vec2 vW;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }
        // Ridged noise: thin bright filaments with gaps between, like a lace of foam.
        float ridge(vec2 p) { return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }
        void main() {
          float across = abs(vWake.x), age = vWake.y, strength = vWake.z;
          bool centre = vWake.w > 0.5;
          vec2 p = vW;
          // Foam drifts and boils slowly; the two scales move against each other.
          float lace = ridge(p * 5.5 + vec2(uTime * 0.21, -uTime * 0.17)) * 0.68
                     + vnoise(p * 15.0 - vec2(uTime * 0.5, uTime * 0.31)) * 0.32;
          float fleck = vnoise(p * 34.0 + uTime * 0.9);
          float fade = pow(1.0 - age, 1.25);
          vec3 white = vec3(0.97, 0.99, 1.0);
          vec3 col; float a;
          if (!centre) {
            // The arms: a crisp bright crest that frays and breaks into flecks as it spreads.
            float core = 1.0 - smoothstep(0.0, 1.0, across);
            float threshold = 0.5 + 0.3 * age;
            float bow = exp(-age * 9.0);
            float foam = smoothstep(threshold, threshold + 0.06, lace * core * 1.15 + core * core * 0.18 * (1.0 - age) + core * 0.35 * bow);
            // Loose flecks scattered round the crest.
            foam = max(foam, step(0.84, fleck) * (1.0 - smoothstep(0.6, 1.0, across)) * (1.0 - age));
            col = white;
            a = foam * fade * 0.9;
          } else {
            // The churned trail: pale aerated water with boiling foam patches over it.
            float core = 1.0 - smoothstep(0.15, 1.0, across);
            float threshold = 0.55 + 0.3 * age;
            // White, boiling churn right behind the stern, breaking up into patches further back.
            float foam = smoothstep(threshold, threshold + 0.08, lace * core * 1.1 + core * 0.4 * exp(-age * 6.0));
            foam = max(foam, step(0.87, fleck) * core * (1.0 - age));
            float aerated = core * (1.0 - age) * 0.26;
            col = mix(vec3(0.6, 0.85, 0.87), white, foam);
            a = max(foam * 0.85, aerated) * fade;
            // Ease in right behind the stern so the trail grows out of the hull.
            a *= smoothstep(0.0, 0.035, age);
          }
          a *= clamp(strength, 0.0, 1.0);
          if (a < 0.02) discard;
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    material.customProgramCacheKey = () => 'boat-wake-v3';
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 14;
    this.mesh.name = 'Boat wakes';
  }

  /**
   * Note where a boat is this frame. `s` is its speed against its cruising speed; below a crawl
   * nothing new is laid and its trail simply fades behind it.
   */
  record(v: object & { x: number; z: number; heading: number; speed: number }, half: number, beam: number, size: number, s: number): void {
    let tr = this.trails.get(v);
    if (!tr) {
      if (this.trails.size >= MAX_TRAILS) return;
      tr = { samples: [], half, beam, size, life: 2.4 + 1.3 * size, head: null, lastSeen: this.clock };
      this.trails.set(v, tr);
    }
    tr.half = half; tr.beam = beam; tr.size = size;
    tr.lastSeen = this.clock;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const head: Sample = { x: v.x, z: v.z, fx, fz, t: this.clock, s, v: Math.max(0, v.speed) };
    tr.head = s > 0.06 ? head : null;
    if (s <= 0.06) return;
    const last = tr.samples[0];
    if (!last || Math.hypot(v.x - last.x, v.z - last.z) > STEP * size || this.clock - last.t > STEP_SECONDS) {
      tr.samples.unshift(head);
      if (tr.samples.length > MAX_SAMPLES) tr.samples.length = MAX_SAMPLES;
    }
  }

  update(dt: number): void {
    this.clock += dt;
    let vi = 0, ii = 0;
    for (const [key, tr] of this.trails) {
      // Drop foam that has run its course, and trails of boats that have gone.
      while (tr.samples.length && this.clock - tr.samples[tr.samples.length - 1].t > tr.life) tr.samples.pop();
      if (!tr.samples.length && this.clock - tr.lastSeen > 1) {
        this.trails.delete(key);
        continue;
      }
      if (this.clock - tr.lastSeen > 0.25) tr.head = null;
      const n = tr.samples.length + (tr.head ? 1 : 0);
      if (n < 2) continue;
      const at = (k: number): Sample => (tr.head ? (k === 0 ? tr.head : tr.samples[k - 1]) : tr.samples[k]);
      for (let kind = 0; kind < 3; kind++) {
        if (vi + n * 2 > MAX_VERTS || ii + (n - 1) * 6 > MAX_INDEX) break;
        const start = vi;
        for (let k = 0; k < n; k++) {
          const p = at(k);
          const age = Math.min(1, (this.clock - p.t) / tr.life), secs = this.clock - p.t;
          const qx = p.fz, qz = -p.fx;
          let cx: number, cz: number, w: number;
          const strength = Math.min(1, 0.35 + p.s);
          if (kind < 2) {
            // An arm peels off each bow shoulder and spreads outward as the boat leaves it behind,
            // opening at about the angle of a real wake (sideways a third as fast as the boat goes).
            const side = kind === 0 ? -1 : 1;
            const spread = tr.beam * 0.7 + secs * p.v * 0.34;
            cx = p.x + p.fx * tr.half * 0.78 + qx * spread * side;
            cz = p.z + p.fz * tr.half * 0.78 + qz * spread * side;
            // Thick, piled-up froth against the hull at the bow, thinning to a crest as it spreads.
            w = (0.045 + 0.11 * age + 0.09 * Math.exp(-age * 10)) * tr.size * (0.75 + 0.4 * p.s);
          } else {
            cx = p.x - p.fx * tr.half * 0.82;
            cz = p.z - p.fz * tr.half * 0.82;
            w = tr.beam * (0.5 + 1.2 * age) * (0.75 + 0.35 * p.s);
          }
          for (let u = -1; u <= 1; u += 2) {
            const o = vi * 3, q = vi * 4;
            this.pos[o] = cx + qx * w * u;
            this.pos[o + 1] = SEA_SURFACE + 0.05 + (kind < 2 ? 0.004 : 0);
            this.pos[o + 2] = cz + qz * w * u;
            this.info[q] = u;
            this.info[q + 1] = age;
            this.info[q + 2] = strength;
            this.info[q + 3] = kind === 2 ? 1 : 0;
            vi++;
          }
        }
        for (let k = 0; k < n - 1; k++) {
          const a = start + k * 2;
          const x = this.index;
          x[ii] = a; x[ii + 1] = a + 1; x[ii + 2] = a + 2;
          x[ii + 3] = a + 1; x[ii + 4] = a + 3; x[ii + 5] = a + 2;
          ii += 6;
        }
      }
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, ii);
    if (!ii) return;
    for (const [name, n] of [['position', 3], ['aWake', 4]] as const) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, vi * n);
      attr.needsUpdate = true;
    }
    const idx = g.index!;
    idx.clearUpdateRanges();
    idx.addUpdateRange(0, ii);
    idx.needsUpdate = true;
  }

  /** Boats with foam behind them (for tests and debugging). */
  get count(): number {
    return this.trails.size;
  }
}
