import * as THREE from 'three';
import { GeoBuilder, M, P, lumpy } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { angularRockGeometry, rockColor, SeaMoss, subdivideFacets } from '../render/rocks';
import { palmGeometry } from '../vegetation/models';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { canoeLanding, landDistance, openSea } from './SeaStacks';
import { SEA_SURFACE, Water } from './Water';

/** Where the arch stands: its foot on the shore, the way it runs out to sea, and its parts. */
export interface ArchSite {
  /** Shore point the rock spine grows out of, and the seaward direction (unit) it runs. */
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** Along the spine: where the solid ridge ends, the open-water gap under the arch, and the pillar. */
  spineEnd: number;
  gap0: number;
  gap1: number;
  pillar: number;
  pillarR: number;
  /** Boulders fallen round the formation (world x, z, radius, top above the sea). */
  rocks: { x: number; z: number; r: number; top: number }[];
}

/** Sizes in world units. Clearance is the underside of the arch above the sea at its crown. */
const ARCH = { spine: 4.2, gap: 3.8, pillarR: 1.35, halfWidth: 1.6, clearance: 3.1, top: 4.4 };

/**
 * Find a place for the sea arch (deterministic from the seed): on the main island's coast within
 * sight of the village plain but clear of it, the settlers' canoe route, the lagoon, the reefs and
 * the sea stacks (`avoid`), where a ridge can run straight out to sea with open water both sides
 * of the gap for boats to sail through.
 */
export function placeSeaArch(w: World, seed: number, avoid: { x: number; z: number; r: number }[] = []): ArchSite | null {
  const rng = new RNG(seed * 61 + 17);
  const N = w.N;
  const sea = openSea(w);
  const dLand = landDistance(w);
  const landing = canoeLanding(w);
  const lag = w.lagoon;
  const isSea = (x: number, z: number) => {
    const i = w.cellIndexAt(x, z);
    return i >= 0 && sea[i] === 1 && w.blockFixed[i] === 0;
  };
  const clearOf = (x: number, z: number, r: number) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) > a.r + r);
  const L = ARCH.spine + 0.4 + ARCH.gap + 1.3 + ARCH.pillarR;
  let best: ArchSite | null = null, bestScore = -Infinity;
  for (let cz = 6; cz < N - 6; cz++) for (let cx = 6; cx < N - 6; cx++) {
    const i = cz * N + cx;
    if (!sea[i] || dLand[i] !== 1) continue;
    const x = w.centerX(cx), z = w.centerZ(cz);
    const dm = Math.hypot(x - w.meadow.x, z - w.meadow.z);
    if (dm < w.meadow.r + 10 || dm > w.meadow.r + 70) continue;
    if (lag && Math.hypot(x - lag.x, z - lag.z) < lag.r + 10) continue;
    if (landing) {
      const ox = x - landing.x, oz = z - landing.z;
      const along = THREE.MathUtils.clamp(ox * landing.dx + oz * landing.dz, 0, 50);
      if (Math.hypot(ox - landing.dx * along, oz - landing.dz * along) < 12) continue;
    }
    // Seaward: away from the land nearby, which must all be the main island.
    let sx = 0, sz = 0, rock = 0, other = false;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      const j = w.idx(cx + dx, cz + dz);
      if (w.layer[j] < 1) continue;
      sx -= dx;
      sz -= dz;
      rock += w.rocky[j];
      if (w.isle[j] !== 1) other = true;
    }
    const sl = Math.hypot(sx, sz);
    if (other || sl < 1e-3) continue;
    sx /= sl;
    sz /= sl;
    const qx = -sz, qz = sx;
    // The whole formation stands in open sea, clear of everything else...
    let ok = true;
    for (let t = 0.4; t <= L + 1.5 && ok; t += 0.5) for (let u = -ARCH.halfWidth - 0.6; u <= ARCH.halfWidth + 0.6 && ok; u += 0.5) {
      const px = x + sx * t + qx * u, pz = z + sz * t + qz * u;
      if (!isSea(px, pz) || !clearOf(px, pz, 0.5)) ok = false;
    }
    // ...and boats can come at the gap from either side and pass straight through.
    const tg = ARCH.spine + 0.4 + ARCH.gap / 2;
    for (let u = -9; u <= 9 && ok; u += 0.5) for (const dt of [-1, 0, 1]) {
      const px = x + sx * (tg + dt) + qx * u, pz = z + sz * (tg + dt) + qz * u;
      if (!isSea(px, pz)) ok = false;
      const j = w.cellIndexAt(px, pz);
      if (j >= 0 && Math.abs(u) < 3 && w.heightAt(px, pz) > SEA_SURFACE - 0.35) ok = false;
    }
    if (!ok) continue;
    const score = -dm * 0.02 + Math.min(1, rock / 30) + rng.next() * 0.6;
    if (score <= bestScore) continue;
    bestScore = score;
    const spineEnd = ARCH.spine, gap0 = spineEnd + 0.4, gap1 = gap0 + ARCH.gap, pillar = gap1 + 1.3;
    best = { x, z, sx, sz, spineEnd, gap0, gap1, pillar, pillarR: ARCH.pillarR, rocks: [] };
  }
  if (!best) return null;
  // Boulders tumbled round the foot (never in the channel through the gap).
  const s = best, qx = -s.sz, qz = s.sx;
  const tg = (s.gap0 + s.gap1) / 2;
  for (let k = 0; k < 80 && s.rocks.length < 11; k++) {
    const t = rng.range(-0.5, s.pillar + 3.2), u = rng.range(-4.2, 4.2) * (rng.chance(0.5) ? 1 : -1) * 0.8;
    if (Math.abs(t - tg) < ARCH.gap / 2 + 1.2 && Math.abs(u) < 9) continue;
    if (Math.abs(u) < ARCH.halfWidth + 0.4 && t < s.pillar + s.pillarR) continue;
    const r = rng.chance(0.35) ? rng.range(0.15, 0.35) : rng.range(0.4, 0.95);
    const px = s.x + s.sx * t + qx * u, pz = s.z + s.sz * t + qz * u;
    if (!isSea(px, pz) || !clearOf(px, pz, r) || s.rocks.some((o) => Math.hypot(o.x - px, o.z - pz) < o.r + r + 0.2)) continue;
    s.rocks.push({ x: px, z: pz, r, top: SEA_SURFACE + rng.range(0.1, 0.4 + r * 1.6) });
  }
  return best;
}

