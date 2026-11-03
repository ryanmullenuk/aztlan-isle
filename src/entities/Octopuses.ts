import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { View } from '../render/View';
import { SEA_SURFACE } from '../water/Water';
import { warmLoads, warmWith } from '../render/WarmUp';
import type { World } from '../world/World';

export const OCTOPUS = {
  count: 5,
  /** World units per model metre: about 60 cm across the arms (the model is 3.45 m). */
  scale: 0.16,
  /** Seabed depths they keep to: the clear shallows, where they can be seen from above. */
  depth: [-2.2, -0.3] as [number, number],
  /** How far from home they roam, and their speeds (world units a second). */
  roam: 7,
  swim: 0.4,
  dash: 1.5,
  back: 0.18,
  /** Seconds resting on the bottom, jetting away, and backing into a crevice. */
  rest: [4, 9] as [number, number],
  /** Swims in a row before it settles, how high above the seabed it swims, and how often it settles by backing into a nook. */
  legs: [2, 4] as [number, number],
  swimLift: 0.45,
  backChance: 0.15,
  dashSecs: 2.9,
  backSecs: 2.5,
  /** A boat or swimmer this close sends one jetting off in a puff of ink. */
  startle: 2.4,
  /** Beyond this from the camera they aren't animated (they keep moving). */
  far: 70,
};

/** The model's four clips, and what they're used for. */
export type OctoClip = 'Idle' | 'Swim' | 'Swim fast' | 'Swim backward';
export type OctoState = 'rest' | 'swim' | 'dash' | 'back';

export interface Octopus {
  x: number; z: number; y: number; heading: number;
  home: { x: number; z: number };
  target: { x: number; z: number };
  state: OctoState;
  timer: number;
  /** Swims left before it settles on the bottom again. */
  legs: number;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<OctoClip, THREE.AnimationAction>>;
  playing: OctoClip | null;
}

/** What each state looks like (the clip it plays). */
export const STATE_CLIP: Record<OctoState, OctoClip> = { rest: 'Idle', swim: 'Swim', dash: 'Swim fast', back: 'Swim backward' };

/** A few octopus colours (multiplied over the model's own). */
const TINTS = [0xffffff, 0xffc2a8, 0xe0b4ff, 0xffe0a0, 0xc8e8ff];

/**
 * A puff of ink: a cluster of dark lumps that billow out and then shrink away. Solid, not
 * see-through: the sea draws what lies beneath it from the solid scene only.
 */
interface Ink { group: THREE.Group; t: number; puffs: { m: THREE.Mesh; size: number; drift: THREE.Vector3 }[] }

/**
 * Octopuses in the shallows round the island: they rest on the seabed (idling, arms curling),
 * swim off to a new spot, sometimes back slowly into hiding, and jet away in a cloud of ink when a
 * boat or swimmer comes close, or when tapped. Each plays the model's own clips (idle, swim,
 * fast swim, swim backward), blended as it changes what it's doing.
 */
export class Octopuses {
  readonly group = new THREE.Group();
  list: Octopus[] = [];
  private inks: Ink[] = [];
  private inkGeo = new THREE.IcosahedronGeometry(0.5, 1);
  private inkMat = new THREE.MeshStandardMaterial({ color: 0x0c0912, roughness: 1, metalness: 0, flatShading: true });
  private ready = false;

  constructor(private world: World) {
    this.group.name = 'octopuses';
    this.spawn();
    warmLoads.push(new GLTFLoader().loadAsync(new URL('models/octopus.glb', document.baseURI).href)
      .then((gltf) => this.dress(gltf.scene, gltf.animations))
      .catch((err) => console.error('Octopus model failed to load.', err)));
    warmWith(new THREE.Mesh(this.inkGeo, this.inkMat));
  }

  /** The seabed under (x, z). */
  private bed(x: number, z: number): number {
    return Math.max(this.world.heightAt(x, z), -6.2);
  }

  /** Clear shallow sea an octopus can live over. */
  private shallows(x: number, z: number): boolean {
    const w = this.world, i = w.cellIndexAt(x, z);
    if (i < 0 || !w.isSeaCell(i)) return false;
    const b = this.bed(x, z);
    return b >= OCTOPUS.depth[0] && b <= OCTOPUS.depth[1];
  }

