import type { Game } from '../Game';
import { haptic } from '../ui/Haptics';

export const RAID = {
  /** No raids before this day, nor before a Skilled village (stage 3): there must be something worth taking. */
  firstDay: 6,
  minStage: 3,
  /** Game days between raids (or sightings). */
  every: [3, 6] as [number, number],
  /** Defence that makes raiders think again: each warrior counts 1, each working watchtower 2. */
  deter: 3,
  /** Shares of the stores taken by raiders who land unopposed (halved if any warrior is there to meet them). */
  take: { food: 0.25, wood: 0.15, stone: 0.15 },
  /** The most two canoes can carry away. */
  carry: { food: 80, wood: 50, stone: 50 },
  /** The village's fright when it is raided, and the Belief when raiders are turned away. */
  fright: 0.08,
  repelBelief: 10,
};

export interface RaidSave { next: number }

/** The village's defence against raiders: its warriors, and each working watchtower twice over. */
export function defence(warriors: number, watchtowers: number): number {
  return warriors + watchtowers * 2;
}

/** What raiders carry off from the stores (`met`: a warrior met them on the beach, so half as much). */
export function plunder(stores: { food: number; wood: number; stone: number }, met: boolean): { food: number; wood: number; stone: number } {
  const k = met ? 0.5 : 1;
  return {
    food: Math.floor(Math.min(RAID.carry.food, stores.food * RAID.take.food) * k),
    wood: Math.floor(Math.min(RAID.carry.wood, stores.wood * RAID.take.wood) * k),
    stone: Math.floor(Math.min(RAID.carry.stone, stores.stone * RAID.take.stone) * k),
  };
}

/**
 * Rival raiders. Every few days, canoes from another island come looking for an easy village.
 * A village with warriors and watchtowers enough sees them off before they land (and the gods
 * are pleased); a weak one is raided: the canoes run up the beach and the raiders carry off a
 * share of the food, wood and stone, half as much if a warrior is there to meet them.
 */
export class Raids {
  /** Game day of the next raid (or sighting). */
  next = RAID.firstDay;

  constructor(private game: Game) {}

  save(): RaidSave {
    return { next: this.next };
  }

  restore(d: unknown): void {
    const n = Number((d as RaidSave | null)?.next);
    if (Number.isFinite(n)) this.next = n;
  }

  private strength(): { warriors: number; towers: number; total: number } {
    const g = this.game;
    const warriors = g.colony.list.filter((i) => i.warrior && i.condition === 'well').length;
    const towers = g.buildings.of('watchtower').length;
    return { warriors, towers, total: defence(warriors, towers) };
  }

  update(): void {
    const g = this.game, t = g.time;
    if (g.eco.godMode || t.day < this.next || t.isNight) return;
    if (g.progression.stage < RAID.minStage) return;
    this.next = t.day + RAID.every[0] + Math.floor(Math.random() * (RAID.every[1] - RAID.every[0] + 1));
    const fire = g.buildings.list.find((b) => b.key === 'campfire');
    if (!fire) return;
    const s = this.strength();
    if (s.total >= RAID.deter) {
      g.eco.add('belief', RAID.repelBelief);
      g.ui?.toast(`Rival canoes came over the horizon, saw your ${s.towers ? 'watchtowers and ' : ''}warriors, and turned back (+${RAID.repelBelief} Belief).`, 'milestone');
      return;
    }
    const store = g.buildings.nearestStore(fire.x, fire.z, true) ?? fire;
    const land = g.boats.sendSettlers(['m', 'm'], { x: store.x, z: store.z }, () => this.land(), true);
    if (!land) return;
    g.boats.sendSettlers(['m', 'm'], { x: store.x + 2, z: store.z + 2 }, undefined, true);
    g.ui?.dialog.push({
      icon: 'warn', kicker: 'Raiders', important: true,
      title: 'Rival canoes are coming!',
      body: 'Raiders from another island are paddling for your shore. Undefended, they will carry off food, wood and stone. Warriors (Great Hall) and watchtowers keep raiders away.',
      actions: [
        { label: 'Show me', primary: true, run: () => g.focusAt(land) },
        { label: 'OK' },
      ],
    });
    g.audio?.sfx('select');
    haptic('medium');
  }

  /** The raiders reach the beach. */
  private land(): void {
    const g = this.game, s = this.strength();
    const took = plunder({ food: g.eco.food, wood: g.eco.res.wood, stone: g.eco.res.stone }, s.warriors > 0);
    g.eco.spend({ wood: took.wood, stone: took.stone, belief: 0, food: took.food });
    g.colony.moodBoost -= RAID.fright;
    const what = [took.food && `${took.food} food`, took.wood && `${took.wood} wood`, took.stone && `${took.stone} stone`].filter(Boolean).join(', ') || 'little';
    g.ui?.toast(`Raiders landed and made off with ${what}${s.warriors ? ' (your warriors drove them off before they took more)' : ''}. Train warriors or build a watchtower to keep them away.`, 'warn');
    haptic('medium');
  }
}
