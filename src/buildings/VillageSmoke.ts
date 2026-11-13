import * as THREE from 'three';
import { FX } from '../render/materials';

/** Somewhere smoke rises from (world space), and how strongly (0 none, 1 a full cooking fire). */
export interface SmokeSpot { key: number; x: number; y: number; z: number; power: number }

/** Puffs in the air at once over each fire. */
const PUFFS = 5;
/** Fires that can smoke at once (the rest go without: far more than a village has hearths). */
const MAX_SPOTS = 220;

/**
 * How hard the village's hearths are burning for the time of day (0..1): a thin wisp through the
 * working day, more at the morning and midday meals, most as supper is cooked in the evening, and
 * banked embers through the night. `day` is the day fraction (0..1) when known; without it the
 * depth of night stands in (dusk and dawn are the meals).
 */
export function hearthStrength(night: number, day = -1): number {
  const bump = (t: number, at: number, wide: number) => Math.max(0, 1 - Math.abs(t - at) / wide);
  if (day >= 0) {
    // Clock: 0.2 is six in the morning, 0.4 noon, 0.74 half past six, 0.86 half past eight.
    const meals = Math.max(bump(day, 0.235, 0.05) * 0.8, bump(day, 0.41, 0.045) * 0.75, Math.min(1, bump(day, 0.72, 0.16) * 1.6));
    const asleep = day > 0.9 || day < 0.15 ? 0.18 : 0.32;
    return Math.max(asleep, meals);
  }
  const meal = Math.min(1, bump(night, 0.35, 0.4) * 1.5);
  return Math.max(night > 0.8 ? 0.18 : 0.32, meal);
}

/**
 * Smoke from every hearth, cooking fire and working kiln in the village, in one draw. Each fire
 * owns a handful of points; where each puff is in its rise is worked out on the GPU from the clock
 * (no per-frame work here at all), so the only cost is a small upload when a fire is lit, moves or
 * changes strength. Puffs start thin and grey at the fire, swell and pale as they climb, lean with
 * the wind and fade out; the whole plume fades with distance from the camera.
 */
export class VillageSmoke {
  readonly points: THREE.Points;
  private origin: Float32Array;
  private power: Float32Array;
  private slots = new Map<number, number>();
  private used = new Uint8Array(MAX_SPOTS);
  private seen = new Set<number>();
  private uniforms = {
    uTime: FX.uTime,
    uWind: FX.uWind,
    uDay: { value: 1 },
    uFar: { value: 90 },
    uScale: { value: 600 },
    uDir: { value: new THREE.Vector2(0.8, 0.6) },
  };

