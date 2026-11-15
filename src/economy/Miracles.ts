import { POWERS, isDecor, isFarm, isWonder } from '../config';
import type { Building } from '../buildings/Buildings';
import type { Islander } from '../entities/Islander';
import { DEVOTION } from './Devotion';
import type { Economy } from './Economy';

/**
 * Miracles that follow fear or love. As the Fear-or-love meter (see Devotion) fills toward one end,
 * that path's miracles unlock one by one, and lock again if the feeling fades back. Love heals,
 * ripens and blesses; fear shakes, strips and burns, and the terrified village prays all the harder
 * for it (so a feared god is not a poor one). Each costs Belief and needs a while to gather
 * strength again. The logic is here and plain (so it can be tested); the game supplies the island
 * through hooks, and draws and sounds what happens (see render/MiracleFX).
 */

export type MiracleId = 'healrain' | 'harvest' | 'rainbow' | 'quake' | 'locusts' | 'volcano';
export type MiraclePath = 'love' | 'fear';

export interface MiracleDef {
  id: MiracleId;
  path: MiraclePath;
  tier: 1 | 2 | 3;
  name: string;
  icon: string;
  /** Cast on a place (tap the island with the brush), rather than at once. */
  area: boolean;
  hint: string;
}

const M = POWERS.miracles;

export const MIRACLE_IDS: MiracleId[] = ['healrain', 'harvest', 'rainbow', 'quake', 'locusts', 'volcano'];

export const MIRACLES: Record<MiracleId, MiracleDef> = {
  healrain: { id: 'healrain', path: 'love', tier: 1, name: 'Healing Rain', icon: 'm_healrain', area: true, hint: 'A soft golden shower over an area: the sick and hurt there are made well, everyone under it is cheered, and crops and plants flourish.' },
  harvest: { id: 'harvest', path: 'love', tier: 2, name: 'Bountiful Harvest', icon: 'm_harvest', area: true, hint: 'Every field in the area ripens at once, and its next harvest yields half as much again. Fruit trees there fill with fruit.' },
  rainbow: { id: 'rainbow', path: 'love', tier: 3, name: 'Rainbow Blessing', icon: 'm_rainbow', area: false, hint: 'A rainbow over the whole island: for a day everyone is happier, and happy islanders’ Belief flows twice as freely.' },
  quake: { id: 'quake', path: 'fear', tier: 1, name: 'Earthquake', icon: 'm_quake', area: true, hint: 'The ground shakes in an area: the people flee, and buildings crack (repair them from their cards). Afterwards the frightened village prays: Belief comes back.' },
  locusts: { id: 'locusts', path: 'fear', tier: 2, name: 'Locust Swarm', icon: 'm_locusts', area: true, hint: 'A black swarm settles on the fields in an area for a while, stripping their crops back to bare earth. The terrified village prays hard: more Belief comes back.' },
  volcano: { id: 'volcano', path: 'fear', tier: 3, name: 'Wake the Volcano', icon: 'm_volcano', area: false, hint: 'The sleeping volcano rumbles and erupts at your word. The village cowers by the fire, and when the lava stops, prays as never before.' },
};

/** The radius of an area miracle's brush (0 for the island-wide ones). */
export function miracleRadius(id: MiracleId): number {
  const c = M[id] as { radius?: number };
  return c.radius ?? 0;
}

export function miracleCost(id: MiracleId): number {
  return M[id].cost;
}

/** The meter's reading needed for a path's miracle of this tier (0.25, 0.5, 0.75). */
export function miracleThreshold(tier: 1 | 2 | 3): number {
  return M.tiers[tier - 1];
}

/** How far along a path the meter stands (0..1): love from the middle to Loved, fear to Feared. */
export function pathAmount(path: MiraclePath, value: number): number {
  return path === 'love' ? Math.max(0, value) : Math.max(0, -value);
}

export function miracleUnlocked(id: MiracleId, value: number): boolean {
  const d = MIRACLES[id];
  return pathAmount(d.path, value) >= miracleThreshold(d.tier) - 1e-9;
}

