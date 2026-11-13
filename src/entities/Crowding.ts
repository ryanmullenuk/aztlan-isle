import type { World } from '../world/World';

/** Anything that walks or swims about: where it is, and (if it has one) the way it is heading. */
export interface Body { x: number; z: number; heading?: number }

interface Herd {
  list: () => Body[];
  /** Footprint radius of one body. */
  radius: (b: Body) => number;
  /** Bodies to leave alone this frame (dead, carried, flying, asleep in a kennel…). */
  skip?: (b: Body) => boolean;
  /** Swimmers are stopped by rock only; walkers by rock and by buildings. */
  water?: boolean;
}

/**
 * One rule for every creature, whatever system moves it: nothing walks through a rock, a building
 * or another animal.
 *
 * Each frame, after the creatures have moved:
 *  - a body that has stepped into rock (or, on land, a building that is not open ground like a
 *    plaza or a farm) is put back where it last stood clear, and turned aside so it tries another
 *    way instead of pushing at the wall;
 *  - any two bodies whose footprints overlap are eased apart, each giving way by half (never into
 *    a rock or a building).
 * A body that starts out inside a building (animals in a pen, a dog in its kennel) is left to
 * move about in there: it is only held to the rule once it has stood on clear ground.
 */
export class Crowding {
  private herds: Herd[] = [];
  private clear = new WeakMap<Body, { x: number; z: number }>();
  private grid = new Map<number, { b: Body; r: number; water: boolean }[]>();

  constructor(private world: World) {}

  add(herd: Herd): void {
    this.herds.push(herd);
  }

  /** Is a body of radius r at (x, z) inside something solid? */
  solid(x: number, z: number, r: number, water: boolean): boolean {
    const w = this.world;
    for (let k = 0; k < 5; k++) {
      const px = k === 0 ? x : x + (k === 1 ? r : k === 2 ? -r : 0), pz = k === 0 ? z : z + (k === 3 ? r : k === 4 ? -r : 0);
      const i = w.cellIndexAt(px, pz);
      if (i < 0) continue;
      if (w.blocked(i)) return true;
      if (!water && w.occ[i] && !w.passableBuildings.has(w.occ[i] - 1)) return true;
    }
    return false;
  }

  update(): void {
    const CELL = 1.5;
    this.grid.clear();
    for (const h of this.herds) {
      const water = !!h.water;
      for (const b of h.list()) {
        if (h.skip?.(b)) continue;
        const r = h.radius(b);
        if (this.solid(b.x, b.z, r, water)) {
          const ok = this.clear.get(b);
          // (Never stood clear: it lives in there, like a penned pig. Leave it be.)
          if (!ok) continue;
          // Slide along the wall if it can (keep the half of the step that stays clear); otherwise
          // step back and turn aside.
          if (!this.solid(b.x, ok.z, r, water)) b.z = ok.z;
          else if (!this.solid(ok.x, b.z, r, water)) b.x = ok.x;
          else {
            b.x = ok.x;
            b.z = ok.z;
            if (b.heading !== undefined) b.heading += 1.1;
          }
          ok.x = b.x;
          ok.z = b.z;
          // Back on its last clear spot, it still takes part in the jostling below.
        } else {
          const ok = this.clear.get(b);
          if (ok) { ok.x = b.x; ok.z = b.z; } else this.clear.set(b, { x: b.x, z: b.z });
        }
        const key = Math.floor(b.x / CELL) * 4096 + Math.floor(b.z / CELL);
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push({ b, r, water });
      }
    }
    // Ease overlapping neighbours apart (each pair once: same cell, or the cells east and south).
    for (const [key, cell] of this.grid) {
      for (const [dk, same] of [[0, true], [1, false], [4096, false], [4097, false], [4095, false]] as [number, boolean][]) {
        const other = same ? cell : this.grid.get(key + dk);
        if (!other) continue;
        for (let i = 0; i < cell.length; i++) for (let j = same ? i + 1 : 0; j < other.length; j++) {
          const A = cell[i], B = other[j];
          let dx = B.b.x - A.b.x, dz = B.b.z - A.b.z;
          const need = A.r + B.r, d2 = dx * dx + dz * dz;
          if (d2 >= need * need) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
          // Gently: a share of the overlap each frame, so they slide past rather than snap.
          const push = (need - d) * 0.25, ux = dx / d, uz = dz / d;
          this.nudge(A, -ux * push, -uz * push);
          this.nudge(B, ux * push, uz * push);
        }
      }
    }
  }

  private nudge(e: { b: Body; r: number; water: boolean }, dx: number, dz: number): void {
    const x = e.b.x + dx, z = e.b.z + dz;
    if (this.solid(x, z, e.r, e.water)) return;
    // Walkers stay on land and swimmers in the sea, however they are pushed.
    const i = this.world.cellIndexAt(x, z);
    if (i < 0 || (!e.water && this.world.isSea(i) && !this.world.isSea(this.world.cellIndexAt(e.b.x, e.b.z)))) return;
    e.b.x = x;
    e.b.z = z;
    const ok = this.clear.get(e.b);
    if (ok) { ok.x = x; ok.z = z; }
  }
}
