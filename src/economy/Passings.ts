import { buildingOperational } from '../buildings/BuildingCondition';
import { Gathering } from '../ai/Gathering';
import { TIME } from '../config';
import { isElder } from '../entities/CharacterVariants';
import type { Islander } from '../entities/Islander';
import type { Game } from '../Game';
import { Graves } from '../render/Graves';
import { GRAVEYARD } from '../buildings/models';
import type { Building } from '../buildings/Buildings';
import { haptic } from '../ui/Haptics';

export const PASSING = {
  /** Game days an elder lives on from when the village first knows them as one. */
  life: [12, 24] as [number, number],
  /** Nobody passes while the village has fewer grown islanders than this (a small village can't spare its elders). */
  minAdults: 6,
  /** Early morning: elders pass peacefully in their sleep, found at first light. The funeral is mid-morning, once the village is up. */
  hours: [5, 8] as [number, number],
  funeralHour: 9,
  /** Mourners at the funeral, seconds to gather and to pray, the grief, and the Belief when the village honours them. */
  mourners: 12,
  gatherSecs: 40,
  praySecs: 35,
  grief: 0.06,
  honour: 10,
  /** Seconds the two bearers may take to reach the body, and to carry it to the graveyard. */
  fetchSecs: 240,
  carrySecs: 360,
};

/** A free plot in a graveyard: its world centre and the way its headstone faces. */
interface Plot { x: number; z: number; y: number; yaw: number; venue: { x: number; z: number } }

/** The procession to the graveyard: two bearers, the body lying where they passed, and its plot. */
interface Procession { bearers: Gathering; body: { x: number; z: number; y: number }; plot: Plot; day: number; follower?: number }

/**
 * Elders pass away. Each elder has some years left; when they run out, the elder dies peacefully in
 * their sleep and is found at first light. The village gathers at a resting place near the temple
 * (or the tribal fire) and prays; a grave with a carved stone and marigolds is left there. The
 * village grieves a little, then is comforted (Belief). A village too small to spare an elder keeps
 * them a while longer.
 */
export class Passings {
  readonly graves = new Graves();
  private funeral: { name: string; t: number; phase: 'wait' | 'fetch' | 'carry' | 'gather' | 'pray'; crowd: Gathering; spot: { x: number; z: number }; spouse?: number; procession?: Procession } | null = null;

  constructor(private game: Game) {}

  save(): { graves: Graves['list'] } {
    // Someone not yet carried to the graveyard is saved as laid to rest in their plot.
    const p = this.funeral?.procession;
    return { graves: p ? [...this.graves.list, { name: this.funeral!.name, x: p.plot.x, z: p.plot.z, y: p.plot.y, yaw: p.plot.yaw, day: p.day }] : this.graves.list };
  }

  restore(d: unknown): void {
    this.graves.restore((d as { graves?: unknown } | null)?.graves);
    for (const gr of this.graves.list) this.game.world.blockCircle(gr.x, gr.z, 0.2);
  }

  /** Game time `dt`. */
  update(dt: number): void {
    const g = this.game;
    if (this.funeral) this.runFuneral(dt);
    if (g.eco.godMode || dt <= 0) return;
    // Elders' years run down (no lists made: this runs every frame).
    let adults = 0;
    for (const isl of g.colony.list) {
      if (isl.child || isl.npc) continue;
      adults++;
      if (!isElder(isl)) continue;
      if (isl.lifeLeft === undefined) isl.lifeLeft = (PASSING.life[0] + Math.random() * (PASSING.life[1] - PASSING.life[0])) * TIME.dayLength;
      isl.lifeLeft -= dt;
    }
    const h = g.time.hour;
    if (h < PASSING.hours[0] || h >= PASSING.hours[1] || this.funeral || adults < PASSING.minAdults) return;
    const due = g.colony.list.find((i) => !i.child && !i.npc && isElder(i) && (i.lifeLeft ?? 1) <= 0 && i.condition === 'well' && !i.warrior && (i.sleeping || i.hidden || !i.task));
    if (due) this.pass(due);
  }

