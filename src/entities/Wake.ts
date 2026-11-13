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
const STEP = 0.2;
const STEP_SECONDS = 0.14;
const MAX_SAMPLES = 72;
const MAX_TRAILS = 32;
/**
 * Five ribbons per trail (port and starboard arms, the churned centre, and a fainter second pair
 * of arms inside the first), two vertices per sample.
 */
const RIBBONS = 5;
const MAX_VERTS = MAX_TRAILS * RIBBONS * (MAX_SAMPLES + 1) * 2;
const MAX_INDEX = MAX_TRAILS * RIBBONS * MAX_SAMPLES * 6;
/** How fast the arms open: sideways this share of the boat's speed (a real wake's angle, about 19 degrees). */
const SPREAD = 0.34;

/**
 * Animated foam wakes behind every boat on the sea (and anything else that swims: see swimmer()),
 * drawn as ribbons along its recent course: two arms peeling away from the bow in a V and
 * spreading as they go (bending with the boat's path), each a crisp crest of white on its outer
 * edge with lace feathering back inside it and a thin dark flank outside; a fainter second pair
 * of arms opening more slowly inside the first; and a churned, frothy trail of pale aerated water
 * straight behind the stern. The foam is lacy rather than solid: ridged noise that drifts and
 * boils, and breaks into scattered flecks as it ages before fading out. It dims with the night.
 */
export class WakeTrails {
  readonly mesh: THREE.Mesh;
  private trails = new Map<object, Trail>();
  private clock = 0;
  private pos = new Float32Array(MAX_VERTS * 3);
  /**
   * x: across the ribbon (-1..1; on the arms +1 is the outer edge), y: age (0 new .. 1 gone),
   * z: strength, w: 0 arm / 0.5 inner arm / 1 centre.
   */
  private info = new Float32Array(MAX_VERTS * 4);
  private index = new Uint32Array(MAX_INDEX);

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWake', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: FX.uTime, uNight: FX.uNight },
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
        uniform float uNight;
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
          // (Clamped: a varying a hair past 1 would make the fade's pow() a NaN on some GPUs.)
          float side = vWake.x, across = abs(vWake.x), age = clamp(vWake.y, 0.0, 1.0), strength = vWake.z;
          bool centre = vWake.w > 0.75, inner = vWake.w > 0.25 && vWake.w <= 0.75;
          vec2 p = vW;
          // Foam drifts and boils slowly; the two scales move against each other.
          float lace = ridge(p * 5.5 + vec2(uTime * 0.21, -uTime * 0.17)) * 0.68
                     + vnoise(p * 15.0 - vec2(uTime * 0.5, uTime * 0.31)) * 0.32;
          float fleck = vnoise(p * 34.0 + uTime * 0.9);
          float fade = pow(1.0 - age, 1.25);
          // Foam is lit by the day: by night it sinks to a dim grey-blue instead of glowing white.
          float lightK = mix(1.0, 0.3, clamp(uNight, 0.0, 1.0));
          vec3 white = vec3(0.97, 0.99, 1.0) * lightK;
          vec3 col; float a;
          if (centre) {
            // The churned trail: pale aerated water with boiling foam patches over it.
            float core = 1.0 - smoothstep(0.15, 1.0, across);
            float threshold = 0.55 + 0.3 * age;
            // White, boiling churn right behind the stern, breaking up into patches further back.
            float foam = smoothstep(threshold, threshold + 0.08, lace * core * 1.1 + core * 0.4 * exp(-age * 6.0));
            foam = max(foam, step(0.87, fleck) * core * (1.0 - age));
            // The smoothed, milky water the hull leaves lasts longest of all.
            float aerated = core * (1.0 - age) * 0.28;
            col = mix(vec3(0.6, 0.85, 0.87) * lightK, white, foam);
            a = max(foam * 0.85, aerated) * fade;
            // Ease in right behind the stern so the trail grows out of the hull.
            a *= smoothstep(0.0, 0.035, age);
          } else {
            // The arms. The crest runs along the outer part of the ribbon: crisp and bright where
            // it leaves the bow, fraying into lace and then flecks as it spreads. Inside it, foam
            // feathers back towards the boat's track; outside, the raised wave's flank is a thin
            // dark line, which is what makes the V read as a wave and not a painted stripe.
            float crest = 1.0 - smoothstep(0.0, 0.2 + 0.22 * age, abs(side - 0.42));
            float feather = smoothstep(-1.0, 0.42, side) * (1.0 - smoothstep(0.42, 0.62, side));
            float body = max(crest, feather * (0.6 - 0.35 * age));
            float bow = exp(-age * 9.0);
            float threshold = (inner ? 0.56 : 0.44) + 0.4 * age;
            float foam = smoothstep(threshold, threshold + 0.07, lace * body * 1.2 + crest * (0.22 * (1.0 - age) + 0.45 * bow));
            // Loose flecks scattered round the crest.
            foam = max(foam, step(0.84, fleck) * (1.0 - smoothstep(0.55, 1.0, across)) * (1.0 - age) * (inner ? 0.5 : 1.0));
            float flank = inner ? 0.0 : smoothstep(0.5, 0.7, side) * (1.0 - smoothstep(0.78, 1.0, side)) * (1.0 - age) * 0.24;
            col = mix(vec3(0.02, 0.13, 0.17) * lightK, white, smoothstep(0.0, 0.25, foam));
            a = max(foam * (inner ? 0.5 : 0.9), flank) * fade;
            // The inner arms rise out of the churn a little way behind the bow.
            if (inner) a *= smoothstep(0.03, 0.12, age);
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
    material.customProgramCacheKey = () => 'boat-wake-v4';
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
    this.lay(v, v.x, v.z, v.heading, v.speed, half, beam, size, s);
  }

