import type { World } from '../world/World';
import type { Islander } from './Islander';
import { SEA_SURFACE } from '../water/Water';

/** What the hand has done to an islander: held, flying, swimming for shore, or picking themselves up. */
export interface Flung {
  mode: 'held' | 'air' | 'swim' | 'dazed';
  /** How the body hangs or tumbles: pitch and roll in its own frame (drawn by the rig). */
  rx: number;
  rz: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds in this mode. */
  t: number;
  /** Swing speeds (the body is a pendulum under the hand), and the shore being swum for. */
  wx: number;
  wz: number;
  shore?: { x: number; z: number } | null;
}

export const HAND = {
  /** How high above the ground under the pointer a held islander dangles. */
  lift: 1.5,
  gravity: 13,
  /** Fastest throw (world units a second), and how much of the hand's speed becomes upward heave. */
  maxThrow: 15,
  loft: 0.45,
  swimSpeed: 0.6,
  /** Within this of a shark or a jellyfish swarm, a swimmer is caught. */
  sharkReach: 1.5,
  jellyReach: 1.1,
  /** Seconds lying dazed after landing before getting up. */
  dazed: 1.8,
};

export interface HandHooks {
  /** Where the sharks and the jellyfish swarms are now. */
  sharks: () => { x: number; z: number }[];
  jellies: () => { x: number; z: number; r?: number }[];
  splash?: (x: number, z: number, big: boolean) => void;
  /** Thrown into the sea and caught: the game decides what that means (see Game.ts). */
  taken: (isl: Islander, by: 'shark' | 'jellyfish') => void;
  /** Set down or washed ashore and back on their feet. */
  freed?: (isl: Islander, swam: boolean) => void;
  release: (isl: Islander) => void;
}

/**
 * The god's hand: pick an islander up, dangle them (they hang and swing like a rag doll under the
 * hand, kicking), and throw them. It shows power; it never kills by itself. Thrown on land they
 * tumble through the air, land in a heap, lie dazed a moment and get up. Thrown in the sea they
 * surface and swim for the nearest shore, unless a shark or a swarm of jellyfish reaches them first.
 * While the hand has them (any mode) the colony leaves them alone: `isl.flung` is set.
 */
export class GodHand {
  held: Islander | null = null;
  private busy = new Set<Islander>();
  private hx = 0; private hy = 0; private hz = 0;
  private hvx = 0; private hvy = 0; private hvz = 0;

  constructor(private world: World, private hooks: HandHooks) {}

  /** Anyone the hand has (held, flying, swimming or dazed). */
  get active(): boolean { return this.busy.size > 0; }

  private ground(x: number, z: number): number {
    return this.world.heightAt(x, z);
  }

  /** Take hold of an islander; the hand starts over the point (x, z). */
  grab(isl: Islander, x: number, z: number): void {
    if (this.held || isl.flung) return;
    this.hooks.release(isl);
    isl.flung = { mode: 'held', rx: 0, rz: 0, vx: 0, vy: 0, vz: 0, t: 0, wx: 0, wz: 0 };
    isl.sleeping = false;
    this.held = isl;
    this.busy.add(isl);
    this.hx = isl.x; this.hy = isl.y; this.hz = isl.z;
    this.hvx = this.hvy = this.hvz = 0;
    this.moveTo(x, z);
  }

  private tx = 0; private tz = 0;
  /** The hand follows the pointer: over ground point (x, z). */
  moveTo(x: number, z: number): void {
    this.tx = x; this.tz = z;
  }