/** Grid cells the solid rock stands in (boats steer round them; the gap under the arch stays open). */
export function archCells(w: World, s: ArchSite): number[] {
  const out = new Set<number>();
  const tg = (s.gap0 + s.gap1) / 2;
  const add = (x: number, z: number, r: number) => {
    const [cx, cz] = w.cellOf(x, z);
    const K = Math.ceil(r + 1);
    for (let dz = -K; dz <= K; dz++) for (let dx = -K; dx <= K; dx++) {
      if (!w.inBounds(cx + dx, cz + dz)) continue;
      const px = w.centerX(cx + dx), pz = w.centerZ(cz + dz);
      if (Math.hypot(px - x, pz - z) > r + 0.2) continue;
      // Never close the channel under the arch.
      const t = (px - s.x) * s.sx + (pz - s.z) * s.sz;
      if (Math.abs(t - tg) < ARCH.gap / 2 - 0.3) continue;
      out.add(w.idx(cx + dx, cz + dz));
    }
  };
  for (let t = -0.8; t <= s.spineEnd + 0.2; t += 0.5) add(s.x + s.sx * t, s.z + s.sz * t, ARCH.halfWidth + 0.2);
  add(s.x + s.sx * s.pillar, s.z + s.sz * s.pillar, s.pillarR + 0.45);
  for (const r of s.rocks) add(r.x, r.z, r.r + 0.35);
  return [...out];
}

/**
 * A great sea arch, like Durdle Door: a ridge of faceted grey rock running out from the shore,
 * green with moss, scrub and a couple of palms along its crest, that leaps over a channel of open
 * water in a high arch to an outer pillar, with boulders tumbled round its feet and foam where the
 * sea breaks on them. Boats can sail through under the arch; the rock itself is an obstacle.
 */
export class SeaArch {
  readonly group = new THREE.Group();
  readonly site: ArchSite | null;