  /**
   * The same for anything that swims at the surface (a dog, a turtle, an alligator): call it every
   * frame the animal is in the water. `key` is the animal itself (one trail each), `length` its
   * body length in world units, `cruise` its usual swimming speed (the wake is weaker below it).
   */
  swimmer(key: object, x: number, z: number, heading: number, speed: number, length: number, cruise = speed): void {
    const half = length * 0.5;
    this.lay(key, x, z, heading, speed, half, half * 0.45, Math.max(0.35, length / 1.5), Math.min(1.2, Math.max(0, speed) / Math.max(cruise, 1e-3)) * 0.8);
  }

  private lay(v: object, x: number, z: number, heading: number, speed: number, half: number, beam: number, size: number, s: number): void {
    let tr = this.trails.get(v);
    if (!tr) {
      if (this.trails.size >= MAX_TRAILS) return;
      // Long enough for the V to open well out behind the boat before it goes.
      tr = { samples: [], half, beam, size, life: 2.6 + 2.0 * Math.min(size, 2.5), head: null, lastSeen: this.clock };
      this.trails.set(v, tr);
    }
    tr.half = half; tr.beam = beam; tr.size = size;
    tr.lastSeen = this.clock;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const head: Sample = { x, z, fx, fz, t: this.clock, s, v: Math.max(0, speed) };
    tr.head = s > 0.06 ? head : null;
    if (s <= 0.06) return;
    const last = tr.samples[0];
    if (!last || Math.hypot(x - last.x, z - last.z) > STEP * size || this.clock - last.t > STEP_SECONDS) {
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
      for (let kind = 0; kind < RIBBONS; kind++) {
        if (vi + n * 2 > MAX_VERTS || ii + (n - 1) * 6 > MAX_INDEX) break;
        const start = vi;
        for (let k = 0; k < n; k++) {
          const p = at(k);
          const age = Math.min(1, (this.clock - p.t) / tr.life), secs = this.clock - p.t;
          const qx = p.fz, qz = -p.fx;
          let cx: number, cz: number, w: number;
          const strength = Math.min(1, 0.35 + p.s);
          let side = 1, type = 0;
          if (kind !== 2) {
            // An arm peels off each bow shoulder and spreads outward as the boat leaves it behind,
            // opening at about the angle of a real wake (sideways a third as fast as the boat goes,
            // easing a little as it tires). The inner pair opens half as fast, from further aft.
            const inner = kind > 2;
            side = kind === 0 || kind === 3 ? -1 : 1;
            type = inner ? 0.5 : 0;
            const open = secs * p.v * SPREAD * (1 - 0.2 * age) * (inner ? 0.5 : 1);
            const spread = tr.beam * (inner ? 0.55 : 0.7) + open;
            const fore = tr.half * (inner ? 0.25 : 0.78);
            cx = p.x + p.fx * fore + qx * spread * side;
            cz = p.z + p.fz * fore + qz * spread * side;
            // Thick, piled-up froth against the hull at the bow, thinning to a crest that widens as it spreads.
            w = (0.06 + 0.2 * age + 0.09 * Math.exp(-age * 10)) * tr.size * (0.75 + 0.4 * p.s) * (inner ? 0.8 : 1);
          } else {
            type = 1;
            cx = p.x - p.fx * tr.half * 0.82;
            cz = p.z - p.fz * tr.half * 0.82;
            w = tr.beam * (0.5 + 1.2 * age) * (0.75 + 0.35 * p.s);
          }
          for (let u = -1; u <= 1; u += 2) {
            const o = vi * 3, q = vi * 4;
            this.pos[o] = cx + qx * w * u;
            this.pos[o + 1] = SEA_SURFACE + 0.05 + (kind === 2 ? 0 : kind < 2 ? 0.006 : 0.003);
            this.pos[o + 2] = cz + qz * w * u;
            // On the arms, +1 is the edge furthest from the boat's track.
            this.info[q] = u * side;
            this.info[q + 1] = age;
            this.info[q + 2] = strength;
            this.info[q + 3] = type;
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