/** What it takes to unlock a miracle, and where the meter is now. */
export function unlockText(id: MiracleId, value: number): string {
  const d = MIRACLES[id];
  const who = d.path === 'love' ? (d.tier === 3 ? 'Adoring' : 'Devoted') : (d.tier === 3 ? 'Terrified' : 'Fearful');
  const need = Math.round(miracleThreshold(d.tier) * 100), now = Math.round(pathAmount(d.path, value) * 100);
  return `Unlocks when your people are ${who}: ${need}% toward ${d.path === 'love' ? 'Loved' : 'Feared'} (now ${now}%).`;
}

/** Game seconds as a short wait ("40s", "3 min"). */
export function waitText(s: number): string {
  return s < 60 ? `${Math.max(1, Math.ceil(s))}s` : `${Math.ceil(s / 60)} min`;
}

/** What the miracles need from the island. */
export interface MiracleHooks {
  people(): Islander[];
  buildings(): Building[];
  /** Make an islander well again. */
  heal(isl: Islander): void;
  /** Everyone within r of (x, z) runs away from it; returns how many ran. */
  scatter(x: number, z: number, r: number): number;
  /** Plants within r: saplings grow by `grow`, fruit plants fill by `fruit` of their store. */
  flourish?(x: number, z: number, r: number, grow: number, fruit: number): void;
  /** Why the volcano can't be woken now ('' if it can). */
  canWakeVolcano?(): string;
  wakeVolcano?(rumble: number): boolean;
  volcanoPhase?(): string | null;
  /** The whole village's spirits fall (a fright) or rise. */
  moodShift?(d: number): void;
  notify?(text: string, kind?: 'info' | 'warn' | 'milestone', at?: { x: number; z: number }): void;
  /** Draw and sound a miracle at (x, z) (radius r). */
  effect?(id: MiracleId, x: number, z: number, r: number): void;
  /** A miracle unlocked (or locked again) as the meter moved. */
  unlocked?(id: MiracleId, on: boolean): void;
}

/** Locusts on the fields: where they are, the fields they strip, and the time left. */
export interface Swarm { x: number; z: number; r: number; t: number; spots: number[]; scare: number }
interface Prayer { t: number; belief: number; x: number; z: number; why: 'quake' | 'locusts' | 'volcano' }

export interface MiraclesSave {
  cd?: Partial<Record<MiracleId, number>>;
  rainbow?: number;
  prayers?: Prayer[];
  swarms?: Swarm[];
  volcano?: number;
}

type Eco = Pick<Economy, 'godMode' | 'res' | 'spend' | 'add'>;
type Dev = { value: number; shift(d: number): void };

export class Miracles {
  /** Game seconds before each can be called again. */
  readonly cooldown: Record<MiracleId, number> = { healrain: 0, harvest: 0, rainbow: 0, quake: 0, locusts: 0, volcano: 0 };
  /** Game seconds left of the Rainbow Blessing. */
  rainbowT = 0;
  /** Locust swarms now on the fields. */
  readonly swarms: Swarm[] = [];
  /** Belief to come from frightened prayer, after a little while. */
  private prayers: Prayer[] = [];
  /** The volcano the god woke: 1 rumbling, 2 erupting (0 none). */
  private woken = 0;
  /** Which miracles were unlocked at the last update (null before the first). */
  private known: Set<MiracleId> | null = null;

  constructor(private eco: Eco, private devotion: Dev, public hooks: MiracleHooks, private rnd: () => number = Math.random) {}

  unlocked(id: MiracleId): boolean {
    return this.eco.godMode || miracleUnlocked(id, this.devotion.value);
  }

  /** Why a miracle can't be called now ('' if it can). */
  reason(id: MiracleId): string {
    const d = MIRACLES[id], god = this.eco.godMode;
    if (!this.unlocked(id)) return unlockText(id, this.devotion.value);
    if (!god && this.cooldown[id] > 0) return `${d.name} is gathering strength again: ready in ${waitText(this.cooldown[id])}.`;
    if (id === 'rainbow' && this.rainbowT > 0) return 'The rainbow’s blessing is still upon the island.';
    if (id === 'volcano') {
      const why = this.hooks.canWakeVolcano ? this.hooks.canWakeVolcano() : 'There is no volcano on this island.';
      if (why) return why;
      if (this.woken) return 'The volcano is already awake.';
    }
    if (!god && this.eco.res.belief < M[id].cost) return `Not enough Belief: ${d.name} needs ${M[id].cost}.`;
    return '';
  }