  /**
   * The next free plot in a working graveyard, filled from the shrine end: its headstone at the
   * back of the plot, its carved face looking down the rows to the gate.
   */
  private graveyardPlot(): Plot | null {
    const g = this.game;
    for (const yard of g.buildings.list.filter((b) => b.key === 'graveyard' && buildingOperational(b))) {
      for (const [lx, lz] of [...GRAVEYARD.plots].sort((a, b) => a[1] - b[1] || Math.abs(a[0]) - Math.abs(b[0]))) {
        const [x, z] = yard.local(lx, lz);
        if (this.graves.near(x, z, 0.35)) continue;
        return { x, z, y: yard.y + 0.05, yaw: yard.angle + Math.PI, venue: { x: yard.x, z: yard.z } };
      }
    }
    return null;
  }

  /** Mourners' places at a graveyard: down the path beside the plot's row, either side. */
  private pathSlots(plot: Plot): { x: number; z: number }[] {
    const yard = this.game.buildings.list.find((b) => b.key === 'graveyard' && Math.hypot(b.x - plot.venue.x, b.z - plot.venue.z) < 0.1) as Building | undefined;
    if (!yard) return [];
    const [, lz] = yard.toLocal(plot.x, plot.z);
    const out: { x: number; z: number }[] = [];
    for (let k = 0; k < 14; k++) {
      const [x, z] = yard.local(k % 2 ? 0.32 : -0.32, lz + 1.2 - Math.floor(k / 2) * 0.42);
      out.push({ x, z });
    }
    return out;
  }

