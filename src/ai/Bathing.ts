import type { Islander } from '../entities/Islander';
import { SEA_SURFACE } from '../water/Water';
import type { World } from '../world/World';

export const BATHE = {
  /** Game seconds between looks for someone who fancies a swim. */
  every: [20, 45] as [number, number],
  /** Most in the water at once, and how far (world units) anyone walks for a swim. */
  most: 4,
  reach: 45,
  /** Deep enough to swim in. */
  minDepth: 0.38,
  /** Seconds in the water; strokes and spells treading water. */
  secs: [40, 90] as [number, number],
  stroke: 0.45,
  tread: [4, 9] as [number, number],
  /** Gives up walking there after this long. */
  walkSecs: 120,
  /** A swim lifts the swimmer's happiness, and the village's mood a little. */
  happy: 0.22,
  mood: 0.015,
  hours: [9, 18] as [number, number],
};

/** Fresh water at (x, z): its surface and depth (the glade's lake and other inland water, rivers and waterfall pools; never the sea). */
export function freshWater(w: World, x: number, z: number): { y: number; depth: number } | null {
  const i = w.cellIndexAt(x, z);
  if (i < 0) return null;
  const g = w.heightAt(x, z), ry = w.riverY[i];
  if (!Number.isNaN(ry)) return ry > g ? { y: ry, depth: ry - g } : null;
  if (w.layer[i] <= 0 && !w.isSea(i)) return SEA_SURFACE > g ? { y: SEA_SURFACE, depth: SEA_SURFACE - g } : null;
  return null;
}

/** A spot deep enough to swim, and the dry ground where swimmers walk in and out. */
export interface SwimSpot { x: number; z: number; y: number; ex: number; ez: number }

/** What bathing needs from the game. */
export interface BathingWorld {
  world: World;
  people: () => Islander[];
  walkTo: (isl: Islander, x: number, z: number) => void;
  /** May anyone swim now (daylight, fair weather, not winter)? */
  fair: () => boolean;
  /** A swim is over. */
  swam: (isl: Islander) => void;
}

interface Swimmer {
  id: number;
  phase: 'walk' | 'swim' | 'out';
  t: number;
  until: number;
  spot: SwimSpot;
  tx: number;
  tz: number;
  /** Seconds left treading water (0 while swimming a stroke). */
  tread: number;
}

/**
 * Swimming for pleasure: now and then, on a fair day, an islander with nothing to do walks down to
 * the glade's lake, a river pool or the pool under the waterfall, wades in and swims about,
 * stopping to tread water, before climbing out happier. (Never the sea: that has sharks.) In the
 * water they are `isl.flung` with mode 'bathe', so the colony leaves them be; the god's hand can
 * still pluck them out.
 */
export class Bathing {
  list: Swimmer[] = [];
  private timer = BATHE.every[0];
  private spots: SwimSpot[] = [];
  private spotsVersion = -1;

  constructor(private w: BathingWorld, private rnd: () => number = Math.random) {}

