import * as THREE from 'three';
import { TURTLES, WORLD } from '../config';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import { QuadMeshes } from './quadRig';

type TState = 'rest' | 'crawl' | 'enter' | 'swim' | 'breathe' | 'approach' | 'exit';

export interface Turtle {
  /** Family turtles remain offshore; babies refer to their mother in the stable list. */
  family: number;
  mother: number;
  slot: number;
  /** Mothers leave a short water-only trail so babies follow bends instead of cutting across land. */
  trail?: { x: number; z: number }[];
  wanderTimer?: number;
  bayVisit?:{x:number;z:number};
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  state: TState;
  timer: number;
  tx: number;
  tz: number;
  ty: number;
  /** Beach spot it's heading for (or resting on). */
  beachX: number;
  beachZ: number;
  breath: number;
  stroke: number;
  speed: number;
  scale: number;
  color: THREE.Color;
  /** Head drawn in (0 out … 1 tucked) when people come close on land. */
  shy: number;
  // ---- Animation only (smoothed) ----
  /** 0 on land … 1 afloat: blends crawling strokes into swimming strokes. */
  wet: number;
  prevH: number;
  turnRate: number;
  roll: number;
  pitchS: number;
  /** Breathing: head raised to the surface 0..1. */
  gasp: number;
  seed: number;
}

// ---------------- Geometry ----------------

const C = (c: number) => ({ color: c });
/** Cream skin between the dark scales; the plates themselves; the pale underside. */
const SKIN = 0xd6c88c, SKIN_DARK = 0x5a4a2e, SKIN_PALE = 0xe4d9a8;
const SEAM = new THREE.Color(0xe2d3a0);

/** Mirror the geometry while preserving outward faces and reflected vertex normals. */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.index ? g.toNonIndexed() : g.clone();
  const p = m.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  // Swap the 2nd and 3rd vertex of every triangle (all attributes) to restore the winding.
  for (const k of Object.keys(m.attributes)) {
    const a = m.getAttribute(k) as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3)
      for (let c = 0; c < a.itemSize; c++) {
        const t = a.getComponent(i + 1, c);
        a.setComponent(i + 1, c, a.getComponent(i + 2, c));
        a.setComponent(i + 2, c, t);
      }
  }
  const n = m.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i));
  return m;
}

const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Distances to the nearest and second-nearest jittered cell points (3D cellular noise), and the nearest's id. */
function cells(x: number, y: number, z: number): [number, number, number] {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let d1 = 9, d2 = 9, id = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const cx = ix + a, cy = iy + b, cz = iz + c;
    const px = cx + hash3(cx, cy, cz), py = cy + hash3(cy, cz, cx), pz = cz + hash3(cz, cx, cy);
    const d = Math.hypot(px - x, py - y, pz - z);
    if (d < d1) { d2 = d1; d1 = d; id = hash3(cx + 3, cy + 7, cz + 11); } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}

/**
 * Scaled skin, as on a sea turtle's head and flippers: dark polygonal plates separated by cream
 * skin, the plates larger on top; plain pale underneath.
 */
const scaled = (size: number): ColorFn => (p, n) => {
  if (n.y < -0.3) return new THREE.Color(SKIN_PALE);
  const [d1, d2, id] = cells(p.x / size, p.y / size, p.z / size);
  if (d2 - d1 < 0.16) return new THREE.Color(SKIN);
  return new THREE.Color(SKIN_DARK).multiplyScalar(0.85 + id * 0.35);
};

/** Shell dimensions: dome radius, height and length factors. */
const R = 0.13, SY = 0.56, SZ = 1.3;
/** Scute centres on the carapace, in its normalised (across, along) coordinates: five vertebrals and four costals a side. */
const SCUTES: [number, number][] = [
  [0, 0.66], [0, 0.34], [0, 0.02], [0, -0.3], [0, -0.6],
  ...[1, -1].flatMap((s) => [[0.5, 0.48], [0.56, 0.16], [0.52, -0.16], [0.42, -0.46]].map(([x, z]) => [s * x, z] as [number, number])),
];
/** Teardrop outline: full across the front of the shell, narrowing to a point behind. */
const shellWidth = (Z: number) => 1 - 0.3 * THREE.MathUtils.smoothstep(0.15, -1, Z);

/**
 * Carapace (tinted per turtle, mat 2): a high faceted dome, teardrop shaped with a low keel, a
 * flared rim and a serrated back edge. Vertebral and costal scutes over the top and a ring of
 * marginals round the rim, each plate lighter in its middle, all outlined in pale seams; a pale
 * plastron and a short tail. Faces +z.
 */
function shellGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const g = new THREE.SphereGeometry(1, 60, 30);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let X = pos.getX(i), Y = Math.max(pos.getY(i), -0.06), Z = pos.getZ(i);
    if (Z < 0) Z *= 1.06;
    // Low keel down the middle, and the rim flaring out (saw-toothed along the back).
    Y += Math.exp(-(X * X) / 0.03) * 0.08 * Math.max(0, Y);
    const rim = 1 - THREE.MathUtils.smoothstep(Y, 0, 0.2);
    let flare = 1 + 0.06 * rim;
    if (Z < -0.45) {
      const a = Math.atan2(X, Z) * (26 / (Math.PI * 2));
      flare *= 1 + 0.05 * rim * (1 - 2 * Math.abs(a - Math.round(a)));
    }
    X *= flare * shellWidth(Z); Z *= flare;
    pos.setXYZ(i, X * R, 0.02 + Y * R * SY, Z * R * SZ);
  }
  const SEAM_MARK = new THREE.Color(-1, -1, -1);
  const plates: ColorFn = (p) => {
    const Z = p.z / (R * SZ), X = p.x / (R * shellWidth(Z)), Y = (p.y - 0.02) / (R * SY);
    if (Y < 0.24) {
      // Marginal scutes round the rim, divided where they meet the costals.
      if (Y > 0.205) return SEAM_MARK;
      const a = Math.atan2(X, Z) * (26 / (Math.PI * 2)), dm = Math.abs(a - Math.round(a));
      if (dm < 0.06) return SEAM_MARK;
      return new THREE.Color().setScalar(0.72 + 0.25 * Math.min(1, dm * 3));
    }
    let d1 = 9, d2 = 9;
    for (const [sx, sz] of SCUTES) {
      const d = Math.hypot(X - sx, (Z - sz) * 0.9);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    if (d2 - d1 < 0.045) return SEAM_MARK;
    return new THREE.Color().setScalar(1.12 - Math.min(1, d1 / 0.34) * 0.42);
  };
  b.add(g, { color: plates, mat: 2, facet: true });
  // Plastron, the skin at the openings and the short tail.
  b.add(new THREE.SphereGeometry(0.12, 16, 8), { color: SKIN_PALE }, M.t(0, 0.014, 0, 0, 0, 0, 0.92, 0.18, 1.18));
  b.add(new THREE.SphereGeometry(0.05, 10, 6), { color: SKIN }, M.t(0, 0.014, 0.13, 0, 0, 0, 1.2, 0.35, 0.6));
  b.add(P.cone(0.018, 0.05, 6), { color: scaled(0.012), facet: true }, M.t(0, 0.012, -0.18, -Math.PI / 2, 0, 0, 1, 0.6, 1));
  const out = facet(b.build());
  // Seams: pale cream skin between the plates (not tinted with the shell's colour).
  const c = out.getAttribute('color') as THREE.BufferAttribute, m = out.getAttribute('aMat') as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) if (c.getX(i) < 0) { c.setXYZ(i, SEAM.r, SEAM.g, SEAM.b); m.setX(i, 0); }
  return out;
}

/** Neck from its base (inside the shell) forward along +z; scaled skin with folds. */
function neckGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.026, 0.034, NECK_LEN, 24, 6, true), { color: scaled(0.013), facet: true }, M.t(0, 0, NECK_LEN / 2, Math.PI / 2, 0, 0));
  for (let k = 0; k < 2; k++) b.add(P.torus(0.03 - k * 0.003, 0.003, 4, 10), { color: SKIN }, M.t(0, 0, 0.014 + k * 0.016));
  return facet(b.build());
}

/** Head from the end of the neck: big blunt skull with plated scales, hooked beak, large dark eyes. */
function headGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.SphereGeometry(0.04, 30, 20), { color: scaled(0.014), facet: true }, M.t(0, 0.006, 0.032, 0, 0, 0, 0.92, 0.82, 1.2));
  // Beak: the upper jaw hooked over the lower.
  b.add(P.cone(0.016, 0.026, 8), { color: 0x4a4230 }, M.t(0, -0.004, 0.078, Math.PI / 2 + 0.3, 0, 0, 1, 1, 0.8));
  b.add(P.rbox(0.022, 0.007, 0.022, 0.002, 1), { color: 0x5a5038 }, M.t(0, -0.017, 0.066));
  for (const x of [-1, 1]) {
    b.add(new THREE.SphereGeometry(0.0115, 10, 8), { color: SKIN_PALE }, M.t(x * 0.026, 0.012, 0.05, 0, 0, 0, 0.5, 0.95, 1.1));
    b.add(new THREE.SphereGeometry(0.0085, 10, 8), { color: 0x120f0c }, M.t(x * 0.0295, 0.012, 0.051, 0, 0, 0, 0.45, 1, 1));
    b.add(P.uvSphere(0.0022, 6, 4), C(0xf0f2e6), M.t(x * 0.032, 0.0145, 0.054));
    b.add(P.uvSphere(0.002, 6, 4), C(0x33302a), M.t(x * 0.009, 0.013, 0.07, 0, 0, 0, 1, 0.5, 1));
  }
  return facet(b.build());
}