  /** Where the dead are laid: a quiet spot near the temple, or the tribal fire before there is one. */
  private restingPlace(): { x: number; z: number; venue: { x: number; z: number } } | null {
    const g = this.game, w = g.world;
    const temple = g.buildings.list.find((b) => (b.key === 'temple' || b.key === 'greattemple') && buildingOperational(b));
    const venue = temple ?? g.buildings.list.find((b) => b.key === 'campfire');
    if (!venue) return null;
    // Graves sit near each other: start beside the last one, else a little way out from the venue.
    const last = this.graves.list[this.graves.list.length - 1];
    const cx = last && Math.hypot(last.x - venue.x, last.z - venue.z) < 16 ? last.x : venue.x;
    const cz = last && Math.hypot(last.x - venue.x, last.z - venue.z) < 16 ? last.z : venue.z;
    const r0 = last && cx === last.x ? 0.9 : 5;
    for (let r = r0; r < r0 + 10; r += 0.6) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const i = w.cellIndexAt(x, z);
        if (i < 0 || !w.isLandCell(i) || w.occ[i] || w.path[i] || w.blocked(i)) continue;
        if (this.graves.list.some((gr) => Math.hypot(gr.x - x, gr.z - z) < 0.8)) continue;
        return { x, z, venue: { x: venue.x, z: venue.z } };
      }
    }
    return null;
  }

  private pass(isl: Islander): void {
    const g = this.game, c = g.colony;
    const spouse = isl.spouse !== undefined ? c.byId(isl.spouse) : undefined;
    const taught = isl.taught ?? 0;
    const spot = this.restingPlace();
    const x = isl.x, z = isl.z;
    c.remove(isl);
    c.moodBoost -= PASSING.grief;
    if (spouse) spouse.happy = Math.max(0, spouse.happy - 0.3);
    const lines = [
      `${isl.name} has passed away peacefully in their sleep.`,
      taught ? `They taught ${taught === 1 ? 'one young islander' : `${taught} young islanders`} their skills.` : '',
      spouse ? `${spouse.name} mourns them.` : '',
    ].filter(Boolean).join(' ');
    g.ui?.dialog.push({
      icon: 'home', kicker: 'An elder passes', important: true,
      title: `Farewell, ${isl.name}`,
      body: `${lines} The village gathers to lay them to rest.`,
      actions: [
        { label: 'Go to the funeral', primary: true, run: () => g.focusAt(spot ?? { x, z }) },
        { label: 'OK' },
      ],
    });
    g.audio?.sfx('select');
    haptic('light');
    // With a graveyard: they lie shrouded where they were found until two bearers carry them there.
    const plot = this.graveyardPlot();
    if (plot) {
      const y = g.world.groundY(x, z);
      this.graves.showBier({ x, y: y + 0.02, z, yaw: isl.heading });
      this.funeral = {
        name: isl.name, t: 0, phase: 'wait', crowd: new Gathering(c, 'idle', plot.x, plot.z), spot: { x: plot.x, z: plot.z }, spouse: spouse?.id,
        procession: { bearers: new Gathering(c, 'idle', x, z), body: { x, z, y }, plot, day: g.time.day },
      };
      return;
    }
    if (!spot) return;
    const y = g.world.groundY(spot.x, spot.z);
    this.graves.add({ name: isl.name, x: spot.x, z: spot.z, y, yaw: Math.atan2(spot.venue.x - spot.x, spot.venue.z - spot.z), day: g.time.day });
    // Nothing is built on a grave.
    g.world.blockCircle(spot.x, spot.z, 0.2);
    this.funeral = { name: isl.name, t: 0, phase: 'wait', crowd: new Gathering(c, 'idle', spot.x, spot.z), spot, spouse: spouse?.id };
  }

  /**
   * The bearers reach the body, lift the litter and carry it between them to the graveyard; at the
   * plot it is laid to rest, the headstone is raised, and the village is called to pray.
   */
  private procession(dt: number): void {
    const g = this.game, f = this.funeral!, p = f.procession!, c = g.colony;
    p.bearers.update();
    const ids = [...p.bearers.ids, ...(f.phase === 'carry' && p.follower !== undefined ? [p.follower] : [])]
      .map((id) => c.byId(id)).filter((i): i is NonNullable<typeof i> => !!i && !i.hidden);
    if (f.phase === 'fetch') {
      // Only those who reached the body lift it (no one is pulled across the island to it).
      const there = ids.filter((i) => Math.hypot(i.x - p.body.x, i.z - p.body.z) < 1.6 && i.task?.kind !== 'goto');
      if (there.length >= 2 || (f.t > PASSING.fetchSecs && there.length)) {
        ids.splice(0, ids.length, ...there);
        f.phase = 'carry';
        f.t = 0;
        // Off to the plot: the path beside it, one bearer either end.
        const yard = g.buildings.list.find((b) => b.key === 'graveyard' && Math.hypot(b.x - p.plot.venue.x, b.z - p.plot.venue.z) < 0.1);
        p.bearers.release();
        const [, lz] = yard ? yard.toLocal(p.plot.x, p.plot.z) : [0, 0];
        const ends = yard ? [yard.local(0, lz + 0.75), yard.local(0, lz - 0.75)] : [[p.plot.x, p.plot.z + 0.75], [p.plot.x, p.plot.z - 0.75]];
        p.bearers = new Gathering(c, 'idle', p.plot.x, p.plot.z);
        p.bearers.join(ids[0], ends[0][0], ends[0][1]);
        // The second goes the same way (kept busy, so no other work calls them off), held just behind.
        if (ids[1]) { p.follower = ids[1].id; c.walkTo(ids[1], ends[1][0], ends[1][1]); }
      } else if (f.t > PASSING.fetchSecs) return this.bury();
      return;
    }
    // Carrying: the first bearer leads the way and the second walks close behind, the litter
    // between them at hand height (or carried alone, alongside).
    if (ids.length >= 2) {
      const [a, b] = ids, fx = Math.sin(a.heading), fz = Math.cos(a.heading);
      b.x = a.x - fx * 1.15;
      b.z = a.z - fz * 1.15;
      b.y = g.world.groundY(b.x, b.z);
      b.heading = a.heading;
      b.anim = a.anim === 'walk' || a.anim === 'run' ? 'walk' : 'idle';
      this.graves.showBier({ x: a.x - fx * 0.58, y: (a.y + b.y) / 2 + 0.5, z: a.z - fz * 0.58, yaw: a.heading });
    } else if (ids.length === 1) {
      const a = ids[0];
      this.graves.showBier({ x: a.x + Math.cos(a.heading) * 0.4, y: a.y + 0.5, z: a.z - Math.sin(a.heading) * 0.4, yaw: a.heading });
    }
    if (p.bearers.present >= 1 || f.t > PASSING.carrySecs || !ids.length) this.bury();
  }

  /** At the plot: the body is laid to rest, the headstone appears, and the mourners are called. */
  private bury(): void {
    const g = this.game, f = this.funeral!, p = f.procession!;
    p.bearers.release();
    this.graves.showBier(null);
    this.graves.add({ name: f.name, x: p.plot.x, z: p.plot.z, y: p.plot.y, yaw: p.plot.yaw, day: p.day });
    f.procession = undefined;
    f.phase = 'gather';
    f.t = 0;
    this.callMourners(this.pathSlots(p.plot));
  }

  /** Mid-morning: the village comes to stand round the grave (or along the graveyard path). */
  private callMourners(at?: { x: number; z: number }[]): void {
    const f = this.funeral!, c = this.game.colony, { x, z } = f.spot;
    const slots: { x: number; z: number }[] = at?.length ? at.slice() : [];
    for (let k = 0; k < 14 && !at?.length; k++) {
      const ring = k < 8 ? 1.1 : 1.7, n = k < 8 ? 8 : 6, a = ((k < 8 ? k : k - 8) / n) * Math.PI * 2 + (k < 8 ? 0 : 0.3);
      slots.push({ x: x + Math.cos(a) * ring, z: z + Math.sin(a) * ring });
    }
    const spouse = f.spouse !== undefined ? c.byId(f.spouse) : undefined;
    if (spouse && !spouse.hidden && spouse.condition === 'well') { const s0 = slots.shift()!; f.crowd.join(spouse, s0.x, s0.z); }
    f.crowd.call(PASSING.mourners, slots, (i) => !!i.warrior);
    this.game.ui?.toast(`The village gathers to lay ${f.name} to rest.`, 'info', { x, z });
  }

  private runFuneral(dt: number): void {
    const g = this.game, f = this.funeral!;
    f.t += dt;
    if (f.phase === 'wait') {
      if (g.time.hour < PASSING.funeralHour || g.time.hour > 17) return;
      f.t = 0;
      if (f.procession) {
        // Two bearers come for the body, one at each end of the litter.
        const p = f.procession, { x, z } = p.body;
        p.bearers.call(2, [{ x: x - 0.75, z }, { x: x + 0.75, z }], (i) => !!i.warrior);
        f.phase = 'fetch';
        g.ui?.toast(`Two islanders go to carry ${f.name} to the graveyard.`, 'info', { x, z });
        return;
      }
      f.phase = 'gather';
      this.callMourners();
      return;
    }
    if (f.phase === 'fetch' || f.phase === 'carry') return this.procession(dt);
    f.crowd.update();
    if (f.phase === 'gather') {
      if ((f.crowd.present >= Math.min(f.crowd.size, 4) && f.t > 10) || f.t > PASSING.gatherSecs) {
        f.phase = 'pray';
        f.t = 0;
        f.crowd.anim = 'pray';
      }
      return;
    }
    if (f.t < PASSING.praySecs) return;
    f.crowd.release();
    this.funeral = null;
    g.eco.add('belief', PASSING.honour);
    g.colony.moodBoost += PASSING.grief * 0.5;
    g.ui?.toast(`The village has laid ${f.name} to rest. Their memory comforts the village (+${PASSING.honour} Belief).`, 'info');
  }
}