  /** Every place deep enough to swim, each with its way in (found once per change of the land). */
  swimSpots(): SwimSpot[] {
    const w = this.w.world;
    if (this.spotsVersion === w.version) return this.spots;
    this.spotsVersion = w.version;
    const out: SwimSpot[] = [];
    for (let gz = 1; gz < w.N - 1; gz += 2) for (let gx = 1; gx < w.N - 1; gx += 2) {
      const x = w.centerX(gx), z = w.centerZ(gz), f = freshWater(w, x, z);
      if (!f || f.depth < BATHE.minDepth) continue;
      // The nearest dry, open ground within a few cells: where they walk in.
      let best: [number, number] | null = null, bd = Infinity;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        if (!w.inBounds(gx + dx, gz + dz)) continue;
        const j = w.idx(gx + dx, gz + dz);
        const ex = w.centerX(gx + dx), ez = w.centerZ(gz + dz);
        // Dry ground, above the water (not a marshy margin lying under it).
        if (!w.isLandCell(j) || w.layer[j] < 1 || w.blocked(j) || w.occ[j] || freshWater(w, ex, ez) || w.heightAt(ex, ez) < f.y + 0.03) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = [w.centerX(gx + dx), w.centerZ(gz + dz)]; }
      }
      if (best) out.push({ x, z, y: f.y, ex: best[0], ez: best[1] });
    }
    return (this.spots = out);
  }

  /** Game time `dt`. */
  update(dt: number): void {
    if (dt <= 0) return;
    for (const s of [...this.list]) this.step(s, dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = BATHE.every[0] + this.rnd() * (BATHE.every[1] - BATHE.every[0]);
    if (this.list.length < BATHE.most && this.w.fair()) this.invite();
  }

  /** Someone at a loose end goes for a swim, if there is water near them. */
  invite(): boolean {
    const spots = this.swimSpots();
    if (!spots.length) return false;
    const idle = this.w.people().filter((i) => !i.npc && !i.hidden && !i.sleeping && !i.flung && !i.task && !i.warrior
      && i.condition === 'well' && i.hunger > 0.5 && i.rest > 0.4 && !this.list.some((s) => s.id === i.id));
    for (let tries = 0; tries < 6 && idle.length; tries++) {
      const isl = idle.splice(Math.floor(this.rnd() * idle.length), 1)[0];
      let spot: SwimSpot | null = null, bd = BATHE.reach * BATHE.reach;
      for (const s of spots) {
        const d = (s.ex - isl.x) ** 2 + (s.ez - isl.z) ** 2;
        if (d < bd) { bd = d; spot = s; }
      }
      if (!spot) continue;
      this.w.walkTo(isl, spot.ex, spot.ez);
      this.list.push({ id: isl.id, phase: 'walk', t: 0, until: 0, spot, tx: spot.x, tz: spot.z, tread: 0 });
      return true;
    }
    return false;
  }

  private drop(s: Swimmer): void {
    this.list = this.list.filter((x) => x !== s);
  }

  /** Somewhere deep enough to swim to, near where they went in. */
  private nextTarget(s: Swimmer): void {
    const w = this.w.world;
    for (let k = 0; k < 10; k++) {
      const a = this.rnd() * Math.PI * 2, r = 0.6 + this.rnd() * 3.2, x = s.spot.x + Math.cos(a) * r, z = s.spot.z + Math.sin(a) * r;
      const f = freshWater(w, x, z);
      if (f && f.depth >= BATHE.minDepth) { s.tx = x; s.tz = z; return; }
    }
    s.tx = s.spot.x; s.tz = s.spot.z;
  }

  private step(s: Swimmer, dt: number): void {
    const isl = this.w.people().find((i) => i.id === s.id);
    if (!isl) return this.drop(s);
    s.t += dt;
    if (s.phase === 'walk') {
      if (isl.flung || isl.condition !== 'well' || s.t > BATHE.walkSecs) return this.drop(s);
      if (isl.task?.kind === 'goto') return;
      // Called away to something else, or not there yet: give up.
      if (isl.task || Math.hypot(isl.x - s.spot.ex, isl.z - s.spot.ez) > 1.6) return this.drop(s);
      isl.flung = { mode: 'bathe', rx: 0, rz: 0, vx: 0, vy: 0, vz: 0, t: 0, wx: 0, wz: 0, stroke: true };
      s.phase = 'swim';
      s.t = 0;
      s.until = BATHE.secs[0] + this.rnd() * (BATHE.secs[1] - BATHE.secs[0]);
      s.tx = s.spot.x; s.tz = s.spot.z;
      return;
    }
    const f = isl.flung;
    // Plucked out by the god, or struck down: no longer bathing.
    if (!f || f.mode !== 'bathe') return this.drop(s);
    f.t += dt;
    const w = this.w.world, ground = w.heightAt(isl.x, isl.z), water = freshWater(w, isl.x, isl.z)?.y ?? s.spot.y;
    if (s.phase === 'swim' && s.t > s.until) { s.phase = 'out'; s.tread = 0; s.tx = s.spot.ex; s.tz = s.spot.ez; }
    if (s.tread > 0) {
      // Treading water: upright, in up to the shoulders, bobbing, turning slowly.
      s.tread -= dt;
      f.stroke = false;
      f.wade = false;
      f.rx = 0; f.rz = Math.sin(f.t * 1.7) * 0.05;
      isl.heading += Math.sin(f.t * 0.4 + isl.id) * 0.3 * dt;
      isl.y = Math.max(ground, water - 0.47 + Math.sin(f.t * 2.2) * 0.025);
      if (s.tread <= 0) this.nextTarget(s);
      return;
    }
    // A stroke: head toward the target, lying along the surface; where it is too shallow, wade on foot.
    const shallow = ground > water - 0.3;
    f.stroke = !shallow;
    f.wade = shallow;
    const dx = s.tx - isl.x, dz = s.tz - isl.z, d = Math.hypot(dx, dz);
    if (d > 0.05) {
      isl.heading = Math.atan2(dx, dz);
      const step = Math.min(d, (shallow ? 0.9 : BATHE.stroke) * dt);
      isl.x += (dx / d) * step; isl.z += (dz / d) * step;
    }
    f.rx = 0; f.rz = Math.sin(f.t * 2.4) * 0.1;
    isl.y = shallow ? ground : Math.max(ground, water - 0.16 + Math.sin(f.t * 3.1) * 0.02);
    if (d > 0.25) return;
    if (s.phase === 'out') {
      // Out on the bank, dripping and happy.
      isl.flung = undefined;
      isl.y = ground;
      this.drop(s);
      this.w.swam(isl);
      return;
    }
    s.tread = BATHE.tread[0] + this.rnd() * (BATHE.tread[1] - BATHE.tread[0]);
  }
}
