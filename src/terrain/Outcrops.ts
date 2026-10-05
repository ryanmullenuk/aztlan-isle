import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { angularRockGeometry, boulderGeometry, rockColor } from '../render/rocks';
import { SEA_SURFACE } from '../water/Water';
import { World } from '../world/World';

/** Kinds of stone the outcrops are built from: columns and ledges in cliffs, bedrock slabs, scree. */
const enum Kind { Crag, Slab, Scree }

interface Piece {
  kind: Kind;
  /** Which of that kind's shapes. */
  shape: number;
  matrix: THREE.Matrix4;
  tint: number;
}

/** Shapes of each kind (instanced; rotation, scale and tint vary them). */
const SHAPES: Record<Kind, number> = { [Kind.Crag]: 6, [Kind.Slab]: 4, [Kind.Scree]: 4 };

/** Deterministic noise from a cell and a salt, so a cliff's rocks never move unless it changes. */
function rand(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function shapeGeometry(kind: Kind, k: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const seed = 9100 + kind * 97 + k * 13;
  if (kind === Kind.Crag) {
    // Columns and blocks of cliff rock: angular prisms with tilted, broken tops (unit size: about 2
    // across, 1 tall), or fractured boulders for the chunkier ledges.
    const g = k < 4 ? angularRockGeometry(seed, { taper: 0.84 + (k % 2) * 0.08, tilt: 0.1 + k * 0.02 }) : boulderGeometry(seed, { height: 1, sink: 0.25, fractures: 3, flat: 0.8 });
    b.add(g, { facet: true, color: rockColor(0.4), ao: { y0: -0.2, y1: 0.7, min: 0.62 } });
  } else if (kind === Kind.Slab) {
    // Bedrock breaking through the turf: low, wide, flat-topped.
    // Weathered darker than loose stone, with moss in the hollows.
    const base = rockColor(0.55);
    b.add(boulderGeometry(seed, { height: 0.5, flat: 1, sink: 0.4, points: 16, fractures: 2, lean: [0, 0] }), { facet: true, color: (p, n) => base(p, n).multiplyScalar(n.y > 0.8 ? 0.7 : 0.84), ao: { y0: -0.2, y1: 0.4, min: 0.7 } });
  } else {
    b.add(boulderGeometry(seed, { height: 0.9, sink: 0.2, points: 10 }), { facet: true, color: rockColor(0.12) });
  }
  return b.build();
}

/**
 * Rock breaking through the land: craggy columns and ledges set into every cliff (wherever the
 * ground drops two layers or more, which nobody can climb), bedrock slabs on the rocky hills, and,
 * on Ultra, scree at the foot of the cliffs and over the rocky ground. All of it is worked out
 * from the terrain, so it follows sculpting, and keeps off buildings, paths, rivers and landmarks.
 */
export class Outcrops {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private ultra = false;
  private timer = 0;
  private stamp = '';
  /** How many of each kind are placed (for tests and tuning). */
  counts = { crag: 0, slab: 0, scree: 0 };

  /** @param exclude ground other features own (the volcano, the sea arch): no outcrops there. */
  constructor(private world: World, private exclude: (x: number, z: number) => boolean = () => false) {
    this.refresh(true);
  }

  /** Ultra adds scree and more bedrock. */
  setUltra(enabled: boolean): void {
    if (enabled === this.ultra) return;
    this.ultra = enabled;
    this.refresh(true);
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.5;
    this.refresh(false);
  }

  /** Work the outcrops out again if the land or what stands on it has changed. */
  refresh(force: boolean): void {
    const w = this.world;
    // Cheap signature of the ground and its occupants.
    let sig = 0;
    for (let i = 0; i < w.occ.length; i += 1) if (w.occ[i] || w.path[i]) sig = (sig * 31 + i * (w.occ[i] + 3 * w.path[i])) | 0;
    const stamp = `${w.version}|${sig}|${this.ultra}`;
    if (!force && stamp === this.stamp) return;
    this.stamp = stamp;
    this.build(this.place());
  }

  /** Can rock show here? Not under buildings, paths, rivers, canals, bridges or landmarks. */
  private free(i: number): boolean {
    const w = this.world;
    return !w.occ[i] && !w.path[i] && w.wear[i] < 0.25 && !w.bridge[i] && !w.canal[i] && !w.blockFixed[i] && Number.isNaN(w.riverY[i]) && w.swamp[i] < 0.2;
  }

  private place(): Piece[] {
    const w = this.world, N = w.N;
    const out: Piece[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
    const push = (kind: Kind, i: number, salt: number, x: number, y: number, z: number, rot: THREE.Quaternion, sx: number, sy: number, sz: number) => {
      out.push({ kind, shape: Math.floor(rand(i, salt) * SHAPES[kind]), matrix: m.compose(p.set(x, y, z), rot, s.set(sx, sy, sz)).clone(), tint: rand(i, salt + 0.5) });
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let cz = 1; cz < N - 1; cz++) for (let cx = 1; cx < N - 1; cx++) {
      const i = cz * N + cx;
      const L = w.layer[i];
      if (L < 1 || !this.free(i)) continue;
      const x0 = w.centerX(cx), z0 = w.centerZ(cz);
      if (this.exclude(x0, z0)) continue;
      // Cliffs: crags along every edge the ground drops two layers or more.
      for (let d = 0; d < 4; d++) {
        const [dx, dz] = dirs[d];
        const j = i + dx + dz * N;
        if (L - w.layer[j] < 2 || !this.free(j) && w.layer[j] >= 1) continue;
        // Not on sandy banks down to a beach: only real rock faces.
        if (Math.max(w.sandy[i], w.sandy[j]) > 0.3) continue;
        const hi = w.heightAt(x0 - dx * 0.35, z0 - dz * 0.35);
        const lo = Math.min(w.heightAt(x0 + dx * 1.1, z0 + dz * 1.1), w.layer[j] <= 0 ? SEA_SURFACE - 0.3 : Infinity);
        const drop = hi - lo;
        if (drop < 0.7) continue;
        // Steep enough to be a cliff (not a grassy bank).
        if (w.heightAt(x0 + dx * 0.3, z0 + dz * 0.3) - w.heightAt(x0 + dx * 1.05, z0 + dz * 1.05) < 0.6) continue;
        // Where the face is half way down.
        const mid = (hi + lo) / 2;
        let tf = 0;
        for (let t = -0.5; t <= 0.9; t += 0.1) if (w.heightAt(x0 + dx * (0.5 + t), z0 + dz * (0.5 + t)) > mid) tf = t;
        const n = 1 + Math.floor(rand(i, d + 1) * 2);
        for (let k = 0; k < n; k++) {
          const salt = d * 10 + k;
          const along = (n === 1 ? 0 : k === 0 ? -0.24 : 0.24) + (rand(i, salt + 3) - 0.5) * 0.25;
          const bx = x0 + dx * (0.38 + tf) - dz * along, bz = z0 + dz * (0.38 + tf) + dx * along;
          const bi = w.cellIndexAt(bx, bz);
          if (bi < 0 || w.sandy[bi] > 0.3 || (w.layer[bi] >= 1 && !this.free(bi))) continue;
          const yaw = Math.atan2(dx, dz) + (rand(i, salt + 4) - 0.5) * 0.6;
          // Columns lean back into the hill a little.
          e.set(-0.12 * rand(i, salt + 5), yaw, 0, 'YXZ');
          q.setFromEuler(e);
          const width = 0.42 + rand(i, salt + 6) * 0.18, depth = 0.34 + rand(i, salt + 7) * 0.12;
          const top = hi - 0.06 - rand(i, salt + 8) * 0.22;
          // Tall cliffs get two tiers: a broad footing and a column above, set back.
          if (drop > 1.8) {
            const midY = lo + drop * (0.45 + rand(i, salt + 9) * 0.15);
            push(Kind.Crag, i, salt + 10, bx + dx * 0.08, lo - 0.1, bz + dz * 0.08, q, width * 1.15, (midY - lo + 0.1) / 1.05, depth * 1.2);
            push(Kind.Crag, i, salt + 11, bx - dx * 0.12, midY - 0.15, bz - dz * 0.12, q, width * 0.95, (top - midY + 0.15) / 1.05, depth);
          } else {
            push(Kind.Crag, i, salt + 12, bx, lo - 0.1, bz, q, width, (top - lo + 0.1) / 1.05, depth);
          }
          // Scree fallen at the foot (Ultra).
          if (this.ultra) {
            const ns = 2 + Math.floor(rand(i, salt + 13) * 3);
            for (let r = 0; r < ns; r++) {
              const fx = bx + dx * (0.35 + rand(i, salt + 20 + r) * 0.55) + (rand(i, salt + 30 + r) - 0.5) * 0.7 * -dz;
              const fz = bz + dz * (0.35 + rand(i, salt + 20 + r) * 0.55) + (rand(i, salt + 30 + r) - 0.5) * 0.7 * dx;
              const fi = w.cellIndexAt(fx, fz);
              if (fi < 0 || (w.layer[fi] >= 1 && !this.free(fi))) continue;
              const sz = 0.05 + rand(i, salt + 40 + r) * 0.08;
              e.set(0, rand(i, salt + 50 + r) * 6.28, 0);
              q.setFromEuler(e);
              push(Kind.Scree, i, salt + 60 + r, fx, w.heightAt(fx, fz) - 0.01, fz, q, sz, sz, sz * 0.9);
            }
          }
        }
      }
      // Bedrock on rocky slopes: low slabs lying with the hillside.
      const rocky = w.rocky[i];
      if (rocky < 0.4 || w.sandy[i] > 0.3) continue;
      const want = (this.ultra ? 0.36 : 0.2) * Math.min(1, (rocky - 0.4) * 2.5 + 0.3);
      if (rand(i, 101) > want) continue;
      const sx = x0 + (rand(i, 102) - 0.5) * 0.6, sz = z0 + (rand(i, 103) - 0.5) * 0.6;
      const h = w.heightAt(sx, sz), gx = w.heightAt(sx + 0.3, sz) - w.heightAt(sx - 0.3, sz), gz = w.heightAt(sx, sz + 0.3) - w.heightAt(sx, sz - 0.3);
      nrm.set(-gx, 0.6, -gz).normalize();
      // Mostly on the slopes of the hills; a few on the flat.
      if (nrm.y > 0.97 && rand(i, 104) > 0.25) continue;
      q.setFromUnitVectors(up, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(up, rand(i, 105) * 6.28));
      const r = 0.55 + rand(i, 106) * 0.55;
      push(Kind.Slab, i, 107, sx, h - 0.1, sz, q, r, 0.26 + rand(i, 108) * 0.2, r * (0.6 + rand(i, 109) * 0.3));
      if (this.ultra) {
        for (let k = 0; k < 3; k++) {
          if (rand(i, 110 + k) > 0.45) continue;
          const px = x0 + (rand(i, 120 + k) - 0.5) * 0.9, pz = z0 + (rand(i, 130 + k) - 0.5) * 0.9;
          const ss = 0.04 + rand(i, 140 + k) * 0.07;
          e.set(0, rand(i, 150 + k) * 6.28, 0);
          q.setFromEuler(e);
          push(Kind.Scree, i, 160 + k, px, w.heightAt(px, pz) - 0.01, pz, q, ss, ss, ss);
        }
      }
    }
    return out;
  }

  private build(pieces: Piece[]): void {
    const byKey = new Map<string, Piece[]>();
    for (const pc of pieces) {
      const key = `${pc.kind}:${pc.shape}`;
      let l = byKey.get(key);
      if (!l) byKey.set(key, (l = []));
      l.push(pc);
    }
    this.counts = { crag: 0, slab: 0, scree: 0 };
    for (const pc of pieces) this.counts[pc.kind === Kind.Crag ? 'crag' : pc.kind === Kind.Slab ? 'slab' : 'scree']++;
    const col = new THREE.Color();
    for (const [key, list] of byKey) {
      let mesh = this.meshes.get(key);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        let geo = this.geos.get(key);
        if (!geo) {
          const [k, sh] = key.split(':').map(Number);
          geo = shapeGeometry(k as Kind, sh);
          this.geos.set(key, geo);
        }
        mesh = new THREE.InstancedMesh(geo, stylisedMaterial(), Math.ceil(list.length * 1.3) + 8);
        const scree = key.startsWith(`${Kind.Scree}:`);
        mesh.castShadow = !scree;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.name = `outcrops-${scree ? 'scree' : key.startsWith(`${Kind.Slab}:`) ? 'slab' : 'crag'}`;
        this.meshes.set(key, mesh);
        this.group.add(mesh);
      }
      list.forEach((pc, n) => {
        mesh!.setMatrixAt(n, pc.matrix);
        mesh!.setColorAt(n, col.setScalar(0.88 + pc.tint * 0.22).multiply(new THREE.Color(1, 0.99 + pc.tint * 0.02, 0.97 + pc.tint * 0.03)));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const [key, mesh] of this.meshes) if (!byKey.has(key)) mesh.count = 0;
  }
}