  /** Homes spread round the island's shallows (deterministic per island). */
  private spawn(): void {
    const w = this.world, spots: { x: number; z: number }[] = [];
    let seed = (w.seed * 2654435761) >>> 0;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let tries = 0; tries < 4000 && spots.length < OCTOPUS.count; tries++) {
      const x = (rnd() * 2 - 1) * (w.half - 4), z = (rnd() * 2 - 1) * (w.half - 4);
      if (!this.shallows(x, z)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
      spots.push({ x, z });
    }
    this.list = spots.map((s) => ({
      x: s.x, z: s.z, y: this.bed(s.x, s.z), heading: rnd() * Math.PI * 2,
      home: s, target: { ...s }, state: 'rest', timer: 2 + rnd() * 8, legs: 0,
      root: new THREE.Group(), mixer: null, actions: {}, playing: null,
    }));
  }

  /** The model has loaded: give each octopus its own copy, clips and colour. */
  private dress(scene: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.list.forEach((o, k) => {
      const body = cloneSkinned(scene);
      body.traverse((n) => {
        const m = n as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.frustumCulled = false;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.setHex(TINTS[k % TINTS.length]);
        mat.flatShading = true;
        m.material = mat;
      });
      body.scale.setScalar(OCTOPUS.scale);
      o.root.add(body);
      o.mixer = new THREE.AnimationMixer(body);
      for (const clip of clips) o.actions[clip.name as OctoClip] = o.mixer.clipAction(clip);
      this.group.add(o.root);
      this.play(o, STATE_CLIP[o.state], 0);
    });
    this.ready = true;
  }

  /** Cross-fade to a clip (each octopus starts its loops at its own point). */
  private play(o: Octopus, clip: OctoClip, fade = 0.35): void {
    if (o.playing === clip) return;
    const next = o.actions[clip];
    if (!next) return;
    const prev = o.playing ? o.actions[o.playing] : undefined;
    next.reset();
    next.time = Math.random() * next.getClip().duration;
    next.play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    o.playing = clip;
  }

