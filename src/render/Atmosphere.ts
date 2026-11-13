import * as THREE from 'three';
import { PresetName } from '../config';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import type { LightState } from './Lighting';
import { LightShafts } from './LightShafts';

/** Most banks of mist drawn at once, by preset (one instanced draw; phones get fewer). */
export const MIST_COUNT: Record<PresetName, number> = { low: 36, medium: 60, high: 110, ultra: 140 };
const MAX_MIST = 140;
/** The sea's surface (as the water is drawn). */
const SEA = 0.07;

/** One bank of mist: a soft, level sheet lying just over the ground or the water. */
export interface MistSpot {
  x: number;
  y: number;
  z: number;
  r: number;
  /** 0..1: how early it burns off (still water and hollows hold their mist longest). */
  burn: number;
  phase: number;
  /** What it lies on. */
  on: 'water' | 'land';
}

/**
 * Where the mist lies: over rivers, lakes and the sheltered sea close inshore, and in the low,
 * level places of the land (hollows first). Each bank is fitted to ground level enough to hold
 * it, floating just clear of the highest point under it, so no sheet ever cuts into a hillside.
 * The list is in order of preference: lower presets draw only the first of them.
 */
export function mistSpots(world: World, max = MAX_MIST): MistSpot[] {
  const rng = new RNG(world.seed * 37 + 11);
  const N = world.N;
  const top = (x: number, z: number): number => {
    const i = world.cellIndexAt(x, z);
    if (i >= 0 && !Number.isNaN(world.riverY[i])) return Math.max(world.riverY[i], world.heightAt(x, z));
    return Math.max(SEA, world.heightAt(x, z));
  };
  const cand: (MistSpot & { w: number })[] = [];
  for (let cz = 3; cz < N - 3; cz += 4) for (let cx = 3; cx < N - 3; cx += 4) {
    const x = world.centerX(cx) + rng.range(-1.5, 1.5), z = world.centerZ(cz) + rng.range(-1.5, 1.5);
    const r0 = rng.range(6, 10.5), jitter = rng.next(), phase = rng.range(0, 100);
    const i = world.cellIndexAt(x, z);
    if (i < 0) continue;
    const L = world.layer[i], river = !Number.isNaN(world.riverY[i]);
    let w = 0, on: MistSpot['on'] = 'land';
    if (river) {
      w = 1.25;
      on = 'water';
    } else if (L <= 0) {
      on = 'water';
      if (!world.isSea(i)) w = 1.4; // lakes and pools
      else {
        // The sea only close inshore: the more land round about (a bay, a lagoon), the more mist.
        let land = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          for (const d of [5, 10]) {
            const j = world.cellIndexAt(x + Math.cos(a) * d, z + Math.sin(a) * d);
            if (j >= 0 && world.layer[j] >= 1) { land++; break; }
          }
        }
        if (land === 0) continue;
        w = 0.45 + 0.1 * land;
      }
    } else if (L <= 6) {
      // Low ground: how far it lies below the land round it (a valley floor), and how wet it is.
      const h0 = world.heightAt(x, z);
      let ring = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ring += top(x + Math.cos(a) * 9, z + Math.sin(a) * 9);
      }
      const hollow = THREE.MathUtils.clamp((ring / 8 - h0) / 1.2, 0, 1);
      w = 0.3 + 0.9 * hollow + (L <= 2 ? 0.2 : 0) + 0.5 * world.swamp[i] + 0.15 * world.forest[i];
      if (w < 0.45) continue;
    } else continue;
    // Fit it: shrink until the ground under it is level enough, then float it clear of the highest point.
    const h0 = top(x, z);
    for (const r of [r0, r0 * 0.7, r0 * 0.5]) {
      let hi = h0;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, d = k % 2 ? r * 0.85 : r * 0.45;
        hi = Math.max(hi, top(x + Math.cos(a) * d, z + Math.sin(a) * d));
      }
      if (hi - h0 > 0.9) continue;
      cand.push({ x, y: hi + (on === 'water' ? 0.3 : 0.4), z, r, burn: THREE.MathUtils.clamp(1.15 - w * 0.6 - jitter * 0.3, 0, 1), phase, on, w: w * (0.75 + 0.5 * jitter) });
      break;
    }
  }
  cand.sort((a, b) => b.w - a.w);
  const out: MistSpot[] = [];
  for (const c of cand) {
    if (out.length >= max) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 0.6 * Math.max(o.r, c.r))) continue;
    out.push({ x: c.x, y: c.y, z: c.z, r: c.r, burn: c.burn, phase: c.phase, on: c.on });
  }
  return out;
}

const NIGHT_MIST = new THREE.Color(0.2, 0.27, 0.42), DAWN_MIST = new THREE.Color(0.92, 0.86, 0.8);
const _m = new THREE.Matrix4();

