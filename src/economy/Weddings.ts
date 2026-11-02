import type { Building } from '../buildings/Buildings';
import { buildingOperational } from '../buildings/BuildingCondition';
import { Gathering } from '../ai/Gathering';
import type { Islander } from '../entities/Islander';
import type { Game } from '../Game';
import { haptic } from '../ui/Haptics';

export const WEDDING = {
  /** First day a couple may wish to marry; then at most one marriage (or wish) every five game days. */
  firstDay: 2,
  gapMin: 5,
  gapSpread: 1,
  /** Hours of the day a couple voices the wish, and game seconds it stays open (a day). */
  hours: [9, 16] as [number, number],
  wishSecs: 600,
  /** Belief lost, and the couple's sorrow, when a wish to marry goes ungranted. */
  refusedBelief: 10,
  refusedHappy: 0.25,
  /** Guests called, and seconds for each part: gathering, the vows, the dance. */
  guests: 10,
  gatherSecs: 30,
  vowSecs: 40,
  danceSecs: 35,
  /** The village's cheer, the Belief it brings, and the newlyweds' joy. */
  mood: 0.1,
  belief: 15,
};

export interface WeddingSave { next: number; wish?: { a: number; b: number; until: number } }

/**
 * The couple who'd marry next: an unmarried man and woman, grown and well, the happiest pair
 * (with a little chance so it isn't always the same two). Null when there's no such pair.
 */
export function pickCouple(list: Islander[], rnd: () => number): [Islander, Islander] | null {
  const free = list.filter((i) => !i.child && !i.npc && i.spouse === undefined && i.condition === 'well' && !i.warrior);
  const score = (i: Islander) => i.happy + rnd() * 0.3;
  const men = free.filter((i) => i.gender === 'm').map((i) => ({ i, s: score(i) })).sort((a, b) => b.s - a.s);
  const women = free.filter((i) => i.gender === 'f').map((i) => ({ i, s: score(i) })).sort((a, b) => b.s - a.s);
  if (!men.length || !women.length || men[0].i.happy < 0.4 || women[0].i.happy < 0.4) return null;
  return [men[0].i, women[0].i];
}

/** Read a saved plan back (anything malformed starts afresh). */
export function restoreWedding(d: unknown): WeddingSave | null {
  const o = d as Partial<WeddingSave> | null;
  if (!o || typeof o !== 'object' || !Number.isFinite(o.next)) return null;
  const w = o.wish;
  const wish = w && Number.isFinite(w.a) && Number.isFinite(w.b) && Number.isFinite(w.until) ? { a: Number(w.a), b: Number(w.b), until: Number(w.until) } : undefined;
  return { next: Number(o.next), ...(wish ? { wish } : {}) };
}

type Phase = 'gather' | 'vows' | 'dance';

/**
 * Weddings. Only married couples have children. Now and then (at most once every five days) an
 * unmarried man and woman wish to marry: the wish waits in the Requests list for a day, and the
 * player grants it (or lets it lapse, which grieves the couple and costs Belief).
 * At the temple (or, before there is one, the tribal fire) the pair kneel at the steps while the
 * village gathers behind them; after the vows everyone dances; then the newlyweds set up home
 * together (and, being married, are more likely to have a child). The village is cheered, the gods
 * pleased, and if there are fireworks the firemaker offers a display.
 */
export class WeddingSystem {
  private next: number = WEDDING.firstDay;
  /** A couple's open wish to marry: their ids, and when (game seconds) it lapses. */
  wish: { a: number; b: number; until: number } | null = null;
  private active: { a: number; b: number; phase: Phase; t: number; couple: Gathering; guests: Gathering } | null = null;

  constructor(private game: Game) {}

  /** A wedding is under way. */
  get busy(): boolean {
    return !!this.active;
  }

  save(): WeddingSave {
    return { next: this.next, ...(this.wish ? { wish: { ...this.wish } } : {}) };
  }

  restore(d: unknown): void {
    const r = restoreWedding(d);
    if (!r) return;
    this.next = r.next;
    this.wish = r.wish ?? null;
  }

  /** The couple who wish to marry, by name (for the Requests list), or null. */
  get wishText(): string | null {
    const c = this.game.colony, w = this.wish;
    const a = w && c.byId(w.a), b = w && c.byId(w.b);
    return a && b ? `${a.name} and ${b.name} wish to marry` : null;
  }

  /** Grant the open wish: the wedding begins. */
  grant(): void {
    const w = this.wish;
    if (!w || this.active) return;
    this.wish = null;
    this.game.ui?.dialog.forget((d) => d.kicker === 'A wish to marry');
    this.begin(w.a, w.b);
  }

  /** Where weddings are held: the nearest working temple to the fire, or the fire itself. */
  private venue(): Building | null {
    const g = this.game, fire = g.buildings.list.find((b) => b.key === 'campfire') ?? null;
    const temples = g.buildings.list.filter((b) => (b.key === 'temple' || b.key === 'greattemple') && buildingOperational(b));
    if (!temples.length || !fire) return temples[0] ?? fire;
    return temples.sort((a, b) => (a.x - fire.x) ** 2 + (a.z - fire.z) ** 2 - ((b.x - fire.x) ** 2 + (b.z - fire.z) ** 2))[0];
  }