  constructor(private world: World, seed: number, avoid: { x: number; z: number; r: number }[] = []) {
    const w = world;
    this.site = placeSeaArch(w, seed, avoid);
    const s = this.site;
    if (!s) return;
    const rng = new RNG(seed * 97 + 5);
    const b = new GeoBuilder();
    const qx = -s.sz, qz = s.sx;
    const along = Math.atan2(s.sx, s.sz);
    const at = (t: number, u = 0) => ({ x: s.x + s.sx * t + qx * u, z: s.z + s.sz * t + qz * u });
    const bed = (x: number, z: number) => Math.min(w.heightAt(x, z), SEA_SURFACE - 0.05) - 0.25;
    const wet = SEA_SURFACE + 0.5;
    const weed: SeaMoss = { y0: SEA_SURFACE - 0.5, y1: SEA_SURFACE + 0.55, amount: 0.75 };
    const sea = SEA_SURFACE;
    // An angular rock from y0 to y1 (its geometry runs from -0.25 to about 1.05 of its height).
    const block = (x: number, z: number, y0: number, y1: number, rx: number, rz: number, turn: number, moss: number, taper?: number) => {
      const h = (y1 - y0) / 1.3;
      // Rocks standing in the sea get finer facets so the weed round the waterline shows in patches.
      const wetFoot = y0 < weed.y1 && y1 > weed.y0;
      b.add(subdivideFacets(angularRockGeometry(Math.floor(rng.next() * 1e6), { tilt: 0.22, taper }), wetFoot ? 2 : 0), { color: rockColor(moss, wet, weed), ao: { y0, y1, min: 0.7 } }, M.t(x, y0 + h * 0.25, z, 0, turn, 0, rx, h, rz));
    };
    // The ridge: stacked cliff blocks running out from the shore, highest where it leaves the land.
    const crowns: { t: number; u: number; top: number }[] = [];
    for (let t = -0.8; t <= s.spineEnd; t += 0.95) {
      const p = at(t, rng.range(-0.2, 0.2)), top = sea + ARCH.top + 0.5 * (1 - t / s.spineEnd) + rng.range(-0.25, 0.25);
      block(p.x, p.z, bed(p.x, p.z), top - 0.9, ARCH.halfWidth * rng.range(0.9, 1.1), 1.0, along + rng.range(-0.3, 0.3), 0.35, 0.85);
      // A narrower stepped crown on top, mossy.
      const ct = t + rng.range(-0.2, 0.2), cu = rng.range(-0.4, 0.4), c2 = at(ct, cu);
      block(c2.x, c2.z, top - 1.4, top, ARCH.halfWidth * 0.75, 0.8, along + rng.range(-0.5, 0.5), 0.85, 0.75);
      crowns.push({ t: ct, u: cu, top });
    }
    // The outer pillar: a tapering column with a broken crown.
    const pp = at(s.pillar);
    const ptop = sea + ARCH.top - 0.2;
    block(pp.x, pp.z, bed(pp.x, pp.z), sea + 0.7, s.pillarR * 1.35, s.pillarR * 1.2, rng.next() * 6.28, 0.1, 0.85);
    block(pp.x, pp.z, bed(pp.x, pp.z), ptop - 0.7, s.pillarR, s.pillarR * 0.92, rng.next() * 6.28, 0.3, 0.8);
    block(pp.x + rng.range(-0.2, 0.2), pp.z + rng.range(-0.2, 0.2), ptop - 1.3, ptop, s.pillarR * 0.78, s.pillarR * 0.7, rng.next() * 6.28, 0.85, 0.7);
    // The arch: chunks along a curve from the ridge's end to the pillar, its underside high over
    // the channel (ARCH.clearance at the crown) and coming down to the water at either foot.
    const t0 = s.spineEnd - 0.4, t1 = s.pillar - 0.3, chunks = 9;
    const arch: { t: number; top: number }[] = [];
    for (let k = 0; k <= chunks; k++) {
      const f = k / chunks, t = t0 + (t1 - t0) * f;
      const under = sea + 0.3 + (ARCH.clearance - 0.3) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (t - s.gap0 + 0.5) / (s.gap1 - s.gap0 + 1)))), 0.55);
      const top = sea + ARCH.top - 0.25 * Math.sin(Math.PI * f) + rng.range(-0.15, 0.15);
      const p = at(t, rng.range(-0.15, 0.15)), turn = along + rng.range(-0.25, 0.25);
      const y0 = Math.max(under, bed(p.x, p.z)), mid = (y0 + top) / 2 + 0.1;
      block(p.x, p.z, mid - 0.15, top, 1.15, 0.62, turn, 0.8);
      // Its underside: the same faceted rock upside down, so the arch is solid seen from below.
      const h = (mid - y0) / 1.3;
      b.add(angularRockGeometry(Math.floor(rng.next() * 1e6), { tilt: 0.08, taper: 0.92 }), { color: rockColor(0.05, wet, weed), ao: { y0, y1: mid, min: 0.6 } }, M.t(p.x, mid - 0.25 * h, p.z, Math.PI, Math.PI - turn, 0, 1.12, h, 0.78));
      arch.push({ t, top });
    }
    // Boulders round the feet, some weedy, some with a cap of moss.
    for (const r of s.rocks) {
      const rb = bed(r.x, r.z);
      b.add(subdivideFacets(angularRockGeometry(Math.floor(rng.next() * 1e6), { tilt: 0.2 }), 1), { color: rockColor(rng.chance(0.4) ? 0.6 : 0.15, wet, rng.chance(0.6) ? weed : undefined) },
        M.t(r.x, rb, r.z, 0, rng.next() * 6.28, 0, r.r, Math.max(0.25, r.top - rb), r.r * rng.range(0.8, 1.15)));
    }
    // Green scrub along the crest.
    const greens = [0x4f7f2c, 0x5f9233, 0x6d9e3a, 0x3f6a26];
    for (let k = 0; k < 30; k++) {
      if (k >= 24) {
        // A few tufts clinging along the top of the arch itself.
        const a = arch[1 + ((k * 3) % (arch.length - 2))], p = at(a.t + rng.range(-0.2, 0.2), rng.range(-0.4, 0.4)), r = rng.range(0.16, 0.3);
        b.add(lumpy(P.sphere(1, 1), 0.3, 500 + k, 0.7), { color: new THREE.Color(greens[k % greens.length]).multiplyScalar(rng.range(0.85, 1.1)) }, M.t(p.x, a.top - 0.1, p.z, 0, rng.next() * 6, 0, r, r * 0.6, r));
        continue;
      }
      const onPillar = k >= 20;
      const c = crowns[k % crowns.length];
      const p = onPillar ? at(s.pillar + rng.range(-0.35, 0.35), rng.range(-0.35, 0.35)) : at(c.t + rng.range(-0.5, 0.5), c.u + rng.range(-0.55, 0.55));
      const y = (onPillar ? ptop : c.top) - 0.12;
      const r = rng.range(0.22, 0.48);
      b.add(lumpy(P.sphere(1, 1), 0.3, 500 + k, 0.7), { color: new THREE.Color(greens[k % greens.length]).multiplyScalar(rng.range(0.85, 1.1)) }, M.t(p.x, y, p.z, 0, rng.next() * 6, 0, r, r * 0.7, r));
    }
    const mesh = new THREE.Mesh(b.build(), stylisedMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'seaArch';
    this.group.add(mesh);
    // A couple of small palms leaning out from the crest near the shore.
    for (let k = 0; k < 3; k++) {
      const c = crowns[(k * 2) % Math.max(1, crowns.length - 1)], p = at(c.t, c.u + rng.range(-0.25, 0.25));
      const palm = new THREE.Mesh(palmGeometry(k % 3, false, 900 + k), stylisedMaterial());
      palm.position.set(p.x, c.top - 0.15, p.z);
      palm.rotation.set(rng.range(-0.15, 0.15), rng.next() * 6.28, rng.range(-0.15, 0.15));
      palm.scale.setScalar(rng.range(0.42, 0.55));
      palm.castShadow = true;
      this.group.add(palm);
    }
    // Solid for anything steering by the world's obstacle map; foam where the sea breaks on it.
    for (const i of archCells(w, s)) if (w.layer[i] <= 0) w.blockFixed[i] = 1;
    this.stampFoam();
  }

  /** Grid cells the rock stands in (boats steer round them; the channel under the arch is left open). */
  cells(): number[] {
    return this.site ? archCells(this.world, this.site) : [];
  }

  private stampFoam(): void {
    const w = this.world, s = this.site!;
    const feet = [{ x: s.x + s.sx * s.pillar, z: s.z + s.sz * s.pillar, r: s.pillarR + 1.4 }, ...s.rocks.map((r) => ({ x: r.x, z: r.z, r: r.r + 0.8 }))];
    for (let t = 0; t <= s.spineEnd - 1; t += 1) feet.push({ x: s.x + s.sx * t, z: s.z + s.sz * t, r: ARCH.halfWidth + 1 });
    for (const f of feet) {
      const [cx, cz] = w.cellOf(f.x, f.z);
      const K = Math.ceil(f.r + 1);
      for (let dz = -K; dz <= K; dz++) for (let dx = -K; dx <= K; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const i = w.idx(cx + dx, cz + dz);
        if (w.layer[i] > 0) continue;
        const d = Math.hypot(w.centerX(cx + dx) - f.x, w.centerZ(cz + dz) - f.z);
        w.foam[i] = Math.max(w.foam[i], THREE.MathUtils.clamp(1 - (d - f.r * 0.45) / (f.r * 0.55 + 0.5), 0, 0.9));
      }
    }
  }

  /** Push the stamped foam into the sea's texture. */
  refreshWater(water: Water): void {
    const s = this.site;
    if (!s) return;
    const [cx, cz] = this.world.cellOf(s.x + s.sx * s.pillar * 0.5, s.z + s.sz * s.pillar * 0.5);
    const R = Math.ceil(s.pillar + 6), N = this.world.N;
    water.updateHeight(Math.max(0, cx - R), Math.max(0, cz - R), Math.min(N - 1, cx + R), Math.min(N - 1, cz + R));
  }
}