  /** Let go: the islander leaves with the hand's speed, heaved upward a little. */
  release(): void {
    const isl = this.held;
    if (!isl?.flung) { this.held = null; return; }
    const f = isl.flung;
    let sp = Math.hypot(this.hvx, this.hvz);
    const k = sp > HAND.maxThrow ? HAND.maxThrow / sp : 1;
    sp = Math.min(sp, HAND.maxThrow);
    f.vx = this.hvx * k; f.vz = this.hvz * k;
    f.vy = Math.max(0, this.hvy) + sp * HAND.loft;
    f.mode = 'air'; f.t = 0;
    this.held = null;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const w = this.world;
    for (const isl of this.busy) {
      const f = isl.flung;
      if (!f) { this.busy.delete(isl); continue; }
      f.t += dt;
      if (f.mode === 'held') {
        // The hand eases to its place above the ground under the pointer; its speed is what a throw gives.
        const gy = Math.max(this.ground(this.tx, this.tz), SEA_SURFACE) + HAND.lift;
        const k = Math.min(1, dt * 12), nx = this.hx + (this.tx - this.hx) * k, ny = this.hy + (gy - this.hy) * k, nz = this.hz + (this.tz - this.hz) * k;
        const ax = (nx - this.hx) / dt, ay = (ny - this.hy) / dt, az = (nz - this.hz) / dt;
        const s = Math.min(1, dt * 8);
        const pvx = this.hvx, pvz = this.hvz;
        this.hvx += (ax - this.hvx) * s; this.hvy += (ay - this.hvy) * s; this.hvz += (az - this.hvz) * s;
        this.hx = nx; this.hy = ny; this.hz = nz;
        // Rag doll: the body is a damped pendulum under the hand, swung by the hand's changes of speed.
        const accX = (this.hvx - pvx) / dt, accZ = (this.hvz - pvz) / dt;
        const ch = Math.cos(isl.heading), sh = Math.sin(isl.heading);
        // (Into the body's own frame: its nose is along (sin h, cos h).)
        const fwd = accX * sh + accZ * ch, side = accX * ch - accZ * sh;
        f.wx += (-fwd * 0.5 - f.rx * 34 - f.wx * 3.2) * dt;
        f.wz += (side * 0.5 - f.rz * 34 - f.wz * 3.2) * dt;
        f.rx = clamp(f.rx + f.wx * dt, -1.5, 1.5);
        f.rz = clamp(f.rz + f.wz * dt, -1.5, 1.5);
        isl.x = this.hx; isl.z = this.hz;
        // Held by the scruff: the feet hang about a body's height under the hand.
        isl.y = this.hy - 0.5;
        continue;
      }
      if (f.mode === 'air') {
        f.vy -= HAND.gravity * dt;
        isl.x += f.vx * dt; isl.y += f.vy * dt; isl.z += f.vz * dt;
        // Tumbling head over heels, faster the harder the throw.
        const sp = Math.hypot(f.vx, f.vz);
        f.rx += (2.5 + sp * 0.55) * dt;
        f.rz += Math.sin(f.t * 5) * 0.8 * dt;
        if (sp > 0.3) isl.heading = Math.atan2(f.vx, f.vz);
        // Kept on the map.
        const lim = w.half - 1.5;
        isl.x = clamp(isl.x, -lim, lim); isl.z = clamp(isl.z, -lim, lim);
        const gy = this.ground(isl.x, isl.z);
        const cell = w.cellIndexAt(isl.x, isl.z), sea = gy < SEA_SURFACE - 0.25 && cell >= 0 && w.isSea(cell);
        if (sea && isl.y <= SEA_SURFACE - 0.1) {
          this.hooks.splash?.(isl.x, isl.z, sp > 5);
          f.mode = 'swim'; f.t = 0; f.rx = 0; f.rz = 0; f.shore = this.nearestShore(isl.x, isl.z);
        } else if (!sea && isl.y <= gy && f.vy <= 0) {
          isl.y = gy;
          f.mode = 'dazed'; f.t = 0; f.rz = 0;
        }
        continue;
      }
      if (f.mode === 'swim') {
        isl.y = SEA_SURFACE - 0.16 + Math.sin(f.t * 3.1) * 0.02;
        // (Head just clear, body along the surface: the rig plays a crawl.)
        f.rx = 0; f.rz = Math.sin(f.t * 2.4) * 0.12;
        const s = f.shore ?? (f.shore = this.nearestShore(isl.x, isl.z));
        if (s) {
          const dx = s.x - isl.x, dz = s.z - isl.z, d = Math.hypot(dx, dz) || 1;
          isl.heading = Math.atan2(dx, dz);
          isl.x += (dx / d) * HAND.swimSpeed * dt; isl.z += (dz / d) * HAND.swimSpeed * dt;
        }
        for (const sh of this.hooks.sharks()) if (Math.hypot(sh.x - isl.x, sh.z - isl.z) < HAND.sharkReach) { this.take(isl, 'shark'); break; }
        if (!isl.flung) continue;
        for (const j of this.hooks.jellies()) if (Math.hypot(j.x - isl.x, j.z - isl.z) < (j.r ?? 0) * 0.6 + HAND.jellyReach) { this.take(isl, 'jellyfish'); break; }
        if (!isl.flung) continue;
        const gy = this.ground(isl.x, isl.z);
        // Feet on the bottom in the shallows: wade on (rising out of the water) until on dry sand, then collapse.
        if (gy > SEA_SURFACE - 0.3) isl.y = Math.max(gy, SEA_SURFACE - 0.3);
        if (gy > SEA_SURFACE + 0.01) {
          isl.y = gy;
          f.mode = 'dazed'; f.t = HAND.dazed * 0.45; f.shore = s ?? { x: isl.x, z: isl.z };
        }
        continue;
      }
      // Dazed: flat on the ground (or the sand at the water's edge), then up again.
      const lie = Math.min(1, f.t / 0.25), rise = Math.max(0, (f.t - (HAND.dazed - 0.5)) / 0.5);
      f.rx = (Math.PI / 2) * lie * (1 - Math.min(1, rise));
      f.rz = 0;
      isl.y = Math.max(this.ground(isl.x, isl.z), SEA_SURFACE - 0.22);
      if (f.t >= HAND.dazed) {
        const swam = !!f.shore;
        isl.flung = undefined;
        this.busy.delete(isl);
        this.hooks.freed?.(isl, swam);
      }
    }
  }

  private take(isl: Islander, by: 'shark' | 'jellyfish'): void {
    isl.flung = undefined;
    this.busy.delete(isl);
    this.hooks.taken(isl, by);
  }

  /** The nearest dry land to swim for (a walkable shore cell), searching outward in rings. */
  nearestShore(x: number, z: number): { x: number; z: number } | null {
    const w = this.world, [cx, cz] = w.cellOf(x, z);
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (let r = 1; r < 90 && (!best || r * r <= bd * 1.3 + 4); r++) {
      for (let k = -r; k <= r; k++) for (const [gx, gz] of [[cx + k, cz - r], [cx + k, cz + r], [cx - r, cz + k], [cx + r, cz + k]]) {
        if (!w.inBounds(gx, gz)) continue;
        const i = w.idx(gx, gz);
        if (!w.isLandCell(i) || w.layer[i] < 1 || w.blocked(i)) continue;
        const d = (gx - cx) ** 2 + (gz - cz) ** 2;
        if (d < bd) { bd = d; best = { x: w.centerX(gx), z: w.centerZ(gz) }; }
      }
    }
    return best;
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
