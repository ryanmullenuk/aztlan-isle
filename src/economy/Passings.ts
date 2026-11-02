import { buildingOperational } from '../buildings/BuildingCondition';
import { Gathering } from '../ai/Gathering';
import { TIME } from '../config';
import { isElder } from '../entities/CharacterVariants';
import type { Islander } from '../entities/Islander';
import type { Game } from '../Game';
import { Graves } from '../render/Graves';
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
};

/**
 * Elders pass away. Each elder has some years left; when they run out, the elder dies peacefully in
 * their sleep and is found at first light. The village gathers at a resting place near the temple
 * (or the tribal fire) and prays; a grave with a carved stone and marigolds is left there. The
 * village grieves a little, then is comforted (Belief). A village too small to spare an elder keeps
 * them a while longer.
 */
export class Passings {
  readonly graves = new Graves();
  private funeral: { name: string; t: number; phase: 'wait' | 'gather' | 'pray'; crowd: Gathering; spot: { x: number; z: number }; spouse?: number } | null = null;

  constructor(private game: Game) {}

  save(): { graves: Graves['list'] } {
    return { graves: this.graves.list };
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
    if (!spot) return;
    const y = g.world.groundY(spot.x, spot.z);
    this.graves.add({ name: isl.name, x: spot.x, z: spot.z, y, yaw: Math.atan2(spot.venue.x - spot.x, spot.venue.z - spot.z), day: g.time.day });
    // Nothing is built on a grave.
    g.world.blockCircle(spot.x, spot.z, 0.2);
    this.funeral = { name: isl.name, t: 0, phase: 'wait', crowd: new Gathering(c, 'idle', spot.x, spot.z), spot, spouse: spouse?.id };
  }

  /** Mid-morning: the village comes to stand round the grave. */
  private callMourners(): void {
    const f = this.funeral!, c = this.game.colony, { x, z } = f.spot;
    const slots: { x: number; z: number }[] = [];
    for (let k = 0; k < 14; k++) {
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
      f.phase = 'gather';
      f.t = 0;
      this.callMourners();
      return;
    }
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
