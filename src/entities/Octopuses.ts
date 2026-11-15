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
  /** How far under the surface it keeps (its mantle stands about 0.3 above where it is). */
  under: 0.42,
  /** Crawling over the sand on its arms: its speed, and the longest move it makes that way (further, it swims). */
  crawl: 0.11,
  crawlMax: 2.2,
  /** How often its next move is a short one, to somewhere close by. */
  potter: 0.35,
  /** How quickly it gathers and loses way (per second), and how fast it can turn swimming, crawling and fleeing (radians a second). */
  accel: 1.3,
  turn: { swim: 1.7, crawl: 0.9, dash: 9 },
  /** How far it leans into its travel, mantle first, swimming and jetting (radians), and how hard it banks in a turn. */
  lean: 0.5,
  dashLean: 0.8,
  bank: 0.24,
};

/** The model's four clips, and what they're used for. */
export type OctoClip = 'Idle' | 'Swim' | 'Swim fast' | 'Swim backward';
export type OctoState = 'rest' | 'crawl' | 'swim' | 'dash' | 'back';

/** Clip lengths (seconds), and where in each swimming clip the mantle starts to squeeze (0..1). */
const CLIP_SECS: Record<OctoClip, number> = { Idle: 5.6, Swim: 2.7, 'Swim fast': 1.45, 'Swim backward': 2.5 };
const SQUEEZE_AT: Record<OctoClip, number> = { Idle: 0, Swim: 0.09, 'Swim fast': 0.06, 'Swim backward': 0.05 };
/** How fast each state runs through its strokes (times the clip's own speed). */
const STROKE_RATE: Record<OctoState, number> = { rest: 0, crawl: 1.3, swim: 1.15, dash: 1.1, back: 1 };
/** The clips each state blends (weights add up to 1). There is no crawling clip: the idle, hurried, with a little of the swim. */
const STATE_MIX: Record<OctoState, Partial<Record<OctoClip, number>>> = {
  rest: { Idle: 1 }, crawl: { Idle: 0.65, Swim: 0.35 }, swim: { Swim: 1 }, dash: { 'Swim fast': 1 }, back: { 'Swim backward': 1 },
};
const CLIPS: OctoClip[] = ['Idle', 'Swim', 'Swim fast', 'Swim backward'];

/** Short moves are crawled over the sand; longer ones are swum. */
export function octoGait(distance: number): 'crawl' | 'swim' {
  return distance <= OCTOPUS.crawlMax ? 'crawl' : 'swim';
}

/**
 * Jet propulsion: how fast it is going through one stroke (`stroke`: strokes so far; the mantle
 * squeezes at each whole number), as a multiple of its average speed. A surge as the water is
 * squeezed out, then a long glide slowing down. Averages 1 over a stroke.
 */
export function jetPulse(stroke: number): number {
  const u = stroke - Math.floor(stroke), tail = Math.exp(-3.2 * 0.82);
  if (u < 0.18) { const k = u / 0.18; return 0.4 + 1.6 * (tail + (1 - tail) * k * k * (3 - 2 * k)); }
  return 0.4 + 1.6 * Math.exp(-3.2 * (u - 0.18));
}