  /** Somewhere new to go, in the shallows near home. */
  private wander(o: Octopus): void {
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * OCTOPUS.roam;
      const x = o.home.x + Math.cos(a) * r, z = o.home.z + Math.sin(a) * r;
      if (this.shallows(x, z)) { o.target = { x, z }; return; }
    }
    o.target = { ...o.home };
  }

  private set(o: Octopus, state: OctoState, timer: number): void {
    o.state = state;
    o.timer = timer;
    this.play(o, STATE_CLIP[state], state === 'dash' ? 0.15 : 0.35);
  }

  /** Jet away from (fx, fz) in a puff of ink. */
  startle(o: Octopus, fx: number, fz: number): void {
    if (o.state === 'dash') return;
    o.heading = Math.atan2(o.x - fx, o.z - fz);
    this.set(o, 'dash', OCTOPUS.dashSecs);
    this.ink(o.x, o.y + 0.15, o.z);
  }

  private ink(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const puffs = Array.from({ length: 7 }, () => {
      const m = new THREE.Mesh(this.inkGeo, this.inkMat);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      group.add(m);
      return { m, size: 0.35 + Math.random() * 0.4, drift: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(0.5) };
    });
    this.group.add(group);
    this.inks.push({ group, t: 0, puffs });
  }

  /** Real time `dt`; `threats` are boats and swimmers on the water. */
  update(dt: number, threats: { x: number; z: number }[]): void {
    if (dt <= 0) return;
    for (const o of this.list) {
      o.timer -= dt;
      // Something big on the water close by: off it goes.
      if (o.state !== 'dash') {
        const near = threats.find((t) => Math.hypot(t.x - o.x, t.z - o.z) < OCTOPUS.startle);
        if (near) this.startle(o, near.x, near.z);
      }
      let speed = 0, dir = o.heading;
      switch (o.state) {
        case 'rest':
          if (o.timer <= 0) {
            o.legs = OCTOPUS.legs[0] + Math.floor(Math.random() * (OCTOPUS.legs[1] - OCTOPUS.legs[0] + 1));
            this.wander(o);
            this.set(o, 'swim', 30);
          }
          break;
        case 'swim': {
          const dx = o.target.x - o.x, dz = o.target.z - o.z, d = Math.hypot(dx, dz);
          const want = Math.atan2(dx, dz);
          let turn = want - o.heading;
          while (turn > Math.PI) turn -= Math.PI * 2;
          while (turn < -Math.PI) turn += Math.PI * 2;
          o.heading += turn * Math.min(1, dt * 1.6);
          speed = OCTOPUS.swim * Math.max(0.2, Math.cos(turn));
          dir = o.heading;
          if ((d < 0.3 || o.timer <= 0) && --o.legs > 0) { this.wander(o); o.timer = 30; }
          else if (d < 0.3 || o.timer <= 0) {
            // Now and then it settles by backing slowly into a nook.
            if (Math.random() < OCTOPUS.backChance) this.set(o, 'back', OCTOPUS.backSecs);
            else this.set(o, 'rest', OCTOPUS.rest[0] + Math.random() * (OCTOPUS.rest[1] - OCTOPUS.rest[0]));
          }
          break;
        }
        case 'back':
          speed = OCTOPUS.back;
          dir = o.heading + Math.PI;
          if (o.timer <= 0) this.set(o, 'rest', OCTOPUS.rest[0] + Math.random() * (OCTOPUS.rest[1] - OCTOPUS.rest[0]));
          break;
        case 'dash':
          speed = OCTOPUS.dash * Math.min(1, 0.4 + o.timer / OCTOPUS.dashSecs);
          if (o.timer <= 0) { o.target = { x: o.x, z: o.z }; this.set(o, 'rest', OCTOPUS.rest[0]); }
          break;
      }
      if (speed > 0) {
        const nx = o.x + Math.sin(dir) * speed * dt, nz = o.z + Math.cos(dir) * speed * dt;
        // Never out of the shallows: turn back towards home instead.
        if (this.shallows(nx, nz)) { o.x = nx; o.z = nz; }
        else { o.heading = Math.atan2(o.home.x - o.x, o.home.z - o.z); if (o.state === 'swim') o.target = { ...o.home }; }
      }
      // On the bottom when still; just above it on the move (never out of the water).
      const lift = o.state === 'rest' ? 0.02 : o.state === 'back' ? 0.14 : o.state === 'dash' ? 0.3 : OCTOPUS.swimLift;
      const goal = Math.min(SEA_SURFACE - 0.25, this.bed(o.x, o.z) + lift);
      o.y += (goal - o.y) * Math.min(1, dt * 2);
      o.root.position.set(o.x, o.y, o.z);
      o.root.rotation.y = o.heading;
      if (o.mixer) {
        const seen = View.sees(o.x, o.y, o.z, 1) && View.dist2(o.x, o.y, o.z) < OCTOPUS.far * OCTOPUS.far;
        o.root.visible = seen;
        if (seen) o.mixer.update(dt);
      }
    }
    // Ink billows out, drifts, then thins away to nothing.
    for (const ink of this.inks.slice()) {
      ink.t += dt;
      const k = Math.min(1, ink.t / 3.5), grow = Math.sin(Math.PI * Math.min(1, k * 1.3) ** 0.6);
      for (const p of ink.puffs) {
        p.m.scale.setScalar(Math.max(0.001, p.size * grow * (1 - k * 0.5)));
        p.m.position.copy(p.drift).multiplyScalar(0.4 + k * 1.6);
      }
      if (k >= 1) {
        this.group.remove(ink.group);
        this.inks.splice(this.inks.indexOf(ink), 1);
      }
    }
  }

  /** The octopus under a tap (screen x, y), if any. */
  pick(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect, px = 34): Octopus | null {
    if (!this.ready) return null;
    let best: Octopus | null = null, bd = px * px;
    const v = new THREE.Vector3();
    for (const o of this.list) {
      if (!o.root.visible) continue;
      v.set(o.x, o.y + 0.15, o.z).project(camera);
      if (v.z > 1) continue;
      const x = rect.left + (v.x * 0.5 + 0.5) * rect.width, y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** What it's doing, for the wildlife view. */
  static behaviour(o: Octopus): string {
    return o.state === 'rest' ? 'Resting on the seabed' : o.state === 'swim' ? 'Swimming over the reef' : o.state === 'back' ? 'Backing into a crevice' : 'Jetting away in a cloud of ink';
  }
}
