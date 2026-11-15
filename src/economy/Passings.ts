import { buildingOperational } from '../buildings/BuildingCondition';
import { Gathering } from '../ai/Gathering';
import { TIME } from '../config';
import { isElder } from '../entities/CharacterVariants';
import type { Islander } from '../entities/Islander';
import type { Game } from '../Game';
import { Graves, type Grave } from '../render/Graves';
import { GRAVEYARD, PYRE_HEARTH } from '../buildings/models';
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
  /** Seconds the pyre burns: the fire takes, the body blackens, pales to ash and is gone, the fire sinks and dies. */
  burnSecs: 55,
  grief: 0.06,
  honour: 10,
  /** Seconds the two bearers may take to reach the body, and to carry it to the graveyard. */
  fetchSecs: 240,
  carrySecs: 360,
  /** Someone struck down: seconds before the bearers set out (once the others have fled), and by when they reach the body. */
  bearersAfter: 10,
  fetchBy: 60,
  /** Mourners who must stand round the pyre before it is lit (fewer only if the village hasn't so many). */
  pyreMourners: 5,
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
  /** Where a funeral is gathered now (for the mourners' bearing). */
  get mourningAt(): { x: number; z: number } | null {
    const f = this.funeral;
    return f && (f.phase === 'gather' || f.phase === 'pray') ? f.spot : null;
  }
  private funeral: { name: string; t: number; phase: 'wait' | 'fetch' | 'carry' | 'gather' | 'pray'; crowd: Gathering; spot: { x: number; z: number }; spouse?: number; /** Struck down: carried off at once, whatever the hour. */ prompt?: boolean; procession?: Procession; /** Burned on the Funeral Pyre (true) or buried (false). */ pyre?: boolean } | null = null;

  constructor(private game: Game) {}

  save(): { graves: Graves['list'] } {
    // Someone being carried to their grave is saved as laid in it (a pyre funeral is not kept).
    const f = this.funeral, p = f?.procession;
    return { graves: p && !f!.pyre ? [...this.graves.list, { name: f!.name, x: p.plot.x, z: p.plot.z, y: p.plot.y, yaw: p.plot.yaw, day: p.day }] : this.graves.list };
  }

  restore(d: unknown): void {
    this.graves.restore((d as { graves?: unknown } | null)?.graves);
    for (const gr of this.graves.list) this.game.world.blockCircle(gr.x, gr.z, 0.2);
  }

  /** Game time `dt`. */
  update(dt: number): void {
    const g = this.game;
    if (this.funeral) this.runFuneral(dt);
    else if (this.waiting.length && dt > 0) {
      // The pyre is free: the next of the dead is taken up.
      const next = this.waiting.shift()!;
      this.graves.takeBody(next.body);
      this.startFuneral(next.name, next.x, next.z, next.yaw, next.spouse, next.prompt);
    }
    if (dt > 0) this.graves.fadeAsh(dt, TIME.dayLength);
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

  /** Is there a free plot in a graveyard to move a grave into? */
  get plotFree(): boolean {
    return !!this.graveyardPlot();
  }

  /** The ground under a grave is kept clear of building; free it when the grave goes, claim it where it comes. */
  private claim(gr: Grave, on: boolean): void {
    const w = this.game.world, i = w.cellIndexAt(gr.x, gr.z);
    if (on) w.blockCircle(gr.x, gr.z, 0.2);
    else if (i >= 0) { w.blockFixed[i] = 0; w.navigationVersion++; }
  }

  /**
   * Move a grave to any open ground the player chooses (it faces the same way as before).
   * Returns why not, or null once it is done.
   */
  moveGrave(gr: Grave, x: number, z: number, yaw = gr.yaw): string | null {
    const w = this.game.world, why = this.graveSpot(gr, x, z);
    if (why) return why;
    this.claim(gr, false);
    gr.x = x; gr.z = z; gr.y = w.groundY(x, z); gr.yaw = yaw;
    this.claim(gr, true);
    this.graves.redraw();
    return null;
  }

  /** Why a grave may not be moved to (x, z), or null if it may. */
  graveSpot(gr: Grave, x: number, z: number): string | null {
    const w = this.game.world, i = w.cellIndexAt(x, z), here = w.cellIndexAt(gr.x, gr.z);
    if (i < 0 || !w.isLandCell(i)) return 'A grave needs dry land.';
    if (w.occ[i]) return 'A building stands there: choose open ground (or move the grave to the graveyard).';
    if (i !== here && w.blocked(i)) return 'Rock or a landmark is in the way.';
    if (this.graves.list.some((o) => o !== gr && Math.hypot(o.x - x, o.z - z) < 0.7)) return 'Another grave lies there.';
    return null;
  }

  /** Move a grave into the next free plot of a graveyard, laid out like the rest. False if there is no free plot. */
  moveToGraveyard(gr: Grave): boolean {
    const plot = this.graveyardPlot();
    if (!plot) return false;
    this.claim(gr, false);
    gr.x = plot.x; gr.z = plot.z; gr.y = plot.y; gr.yaw = plot.yaw;
    this.claim(gr, true);
    this.graves.redraw();
    return true;
  }

  /** Is this grave already in a graveyard plot? */
  inGraveyard(gr: Grave): boolean {
    const i = this.game.world.cellIndexAt(gr.x, gr.z);
    const b = i >= 0 && this.game.world.occ[i] ? this.game.buildings.byId(this.game.world.occ[i] - 1) : undefined;
    return b?.key === 'graveyard';
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

  /**
   * An islander dies by the god's own doing (struck down, or thrown to the sharks): the village
   * mourns and buries them as it does an elder, with words for how it happened.
   */
  take(isl: Islander, words: { kicker: string; line: string }, quiet = false): void {
    this.game.ancestors?.remember(isl.name, isl.gender === 'f');
    // One funeral at a time: anyone else who dies while one is under way (or in the same stroke)
    // lies shrouded where they fell until the pyre is free for them.
    if (this.funeral || quiet) this.layToRest(isl, quiet ? null : words);
    else this.pass(isl, words);
  }

  /**
   * After the burning: an urn of their ashes is set in the next free plot of a graveyard (true),
   * or, with no graveyard or no room, the ashes are scattered on the wind (false).
   */
  private keepAshes(name: string): boolean {
    const plot = this.graveyardPlot();
    if (!plot) return false;
    this.graves.add({ name, x: plot.x, z: plot.z, y: plot.y, yaw: plot.yaw, day: this.game.time.day, urn: true });
    this.game.world.blockCircle(plot.x, plot.z, 0.2);
    return true;
  }

  /** The dead waiting for the pyre: each lies shrouded where they fell and is carried there in turn. */
  private waiting: { name: string; x: number; z: number; yaw: number; spouse?: number; prompt?: boolean; body: import('three').Object3D }[] = [];

  /** Their funeral must wait for the one under way: the body lies where it fell (a few at most; beyond that they are burned quietly). */
  private layToRest(isl: Islander, words: { kicker: string; line: string } | null): void {
    const g = this.game, c = g.colony;
    const spouse = isl.spouse !== undefined ? c.byId(isl.spouse) : undefined;
    c.remove(isl);
    c.moodBoost -= PASSING.grief * 0.5;
    if (spouse) spouse.happy = Math.max(0, spouse.happy - 0.3);
    if (this.waiting.length < 6 && (this.pyreSite(isl.x, isl.z) || this.graveyardPlot() || this.restingPlace())) {
      const y = g.world.groundY(isl.x, isl.z);
      this.waiting.push({ name: isl.name, x: isl.x, z: isl.z, yaw: isl.heading, spouse: spouse?.id, prompt: true, body: this.graves.layBody({ x: isl.x, y: y + 0.02, z: isl.z, yaw: isl.heading }) });
    } else if (this.pyreSite(isl.x, isl.z)) this.keepAshes(isl.name);
    else this.quickGrave(isl.name);
    if (words) g.ui?.toast(words.line, 'warn');
  }

  /** A grave with no ceremony: the next graveyard plot, or a quiet spot near the temple or fire. */
  private quickGrave(name: string): void {
    const g = this.game, plot = this.graveyardPlot(), spot = plot ? null : this.restingPlace();
    if (plot) this.graves.add({ name, x: plot.x, z: plot.z, y: plot.y, yaw: plot.yaw, day: g.time.day });
    else if (spot) this.graves.add({ name, x: spot.x, z: spot.z, y: g.world.groundY(spot.x, spot.z), yaw: Math.atan2(spot.venue.x - spot.x, spot.venue.z - spot.z), day: g.time.day });
    const at = plot ?? spot;
    if (at) g.world.blockCircle(at.x, at.z, 0.2);
  }

  /** The Funeral Pyre the dead are carried to (the nearest one built and in use), if the village has one. */
  private pyreSite(x: number, z: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.game.buildings.list) {
      if (b.key !== 'pyre' || !buildingOperational(b)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private pass(isl: Islander, words?: { kicker: string; line: string }): void {
    const g = this.game, c = g.colony;
    const spouse = isl.spouse !== undefined ? c.byId(isl.spouse) : undefined;
    const taught = isl.taught ?? 0;
    const spot = this.restingPlace();
    const x = isl.x, z = isl.z;
    c.remove(isl);
    c.moodBoost -= PASSING.grief;
    if (spouse) spouse.happy = Math.max(0, spouse.happy - 0.3);
    const lines = [
      words ? words.line : `${isl.name} has passed away peacefully in their sleep.`,
      !words && taught ? `They taught ${taught === 1 ? 'one young islander' : `${taught} young islanders`} their skills.` : '',
      spouse ? `${spouse.name} mourns them.` : '',
    ].filter(Boolean).join(' ');
    g.ui?.dialog.push({
      icon: 'home', kicker: words?.kicker ?? 'An elder passes', important: true, art: 'death',
      title: `Farewell, ${isl.name}`,
      body: `${lines} ${this.pyreSite(x, z) ? 'The village will carry them to the pyre.' : 'The village gathers to lay them to rest.'}`,
      actions: [
        { label: 'Go to the funeral', primary: true, run: () => g.focusAt(spot ?? { x, z }) },
        { label: 'OK' },
      ],
    });
    g.audio?.sfx('select');
    haptic('light');
    this.startFuneral(isl.name, x, z, isl.heading, spouse?.id, !!words);
  }

  /**
   * Begin the rite for someone lying at (x, z). With a Funeral Pyre built, the logs are stacked on
   * its hearth and two bearers carry them there to be burned. Without one they are buried: carried
   * to the next graveyard plot, or laid in a grave at a quiet spot near the temple (or the fire).
   */
  private startFuneral(name: string, x: number, z: number, heading: number, spouseId?: number, prompt = false): void {
    const g = this.game, c = g.colony, y = g.world.groundY(x, z);
    const site = this.pyreSite(x, z);
    if (site) {
      const py = site.y + PYRE_HEARTH, yaw = site.angle;
      this.graves.showPyre({ x: site.x, y: py, z: site.z, yaw });
      this.graves.showBier({ x, y: y + 0.02, z, yaw: heading });
      this.funeral = {
        name, t: 0, phase: 'wait', crowd: new Gathering(c, 'idle', site.x, site.z), spot: { x: site.x, z: site.z }, spouse: spouseId, pyre: true, prompt,
        procession: { bearers: new Gathering(c, 'idle', x, z), body: { x, z, y }, plot: { x: site.x, z: site.z, y: py, yaw, venue: { x: site.x, z: site.z } }, day: g.time.day },
      };
      return;
    }
    // Buried: to the graveyard if there is room (carried there by two bearers) ...
    const plot = this.graveyardPlot();
    if (plot) {
      this.graves.showBier({ x, y: y + 0.02, z, yaw: heading });
      this.funeral = {
        name, t: 0, phase: 'wait', crowd: new Gathering(c, 'idle', plot.x, plot.z), spot: { x: plot.x, z: plot.z }, spouse: spouseId, prompt,
        procession: { bearers: new Gathering(c, 'idle', x, z), body: { x, z, y }, plot, day: g.time.day },
      };
      return;
    }
    // ... or in a grave at a quiet spot by the temple or the fire, the village gathering round it.
    const spot = this.restingPlace();
    if (!spot) return;
    this.graves.add({ name, x: spot.x, z: spot.z, y: g.world.groundY(spot.x, spot.z), yaw: Math.atan2(spot.venue.x - spot.x, spot.venue.z - spot.z), day: g.time.day });
    g.world.blockCircle(spot.x, spot.z, 0.2);
    this.funeral = { name, t: 0, phase: 'wait', crowd: new Gathering(c, 'idle', spot.x, spot.z), spot, spouse: spouseId };
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
      // Short of hands (asleep, busy, or ran off): call others every few seconds.
      if (p.bearers.size < 2 && Math.floor(f.t / 4) !== Math.floor((f.t - dt) / 4)) p.bearers.call(2 - p.bearers.size, this.litterEnds(p.body.x, p.body.z), this.notBearer);
      // Only those who reached the body lift it (no one is pulled across the island to it).
      const there = ids.filter((i) => Math.hypot(i.x - p.body.x, i.z - p.body.z) < 1.6 && i.task?.kind !== 'goto');
      if (there.length >= 2 || (f.t > (f.prompt ? PASSING.fetchBy : PASSING.fetchSecs) && there.length)) {
        ids.splice(0, ids.length, ...there);
        f.phase = 'carry';
        f.t = 0;
        // Off to the plot: the path beside it, one bearer either end.
        const yard = g.buildings.list.find((b) => b.key === 'graveyard' && Math.hypot(b.x - p.plot.venue.x, b.z - p.plot.venue.z) < 0.1);
        p.bearers.release();
        const [, lz] = yard ? yard.toLocal(p.plot.x, p.plot.z) : [0, 0];
        const ends = yard && !f.pyre ? [yard.local(0, lz + 0.75), yard.local(0, lz - 0.75)] : [[p.plot.x, p.plot.z + 1.3], [p.plot.x, p.plot.z - 1.3]];
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
    f.procession = undefined;
    f.phase = 'gather';
    f.t = 0;
    if (f.pyre) {
      // Laid on top of the pyre.
      this.graves.showBier({ x: p.plot.x, y: p.plot.y + Graves.PYRE_TOP + 0.03, z: p.plot.z, yaw: p.plot.yaw });
      this.callMourners();
      return;
    }
    // Laid in the plot under a headstone; the mourners line the graveyard path.
    this.graves.showBier(null);
    this.graves.add({ name: f.name, x: p.plot.x, z: p.plot.z, y: p.plot.y, yaw: p.plot.yaw, day: p.day });
    this.game.world.blockCircle(p.plot.x, p.plot.z, 0.2);
    this.callMourners(this.pathSlots(p.plot));
  }

  /** Mid-morning: the village comes to stand round the grave (or along the graveyard path). */
  private callMourners(at?: { x: number; z: number }[], again = false): void {
    const f = this.funeral!, c = this.game.colony, { x, z } = f.spot;
    const slots: { x: number; z: number }[] = at?.length ? at.slice() : [];
    for (let k = 0; k < 14 && !at?.length; k++) {
      // (Standing well back: the pyre burns as big as the village bonfire.)
      const near = f.pyre ? 1.9 : 1.1, far = f.pyre ? 2.6 : 1.7;
      const ring = k < 8 ? near : far, n = k < 8 ? 8 : 6, a = ((k < 8 ? k : k - 8) / n) * Math.PI * 2 + (k < 8 ? 0 : 0.3);
      slots.push({ x: x + Math.cos(a) * ring, z: z + Math.sin(a) * ring });
    }
    const spouse = f.spouse !== undefined ? c.byId(f.spouse) : undefined;
    if (spouse && !again && !spouse.hidden && spouse.condition === 'well') { const s0 = slots.shift()!; f.crowd.join(spouse, s0.x, s0.z); }
    f.crowd.call(PASSING.mourners - f.crowd.size, slots, (i) => !!i.warrior || i.task?.kind === 'flee');
    if (again) return;
    this.game.ui?.toast(f.pyre ? `The village gathers at the pyre for ${f.name}: it is lit once ${PASSING.pyreMourners} have come.` : `The village gathers to lay ${f.name} to rest.`, 'info', { x, z });
  }

  /** Where the two bearers stand to lift the litter. */
  private litterEnds(x: number, z: number): { x: number; z: number }[] {
    return [{ x: x - 0.75, z }, { x: x + 0.75, z }];
  }

  /** Not sent to carry the dead: warriors, and anyone still running from the bolt (once they have stopped, they may come back for the body). */
  private notBearer = (i: Islander): boolean => !!i.warrior || (i.task?.kind === 'flee' && i.task.stage < 2);

  /** Grown islanders well enough to come and mourn (asleep or not). */
  private ableAdults(): number {
    return this.game.colony.list.filter((i) => !i.child && !i.npc && i.condition === 'well').length;
  }

  private runFuneral(dt: number): void {
    const g = this.game, f = this.funeral!;
    f.t += dt;
    if (f.phase === 'wait') {
      // The struck-down are fetched as soon as the others have fled; elders at mid-morning.
      if (f.prompt && f.procession ? f.t < PASSING.bearersAfter : g.time.hour < PASSING.funeralHour || g.time.hour > 17) return;
      f.t = 0;
      if (f.procession) {
        // Two bearers come for the body, one at each end of the litter.
        const p = f.procession, { x, z } = p.body;
        p.bearers.call(2, this.litterEnds(x, z), this.notBearer);
        f.phase = 'fetch';
        g.ui?.toast(`Two islanders go to carry ${f.name} to the ${f.pyre ? 'pyre' : 'graveyard'}.`, 'info', { x, z });
        return;
      }
      f.phase = 'gather';
      this.callMourners();
      return;
    }
    if (f.phase === 'fetch' || f.phase === 'carry') return this.procession(dt);
    f.crowd.update();
    if (f.phase === 'gather') {
      if (f.pyre) {
        // The pyre is lit only once enough of the village stands round it (all of them, in a small village).
        const need = Math.max(1, Math.min(PASSING.pyreMourners, this.ableAdults()));
        if (f.crowd.size < need + 2 && Math.floor(f.t / 5) !== Math.floor((f.t - dt) / 5)) this.callMourners(undefined, true);
        if (f.crowd.present < need && !(f.t > PASSING.gatherSecs * 6 && f.crowd.present)) return;
      }
      if (f.pyre || (f.crowd.present >= Math.min(f.crowd.size, 4) && f.t > 10) || f.t > PASSING.gatherSecs) {
        f.phase = 'pray'; this.game.cinematics?.play('funeral', { x: f.spot.x, z: f.spot.z, radius: 3 });
        f.t = 0;
        f.crowd.anim = 'pray';
      }
      return;
    }
    if (!f.pyre) {
      if (f.t < PASSING.praySecs) return;
      f.crowd.release();
      this.funeral = null;
      g.eco.add('belief', PASSING.honour);
      g.colony.moodBoost += PASSING.grief * 0.5;
      g.ui?.toast(`The village has laid ${f.name} to rest. Their memory comforts the village (+${PASSING.honour} Belief).`, 'info');
      return;
    }
    // The pyre is lit as the prayers begin and burns while the village prays: the body blackens,
    // pales to ash and is gone, and the fire sinks and goes out.
    this.graves.burn(Math.min(1, f.t / PASSING.burnSecs));
    if (f.t < PASSING.burnSecs) return;
    this.graves.endPyre();
    f.crowd.release();
    this.funeral = null;
    g.eco.add('belief', PASSING.honour);
    g.colony.moodBoost += PASSING.grief * 0.5;
    const kept = this.keepAshes(f.name);
    g.ui?.toast(kept
      ? `The pyre has burned out. ${f.name}’s ashes rest in an urn in the graveyard. Their memory comforts the village (+${PASSING.honour} Belief).`
      : `The pyre has burned out, and ${f.name}’s ashes are given to the wind. Their memory comforts the village (+${PASSING.honour} Belief).`, 'info');
  }
}