  constructor() {
    const n = MAX_SPOTS * PUFFS;
    this.origin = new Float32Array(n * 3);
    this.power = new Float32Array(n);
    const seed = new Float32Array(n * 4);
    // Fixed per-puff randoms (a plain hash: decoration never draws on the simulation's RNG).
    const h = (i: number, k: number) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < n; i++) {
      // Puffs of one fire are spread evenly through the rise (with a little jitter), so it never pulses.
      seed[i * 4] = ((i % PUFFS) + h(i, 1) * 0.6) / PUFFS + h(Math.floor(i / PUFFS), 5);
      seed[i * 4 + 1] = h(i, 2);
      seed[i * 4 + 2] = h(i, 3);
      seed[i * 4 + 3] = h(i, 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.origin, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPower', new THREE.BufferAttribute(this.power, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aPower;
        attribute vec4 aSeed; // x: where in its rise, y: speed, z: wobble phase, w: size and drift
        uniform float uTime, uWind, uFar, uScale;
        uniform vec2 uDir;
        varying float vA, vAge;
        void main() {
          float age = fract(uTime * (0.15 + 0.05 * aSeed.y) + aSeed.x);
          float wind = clamp(uWind, 0.0, 3.0);
          vec3 p = position;
          // Up fast from the fire, slowing as it cools; a stronger fire throws it higher.
          p.y += (1.0 + 1.3 * aPower) * age * (1.0 - 0.3 * age);
          // Bent over by the wind the higher it gets, and wandering a little on the way.
          float w = 6.2832 * aSeed.z;
          p.xz += uDir * age * age * (0.35 + 0.9 * wind) * (0.7 + 0.6 * aSeed.w);
          p.x += sin(uTime * 0.8 + w + age * 5.0) * 0.07 * age;
          p.z += cos(uTime * 0.65 + w * 1.7 + age * 4.0) * 0.07 * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float fade = 1.0 - smoothstep(uFar * 0.6, uFar, -mv.z);
          vA = smoothstep(0.0, 0.12, age) * pow(1.0 - age, 1.4) * min(1.0, aPower * 1.4) * fade;
          vAge = age;
          float size = (0.14 + 0.6 * age) * (0.55 + 0.55 * aPower) * (0.8 + 0.4 * aSeed.w);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
          // Nothing to draw: off the screen altogether.
          if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uDay;
        varying float vA, vAge;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = pow(smoothstep(0.5, 0.0, d), 1.5) * vA * 0.5;
          if (a < 0.008) discard;
          // Darker and browner at the fire, paler as it thins; dim at night.
          vec3 col = mix(vec3(0.46, 0.43, 0.41), vec3(0.84, 0.82, 0.80), vAge) * (0.32 + 0.68 * uDay);
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.name = 'VillageSmoke';
    this.points.frustumCulled = false;
    this.points.renderOrder = 14;
  }

  /** How many fires are smoking (for tests and tuning). */
  get spots(): number {
    return this.slots.size;
  }

  /** How strongly a fire is smoking just now (0 when it is not). */
  strength(key: number): number {
    const e = this.slots.get(key);
    return e === undefined ? 0 : this.power[e * PUFFS];
  }

  /**
   * Set where smoke rises from. Called a few times a second, not every frame: strengths ease
   * toward what is asked (`ease` 0..1 per call), so a fire builds and dies away over a few seconds.
   * Each fire keeps its own points for as long as it burns (by its `key`), so lighting or putting
   * out one fire never disturbs another's plume.
   */
  sync(spots: SmokeSpot[], ease = 0.3): void {
    const g = this.points.geometry;
    let moved = false, changed = false;
    const set = (e: number, v: number) => {
      if (this.power[e * PUFFS] === v) return;
      for (let k = 0; k < PUFFS; k++) this.power[e * PUFFS + k] = v;
      changed = true;
    };
    this.seen.clear();
    for (const s of spots) {
      let e = this.slots.get(s.key);
      if (e === undefined) {
        // A newly lit fire takes the lowest free slot and starts from nothing.
        e = 0;
        while (e < MAX_SPOTS && this.used[e]) e++;
        if (e >= MAX_SPOTS) continue;
        this.used[e] = 1;
        this.slots.set(s.key, e);
        set(e, 0);
      }
      this.seen.add(s.key);
      const o = e * PUFFS * 3;
      if (this.origin[o] !== Math.fround(s.x) || this.origin[o + 1] !== Math.fround(s.y) || this.origin[o + 2] !== Math.fround(s.z)) {
        for (let k = 0; k < PUFFS; k++) this.origin.set([s.x, s.y, s.z], o + k * 3);
        moved = true;
      }
      const now = this.power[e * PUFFS];
      set(e, Math.abs(s.power - now) < 0.02 ? s.power : now + (s.power - now) * ease);
    }
    // Fires no longer listed die away, then give their slot up.
    let top = 0;
    for (const [key, e] of this.slots) {
      if (!this.seen.has(key)) {
        const next = this.power[e * PUFFS] * (1 - ease);
        if (next < 0.02) {
          set(e, 0);
          this.used[e] = 0;
          this.slots.delete(key);
          continue;
        }
        set(e, next);
      }
      top = Math.max(top, e + 1);
    }
    if (g.drawRange.count !== top * PUFFS) g.setDrawRange(0, top * PUFFS);
    if (moved) (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (changed) (g.getAttribute('aPower') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Daylight on the smoke (0 night .. 1 day) and how far away it fades out. */
  light(night: number, far: number): void {
    this.uniforms.uDay.value = 1 - night;
    this.uniforms.uFar.value = far;
  }
}
