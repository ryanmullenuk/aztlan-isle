import { Gathering } from '../ai/Gathering';
import { TIME } from '../config';
import type { Game } from '../Game';
import { Lanterns } from '../render/Lanterns';
import { haptic } from '../ui/Haptics';
import type { World } from '../world/World';

export const LANTERN = {
  /** Autumn (season 2), its last day, from this hour: once a year after the harvest. */
  season: 2,
  hour: 19.2,
  /** Fewest islanders before the village keeps the custom. */
  minPeople: 5,
  /** Islanders on the shore; seconds they keep letting lanterns go; seconds between each one's lanterns. */
  people: 14,
  gatherSecs: 40,
  releaseSecs: 75,
  every: [5, 10] as [number, number],
  /** The village's cheer and the Belief it brings. */
  mood: 0.08,
  belief: 15,
};

/** Is it time for this year's Lantern Night? (Autumn's last evening, not yet held this year.) */
export function lanternDue(season: number, dayOfSeason: number, daysPerSeason: number, hour: number, year: number, held: number): boolean {
  return season === LANTERN.season && dayOfSeason === daysPerSeason && hour >= LANTERN.hour && hour < 23 && held < year;
}

/** A spot on the beach near (cx, cz) facing the sea: where the village lets its lanterns go. */
export function findShore(w: World, cx: number, cz: number): { x: number; z: number; sx: number; sz: number } | null {
  let best: { x: number; z: number; sx: number; sz: number } | null = null, bestD = Infinity;
  for (let gz = 2; gz < w.N - 2; gz += 2) for (let gx = 2; gx < w.N - 2; gx += 2) {
    const i = w.idx(gx, gz);
    if (!w.isLandCell(i) || w.layer[i] !== 1 || w.distWater[i] > 1.5 || w.occ[i] || w.blocked(i)) continue;
    const x = w.centerX(gx), z = w.centerZ(gz), d = Math.hypot(x - cx, z - cz);
    if (d < 5 || d > 70 || d >= bestD) continue;
    let sx = 0, sz = 0;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      if (w.inBounds(gx + dx, gz + dz) && w.isSeaCell(w.idx(gx + dx, gz + dz))) { sx += dx; sz += dz; }
    }
    const sl = Math.hypot(sx, sz);
    if (sl < 3) continue;
    bestD = d;
    best = { x, z, sx: sx / sl, sz: sz / sl };
  }
  return best;
}

/**
 * Lantern Night: once a year, on the last evening of autumn after the harvest is in, the village
 * walks down to the shore with paper lanterns and lets them go over the water. Hundreds drift out
 * to sea, glowing, until they are lost in the dark. A quieter companion to the fireworks; the
 * village is cheered and the gods are pleased.
 */
export class LanternNight {
  readonly lanterns = new Lanterns();
  /** The year it was last held (saved). */
  held = 0;
  private active: { t: number; phase: 'gather' | 'release'; shore: { x: number; z: number; sx: number; sz: number }; crowd: Gathering; next: Map<number, number> } | null = null;

  constructor(private game: Game) {}

  save(): { held: number } {
    return { held: this.held };
  }

  restore(d: unknown): void {
    const h = Number((d as { held?: unknown } | null)?.held);
    if (Number.isFinite(h)) this.held = h;
  }

  /** Game time `dt` (the lanterns themselves drift in real time; see Lanterns.update). */
  update(dt: number): void {
    const g = this.game, t = g.time;
    if (this.active) return this.run(dt);
    if (g.eco.godMode || !lanternDue(t.seasonIndex, t.dayOfSeason, TIME.daysPerSeason, t.hour, t.year, this.held)) return;
    this.held = t.year;
    if (g.colony.list.length < LANTERN.minPeople) return;
    const fire = g.buildings.list.find((b) => b.key === 'campfire');
    const shore = fire && findShore(g.world, fire.x, fire.z);
    if (!shore) return;
    // Along the water's edge, a little way up the beach, in a gentle line.
    const crowd = new Gathering(g.colony, 'idle', shore.x + shore.sx * 6, shore.z + shore.sz * 6);
    const slots: { x: number; z: number }[] = [];
    for (let k = 0; k < 18; k++) {
      const along = (k % 9 - 4) * 0.55, back = k < 9 ? 0 : -0.7;
      slots.push({ x: shore.x - shore.sz * along + shore.sx * back, z: shore.z + shore.sx * along + shore.sz * back });
    }
    crowd.call(LANTERN.people, slots, (i) => !!i.warrior);
    this.active = { t: 0, phase: 'gather', shore, crowd, next: new Map() };
    g.ui?.dialog.push({
      icon: 'star', kicker: 'Lantern Night', important: true, title: 'The village walks down to the shore',
      body: 'The harvest is in. Tonight the islanders let paper lanterns go over the sea, to thank the gods for the year.',
      actions: [
        { label: 'Go and watch', primary: true, run: () => g.focusAt({ x: shore.x + shore.sx * 2, z: shore.z + shore.sz * 2 }) },
        { label: 'Carry on' },
      ],
    });
    g.audio?.sfx('select');
  }

  private run(dt: number): void {
    const g = this.game, a = this.active!;
    a.t += dt;
    a.crowd.update();
    if (a.phase === 'gather') {
      if (a.crowd.present >= Math.min(a.crowd.size, 4) && a.t > 8 || a.t > LANTERN.gatherSecs) {
        if (!a.crowd.size) return this.end();
        a.phase = 'release';
        a.t = 0;
      }
      return;
    }
    // Each islander on the shore lets a lantern go every few seconds.
    for (const id of a.crowd.ids) {
      const i = g.colony.byId(id);
      if (!i || i.task) continue;
      const due = a.next.get(id) ?? Math.random() * 3;
      if (a.t < due) continue;
      a.next.set(id, a.t + LANTERN.every[0] + Math.random() * (LANTERN.every[1] - LANTERN.every[0]));
      i.heading = Math.atan2(a.shore.sx, a.shore.sz);
      this.lanterns.release(i.x + a.shore.sx * 0.12, i.y + 0.55, i.z + a.shore.sz * 0.12, a.shore.sx, a.shore.sz);
    }
    if (a.t > LANTERN.releaseSecs) this.end(true);
  }

  private end(held = false): void {
    const g = this.game, a = this.active!;
    a.crowd.release();
    this.active = null;
    if (!held) return;
    g.colony.moodBoost += LANTERN.mood;
    g.eco.add('belief', LANTERN.belief);
    g.ui?.toast(`The lanterns drift out over the sea. The village is at peace (+${LANTERN.belief} Belief).`, 'milestone');
    haptic('medium');
  }
}