  /** Mood added to every islander (the rainbow's blessing). */
  get mood(): number {
    return this.rainbowT > 0 ? M.rainbow.mood : 0;
  }

  /** Belief from happy islanders is multiplied by this (the rainbow's blessing). */
  get beliefFactor(): number {
    return this.rainbowT > 0 ? M.rainbow.belief : 1;
  }

  /** Call a miracle (on (x, z) for the area ones). Returns whether it happened. */
  cast(id: MiracleId, x = 0, z = 0): boolean {
    const why = this.reason(id);
    if (why) return this.fail(why);
    switch (id) {
      case 'healrain': return this.healingRain(x, z);
      case 'harvest': return this.bountifulHarvest(x, z);
      case 'rainbow': return this.rainbow();
      case 'quake': return this.earthquake(x, z);
      case 'locusts': return this.locusts(x, z);
      case 'volcano': return this.wakeVolcano();
    }
  }

  private fail(why: string): boolean {
    this.hooks.notify?.(why, 'warn');
    return false;
  }

  /** Pay, start the cooldown and move the village's feeling along the path. */
  private pay(id: MiracleId, x: number, z: number): boolean {
    if (!this.eco.spend({ wood: 0, stone: 0, belief: M[id].cost })) return this.fail(`Not enough Belief: ${MIRACLES[id].name} needs ${M[id].cost}.`);
    this.cooldown[id] = M[id].cooldown;
    this.devotion.shift(DEVOTION[id]);
    this.hooks.effect?.(id, x, z, miracleRadius(id));
    return true;
  }

  private within<T extends { x: number; z: number }>(list: T[], x: number, z: number, r: number): T[] {
    const r2 = r * r;
    return list.filter((o) => (o.x - x) ** 2 + (o.z - z) ** 2 <= r2);
  }

  private peopleIn(x: number, z: number, r: number): Islander[] {
    return this.within(this.hooks.people().filter((p) => !p.npc && !(p.flung && p.flung.mode === 'dead')), x, z, r);
  }

  private farmsIn(x: number, z: number, r: number): Building[] {
    // Like Bless, a field counts if the brush reaches it (its middle within a couple of cells).
    return this.within(this.hooks.buildings().filter((b) => b.complete && !b.ruined && isFarm(b.key)), x, z, r + 2);
  }

  private healingRain(x: number, z: number): boolean {
    const c = M.healrain, people = this.peopleIn(x, z, c.radius), farms = this.farmsIn(x, z, c.radius);
    if (!people.length && !farms.length) return this.fail('Nobody here for the healing rain to fall on. Choose a place near your people or their fields.');
    if (!this.pay('healrain', x, z)) return false;
    let healed = 0;
    for (const p of people) {
      if (p.condition !== 'well') { this.hooks.heal(p); healed++; }
      p.happy = Math.min(1, p.happy + c.happy);
    }
    for (const f of farms) if (f.stock <= 0) f.growth = Math.min(1, f.growth + c.cropGrowth);
    this.hooks.flourish?.(x, z, c.radius, 0.35, 0.5);
    const lifted = `${people.length} ${people.length === 1 ? 'islander' : 'islanders'} lifted in spirit`;
    this.hooks.notify?.(healed
      ? `A golden rain falls: ${healed} ${healed === 1 ? 'islander is' : 'islanders are'} made well, ${lifted}, and the plants there flourish.`
      : `A golden rain falls: ${lifted}, and the crops and plants there flourish.`, 'milestone', { x, z });
    return true;
  }

  private bountifulHarvest(x: number, z: number): boolean {
    const c = M.harvest, farms = this.farmsIn(x, z, c.radius);
    if (!farms.length) return this.fail('No fields here to ripen. Choose a place over your farms.');
    if (!this.pay('harvest', x, z)) return false;
    for (const f of farms) {
      f.growth = 1;
      f.bounty = Math.max(f.bounty, c.bonus);
    }
    this.hooks.flourish?.(x, z, c.radius, 0.5, 1);
    this.hooks.notify?.(`${farms.length} ${farms.length === 1 ? 'field ripens' : 'fields ripen'} at once, and the next harvest will be half as large again. Fruit hangs heavy on the trees.`, 'milestone', { x, z });
    return true;
  }