  update(dt: number): void {
    const g = this.game;
    if (this.active) return this.run(dt);
    const t = g.time;
    if (this.wish) return this.waitOnWish();
    if (t.day < this.next || t.hour < WEDDING.hours[0] || t.hour > WEDDING.hours[1] || g.eco.godMode || !this.venue()) return;
    const pair = pickCouple(g.colony.list, Math.random);
    if (!pair) return;
    const [a, b] = pair;
    this.wish = { a: a.id, b: b.id, until: t.elapsed + WEDDING.wishSecs };
    const at = this.venue()!;
    g.ui?.dialog.push({
      icon: 'ask', kicker: 'A wish to marry', important: true,
      title: `${a.name} and ${b.name} wish to marry`,
      body: `They ask for a wedding at the ${at.key === 'campfire' ? 'tribal fire' : at.label}. Only married couples have children. The wish waits in your Requests for a day; if it goes ungranted, they will grieve and the gods will be displeased.`,
      benefit: `A happier village · +${WEDDING.belief} Belief · a home of their own, and children`,
      actions: [
        { label: 'Grant the wedding', primary: true, run: () => this.grant() },
        { label: 'Later' },
      ],
    });
    g.audio?.sfx('select');
  }

  /** An open wish: still wanted, or lapsing ungranted (which grieves the couple and costs Belief). */
  private waitOnWish(): void {
    const g = this.game, w = this.wish!, a = g.colony.byId(w.a), b = g.colony.byId(w.b);
    if (!a || !b || a.spouse !== undefined || b.spouse !== undefined) {
      this.wish = null;
      return;
    }
    if (g.time.elapsed < w.until) return;
    this.wish = null;
    this.next = g.time.day + WEDDING.gapMin;
    g.ui?.dialog.forget((d) => d.kicker === 'A wish to marry');
    g.eco.res.belief = Math.max(0, g.eco.res.belief - WEDDING.refusedBelief);
    a.happy = Math.max(0, a.happy - WEDDING.refusedHappy);
    b.happy = Math.max(0, b.happy - WEDDING.refusedHappy);
    g.ui?.toast(`${a.name} and ${b.name}’s wish to marry went ungranted. They are heartbroken, and the gods are displeased (−${WEDDING.refusedBelief} Belief).`, 'warn', { x: a.x, z: a.z });
  }

  private begin(aId: number, bId: number): void {
    const g = this.game, c = g.colony, a = c.byId(aId), b = c.byId(bId), at = this.venue();
    if (!a || !b || !at || this.active || a.spouse !== undefined || b.spouse !== undefined) return;
    // The pair stand side by side before the steps, facing in; the guests in an arc behind them.
    const ux = at.door.x - at.x, uz = at.door.z - at.z, ul = Math.hypot(ux, uz) || 1, fx = ux / ul, fz = uz / ul;
    const px = at.door.x + fx * 0.7, pz = at.door.z + fz * 0.7;
    const couple = new Gathering(c, 'pray', at.x, at.z);
    couple.join(a, px - fz * 0.28, pz + fx * 0.28);
    couple.join(b, px + fz * 0.28, pz - fx * 0.28);
    const guests = new Gathering(c, 'idle', px, pz);
    const slots: { x: number; z: number }[] = [];
    for (let k = 0; k < 14; k++) {
      const row = k < 8 ? 1.6 : 2.3, n = k < 8 ? 8 : 6, i = k < 8 ? k : k - 8;
      const ang = Math.atan2(fx, fz) + (i / (n - 1) - 0.5) * 2.1;
      slots.push({ x: px + Math.sin(ang) * row, z: pz + Math.cos(ang) * row });
    }
    guests.call(WEDDING.guests, slots, (i) => i.id === aId || i.id === bId || !!i.warrior);
    this.active = { a: aId, b: bId, phase: 'gather', t: 0, couple, guests };
    g.focusAt({ x: px, z: pz });
    g.ui?.toast(`The village gathers for the wedding of ${a.name} and ${b.name}.`);
  }

  private run(dt: number): void {
    const g = this.game, w = this.active!, c = g.colony;
    w.t += dt;
    w.couple.update();
    w.guests.update();
    const a = c.byId(w.a), b = c.byId(w.b);
    if (!a || !b) return this.end(false);
    if (w.phase === 'gather') {
      if (w.couple.present >= 2 || w.t > WEDDING.gatherSecs) {
        if (w.couple.size < 2) return this.end(false);
        w.phase = 'vows';
        w.t = 0;
      }
    } else if (w.phase === 'vows') {
      if (w.t > WEDDING.vowSecs) {
        // The vows are said: everyone dances.
        w.phase = 'dance';
        w.t = 0;
        w.couple.anim = 'dance';
        w.guests.anim = 'dance';
        g.audio?.flourish();
      }
    } else if (w.t > WEDDING.danceSecs) this.end(true);
  }

  private end(wed: boolean): void {
    const g = this.game, w = this.active!, c = g.colony, a = c.byId(w.a), b = c.byId(w.b);
    w.couple.release();
    w.guests.release();
    this.active = null;
    if (!wed || !a || !b) {
      g.ui?.toast('The wedding could not go ahead. Perhaps another day.');
      return;
    }
    c.marry(a, b);
    this.next = g.time.day + WEDDING.gapMin;
    a.happy = b.happy = 1;
    c.moodBoost += WEDDING.mood;
    g.eco.add('belief', WEDDING.belief);
    g.ui?.notice({ title: `${a.name} and ${b.name} are married`, line: 'The whole village danced. They will make a home together.', benefit: `+${WEDDING.belief} Belief · a happier village`, icon: 'tick', important: true, kicker: 'A wedding' });
    g.audio?.sfx('milestone');
    haptic('success');
    g.offerCelebration(`the newlyweds`);
  }
}