/** Short, thick upper arm of a flipper from the shoulder out along +x. */
function armGeo(len: number, r: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.SphereGeometry(r * 1.1, 16, 10), { color: scaled(0.013), facet: true });
  b.add(new THREE.CylinderGeometry(r * 0.9, r, len, 18, 5), { color: scaled(0.013), facet: true }, M.t(len / 2, 0, 0, 0, 0, -Math.PI / 2, 1, 1, 0.6));
  return facet(b.build());
}

/**
 * A flipper blade out along +x: thick, straight leading edge (+z), thin swept trailing edge curving
 * back to a pointed tip, covered in dark polygonal scales set in cream skin, with a claw near the
 * leading edge; pale underneath.
 */
function bladeGeo(len: number, w: number, sweep: number, claw: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const g = new THREE.SphereGeometry(.5, 40, 16);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5;
    const v = p.getZ(i) + 0.5; // 1 = leading edge
    const chord = w * (1 - u * 0.78) * (0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.6 + 0.2)));
    const lead = w * 0.3 - sweep * u * u;
    const y = p.getY(i) * 0.016 * (0.4 + 0.6 * v) * (1 - 0.6 * u);
    p.setXYZ(i, u * len, y, lead - (1 - v) * chord);
  }
  b.add(g, { color: scaled(0.017), facet: true });
  if (claw) b.add(P.cone(0.004, 0.012, 6), C(0x2a2820), M.t(len * 0.3, 0.004, w * 0.3 + 0.002, 0, 0, -Math.PI / 2));
  return facet(b.build());
}

