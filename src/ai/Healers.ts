import { Building, BuildingSystem } from '../buildings/Buildings';
import { HEAL } from '../buildings/models';
import { Islander, makeIslander } from '../entities/Islander';
import { RNG } from '../world/rng';

/** Healers' names (Nahuatl ticitl, "healer", and others). */
const NAMES = ['Ticitl', 'Patli', 'Xiuhtecuhtli', 'Itzpapalotl', 'Tlazohtli', 'Yolotl'];
/** Walking pace between beds, and how long they stay at each (seconds). */
const PACE = 0.55;
const STAY: [number, number] = [5, 11];

interface Healer {
  isl: Islander;
  dock: number;
  /** Local (x, z) waypoints still to walk, and seconds left at the current spot. */
  route: { x: number; z: number }[];
  wait: number;
  /** Local direction to face while there (radians, model frame). */
  face: number;
  bless: boolean;
}

/**
 * The healer of each Healing Centre: a figure dressed all in white with a feathered headdress, who
 * walks the courtyard between the beds and the hall door, stops at a bedside a while, and now and
 * then raises their arms in blessing over it. Scenery only: not a villager (never counted, chosen,
 * fed or housed, and not saved), drawn with the villagers' own bodies and animations.
 */
export class Healers {
  private healers: Healer[] = [];
  private rng = new RNG(4711);

  constructor(private bld: BuildingSystem) {}

  /** The healers, to draw with the villagers. */
  get list(): Islander[] {
    return this.healers.map((h) => h.isl);
  }

  update(dt: number): void {
    const centres = this.bld.list.filter((b) => b.key === 'healer' && b.complete);
    // A healer for every finished centre; one whose centre is gone (or being rebuilt) leaves.
    this.healers = this.healers.filter((h) => centres.some((b) => b.id === h.dock));
    for (const b of centres) if (!this.healers.some((h) => h.dock === b.id)) this.healers.push(this.make(b));
    for (const h of this.healers) {
      const b = this.bld.byId(h.dock)!;
      this.step(h, b, dt);
    }
  }

  private make(b: Building): Healer {
    const gender = b.id % 2 ? 'f' : 'm';
    const [x, z] = b.local(0, HEAL.hallFront + 0.3);
    const isl = makeIslander(-1000 - b.id, NAMES[b.id % NAMES.length], gender, x, z, () => this.rng.next());
    // All in white, with a white trim; a feathered headdress.
    isl.cloth = 0xf7f4ee;
    isl.cloth2 = 0xfbfaf6;
    isl.npc = 'healer';
    isl.y = b.y + HEAL.h;
    isl.heading = (b.rot * Math.PI) / 2;
    return { isl, dock: b.id, route: [], wait: this.rng.range(1, 3), face: 0, bless: false };
  }

  /** The next place to stand: the foot of a bed (facing it), or the hall door. */
  private choose(h: Healer, b: Building): void {
    const [lx, lz] = b.toLocal(h.isl.x, h.isl.z);
    const k = this.rng.int(-1, HEAL.beds.length - 1);
    const aisle = HEAL.beds[0].z0 + HEAL.bedLen + 0.22;
    let tx: number, tz: number;
    if (k < 0) {
      tx = 0;
      tz = HEAL.hallFront + 0.3;
      h.face = 0;
    } else {
      tx = HEAL.beds[k].x;
      tz = aisle;
      h.face = Math.PI;
    }
    // Along the walkway in front of the beds, then to the spot.
    h.route = [{ x: lx, z: aisle }, { x: tx, z: aisle }, { x: tx, z: tz }].filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) > 0.05);
    h.bless = k >= 0 && this.rng.chance(0.45);
  }

  private step(h: Healer, b: Building, dt: number): void {
    const isl = h.isl;
    const rot = (b.rot * Math.PI) / 2;
    isl.y = b.y + HEAL.h;
    if (h.route.length) {
      const [wx, wz] = b.local(h.route[0].x, h.route[0].z);
      const dx = wx - isl.x, dz = wz - isl.z, d = Math.hypot(dx, dz);
      if (d < 0.05) {
        h.route.shift();
        if (!h.route.length) h.wait = this.rng.range(STAY[0], STAY[1]);
        return;
      }
      const s = Math.min(d, PACE * dt);
      isl.x += (dx / d) * s;
      isl.z += (dz / d) * s;
      turn(isl, Math.atan2(dx, dz), dt * 6);
      isl.speed = PACE;
      isl.anim = 'walk';
      return;
    }
    // At the spot: face the bed (or out from the hall), tending, sometimes raising a blessing.
    isl.speed = 0;
    turn(isl, rot + h.face, dt * 4);
    h.wait -= dt;
    isl.anim = h.bless && h.wait > 1.5 && h.wait < STAY[0] ? 'pray' : 'idle';
    if (h.wait <= 0) this.choose(h, b);
  }
}

function turn(isl: Islander, want: number, k: number): void {
  let d = want - isl.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  isl.heading += d * Math.min(1, k);
}
