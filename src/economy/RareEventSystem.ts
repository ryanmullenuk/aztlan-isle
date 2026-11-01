import type { Game } from '../Game';
import { Gathering } from '../ai/Gathering';
import { findStrandSite, Stranding } from '../entities/Stranding';
import { Comet } from '../render/Comet';
import { haptic } from '../ui/Haptics';
import { eclipseCover, eclipseDark, planRare, RARE, rareDue, restoreRare, type RareKind, type RareSave } from './RareEvents';

/** Rewards and lifts to the village's spirits. */
const REWARD = {
  ritualBelief: 25,
  ritualMood: 0.14,
  shakenMood: -0.12,
  cometBelief: 15,
  cometMood: 0.08,
  whalePearls: 3,
  whaleBelief: 20,
  whaleMood: 0.12,
};
/** Islanders called to a ritual, and to push a whale. */
const RITUAL_CALL = 8;
const WHALE_CALL = 6;
/** Game seconds a stranded whale waits before the tide lifts it off by itself. */
const TIDE_SECONDS = 420;

type Active =
  | { kind: 'eclipse'; t: number; ritual: Gathering | null }
  | { kind: 'comet'; until: number }
  | { kind: 'whale'; t: number; whale: Stranding; helpers: Gathering | null; recall: number };

/**
 * Rare events, a handful of game days apart: an eclipse of the sun (the village is frightened
 * until the priests hold a ritual at the temple), a comet in the night sky for two nights (an
 * omen that cheers everyone), and a young whale stranded on the beach (push it back into the
 * sea before the tide does, and the sea gives pearls). The Observatory foretells the sky ones.
 */
export class RareEventSystem {
  private plan: RareSave | null = null;
  /** The Observatory has foretold the planned event. */
  private told = false;
  private active: Active | null = null;
  readonly comet = new Comet();
  /** 0..1 how much of the sun is covered right now. */
  cover = 0;

  constructor(private game: Game) {
    game.scene.add(this.comet.mesh);
  }

  /** The village is frightened: the sun has gone dark and nobody has held a ritual. */
  get afraid(): boolean {
    const a = this.active;
    return a?.kind === 'eclipse' && !a.ritual && this.cover > 0.7;
  }

  /** What's happening now, for the UI. */
  get now(): RareKind | null {
    return this.active?.kind ?? null;
  }

  save(): RareSave | null {
    return this.plan ? { ...this.plan, ...(this.told ? { told: true } : {}) } : null;
  }

  restore(d: unknown): void {
    this.plan = restoreRare(d);
    this.told = !!this.plan?.told;
  }

  /** Called each frame after the islanders have moved. */
  update(realDt: number, dt: number): void {
    const g = this.game, day = g.time.day, hour = g.time.hour;
    this.comet.update(realDt, g.time.elapsed, g.rig.camera, g.rig.target, g.lighting.state, g.lighting.overcast);
    if (!this.plan) this.plan = planRare(day, Math.random);
    if (this.active) this.run(dt);
    else if (dt > 0) {
      // The Observatory sees the sky events coming the day before.
      if (!this.told && this.plan.kind !== 'whale' && this.plan.next - day === 1 && hour >= 9 && g.observatoryStaffed) {
        this.told = true;
        g.ui?.toast(this.plan.kind === 'eclipse'
          ? 'Observatory: the priests warn that tomorrow, near midday, the sun will be swallowed for a while. A ritual at the temple will calm the village.'
          : 'Observatory: the priests have seen a new star with a tail. Tomorrow night it will blaze across the sky.', 'info');
      }
      if (rareDue(this.plan, day, hour)) this.begin(this.plan.kind);
    }
  }

  private next(kind: RareKind): void {
    this.plan = planRare(this.game.time.day, Math.random, kind);
    this.told = false;
  }

  private begin(kind: RareKind): void {
    const g = this.game;
    // Missed by a day or more (the island wasn't being played): no use starting it late at night.
    const late = g.time.day > this.plan!.next + 1;
    this.next(kind);
    if (late) return;
    if (kind === 'eclipse') this.beginEclipse();
    else if (kind === 'comet') this.beginComet();
    else this.beginWhale();
  }