const _b = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _w = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}
const WHITE = new THREE.Color(1, 1, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

// ---------------- Tuning ----------------

const NECK_LEN = 0.05;
/** Joints in the body frame (right side; x mirrored for the left). */
const TUR = {
  neck: [0, 0.022, 0.105] as [number, number, number],
  front: [0.07, 0.018, 0.075] as [number, number, number],
  rear: [0.065, 0.014, -0.12] as [number, number, number],
  arm: 0.055,
  blade: 0.16,
};
/** Crawling: fraction of each half-cycle spent heaving (the rest is a pause), heave lift and roll. */
const CRAWL = { power: 0.6, lift: 0.014, roll: 0.05 };
/** Swimming: flipper flap amplitude and how the stroke lifts the body. */
const SWIM = { flap: 0.7, bob: 0.012 };

const FAMILY_COUNT = 2, BABIES = 3;
/** Shell colours: olive green, warm brown, dark and a chestnut. */
const SHELL = [0x7b7a3c, 0xa0532a, 0x5e5650, 0x8a5a30];

/**
 * Sea turtles moving between beaches and the sea: resting on quiet sand, crawling slowly down
 * to the water with alternating heaves of their flippers, slipping in and "flying" through the
 * shallows and deeper coastal water with synchronised front-flipper strokes, surfacing to breathe,
 * and now and then hauling out onto a beach again.
 */
export class SeaTurtles {
  readonly meshes = new QuadMeshes();
  list: Turtle[] = [];
  private rng: RNG;
  private beaches: { x: number; z: number }[] = [];
  people: SpatialHash<Islander> | null = null;
  private time = 0;

  constructor(private world: World, private sea: number) {
    this.rng = new RNG(world.seed * 67 + 41);
    this.findBeaches();
    this.spawn();
    this.spawnFamilies();
    const n = TURTLES.count[1] + FAMILY_COUNT * (BABIES + 1) + 2;
    this.meshes.add('shell', shellGeo(), n);
    this.meshes.add('neck', neckGeo(), n);
    this.meshes.add('head', headGeo(), n);
    const armF = armGeo(TUR.arm, 0.018), bladeF = bladeGeo(TUR.blade, 0.07, 0.05, true);
    const bladeR = bladeGeo(0.085, 0.055, 0.02, false);
    this.meshes.add('armR', armF, n);
    this.meshes.add('armL', mirrorX(armF), n);
    this.meshes.add('flipR', bladeF, n);
    this.meshes.add('flipL', mirrorX(bladeF), n);
    this.meshes.add('rearR', bladeR, n);
    this.meshes.add('rearL', mirrorX(bladeR), n);
  }

  private findBeaches(): void {
    const w = this.world;
    for (let k = 0; k < 8000 && this.beaches.length < 60; k++) {
      const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
      const i = w.idx(cx, cz);
      const x = w.centerX(cx), z = w.centerZ(cz);
      const h = w.heightAt(x, z);
      if (w.isLandCell(i) && w.sandy[i] > 0.55 && w.distWater[i] <= 2 && h > this.sea + 0.02 && h < 0.45) this.beaches.push({ x, z });
    }
  }

  private spawn(): void {
    const r = this.rng;
    const n = Math.round(THREE.MathUtils.clamp(this.beaches.length / 6, TURTLES.count[0], TURTLES.count[1]));
    for (let k = 0; k < n; k++) {
      const onBeach = this.beaches.length > 0 && r.chance(0.35);
      let x = 0, z = 0;
      if (onBeach) {
        const b = this.beaches[r.int(0, this.beaches.length - 1)];
        x = b.x;
        z = b.z;
      } else {
        const p = this.seaPoint(r.range(-this.world.half * 0.7, this.world.half * 0.7), r.range(-this.world.half * 0.7, this.world.half * 0.7), 40);
        if (!p) continue;
        x = p.x;
        z = p.z;
      }
      const heading = r.range(0, 6.28);
      this.list.push({
        family: -1, mother: -1, slot: -1,
        x, y: onBeach ? this.world.heightAt(x, z) : -0.6, z, heading, pitch: 0, state: onBeach ? 'rest' : 'swim', timer: r.range(20, 90),
        tx: x, tz: z, ty: -0.6, beachX: x, beachZ: z, breath: r.range(20, 60), stroke: r.next(), speed: 0, scale: r.range(0.85, 1.15),
        color: new THREE.Color(SHELL[r.int(0, SHELL.length - 1)]).offsetHSL(0, r.range(-0.05, 0.05), r.range(-0.04, 0.04)), shy: 0,
        wet: onBeach ? 0 : 1, prevH: heading, turnRate: 0, roll: 0, pitchS: 0, gasp: 0, seed: k * 2.3,
      });
    }
  }

  /** Sweep the whole turtle through submerged ground and fixed rocks. No route searches are needed. */
  private waterClear(ax: number, az: number, bx: number, bz: number, scale: number): boolean {
    const radius = .32 * scale, distance = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(distance / .18));
    for (let k = 0; k <= steps; k++) {
      const x = lerp(ax, bx, k / steps), z = lerp(az, bz, k / steps);
      for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
        const px = x + dx, pz = z + dz, cell = this.world.cellIndexAt(px, pz);
        if (Math.abs(px) > WORLD.oceanSize / 2 - 2 || Math.abs(pz) > WORLD.oceanSize / 2 - 2 ||
          this.world.heightAt(px, pz) >= -.35 || (cell >= 0 && this.world.blocked(cell))) return false;
      }
    }
    return true;
  }

  private spawnFamilies(): void {
    for (let family = 0; family < FAMILY_COUNT; family++) {
      let site: { x: number; z: number; heading: number } | null = null;
      for (let k = 0; k < 400 && !site; k++) {
        const beach = this.beaches.length ? this.beaches[this.rng.int(0, this.beaches.length - 1)] : null;
        const a = this.rng.range(0, Math.PI * 2);
        // First search coastal water; the outer ring also works on unusual islands without beaches.
        const d = k < 300 && beach ? this.rng.range(3, 12) : this.world.half + 6;
        const x = (k < 300 && beach ? beach.x : 0) + Math.sin(a) * d;
        const z = (k < 300 && beach ? beach.z : 0) + Math.cos(a) * d;
        const heading = this.rng.range(0, Math.PI * 2);
        if (this.list.some(t => t.family >= 0 && t.mother < 0 && Math.hypot(t.x - x, t.z - z) < 20)) continue;
        if (this.waterClear(x, z, x - Math.sin(heading) * 2, z - Math.cos(heading) * 2, 1.2)) site = { x, z, heading };
      }
      if (!site) continue; // Never place a family through land or a rock just to meet a count.
      const parent = this.list.length;
      const mother: Turtle = {
        family, mother: -1, slot: -1, ...site, y: this.sea - .35, pitch: 0, state: 'swim', timer: 0,
        tx: site.x, tz: site.z, ty: this.sea - .35, beachX: site.x, beachZ: site.z,
        breath: this.rng.range(25, 50), stroke: this.rng.next(), speed: 0, scale: 1.18,
        color: new THREE.Color(SHELL[family]), shy: 0, wet: 1, prevH: site.heading,
        turnRate: 0, roll: 0, pitchS: 0, gasp: 0, seed: parent * 2.3,
        trail: Array.from({ length: 20 }, (_, k) => ({ x: site!.x - Math.sin(site!.heading) * k * .12, z: site!.z - Math.cos(site!.heading) * k * .12 })),
      };
      this.list.push(mother);
      for (let slot = 0; slot < BABIES; slot++) {
        const p = mother.trail![5 + slot * 3];
        this.list.push({ ...mother, trail: undefined, mother: parent, slot, ...p,
          tx: p.x, tz: p.z, scale: .34 + slot * .035, stroke: this.rng.next(),
          breath: this.rng.range(12, 30), color: mother.color.clone().offsetHSL(0, -.04, .07), seed: this.list.length * 2.3 });
      }
    }
  }

  /** Interpolate a point a fixed distance along the mother's trail, including her latest movement. */
  private followPoint(mother: Turtle, gap: number): { x: number; z: number } {
    let x = mother.x, z = mother.z;
    for (const p of mother.trail!) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > 1e-6 && gap <= d) return { x: lerp(x, p.x, gap / d), z: lerp(z, p.z, gap / d) };
      gap -= d; x = p.x; z = p.z;
    }
    return { x, z };
  }

  /** Offshore mothers wander gently; babies follow their mother's recent safe track. */
  private familyThink(t: Turtle, dt: number): void {
    const mother = t.mother >= 0 ? this.list[t.mother] : null;
    t.stroke += dt * (mother ? .9 : .55);
    if (mother) {
      const p = this.followPoint(mother, .6 + t.slot * .36);
      t.tx = p.x; t.tz = p.z; t.ty = mother.ty - .025;
    } else {
      if(t.bayVisit){t.tx=t.bayVisit.x;t.tz=t.bayVisit.z;t.wanderTimer=100;}
      t.wanderTimer = (t.wanderTimer ?? 0) - dt;
      if (!t.bayVisit && (t.wanderTimer <= 0 || Math.hypot(t.tx - t.x, t.tz - t.z) < .5)) {
        t.wanderTimer = 6;
        for (let k = 0; k < 10; k++) {
          const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(3, 7);
          const x = t.x + Math.sin(a) * d, z = t.z + Math.cos(a) * d;
          if (this.waterClear(t.x, t.z, x, z, t.scale)) { t.tx = x; t.tz = z; t.ty = this.rng.range(this.sea - .6, this.sea - .25); break; }
        }
      }
    }
    const dx = t.tx - t.x, dz = t.tz - t.z, d = Math.hypot(dx, dz);
    if (d > .015) t.heading = turn(t.heading, Math.atan2(dx, dz), 1 - Math.exp(-dt * (mother ? 2.5 : .65)));
    const lagging = !mother && this.list.some(b => b.mother >= 0 && this.list[b.mother] === t && Math.hypot(b.x - t.x, b.z - t.z) > 2.3);
    const desiredSpeed = lagging ? 0 : Math.min(d * (mother ? 3 : 1), TURTLES.swimSpeed * (mother ? 1.3 : .8) * (t.state === 'breathe' ? .7 : 1));
    const easedSpeed = lerp(t.speed, desiredSpeed, 1 - Math.exp(-dt * 3));
    const sp = lagging ? 0 : Math.min(easedSpeed, d / Math.max(dt, .001));
    let moved = false;
    // Try shallow steering around a newly blocked section; every candidate is swept before moving.
    for (const offset of [0, dt * 1.5, -dt * 1.5, dt * 3, -dt * 3]) {
      const h = t.heading + offset, x = t.x + Math.sin(h) * sp * dt, z = t.z + Math.cos(h) * sp * dt;
      if (this.waterClear(t.x, t.z, x, z, t.scale)) { t.x = x; t.z = z; t.heading = h; moved = true; break; }
    }
    t.speed = moved ? sp : 0;
    if (!moved && !mother) t.wanderTimer = Math.min(t.wanderTimer ?? 0, 1);
    if (!mother && Math.hypot(t.x - t.trail![0].x, t.z - t.trail![0].z) >= .12) {
      t.trail!.unshift({ x: t.x, z: t.z }); if (t.trail!.length > 64) t.trail!.pop();
    }
    t.breath -= dt;
    if (t.state !== 'breathe' && t.breath <= 0) { t.state = 'breathe'; t.timer = 4; }
    if (t.state === 'breathe') {
      t.timer -= dt;
      if (t.timer <= 0) { t.state = 'swim'; t.breath = this.rng.range(25, 60); }
    } else t.state = 'swim';
    const bed = this.world.heightAt(t.x, t.z);
    const wantY = t.state === 'breathe' ? this.sea - .05 : Math.max(bed + .12 * t.scale, Math.min(this.sea - .2, t.ty));
    t.pitch = THREE.MathUtils.clamp((wantY - t.y) * 2, -.5, .5);
    t.y += (wantY - t.y) * Math.min(1, dt * .9);
    t.shy = 0;
  }

  visitBay():{subject:string;valid:()=>boolean;finish:()=>void}|null{
    for(let i=0;i<this.list.length;i++){
      const mother=this.list[i];if(mother.family<0||mother.mother>=0||mother.bayVisit)continue;
      for(const beach of this.beaches){
        const d=Math.hypot(beach.x-mother.x,beach.z-mother.z);if(d>28)continue;
        for(let k=0;k<8;k++){
          const a=k*Math.PI/4,x=beach.x+Math.sin(a)*4,z=beach.z+Math.cos(a)*4;
          const bed=this.world.heightAt(x,z);
          if(bed<-2||bed>-.5||!this.waterClear(mother.x,mother.z,x,z,mother.scale))continue;
          // A sheltered pocket has dry shoreline in several directions, not an exposed straight beach.
          let shelter=0;for(let j=0;j<8;j++)if(this.world.heightAt(x+Math.sin(j*Math.PI/4)*10,z+Math.cos(j*Math.PI/4)*10)>0)shelter++;
          if(shelter<3)continue;
          const visit={x,z};mother.bayVisit=visit;
          return {subject:`turtle-${i}`,valid:()=>mother.bayVisit===visit&&this.waterClear(visit.x,visit.z,visit.x,visit.z,mother.scale),finish:()=>{mother.bayVisit=undefined;mother.wanderTimer=0;}};
        }
      }
    }return null;
  }

  /** A point in coastal water (shallow to moderately deep) near (x, z). */
  private seaPoint(x: number, z: number, r: number): { x: number; z: number } | null {
    for (let k = 0; k < 20; k++) {
      const a = this.rng.range(0, 6.28), d = Math.sqrt(this.rng.next()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const h = this.world.heightAt(px, pz);
      if (h < -0.35 && h > -3.5) return { x: px, z: pz };
    }
    return null;
  }

  update(dt: number): void {
    this.time += dt;
    if (dt > 0) {
      const steps = Math.max(1, Math.ceil(dt / .05)), step = dt / steps;
      for (let k = 0; k < steps; k++) for (const t of this.list) this.think(t, step);
    }
    this.draw(dt);
  }

  private think(t: Turtle, dt: number): void {
    if (t.family >= 0) { this.familyThink(t, dt); return; }
    const w = this.world;
    const r = this.rng;
    const ground = w.heightAt(t.x, t.z);
    t.stroke += dt * (t.state === 'swim' || t.state === 'approach' || t.state === 'breathe' ? 0.55 : t.state === 'rest' ? 0 : 0.45);
    // People close by on land: the head draws in and the turtle waits.
    let near = false;
    this.people?.query(t.x, t.z, 2.2, (p) => !p.hidden && (near = true));
    t.shy += ((near && (t.state === 'rest' || t.state === 'crawl' || t.state === 'exit') ? 1 : 0) - t.shy) * Math.min(1, dt * 3);
    // Two heaves per stroke cycle (one per diagonal flipper pair), each followed by a pause; the
    // average speed is the same as a single sinusoidal heave per cycle.
    const crawlStep = () => {
      const h = (((t.stroke * 2) % 1) + 1) % 1;
      return (h < CRAWL.power ? Math.sin((Math.PI * h) / CRAWL.power) / CRAWL.power : 0) * TURTLES.crawlSpeed * (1 - t.shy);
    };
    switch (t.state) {
      case 'rest':
        t.timer -= dt;
        t.y = ground;
        if (t.timer <= 0) {
          // Back to the sea: head for the nearest water.
          const p = this.seaPoint(t.x, t.z, 8);
          if (p) {
            t.state = 'crawl';
            t.tx = p.x;
            t.tz = p.z;
            t.timer = 90;
          } else t.timer = 30;
        }
        break;
      case 'crawl':
      case 'exit': {
        const dx = t.tx - t.x, dz = t.tz - t.z;
        const d = Math.hypot(dx, dz);
        t.heading = turn(t.heading, Math.atan2(dx, dz), dt * 0.8);
        const s = crawlStep();
        t.x += Math.sin(t.heading) * s * dt;
        t.z += Math.cos(t.heading) * s * dt;
        t.y = Math.max(w.heightAt(t.x, t.z), t.state === 'crawl' ? -1 : -1);
        t.speed = s;
        t.timer -= dt;
        if (t.state === 'crawl' && w.heightAt(t.x, t.z) < this.sea - 0.04) {
          // Into the water: the swim takes over as the body lifts off the sand.
          t.state = 'enter';
          t.timer = 2.5;
        } else if (t.state === 'exit' && (d < 0.2 || t.timer <= 0)) {
          t.state = 'rest';
          t.timer = r.range(TURTLES.restSeconds[0], TURTLES.restSeconds[1]);
        }
        break;
      }
      case 'enter':
        t.timer -= dt;
        t.x += Math.sin(t.heading) * 0.18 * dt;
        t.z += Math.cos(t.heading) * 0.18 * dt;
        t.y += (Math.max(w.heightAt(t.x, t.z) + 0.06, this.sea - 0.12) - t.y) * Math.min(1, dt * 1.5);
        if (t.timer <= 0) this.newSwim(t);
        break;
      case 'swim':
      case 'approach':
      case 'breathe': {
        const dx = t.tx - t.x, dz = t.tz - t.z;
        const d = Math.hypot(dx, dz);
        t.heading = turn(t.heading, Math.atan2(dx, dz), dt * 0.6);
        const sp = TURTLES.swimSpeed * (t.state === 'breathe' ? 0.5 : 1);
        const nx = t.x + Math.sin(t.heading) * sp * dt, nz = t.z + Math.cos(t.heading) * sp * dt;
        const nh = w.heightAt(nx, nz);
        if (nh < this.sea - 0.1 || t.state === 'approach') {
          t.x = nx;
          t.z = nz;
        } else t.heading += dt * 1.5;
        const bed = w.heightAt(t.x, t.z);
        t.breath -= dt;
        if (t.state === 'swim' && t.breath <= 0) {
          t.state = 'breathe';
          t.timer = r.range(3, 6);
        }
        const wantY = t.state === 'breathe' ? this.sea - 0.05 : Math.max(bed + 0.12, Math.min(this.sea - 0.2, t.ty));
        t.pitch = THREE.MathUtils.clamp((wantY - t.y) * 2, -0.5, 0.5);
        t.y += (wantY - t.y) * Math.min(1, dt * 0.7);
        t.speed = sp;
        if (t.state === 'breathe') {
          t.timer -= dt;
          if (t.timer <= 0) {
            t.breath = r.range(TURTLES.breathEvery[0], TURTLES.breathEvery[1]);
            t.state = 'swim';
          }
        } else if (t.state === 'approach') {
          // At the shallows' edge: haul out onto the sand.
          if (w.heightAt(t.x, t.z) > this.sea - 0.06) {
            t.state = 'exit';
            t.tx = t.beachX;
            t.tz = t.beachZ;
            t.timer = 90;
          }
        } else if (d < 0.5) {
          // Reached the wander point: carry on exploring, or come ashore now and then.
          if (this.beaches.length && r.chance(TURTLES.comeAshore) && this.quietBeach(t)) {
            t.state = 'approach';
            t.tx = t.beachX;
            t.tz = t.beachZ;
          } else this.newSwim(t);
        }
        break;
      }
    }
  }

  /** Pick a quiet beach not far away (no villagers near) to come ashore on. */
  private quietBeach(t: Turtle): boolean {
    for (let k = 0; k < 8; k++) {
      const b = this.beaches[this.rng.int(0, this.beaches.length - 1)];
      if (Math.hypot(b.x - t.x, b.z - t.z) > 45) continue;
      let busy = false;
      this.people?.query(b.x, b.z, 6, () => (busy = true));
      if (busy) continue;
      t.beachX = b.x;
      t.beachZ = b.z;
      return true;
    }
    return false;
  }

  private newSwim(t: Turtle): void {
    const p = this.seaPoint(t.x, t.z, 18) ?? { x: t.x, z: t.z };
    t.state = 'swim';
    t.tx = p.x;
    t.tz = p.z;
    // Explore at mid-depth: sometimes near the bottom, sometimes just below the surface.
    t.ty = this.rng.range(-0.95, -0.25);
    if (t.breath <= 0) t.breath = this.rng.range(TURTLES.breathEvery[0], TURTLES.breathEvery[1]);
  }

  // ---------------- Drawing ----------------

  private draw(dt: number): void {
    const m = this.meshes;
    m.begin();
    for (const t of this.list) {
      // Turning rate (for the rudders and banking), tracked on or off screen.
      const dh = wrapA(t.heading - t.prevH);
      t.prevH = t.heading;
      if (dt > 0) t.turnRate += (dh / dt - t.turnRate) * Math.min(1, dt * 3);
      if (!View.sees(t.x, t.y, t.z, 0.4)) continue;
      this.drawTurtle(t, dt);
    }
    m.end();
  }

  private drawTurtle(t: Turtle, dt: number): void {
    const m = this.meshes;
    const s = t.scale;
    const inWater = t.state === 'swim' || t.state === 'approach' || t.state === 'breathe' || t.state === 'enter';
    t.wet += ((inWater ? 1 : 0) - t.wet) * Math.min(1, dt * 1.2);
    const W = smooth(t.wet), L = 1 - W;
    // ---- Land: alternating diagonal pairs heave the body forward, then a pause ----
    const crawling = t.state === 'crawl' || t.state === 'exit';
    const cyc = ((t.stroke % 1) + 1) % 1;
    const half = (cyc * 2) % 1;
    const pull = cyc < 0.5 ? 1 : -1;
    const effort = crawling ? 1 - t.shy : 0;
    const heave = (half < CRAWL.power ? Math.sin((Math.PI * half) / CRAWL.power) : 0) * effort;
    // ---- Water: synchronised "flying" strokes; slow sculling while breathing at the surface ----
    const ph = t.stroke * Math.PI * 2;
    const breathing = t.state === 'breathe' && t.y > this.sea - 0.25;
    t.gasp += ((breathing ? 1 : 0) - t.gasp) * Math.min(1, dt * 1.5);
    const amp = SWIM.flap * (1 - 0.55 * t.gasp);
    // ---- Body ----
    t.pitchS += (t.pitch - t.pitchS) * Math.min(1, dt * 2);
    const rollW = THREE.MathUtils.clamp(-t.turnRate * 0.6, -0.35, 0.35);
    t.roll += (rollW - t.roll) * Math.min(1, dt * 2);
    const bob = -Math.cos(ph) * SWIM.bob * (1 - t.gasp);
    const pitch = lerp(-heave * 0.07, t.pitchS - t.gasp * 0.22, W);
    const roll = lerp(pull * heave * CRAWL.roll, t.roll, W);
    compose(_b, t.x, t.y + 0.02 * s + (heave * CRAWL.lift * L + bob * W) * s, t.z, pitch, t.heading, roll, s);
    m.put('shell', _b, t.color);
    // ---- Neck and head: lifted with each heave and to look about; raised to breathe; tucked when shy ----
    const look = Math.max(0, Math.sin(this.time * 0.22 + t.seed));
    const resting = t.state === 'rest';
    const npLand = resting ? 0.18 - look * look * 0.45 : -0.08 - heave * 0.22;
    const npWater = -0.04 + Math.sin(this.time * 0.5 + t.seed) * 0.06 - t.gasp * 0.75;
    const np = lerp(npLand, npWater, W) + t.shy * 0.35;
    const ny = lerp(Math.sin(this.time * 0.35 + t.seed) * 0.35 * (resting ? look : 1), Math.sin(this.time * 0.2 + t.seed) * 0.12 + THREE.MathUtils.clamp(t.turnRate * 0.4, -0.3, 0.3), W) * (1 - t.shy);
    _m.multiplyMatrices(_b, compose(_t, TUR.neck[0], TUR.neck[1], TUR.neck[2] - t.shy * 0.045, np, ny, 0));
    m.put('neck', _m, WHITE);
    const gulp = t.gasp * Math.max(0, Math.sin(this.time * 3 + t.seed)) * 0.25;
    _m.multiply(compose(_t, 0, 0, NECK_LEN, -np * 0.45 - gulp, 0, 0));
    if (t.mother >= 0) _m.multiply(compose(_t, 0, 0, 0, 0, 0, 0, 1.16));
    m.put('head', _m, WHITE);
    // ---- Flippers ----
    for (let q = 0; q < 2; q++) {
      const side = q === 0 ? 1 : -1;
      // Front flipper on land: plant forward, drag back (blade dug in), pause, lift and swing forward.
      const psi = (cyc + (side > 0 ? 0 : 0.5)) % 1;
      let lSw: number, lFl = -0.22;
      if (psi < 0.3) lSw = lerp(-0.45, 0.65, smooth(psi / 0.3));
      else if (psi < 0.5) lSw = 0.65;
      else if (psi < 0.8) {
        const e = smooth((psi - 0.5) / 0.3);
        lSw = lerp(0.65, -0.45, e);
        lFl += Math.sin(Math.PI * e) * 0.4;
      } else lSw = -0.45;
      // Resting: spread flat on the sand.
      const g = crawling ? 1 : 0;
      lSw = lerp(0.45, lSw, g);
      lFl = lerp(-0.2, lFl, g);
      // In water: downstroke sweeps back with the leading edge pronated, upstroke feathers forward.
      const wFl = 0.1 + Math.sin(ph) * amp;
      const wSw = 0.5 - Math.sin(ph) * 0.35 * (amp / SWIM.flap);
      const wTw = -Math.cos(ph) * 0.45 * (amp / SWIM.flap);
      const sweep = lerp(lSw, wSw, W), flap = lerp(lFl, wFl, W);
      const bFl = lerp(-0.3, Math.sin(ph - 0.8) * 0.35 * (amp / SWIM.flap), W);
      const bSw = lerp(0.35, 0.15, W);
      const tw = lerp(0.15, wTw, W);
      _m.multiplyMatrices(_b, compose(_t, side * TUR.front[0], TUR.front[1], TUR.front[2], 0, sweep * side, flap * side));
      m.put(side > 0 ? 'armR' : 'armL', _m, WHITE);
      _m.multiply(compose(_t, side * TUR.arm, 0, 0, 0, bSw * side, bFl * side));
      _m.multiply(compose(_w, 0, 0, 0, tw, 0, 0));
      m.put(side > 0 ? 'flipR' : 'flipL', _m, WHITE);
      // Rear flippers: pushing back in the diagonal pair on land; rudders (and a little paddling) in water.
      const psr = (cyc + (side > 0 ? 0.5 : 0)) % 1;
      let rSw = 0.55, rFl = -0.2;
      if (crawling) {
        if (psr < 0.3) rSw = lerp(0.35, 1.2, smooth(psr / 0.3));
        else if (psr < 0.5) rSw = 1.2;
        else if (psr < 0.8) {
          const e = smooth((psr - 0.5) / 0.3);
          rSw = lerp(1.2, 0.35, e);
          rFl += Math.sin(Math.PI * e) * 0.25;
        } else rSw = 0.35;
      }
      const rud = THREE.MathUtils.clamp(t.turnRate * 0.8, -0.5, 0.5) * side;
      const wrSw = 1.25 + Math.sin(ph + 1.2) * 0.1;
      const wrFl = -0.05 + rud * 0.5 + Math.sin(ph + 1.2) * 0.12 * (1 - t.gasp);
      _m.multiplyMatrices(_b, compose(_t, side * TUR.rear[0], TUR.rear[1], TUR.rear[2], 0, lerp(rSw, wrSw, W) * side, lerp(rFl, wrFl, W) * side));
      _m.multiply(compose(_w, 0, 0, 0, lerp(0, rud * 0.8, W), 0, 0));
      m.put(side > 0 ? 'rearR' : 'rearL', _m, WHITE);
    }
  }
}

function wrapA(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turn(h: number, a: number, k: number): number {
  let d = a - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return h + d * Math.min(1, k);
}