/**
 * Morning mist. It gathers thinly over the water in the small hours, lies thick in the valleys
 * and over lakes, rivers and bays at first light (glowing where the low sun shines through it),
 * then breaks into patches and burns off through the morning, the open ground clearing first.
 * Level, soft-edged sheets of drifting noise in one instanced draw: no textures, and nothing is
 * drawn at all for the rest of the day.
 */
export class Mist {
  readonly mesh: THREE.InstancedMesh;
  readonly spots: MistSpot[];
  private mat: THREE.ShaderMaterial;

  constructor(world: World, preset: PresetName) {
    this.spots = mistSpots(world);
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const n = Math.max(1, this.spots.length), seed = new Float32Array(n * 2);
    this.spots.forEach((s, k) => seed.set([s.phase, s.burn], k * 2));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMist: { value: 0 },
        uDrift: { value: new THREE.Vector2() },
        uCol: { value: new THREE.Color(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uGlow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSeed;
        uniform float uMist;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying vec2 vW;
        varying float vK;
        varying float vFace;
        varying float vGlow;
        void main() {
          vUv = uv;
          // Each bank has its own hour to burn off: thinning as the mist as a whole thins.
          float hold = aSeed.y * 0.55;
          vK = clamp((uMist - hold) / (1.0 - hold), 0.0, 1.0);
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec3 toCam = normalize(cameraPosition - wp.xyz);
          // A level sheet seen edge-on is a hard line: it fades out as the view comes down to it.
          vFace = smoothstep(0.05, 0.32, abs(toCam.y));
          // Looking toward the low sun the mist lights up.
          float f = max(dot(-toCam, uSunDir), 0.0);
          vGlow = f * f * f;
          vW = wp.xz * 0.085 + aSeed.x;
          gl_Position = vK > 0.003 ? projectionMatrix * viewMatrix * wp : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uDrift;
        uniform vec3 uCol;
        uniform float uGlow;
        varying vec2 vUv;
        varying vec2 vW;
        varying float vK;
        varying float vFace;
        varying float vGlow;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float edge = 1.0 - smoothstep(0.2, 1.0, r);
          vec2 p = vW + uDrift;
          float body = vnoise(p) * 0.6 + vnoise(p * 2.3 - uDrift * 1.7) * 0.28 + vnoise(p * 5.1 + uDrift * 2.3) * 0.12;
          // Thick mist is one soft bank; as it burns off, holes open and it breaks into wisps.
          float cut = mix(1.05, 0.15, vK);
          float a = smoothstep(cut, cut + 0.4, body * 0.6 + edge * 0.6) * edge * vFace * (0.55 + 0.45 * vK);
          if (a < 0.004) discard;
          gl_FragColor = vec4(uCol * (1.0 + uGlow * vGlow), a * 0.3);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n);
    this.spots.forEach((s, k) => this.mesh.setMatrixAt(k, _m.makeScale(s.r, 1, s.r).setPosition(s.x, s.y, s.z)));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.frustumCulled = false;
    // After the water and its foam, under the clouds.
    this.mesh.renderOrder = 16;
    this.mesh.name = 'Mist';
    this.mesh.visible = false;
    this.setPreset(preset);
  }

  setPreset(p: PresetName): void {
    this.mesh.count = Math.min(this.spots.length, MIST_COUNT[p]);
  }

  /** @param time seconds, standing still when motion is off. */
  update(time: number, ls: LightState): void {
    this.mesh.visible = ls.mist > 0.01 && this.mesh.count > 0;
    if (!this.mesh.visible) return;
    const u = this.mat.uniforms;
    u.uMist.value = ls.mist;
    u.uDrift.value.set(time * 0.011, time * 0.006);
    // Lit by whatever light there is: dim and blue under the moon, pale and warm at sunrise.
    const lit = 0.55 + 0.45 * Math.min(1, ls.sunIntensity / 3);
    u.uCol.value.copy(NIGHT_MIST).lerp(DAWN_MIST, ls.day).multiplyScalar(1 + (lit - 1) * ls.day).lerp(ls.sunColor, 0.3 * ls.golden);
    u.uSunDir.value.copy(ls.sunSky);
    u.uGlow.value = 0.7 * ls.golden;
  }
}

/**
 * The air of the island: morning mist and shafts of low sunlight. Both follow the light of the
 * day (LightState: mist, shafts, golden) and draw nothing when there is none of either.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  readonly mist: Mist;
  readonly shafts: LightShafts;
  /** Its own clock: runs only while things may move (the motion setting). */
  private time = 0;

  constructor(world: World, preset: PresetName) {
    this.group.name = 'Atmosphere';
    this.mist = new Mist(world, preset);
    this.shafts = new LightShafts(world, preset);
    this.group.add(this.mist.mesh, this.shafts.mesh);
  }

  setPreset(p: PresetName): void {
    this.mist.setPreset(p);
    this.shafts.setPreset(p);
  }

  /** @param motion false holds the mist's drift and the shafts' shimmer still. */
  update(dt: number, ls: LightState, motion = true): void {
    if (motion) this.time += dt;
    this.mist.update(this.time, ls);
    this.shafts.update(this.time, ls);
  }
}