  private rainbow(): boolean {
    if (!this.pay('rainbow', 0, 0)) return false;
    this.rainbowT = M.rainbow.seconds;
    for (const p of this.hooks.people()) if (!p.npc) p.happy = Math.min(1, p.happy + M.rainbow.happy);
    this.hooks.notify?.('A rainbow arcs over the island. For a day your people are happier, and their Belief flows twice as freely.', 'milestone');
    return true;
  }

  private earthquake(x: number, z: number): boolean {
    const c = M.quake;
    if (!this.pay('quake', x, z)) return false;
    let cracked = 0;
    for (const b of this.within(this.hooks.buildings(), x, z, c.radius)) {
      if (!b.complete || b.ruined || b.fire > 0 || b.repairing || isFarm(b.key) || isDecor(b.key) || isWonder(b.key) || b.key === 'campfire') continue;
      const near = 1 - Math.hypot(b.x - x, b.z - z) / c.radius;
      const hit = c.damage * near * (0.6 + 0.4 * this.rnd());
      if (hit < 0.04 || b.integrity <= c.floor) continue;
      // Cracked, never felled: it stands, and can be repaired from its card.
      b.integrity = Math.max(c.floor, Math.min(1, b.integrity) - hit);
      cracked++;
    }
    const ran = this.hooks.scatter(x, z, c.radius + 3);
    this.hooks.moodShift?.(-0.04);
    this.prayers.push({ t: c.prayDelay, belief: c.belief, x, z, why: 'quake' });
    this.hooks.notify?.(`The earth shakes!${cracked ? ` ${cracked} ${cracked === 1 ? 'building is' : 'buildings are'} cracked (repair from the card).` : ''}${ran ? ' The people flee in terror.' : ''}`, 'info', { x, z });
    return true;
  }

  private locusts(x: number, z: number): boolean {
    const c = M.locusts, farms = this.farmsIn(x, z, c.radius);
    if (!farms.length) return this.fail('No fields here for the locusts. Choose a place over farms.');
    if (!this.pay('locusts', x, z)) return false;
    this.swarms.push({ x, z, r: c.radius, t: c.seconds, spots: farms.flatMap((f) => [f.x, f.z]), scare: 0 });
    this.hooks.notify?.(`A black swarm of locusts descends on ${farms.length === 1 ? 'the field' : `${farms.length} fields`}! The people run in terror.`, 'info', { x, z });
    return true;
  }

  private wakeVolcano(): boolean {
    if (!this.pay('volcano', 0, 0)) return false;
    if (!this.hooks.wakeVolcano?.(M.volcano.rumble)) return false;
    this.woken = 1;
    this.hooks.notify?.('The mountain wakes at your command! The ground rumbles: lava is coming.', 'info');
    return true;
  }

  /** Game time: cooldowns, the rainbow, swarms at work, prayers and the woken volcano. */
  update(dt: number): void {
    // Unlocking (and locking again) as the meter moves: told as it happens, not on loading.
    const now = new Set(MIRACLE_IDS.filter((id) => miracleUnlocked(id, this.devotion.value)));
    if (this.known && !this.eco.godMode) {
      for (const id of now) if (!this.known.has(id)) this.hooks.unlocked?.(id, true);
      for (const id of this.known) if (!now.has(id)) this.hooks.unlocked?.(id, false);
    }
    this.known = now;
    if (!(dt > 0)) return;
    for (const id of MIRACLE_IDS) if (this.cooldown[id] > 0) this.cooldown[id] = Math.max(0, this.cooldown[id] - dt);
    this.rainbowT = Math.max(0, this.rainbowT - dt);
    this.updateSwarms(dt);
    for (const p of this.prayers) {
      p.t -= dt;
      if (p.t > 0) continue;
      const got = Math.round(this.eco.add('belief', p.belief));
      const what = p.why === 'quake' ? 'After the earthquake, the frightened village prays to appease you'
        : p.why === 'locusts' ? 'The village prays frantically that the locusts never return'
        : 'The lava cools, and the village prays to you as never before';
      this.hooks.notify?.(`${what}: +${got} Belief.`, 'milestone', p.why === 'volcano' ? undefined : { x: p.x, z: p.z });
    }
    if (this.prayers.some((p) => p.t <= 0)) this.prayers = this.prayers.filter((p) => p.t > 0);
    if (this.woken) {
      const phase = this.hooks.volcanoPhase?.() ?? null;
      if (this.woken === 1 && phase === 'erupting') this.woken = 2;
      else if (this.woken === 2 && phase !== 'erupting') {
        this.woken = 0;
        this.prayers.push({ t: 0.001, belief: M.volcano.belief, x: 0, z: 0, why: 'volcano' });
      } else if (this.woken === 1 && phase !== 'smoking') this.woken = 0; // Calmed before the lava came: no terror, no prayer.
    }
  }