/** Crawling: it hauls itself along unevenly, arm over arm (`gait`: pulls so far). Averages about 1. */
export function crawlPace(gait: number): number {
  return Math.max(0.3, 1 + 0.5 * Math.sin(gait * Math.PI * 2) + 0.22 * Math.sin(gait * Math.PI * 2 * 2.3 + 1));
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface Octopus {
  x: number; z: number; y: number; heading: number;
  home: { x: number; z: number };
  target: { x: number; z: number };
  state: OctoState;
  timer: number;
  /** Swims left before it settles on the bottom again. */
  legs: number;
  /** How fast it is going now (world units a second), the way it is going, and the speed it is easing towards its cruise. */
  vel: number;
  course: number;
  speed: number;
  /** Turning rate (radians a second; eased, so it never snaps round), and where it is fleeing to when jetting. */
  turn: number;
  flee: number;
  /** Lean forward and bank (radians), height above the seabed and how fast that is changing, and the seabed under it (smoothed). */
  pitch: number;
  roll: number;
  lift: number;
  vlift: number;
  floor: number;
  /** Jet strokes and crawling pulls so far, and the surge of the current one (a multiple of its speed). */
  stroke: number;
  gait: number;
  surge: number;
  /** How fast the idle clip is running (hurried when it crawls), and each clip's share of the pose. */
  idleRate: number;
  weights: Record<OctoClip, number>;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<OctoClip, THREE.AnimationAction>>;
  /** The clip that leads what it is doing. */
  playing: OctoClip | null;
}

/** What each state looks like (the clip it plays). */
export const STATE_CLIP: Record<OctoState, OctoClip> = { rest: 'Idle', crawl: 'Idle', swim: 'Swim', dash: 'Swim fast', back: 'Swim backward' };

/** A few octopus colours (multiplied over the model's own). */
const TINTS = [0xffffff, 0xffc2a8, 0xe0b4ff, 0xffe0a0, 0xc8e8ff];

/**
 * A puff of ink: a cluster of dark lumps that billow out and then shrink away. Solid, not
 * see-through: the sea draws what lies beneath it from the solid scene only.
 */
interface Ink { group: THREE.Group; t: number; puffs: { m: THREE.Mesh; size: number; drift: THREE.Vector3 }[] }

/**
 * Octopuses in the shallows round the island: they rest on the seabed (idling, arms curling),
 * crawl a little way over the sand or swim off to a new spot, sometimes back slowly into hiding,
 * and jet away in a cloud of ink when a boat or swimmer comes close, or when tapped. Each plays
 * the model's own clips (idle, swim, fast swim, swim backward), blended as it changes what it's doing.
 *
 * How they move:
 *  - swimming is jet propulsion: a surge each time the mantle squeezes, then a glide (the swim
 *    clips are held in step with the strokes), leaning into the travel and banking through turns;
 *  - they gather way and lose it gradually, lift gently off the sand and settle softly back;
 *  - short moves are crawled: low on the sand, hauling along unevenly, following the seabed.
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
    // Outside a browser (the tests in Node) there is no model: they move just the same, unseen.
    if (typeof document === 'undefined') return;
    warmLoads.push(new GLTFLoader().loadAsync(new URL('models/octopus.glb', document.baseURI).href)
      .then((gltf) => this.dress(gltf.scene, gltf.animations))
      .catch((err) => console.error('Octopus model failed to load.', err)));
    warmWith(new THREE.Mesh(this.inkGeo, this.inkMat));
  }

  /** The seabed under (x, z). */
  private bed(x: number, z: number): number {
    return Math.max(this.world.heightAt(x, z), -6.2);
  }

  /** Clear shallow sea an octopus can live over (open sea, never an inland lake). */
  shallows(x: number, z: number): boolean {
    const w = this.world, i = w.cellIndexAt(x, z);
    if (i < 0 || !w.isSea(i)) return false;
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
      vel: 0, course: 0, speed: 0, turn: 0, flee: 0, pitch: 0, roll: 0, lift: 0.02, vlift: 0, floor: this.bed(s.x, s.z),
      stroke: rnd(), gait: rnd(), surge: 1, idleRate: 1,
      weights: { Idle: 1, Swim: 0, 'Swim fast': 0, 'Swim backward': 0 },
      root: new THREE.Group(), mixer: null, actions: {}, playing: 'Idle',
    }));
    for (const o of this.list) { o.course = o.heading; o.root.rotation.order = 'YXZ'; }
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
      // Every clip plays all the time, each with its share of the pose (most have none, and cost nothing).
      for (const clip of clips) {
        const a = o.mixer.clipAction(clip), name = clip.name as OctoClip;
        o.actions[name] = a;
        a.play();
        a.time = Math.random() * clip.duration;
        // The swimming clips are stepped by hand, in time with the strokes.
        if (name !== 'Idle') a.timeScale = 0;
        a.setEffectiveWeight(o.weights[name] ?? 0);
      }
      this.group.add(o.root);
    });
    this.ready = true;
  }

  /** Somewhere new to go: often a spot close by, otherwise anywhere in the shallows near home. */
  private wander(o: Octopus): void {
    const near = Math.random() < OCTOPUS.potter;
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      let x: number, z: number;
      if (near) {
        const r = 0.5 + Math.random() * (OCTOPUS.crawlMax * 0.9 - 0.5);
        x = o.x + Math.cos(a) * r; z = o.z + Math.sin(a) * r;
        if (Math.hypot(x - o.home.x, z - o.home.z) > OCTOPUS.roam) continue;
      } else {
        const r = 1 + Math.random() * OCTOPUS.roam;
        x = o.home.x + Math.cos(a) * r; z = o.home.z + Math.sin(a) * r;
      }
      if (this.shallows(x, z)) { o.target = { x, z }; return; }
    }
    o.target = { ...o.home };
  }

  /** Set off for (x, z): crawling if it is close, swimming if not. */
  go(o: Octopus, x: number, z: number): void {
    o.target = { x, z };
    const d = Math.hypot(x - o.x, z - o.z), gait = octoGait(d);
    this.set(o, gait, 5 + (d / (gait === 'crawl' ? OCTOPUS.crawl : OCTOPUS.swim)) * 1.8);
  }

  private set(o: Octopus, state: OctoState, timer: number): void {
    // Swimming off from rest starts with a squeeze of the mantle: it pushes off. (Only while no
    // swimming clip shows, as they are stepped by the strokes and would jump.)
    if (state !== 'rest' && state !== 'crawl' && o.weights.Idle > 0.95) o.stroke = Math.ceil(o.stroke);
    o.state = state;
    o.timer = timer;
    o.playing = STATE_CLIP[state];
  }

  private settle(o: Octopus): void {
    this.set(o, 'rest', OCTOPUS.rest[0] + Math.random() * (OCTOPUS.rest[1] - OCTOPUS.rest[0]));
  }

  /** Jet away from (fx, fz) in a puff of ink. */
  startle(o: Octopus, fx: number, fz: number): void {
    if (o.state === 'dash') return;
    // It shoots off at once; its body swings round after it (quickly, but not in one frame).
    o.flee = Math.atan2(o.x - fx, o.z - fz);
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
      // What it wants: a cruising speed, a heading to steer for (if any), and a height above the sand.
      let cruise = 0, accel = OCTOPUS.accel, steer: number | null = null, turnMax = OCTOPUS.turn.swim, lift = 0.02;
      switch (o.state) {
        case 'rest':
          accel = 2;
          if (o.timer <= 0) { o.legs = OCTOPUS.legs[0] + Math.floor(Math.random() * (OCTOPUS.legs[1] - OCTOPUS.legs[0] + 1)); this.wander(o); this.go(o, o.target.x, o.target.z); }
          break;
        case 'crawl':
        case 'swim': {
          const swims = o.state === 'swim';
          const dx = o.target.x - o.x, dz = o.target.z - o.z, d = Math.hypot(dx, dz);
          steer = Math.atan2(dx, dz);
          turnMax = swims ? OCTOPUS.turn.swim : OCTOPUS.turn.crawl;
          // Slowing down (and sinking) as it comes in to land; no faster than it can turn.
          const ease = o.legs > 1 ? 1 : THREE.MathUtils.clamp(d / (swims ? 0.9 : 0.25), 0.3, 1);
          cruise = (swims ? OCTOPUS.swim : OCTOPUS.crawl) * Math.max(0.25, Math.cos(wrapAngle(steer - o.heading))) * ease;
          lift = swims ? OCTOPUS.swimLift * (0.35 + 0.65 * ease) : 0.03;
          if (d < (swims ? 0.3 : 0.1) || o.timer <= 0) {
            if (--o.legs > 0) { this.wander(o); this.go(o, o.target.x, o.target.z); }
            // Now and then it settles by backing slowly into a nook.
            else if (swims && Math.random() < OCTOPUS.backChance) this.set(o, 'back', OCTOPUS.backSecs);
            else this.settle(o);
          }
          break;
        }
        case 'back':
          cruise = OCTOPUS.back;
          lift = 0.14;
          if (o.timer <= 0) this.settle(o);
          break;
        case 'dash':
          steer = o.flee;
          turnMax = OCTOPUS.turn.dash;
          accel = 5;
          lift = 0.3;
          cruise = OCTOPUS.dash * Math.min(1, 0.2 + (o.timer / OCTOPUS.dashSecs) * 1.2);
          if (o.timer <= 0) { o.target = { x: o.x, z: o.z }; this.set(o, 'rest', OCTOPUS.rest[0]); }
          break;
      }
      const state = o.state, jets = state === 'swim' || state === 'dash' || state === 'back';
      // Turning: it swings round towards where it is going, easing into the turn and out of it.
      const quick = state === 'dash' ? 3 : 1;
      const off = steer === null ? 0 : wrapAngle(steer - o.heading), most = Math.min(turnMax, Math.abs(off) / dt);
      o.turn += (THREE.MathUtils.clamp(off * 2.5 * quick, -most, most) - o.turn) * Math.min(1, dt * 5 * quick);
      o.turn = THREE.MathUtils.clamp(o.turn, -turnMax, turnMax);
      o.heading = wrapAngle(o.heading + o.turn * dt);
      // Way: gathered and lost gradually; on top of it the surge of each jet stroke, or the uneven haul of a crawl.
      o.speed += (cruise - o.speed) * Math.min(1, dt * accel);
      o.stroke += (dt * STROKE_RATE[state]) / CLIP_SECS[STATE_CLIP[state]];
      if (state === 'crawl') o.gait += dt * 0.8;
      // (Fleeing, the strokes come so fast they run together: half the surge.)
      o.surge += ((state === 'dash' ? 0.5 + 0.5 * jetPulse(o.stroke) : jets ? jetPulse(o.stroke) : state === 'crawl' ? crawlPace(o.gait) : 1) - o.surge) * Math.min(1, dt * (jets ? 10 : 3));
      o.vel = o.speed * o.surge;
      if (state === 'dash') o.course = o.flee;
      else if (state === 'back') o.course = o.heading + Math.PI;
      else if (state !== 'rest') o.course = o.heading;
      if (o.vel > 1e-4) {
        const nx = o.x + Math.sin(o.course) * o.vel * dt, nz = o.z + Math.cos(o.course) * o.vel * dt;
        // Never out of the shallows: it checks its way and turns back towards home instead.
        if (this.shallows(nx, nz)) { o.x = nx; o.z = nz; }
        else {
          // (Sliding along the edge if it can, and losing way.)
          if (this.shallows(nx, o.z)) o.x = nx;
          else if (this.shallows(o.x, nz)) o.z = nz;
          o.speed *= Math.max(0, 1 - dt * 3);
          const back = Math.atan2(o.home.x - o.x, o.home.z - o.z);
          if (state === 'swim' || state === 'crawl') { o.target = { ...o.home }; o.legs = 1; }
          else if (state === 'dash') o.flee = back;
          else if (state === 'back') this.settle(o);
        }
      }
      // Height: it lifts gently off the sand and settles softly back (a damped spring), following
      // the seabed under it; rising a little on each surge, bobbing as it hauls itself along.
      const bed = this.bed(o.x, o.z), h = Math.min(dt, 0.1), W = 2.4;
      o.floor += (bed - o.floor) * Math.min(1, dt * 8);
      o.vlift += (W * W * (lift - o.lift) - 2 * W * o.vlift) * h;
      o.lift = Math.max(0, o.lift + o.vlift * h);
      const aloft = THREE.MathUtils.clamp(o.lift / 0.3, 0, 1);
      const bob = jets ? (o.surge - 1) * 0.035 * aloft : state === 'crawl' ? 0.012 * Math.abs(Math.sin(o.gait * Math.PI * 2)) : 0;
      // Never out of the water: in the shallowest places it swims lower, close over the sand.
      o.y = Math.max(bed + 0.02, Math.min(SEA_SURFACE - OCTOPUS.under, o.floor + o.lift + bob));
      // Attitude: on the bottom it lies to the slope of the sand (and rocks a little as it crawls);
      // swimming it leans into its travel, mantle first and arms trailing, and banks through turns.
      const sh = Math.sin(o.heading) * 0.15, ch = Math.cos(o.heading) * 0.15;
      const slopeP = Math.atan2(this.bed(o.x - sh, o.z - ch) - this.bed(o.x + sh, o.z + ch), 0.3);
      const slopeR = Math.atan2(this.bed(o.x + ch, o.z - sh) - this.bed(o.x - ch, o.z + sh), 0.3);
      const way = Math.min(1.4, o.vel / OCTOPUS.swim);
      let pitch = slopeP * (1 - aloft), roll = -slopeR * (1 - aloft), yaw = 0;
      if (state === 'crawl') {
        const g = o.gait * Math.PI * 2;
        pitch += 0.04 * Math.sin(g);
        roll += 0.06 * Math.sin(g * 0.5);
        yaw = 0.07 * Math.sin(g * 0.5 + 1.2);
      } else if (state === 'dash') pitch += OCTOPUS.dashLean * Math.min(1, o.vel / OCTOPUS.dash + 0.3) * aloft;
      else if (state !== 'back') pitch += OCTOPUS.lean * Math.min(1, way) * aloft;
      roll -= THREE.MathUtils.clamp(o.turn * OCTOPUS.bank * Math.min(1, way), -0.45, 0.45) * aloft;
      o.pitch += (pitch - o.pitch) * Math.min(1, dt * (state === 'dash' ? 6 : 2.5));
      o.roll += (roll - o.roll) * Math.min(1, dt * 3.5);
      o.root.position.set(o.x, o.y, o.z);
      o.root.rotation.set(o.pitch, o.heading + yaw, o.roll);
      // The body stretches a touch along its travel on each surge.
      const stretch = jets ? (o.surge - 1) * 0.05 * aloft : 0;
      o.root.scale.set(1 - stretch * 0.5, 1 - stretch * 0.5, 1 + stretch);
      // The pose: each clip's share eases towards what this state calls for.
      const mix = STATE_MIX[state], fade = Math.min(1, dt * (state === 'dash' ? 9 : 3.5));
      for (const c of CLIPS) o.weights[c] += ((mix[c] ?? 0) - o.weights[c]) * fade;
      o.idleRate += ((state === 'crawl' ? 2.3 : 1) - o.idleRate) * Math.min(1, dt * 2);
      if (o.mixer) {
        const seen = View.sees(o.x, o.y, o.z, 1) && View.dist2(o.x, o.y, o.z) < OCTOPUS.far * OCTOPUS.far;
        o.root.visible = seen;
        if (seen) {
          for (const c of CLIPS) {
            const a = o.actions[c];
            if (!a) continue;
            a.setEffectiveWeight(o.weights[c] < 0.004 ? 0 : o.weights[c]);
            if (c === 'Idle') a.timeScale = o.idleRate;
            // The swimming clips keep time with the strokes: the mantle squeezes as it surges.
            else { const u = o.stroke + SQUEEZE_AT[c]; a.time = (u - Math.floor(u)) * a.getClip().duration; }
          }
          o.mixer.update(dt);
        }
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
    return o.state === 'rest' ? 'Resting on the seabed' : o.state === 'crawl' ? 'Crawling over the sand' : o.state === 'swim' ? 'Swimming over the reef' : o.state === 'back' ? 'Backing into a crevice' : 'Jetting away in a cloud of ink';
  }
}
