import * as THREE from 'three';
import { PresetName } from '../config';
import { RNG } from '../world/rng';
import { Ground, World } from '../world/World';
import type { LightState } from './Lighting';

/** Most shafts drawn at once, by preset (one instanced draw; phones get fewer). */
export const SHAFT_COUNT: Record<PresetName, number> = { low: 20, medium: 36, high: 64, ultra: 80 };
const MAX_SHAFTS = 80;
const deg = Math.PI / 180;

/** Where a shaft comes down among the trees. */
export interface ShaftSpot {
  x: number;
  y: number;
  z: number;
  /** Length along the beam and width at the ground. */
  len: number;
  width: number;
  phase: number;
  /** How strong the shafts must be before this one shows (so they come and go a few at a time). */
  from: number;
}

/** Places for shafts: scattered through the jungle (and the willow glade), well apart, on open ground. */
export function shaftSpots(world: World, max = MAX_SHAFTS): ShaftSpot[] {
  const rng = new RNG(world.seed * 53 + 19);
  const N = world.N, cand: ShaftSpot[] = [];
  for (let cz = 2; cz < N - 2; cz += 3) for (let cx = 2; cx < N - 2; cx += 3) {
    const x = world.centerX(cx) + rng.range(-1.2, 1.2), z = world.centerZ(cz) + rng.range(-1.2, 1.2);
    const keep = rng.next();
    const i = world.cellIndexAt(x, z);
    if (i < 0 || !world.isLandCell(i) || world.occ[i] !== 0) continue;
    const g = world.glade, inGlade = !!g && Math.hypot(x - g.x, z - g.z) < g.r * 1.3;
    const wooded = world.ground[i] === Ground.Jungle || world.forest[i] > 0.5;
    if (!wooded && !(inGlade && keep < 0.5)) continue;
    cand.push({ x, y: world.heightAt(x, z), z, len: rng.range(6.5, 10.5), width: rng.range(1.3, 2.6), phase: rng.range(0, 6.28), from: rng.range(0, 0.55) });
  }
  // Shuffled, then taken while they keep their distance: an even scatter, not a row.
  for (let k = cand.length - 1; k > 0; k--) {
    const j = Math.floor(rng.next() * (k + 1));
    [cand[k], cand[j]] = [cand[j], cand[k]];
  }
  const out: ShaftSpot[] = [];
  for (const c of cand) {
    if (out.length >= max) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 5)) continue;
    out.push(c);
  }
  return out;
}

/**
 * The direction the shafts slant up along: toward the sun's side of the sky, but never flatter
 * than a steep slant (a truly low sun's rays would lie along the ground and cut through the hill
 * behind) and never straight down.
 */
export function shaftAxis(sunSky: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const el = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(sunSky.y, -1, 1)), 34 * deg, 66 * deg);
  const h = Math.hypot(sunSky.x, sunSky.z);
  const ax = h > 1e-5 ? sunSky.x / h : 1, az = h > 1e-5 ? sunSky.z / h : 0;
  return out.set(ax * Math.cos(el), Math.sin(el), az * Math.cos(el));
}

/**
 * Shafts of sunlight slanting down through the trees while the sun is low: soft, see-through
 * ribbons of warm light, each turned about its own length to face the camera, fading at both
 * ends. They show a few at a time as the light strengthens, shimmer slowly, and are strongest
 * in the morning mist. One instanced draw, no textures; nothing is drawn at midday or at night.
 */
export class LightShafts {
  readonly mesh: THREE.Mesh;
  readonly spots: ShaftSpot[];
  private mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;

  constructor(world: World, preset: PresetName) {
    this.spots = shaftSpots(world);
    const base = new THREE.PlaneGeometry(1, 1, 1, 4);
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const n = this.spots.length, at = new Float32Array(n * 3), shape = new Float32Array(n * 4);
    this.spots.forEach((s, k) => {
      at.set([s.x, s.y, s.z], k * 3);
      shape.set([s.len, s.width, s.phase, s.from], k * 4);
    });
    geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(at, 3));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAxis: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() }, uK: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(1, 0.8, 0.55) } },
      vertexShader: /* glsl */ `
        attribute vec3 aBase;
        attribute vec4 aShape;
        uniform vec3 uAxis;
        uniform float uK, uTime;
        varying vec2 vUv;
        varying float vA;
        void main() {
          vUv = uv;
          // Each shaft comes in at its own strength of light, and breathes slowly.
          float show = smoothstep(aShape.w, aShape.w + 0.25, uK);
          vec3 c = aBase + uAxis * (uv.y * aShape.x);
          vec3 toCam = normalize(cameraPosition - c);
          // Seen end-on a ribbon is nothing but its edge: let it go.
          float along = abs(dot(toCam, uAxis));
          vA = show * (1.0 - along * along * along * along) * (0.72 + 0.28 * sin(uTime * 0.5 + aShape.z));
          vec3 side = normalize(cross(uAxis, toCam) + 1e-5);
          // Spreading a little toward the ground.
          vec3 wp = c + side * (uv.x - 0.5) * aShape.y * mix(1.25, 0.6, uv.y);
          gl_Position = vA > 0.003 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCol;
        varying vec2 vUv;
        varying float vA;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          across = across * across * (3.0 - 2.0 * across);
          // Out of nothing in the canopy, brightest part-way down, gone before it meets the ground.
          float along = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y));
          gl_FragColor = vec4(uCol * across * along * vA, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 17;
    this.mesh.name = 'Light shafts';
    this.mesh.visible = false;
    this.setPreset(preset);
  }

  setPreset(p: PresetName): void {
    this.geo.instanceCount = Math.min(this.spots.length, SHAFT_COUNT[p]);
  }

  /** @param time seconds, standing still when motion is off. */
  update(time: number, ls: LightState): void {
    const k = ls.shafts;
    this.mesh.visible = k > 0.01 && this.geo.instanceCount > 0;
    if (!this.mesh.visible) return;
    const u = this.mat.uniforms;
    shaftAxis(ls.sunSky, u.uAxis.value);
    u.uK.value = k;
    u.uTime.value = time;
    // The sun's own colour, deeper gold at golden hour; never bright enough to wash the trees out.
    u.uCol.value.copy(ls.sunColor).multiplyScalar(0.2 + 0.1 * ls.golden + 0.12 * ls.mist);
  }
}
