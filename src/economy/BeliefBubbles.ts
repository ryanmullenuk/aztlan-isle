import { BELIEF_BUBBLE, COMFORTS, ISLANDER, TEMPLE } from '../config';
import type { Building } from '../buildings/Buildings';
import type { Economy } from './Economy';

/** Buildings whose people's belief gathers in a bubble over them. */
const KINDS = new Set(['hut', 'home', 'temple', 'greattemple', 'observatory', 'campfire', 'bonfire']);

export const hasBubble = (b: Building): boolean => KINDS.has(b.key);

/** A home's earning and holding multiplier: a hut, then each tier of Family House. */
export function homeMult(b: Building): number {
  const m = BELIEF_BUBBLE.homeTierMult;
  return b.key === 'home' ? m[Math.min(m.length - 1, b.tier)] : m[0];
}

/** How much belief a building's bubble holds when full. */
export function bubbleCap(b: Building): number {
  const B = BELIEF_BUBBLE;
  switch (b.key) {
    case 'hut': case 'home': return Math.round(Math.max(2, b.housing) * B.homeCapPerBed * homeMult(b));
    case 'temple': return B.templeCapPerTier * b.tier;
    case 'greattemple': return B.greatTempleCap;
    case 'campfire': return B.campfireCap;
    case 'bonfire': return B.bonfireCap;
    case 'observatory': return B.observatoryCap;
    default: return 0;
  }
}

/**
 * Belief that would gather over a building in a second, about now (for time away): a home's
 * contented residents, a temple's priest at prayer, the Observatory's stargazers, the fires.
 */
export function bubbleRate(b: Building, happyAt: (id: number) => number): number {
  if (!b.complete || b.ruined) return 0;
  switch (b.key) {
    case 'hut': case 'home': return b.residents.reduce((n, id) => n + (happyAt(id) > ISLANDER.happyThreshold ? 1 : 0), 0) * ISLANDER.beliefPerHappyPerSecond * homeMult(b);
    case 'temple': return TEMPLE.prayBelief * b.tier * Math.max(1, b.workers.size) * 0.5;
    case 'greattemple': return 1 / TEMPLE.greatPrayerSeconds;
    case 'bonfire': return COMFORTS.bonfireBelief * 0.5;
    case 'observatory': return b.workers.size ? BELIEF_BUBBLE.observatoryPerSecond : 0;
    default: return 0;
  }
}

/**
 * The bubbles' bookkeeping: belief gathers in a building's bubble up to its cap; tapping takes it
 * into the Belief store (what fits; the rest waits); with the Great Temple they empty themselves.
 */
export class BeliefBubbles {
  /** The Great Temple stands: bubbles collect themselves. */
  auto = false;

  constructor(private eco: Economy) {}

  /** Belief earned at a building: into its bubble (up to full), or straight into the store. */
  gather(b: Building | null | undefined, amount: number): void {
    if (!(amount > 0)) return;
    if (!b || !hasBubble(b) || !b.complete || b.ruined || this.eco.godMode) {
      this.eco.add('belief', amount);
      return;
    }
    b.belief = Math.min(bubbleCap(b), b.belief + amount);
  }

  /** How full a building's bubble is (0..1). */
  fill(b: Building): number {
    const cap = bubbleCap(b);
    return cap > 0 ? Math.min(1, b.belief / cap) : 0;
  }

  /** Take a bubble's belief into the store (as much as there's room for). Returns what was taken. */
  collect(b: Building): number {
    const room = Math.max(0, this.eco.beliefCap - this.eco.res.belief);
    const take = Math.min(b.belief, room);
    if (take <= 0) return 0;
    b.belief -= take;
    this.eco.add('belief', take);
    return take;
  }

  /**
   * Away a while: each bubble kept filling at about its usual pace (the islanders rest at night
   * and nobody is directing them), up to full. Returns how much gathered in all.
   */
  away(list: Building[], seconds: number, pace: number, happyAt: (id: number) => number): number {
    let total = 0;
    for (const b of list) {
      if (!hasBubble(b)) continue;
      const before = b.belief;
      b.belief = Math.min(bubbleCap(b), b.belief + bubbleRate(b, happyAt) * seconds * pace);
      total += b.belief - before;
    }
    return total;
  }
}