  private updateSwarms(dt: number): void {
    if (!this.swarms.length) return;
    const c = M.locusts;
    for (const s of this.swarms) {
      const farms = this.farmsIn(s.x, s.z, s.r);
      s.t -= dt;
      // The crop is eaten down over the swarm's stay (a little faster, so it ends bare).
      for (const f of farms) f.growth = Math.max(0, f.growth - (dt / c.seconds) * 1.2);
      s.scare -= dt;
      if (s.scare <= 0) {
        s.scare = 5;
        this.hooks.scatter(s.x, s.z, s.r);
      }
      if (s.t > 0) continue;
      for (const f of farms) {
        f.growth = 0;
        f.stock = Math.floor(f.stock * (1 - c.stock));
        f.blessTimer = 0;
        f.bounty = 0;
      }
      this.hooks.moodShift?.(-0.04);
      this.hooks.notify?.(`The locusts lift away, leaving ${farms.length === 1 ? 'a field' : `${farms.length} fields`} stripped bare.`, 'info', { x: s.x, z: s.z });
      this.prayers.push({ t: c.prayDelay, belief: c.belief, x: s.x, z: s.z, why: 'locusts' });
    }
    for (let i = this.swarms.length - 1; i >= 0; i--) if (this.swarms[i].t <= 0) this.swarms.splice(i, 1);
  }

  save(): MiraclesSave {
    const cd: Partial<Record<MiracleId, number>> = {};
    for (const id of MIRACLE_IDS) if (this.cooldown[id] > 0) cd[id] = Math.round(this.cooldown[id] * 10) / 10;
    return {
      ...(Object.keys(cd).length ? { cd } : {}),
      ...(this.rainbowT > 0 ? { rainbow: Math.round(this.rainbowT) } : {}),
      ...(this.prayers.length ? { prayers: this.prayers.map((p) => ({ ...p })) } : {}),
      ...(this.swarms.length ? { swarms: this.swarms.map((s) => ({ ...s, spots: [...s.spots] })) } : {}),
      ...(this.woken ? { volcano: this.woken } : {}),
    };
  }

  restore(d: unknown): void {
    const s = (d && typeof d === 'object' ? d : {}) as MiraclesSave;
    const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0);
    for (const id of MIRACLE_IDS) this.cooldown[id] = num(s.cd?.[id], M[id].cooldown);
    this.rainbowT = num(s.rainbow, M.rainbow.seconds);
    this.prayers = Array.isArray(s.prayers) ? s.prayers.filter((p) => p && ['quake', 'locusts', 'volcano'].includes(p.why) && Number.isFinite(p.t) && Number.isFinite(p.x) && Number.isFinite(p.z))
      .map((p) => ({ t: Math.min(60, Math.max(0.001, p.t)), belief: num(p.belief, 500), x: p.x, z: p.z, why: p.why })) : [];
    this.swarms.length = 0;
    if (Array.isArray(s.swarms)) for (const w of s.swarms) {
      if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.z) || !Array.isArray(w.spots)) continue;
      this.swarms.push({ x: w.x, z: w.z, r: num(w.r, 40) || M.locusts.radius, t: num(w.t, M.locusts.seconds) || 0.001, spots: w.spots.filter(Number.isFinite), scare: 0 });
    }
    this.woken = s.volcano === 1 || s.volcano === 2 ? s.volcano : 0;
  }
}
