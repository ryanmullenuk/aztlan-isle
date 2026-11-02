import * as THREE from 'three';
import { stylisedMaterial } from '../render/materials';
import { SEA_SURFACE } from '../water/Water';
import type { Water } from '../water/Water';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { fishGeometry } from './fishModels';

const FIREFLY_VS = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uVis;
  uniform float uPx;
  varying float vGlow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Each blinks on its own beat: a slow swell, a bright pulse, then dark for a while.
    float b = fract(uTime * (0.22 + fract(aPhase * 7.1) * 0.18) + aPhase);
    vGlow = (0.15 + 0.85 * smoothstep(0.0, 0.1, b) * (1.0 - smoothstep(0.3, 0.55, b))) * uVis;
    // Small: pinpricks of light, a few pixels across even close to the camera.
    gl_PointSize = clamp(uPx * 0.15 * projectionMatrix[1][1] / max(-mv.z, 0.5) * (0.5 + vGlow * 0.7), 1.5, uPx * 0.012);
    gl_Position = projectionMatrix * mv;
  }`;

const FIREFLY_FS = /* glsl */ `
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.0, 0.22, d), halo = (1.0 - smoothstep(0.0, 1.0, d)) * 0.3;
    float a = (core + halo) * vGlow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(0.8, 1.0, 0.35) * a * 3.5, 1.0);
  }`;

/**
 * Fireflies: at night little swarms of green-gold lights drift low over the meadows, along the
 * forest edges and by the water, each blinking on its own beat. Gone by day and in the rain.
 */
export class Fireflies {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private home: Float32Array;
  private pos: Float32Array;
  private seed: Float32Array;
  private vis = 0;

  constructor(world: World, swarms = 70) {
    const rng = new RNG(world.seed * 53 + 17);
    const homes: number[] = [];
    for (let tries = 0, found = 0; found < swarms && tries < swarms * 80; tries++) {
      const x = (rng.next() - 0.5) * world.N * 0.96, z = (rng.next() - 0.5) * world.N * 0.96;
      const y = world.heightAt(x, z);
      if (y < 0.12) continue;
      const i = world.cellIndexAt(x, z);
      if (i < 0) continue;
      // Forest edges, damp ground near water, and some open meadow.
      const f = world.forest[i];
      const nearWater = world.distWater[i] < 8;
      const edge = f > 0.15 && f < 0.75;
      if (!(edge || nearWater || rng.next() < 0.25)) continue;
      found++;
      // A swarm of a few, spread round the spot.
      const n = 5 + Math.floor(rng.next() * 6);
      for (let k = 0; k < n; k++) {
        const hx = x + (rng.next() - 0.5) * 5, hz = z + (rng.next() - 0.5) * 5;
        homes.push(hx, Math.max(y, world.heightAt(hx, hz)), hz);
      }
    }
    const n = homes.length / 3;
    this.home = new Float32Array(homes);
    this.pos = new Float32Array(homes);
    this.seed = new Float32Array(n);
    for (let k = 0; k < n; k++) this.seed[k] = rng.next();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(this.seed, 1));
    const px = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uVis: { value: 0 }, uPx: { value: 600 * px } },
      vertexShader: FIREFLY_VS, fragmentShader: FIREFLY_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.name = 'fireflies';
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** `night` 0..1 from the lighting, `rain` 0..1; `viewH` the drawing height in pixels. */
  update(dt: number, time: number, night: number, rain: number, viewH: number): void {
    const want = THREE.MathUtils.smoothstep(night, 0.45, 0.8) * (1 - Math.min(1, rain * 1.5));
    this.vis += (want - this.vis) * Math.min(1, dt * 0.5);
    this.points.visible = this.vis > 0.01;
    if (!this.points.visible) return;
    this.mat.uniforms.uVis.value = this.vis;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uPx.value = viewH * 0.5;
    // Lazy loops round each home, rising and dipping.
    const h = this.home, p = this.pos;
    for (let k = 0; k < this.seed.length; k++) {
      const s = this.seed[k], t = time * (0.12 + s * 0.1) + s * 40;
      p[k * 3] = h[k * 3] + Math.sin(t * 1.3) * 0.9 + Math.sin(t * 3.1 + s) * 0.25;
      p[k * 3 + 1] = h[k * 3 + 1] + 0.45 + Math.sin(t * 2.3 + s * 9) * 0.3 + s * 0.6;
      p[k * 3 + 2] = h[k * 3 + 2] + Math.cos(t * 1.1) * 0.9 + Math.cos(t * 2.7 + s) * 0.25;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Leap {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  dx: number;
  dz: number;
  t: number;
  dur: number;
  h: number;
  dist: number;
}

/**
 * Fish leaping clear of the water now and then near where the view is looking: most often round
 * canoes out netting, otherwise in the shallows off the coast. A splash and rings as each one
 * leaves the water and again as it drops back in.
 */
export class JumpingFish {
  readonly group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private live: Leap[] = [];
  private wait = 4;
  private rng: RNG;
  /** Called on each splash (for the sound). */
  onSplash: (x: number, z: number) => void = () => {};

  constructor(private world: World, private water: Water) {
    this.rng = new RNG(world.seed * 31 + 9);
    const geo = fishGeometry('silver', 'lo');
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(geo, stylisedMaterial());
      m.scale.setScalar(2.6);
      m.visible = false;
      this.pool.push(m);
      this.group.add(m);
    }
    this.group.name = 'jumpingFish';
  }

  update(dt: number, target: THREE.Vector3, fishing: { x: number; z: number }[], storm: boolean): void {
    if (dt <= 0) return;
    this.wait -= dt;
    if (this.wait <= 0) {
      this.wait = (fishing.length ? 2 : 5) + this.rng.next() * 6;
      if (!storm) this.launch(target, fishing);
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.t += dt;
      const u = l.t / l.dur;
      if (u >= 1) {
        this.water.disturb(l.x + l.dx * l.dist, l.z + l.dz * l.dist, 0.3);
        this.onSplash(l.x + l.dx * l.dist, l.z + l.dz * l.dist);
        l.mesh.visible = false;
        this.pool.push(l.mesh);
        this.live.splice(i, 1);
        continue;
      }
      // A parabola: up nose-first, a flick at the top, down nose-first.
      const y = SEA_SURFACE - 0.1 + 4 * l.h * u * (1 - u);
      l.mesh.position.set(l.x + l.dx * l.dist * u, y, l.z + l.dz * l.dist * u);
      const slope = (4 * l.h * (1 - 2 * u)) / l.dist;
      l.mesh.rotation.set(-Math.atan(slope), Math.atan2(l.dx, l.dz), Math.sin(l.t * 30) * 0.25, 'YXZ');
    }
  }

  private launch(target: THREE.Vector3, fishing: { x: number; z: number }[]): void {
    const mesh = this.pool.pop();
    if (!mesh) return;
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 12 && !ok; tries++) {
      const near = fishing.length && this.rng.next() < 0.7 ? fishing[Math.floor(this.rng.next() * fishing.length)] : null;
      const a = this.rng.next() * Math.PI * 2, r = near ? 1.5 + this.rng.next() * 3 : 4 + this.rng.next() * 26;
      x = (near ? near.x : target.x) + Math.cos(a) * r;
      z = (near ? near.z : target.z) + Math.sin(a) * r;
      const y = this.world.heightAt(x, z);
      ok = y < -0.5 && y > -6;
    }
    if (!ok) { this.pool.push(mesh); return; }
    const a = this.rng.next() * Math.PI * 2;
    const l: Leap = { mesh, x, z, dx: Math.cos(a), dz: Math.sin(a), t: 0, dur: 0.7 + this.rng.next() * 0.35, h: 0.45 + this.rng.next() * 0.45, dist: 1 + this.rng.next() * 0.8 };
    mesh.visible = true;
    this.water.disturb(x, z, 0.25);
    this.onSplash(x, z);
    this.live.push(l);
  }
}