  // ---------------- Eclipse ----------------

  private beginEclipse(): void {
    const g = this.game;
    if (g.time.isNight) return;
    this.active = { kind: 'eclipse', t: 0, ritual: null };
    const temple = this.temple();
    g.ui?.dialog.push({
      icon: 'warn', kicker: 'An omen in the sky', title: 'The sun is going dark', important: true,
      body: temple
        ? 'Something is eating the sun, and the islanders are terrified. Call them to the temple for a ritual of drums and prayer to calm them.'
        : 'Something is eating the sun, and the islanders are terrified. With a temple, the priests could hold a ritual to calm them.',
      actions: temple ? [{ label: 'Let it pass' }, { label: 'Hold a ritual', primary: true, run: () => this.ritual() }] : [{ label: 'OK', primary: true }],
    });
    g.audio?.sfx('thunder');
  }

  private ritual(): void {
    const a = this.active, temple = this.temple();
    if (a?.kind !== 'eclipse' || a.ritual || !temple) return;
    const g = this.game;
    const r = new Gathering(g.colony, 'pray', temple.x, temple.z);
    const slots: { x: number; z: number }[] = [];
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2, rad = 2.2 + (k % 2) * 1.3;
      const x = temple.door.x + Math.cos(ang) * rad, z = temple.door.z + Math.sin(ang) * rad;
      const i = g.world.cellIndexAt(x, z);
      if (i >= 0 && g.world.isLandCell(i) && !g.world.occ[i] && !g.world.blocked(i)) slots.push({ x, z });
    }
    r.call(RITUAL_CALL, slots);
    a.ritual = r;
    g.focusAt({ x: temple.x, z: temple.z });
    g.audio?.sfx('bell');
  }

  private temple() {
    const b = this.game.buildings;
    return b.of('greattemple')[0] ?? b.of('temple')[0];
  }

  // ---------------- Comet ----------------

  private beginComet(): void {
    const g = this.game;
    // Two nights: until the morning after the second.
    this.active = { kind: 'comet', until: g.time.day + RARE.cometNights - (g.time.hour < 12 ? 1 : 0) };
    this.comet.on = true;
    g.colony.moodBoost += REWARD.cometMood;
    if (this.temple()) g.eco.add('belief', REWARD.cometBelief);
    g.ui?.dialog.push({
      icon: 'star', kicker: 'An omen in the sky', title: 'A comet!', news: true,
      body: `A star with a burning tail has appeared in the night sky. The islanders gather to watch it, sure that it means good fortune.${this.temple() ? ` (+${REWARD.cometBelief} Belief)` : ''}`,
      actions: [{ label: 'OK', primary: true }],
    });
  }

  // ---------------- Stranded whale ----------------

  private beginWhale(): void {
    const g = this.game;
    const fire = g.buildings.list.find((b) => b.key === 'campfire');
    const site = fire ? findStrandSite(g.world, fire.x, fire.z) : null;
    if (!site) return;
    const whale = new Stranding(g.world, g.water, site);
    g.scene.add(whale.group);
    this.active = { kind: 'whale', t: 0, whale, helpers: null, recall: 0 };
    g.audio?.sfx('whale', site.x, site.z);
    g.ui?.dialog.push({
      icon: 'ask', kicker: 'On the beach', title: 'A whale has stranded', important: true,
      body: 'A young whale has washed up on the beach near the village. Send islanders to push it back into the sea before it tires?',
      actions: [
        { label: 'Show me', run: () => g.focusAt({ x: site.x, z: site.z }) },
        { label: 'Send helpers', primary: true, run: () => this.sendHelpers() },
      ],
    });
  }

  /** Call islanders to the whale (and keep calling, as some drop out to eat or rest). */
  sendHelpers(): void {
    const a = this.active;
    if (a?.kind !== 'whale' || a.whale.phase !== 'stranded') return;
    const g = this.game;
    a.helpers ??= new Gathering(g.colony, 'build', a.whale.x, a.whale.z);
    const sent = a.helpers.call(WHALE_CALL - a.helpers.size, a.whale.slots, (i) => !!i.warrior || i.task?.kind === 'fish');
    if (!a.helpers.size && !sent) g.ui?.toast('Nobody is free to help the whale right now.', 'warn');
    g.focusAt({ x: a.whale.x, z: a.whale.z });
  }

  /** Where the stranded whale lies, while it is there. */
  get whaleAt(): { x: number; z: number } | null {
    const a = this.active;
    return a?.kind === 'whale' && a.whale.phase === 'stranded' ? { x: a.whale.x, z: a.whale.z } : null;
  }

  // ---------------- Running ----------------

  private run(dt: number): void {
    const g = this.game, a = this.active!;
    if (a.kind === 'eclipse') {
      a.t += dt;
      a.ritual?.update();
      this.cover = eclipseCover(a.t);
      g.lighting.eclipse = eclipseDark(this.cover);
      if (a.t >= RARE.eclipseLength) {
        this.cover = 0;
        g.lighting.eclipse = 0;
        if (a.ritual) {
          a.ritual.release();
          g.colony.moodBoost += REWARD.ritualMood;
          g.eco.add('belief', REWARD.ritualBelief);
          g.ui?.toast(`The sun has returned! The priests’ ritual kept the village calm, and spirits are high. (+${REWARD.ritualBelief} Belief)`, 'milestone');
          g.audio?.sfx('milestone');
          haptic('success');
        } else {
          g.colony.moodBoost += REWARD.shakenMood;
          g.ui?.toast('The sun has come back, but the village is badly shaken. A ritual at the temple would have calmed them.');
        }
        this.active = null;
      }
    } else if (a.kind === 'comet') {
      if (g.time.day >= a.until && g.time.hour >= 5 && g.time.hour < 12) {
        this.comet.on = false;
        this.active = null;
      }
    } else {
      a.t += dt;
      a.helpers?.update();
      if (a.helpers && a.whale.phase === 'stranded') {
        a.recall -= dt;
        if (a.recall <= 0) {
          a.recall = 8;
          if (a.helpers.size < WHALE_CALL) a.helpers.call(WHALE_CALL - a.helpers.size, a.whale.slots, (i) => !!i.warrior || i.task?.kind === 'fish');
        }
      }
      const freed = a.whale.update(dt, a.helpers?.present ?? 0);
      if (freed) {
        a.helpers?.release();
        g.colony.moodBoost += REWARD.whaleMood;
        g.eco.goods.pearls += REWARD.whalePearls;
        g.eco.add('belief', REWARD.whaleBelief);
        g.ui?.toast(`The whale is free! It swims out to sea, and the islanders cheer. The sea is grateful: +${REWARD.whalePearls} pearls, +${REWARD.whaleBelief} Belief.`, 'milestone');
        g.audio?.sfx('milestone');
        haptic('success');
      } else if (a.whale.phase === 'stranded' && (a.t > TIDE_SECONDS || g.time.hour >= 19.5)) {
        a.helpers?.release();
        a.whale.refloat();
        g.ui?.toast('The rising tide has lifted the whale off the beach, and it has swum away.');
      }
      if (a.whale.phase === 'done') {
        a.whale.dispose();
        this.active = null;
      }
    }
  }

  /** A new island, or one loaded: nothing under way. */
  reset(): void {
    const a = this.active;
    if (a?.kind === 'whale') { a.helpers?.release(); a.whale.dispose(); }
    if (a?.kind === 'eclipse') a.ritual?.release();
    this.active = null;
    this.cover = 0;
    this.comet.on = false;
    this.game.lighting.eclipse = 0;
  }

  /** Test hook: start one now. */
  trigger(kind: RareKind): void {
    this.reset();
    if (kind === 'eclipse') this.beginEclipse();
    else if (kind === 'comet') this.beginComet();
    else this.beginWhale();
  }
}
