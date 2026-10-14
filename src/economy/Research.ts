import { OBSERVATORY, RESEARCH, RESEARCH_UPGRADE_LABEL, type BuildingKey, type ResearchUpgrade } from '../config';
import { STAGES } from './Progression';

type Cost = { wood: number; stone: number; belief: number; food: number };

/** What the research needs from the rest of the game. */
export interface ResearchContext {
  /** The settlement stage reached (1..7). */
  stage(): number;
  /** Sandbox and GODMODE skip every research gate, as they skip the stage gates. */
  bypass(): boolean;
  canAfford(c: Cost): boolean;
  spend(c: Cost): boolean;
}

export interface ResearchSave {
  /** Tiers completed (0..10); research is sequential, so this is also the highest tier done. */
  done: number;
  /** The tier being studied (0 = none). */
  active: number;
  /** Seconds of full-speed study put into the active tier. */
  progress: number;
}

export type TierState = 'done' | 'active' | 'available' | 'locked';

/** The research tier a building needs (0 = none). */
export function tierForBuilding(key: BuildingKey): number {
  return RESEARCH.findIndex((t) => t.unlocks.includes(key)) + 1;
}

/** The research tier an upgrade needs (0 = none). */
export function tierForUpgrade(u: ResearchUpgrade): number {
  return RESEARCH.findIndex((t) => t.upgrades.includes(u)) + 1;
}

/** "Observatory research: The Count of Seasons (tier 1)". */
export function tierLabel(tier: number): string {
  return `Observatory research: ${RESEARCH[tier - 1].name} (tier ${tier})`;
}

/**
 * Observatory research: one shared progression of ten sequential tiers. The player starts one tier
 * at a time (paying its cost once); priests on duty at a staffed Observatory study it. Completed
 * tiers and the active study belong to the village, not to any building, so they survive damage,
 * demolition and rebuilding.
 */
export class Research {
  done = 0;
  active = 0;
  progress = 0;

  constructor(private ctx: ResearchContext) {}

  has(tier: number): boolean {
    return tier <= 0 || this.done >= tier || this.ctx.bypass();
  }

  /** Why a building can't be placed yet for want of research ('' if it can). */
  requirement(key: BuildingKey): string {
    const t = tierForBuilding(key);
    return this.has(t) ? '' : tierLabel(t);
  }

  /** Why an upgrade can't be started yet for want of research ('' if it can). */
  upgradeRequirement(u: ResearchUpgrade): string {
    const t = tierForUpgrade(u);
    return this.has(t) ? '' : `${RESEARCH_UPGRADE_LABEL[u]} need ${tierLabel(t)}`;
  }

  state(tier: number): TierState {
    if (this.done >= tier) return 'done';
    if (this.active === tier) return 'active';
    return this.lockReason(tier) ? 'locked' : 'available';
  }

  /** Why a tier can't be started ('' when it can; affordability is shown separately). */
  lockReason(tier: number): string {
    if (this.done >= tier) return 'Already studied';
    if (this.active === tier) return 'Being studied';
    if (tier > this.done + 1) return `Study ${RESEARCH[tier - 2].name} (tier ${tier - 1}) first`;
    const need = RESEARCH[tier - 1].stage;
    if (!this.ctx.bypass() && this.ctx.stage() < need) return `Reach ${STAGES[need - 1]} (settlement stage ${need})`;
    if (this.active) return `Finish ${RESEARCH[this.active - 1].name} first: one study at a time`;
    return '';
  }

  /** Begin studying a tier, paying its cost once. Returns an error ('' on success). */
  start(tier: number): string {
    const why = this.lockReason(tier);
    if (why) return why;
    const cost = RESEARCH[tier - 1].cost;
    if (!this.ctx.spend(cost)) return 'Not enough food, wood, stone or Belief to begin this study';
    this.active = tier;
    this.progress = 0;
    return '';
  }

  /** Study speed for this many priests on duty: none, one, or two and more (the cap). */
  static rate(onDuty: number): number {
    return onDuty <= 0 ? 0 : onDuty === 1 ? OBSERVATORY.speedOne : OBSERVATORY.speedFull;
  }

  /** 0..1 progress of the active study. */
  get fraction(): number {
    return this.active ? Math.min(1, this.progress / RESEARCH[this.active - 1].time) : 0;
  }

  /** Seconds of study left at the given staffing (Infinity while nobody is on duty). */
  remaining(onDuty: number): number {
    if (!this.active) return 0;
    const r = Research.rate(onDuty);
    return r > 0 ? (RESEARCH[this.active - 1].time - this.progress) / r : Infinity;
  }

  /** Advance the active study by game time dt; returns the tier just completed (0 if none). */
  advance(dt: number, onDuty: number): number {
    if (!this.active || dt <= 0) return 0;
    this.progress += dt * Research.rate(onDuty);
    const tier = this.active;
    if (this.progress < RESEARCH[tier - 1].time) return 0;
    this.done = tier;
    this.active = 0;
    this.progress = 0;
    return tier;
  }

  save(): ResearchSave {
    return { done: this.done, active: this.active, progress: this.progress };
  }

  restore(s: ResearchSave): void {
    this.done = Math.max(0, Math.min(RESEARCH.length, Math.floor(s.done)));
    this.active = s.active === this.done + 1 ? s.active : 0;
    this.progress = this.active ? Math.max(0, Math.min(RESEARCH[this.active - 1].time, s.progress)) : 0;
  }

  /**
   * Older saves (from before the Observatory): credit every tier whose buildings or upgrades the
   * village already has, and all the tiers below it, so an established village is never locked
   * out of what it has built. `has(key)` says whether a building of that kind was ever completed.
   */
  migrate(has: (key: BuildingKey) => boolean, upgrades: { templeTier: number; boatTier: number }): void {
    let tier = 0;
    RESEARCH.forEach((t, i) => {
      if (t.unlocks.some(has)) tier = i + 1;
    });
    if (upgrades.boatTier >= 3) tier = Math.max(tier, tierForUpgrade('tradeBoats'));
    if (upgrades.templeTier >= 2) tier = Math.max(tier, tierForUpgrade('templeUpgrade'));
    this.done = Math.max(this.done, tier);
    if (this.active && this.active <= this.done) { this.active = 0; this.progress = 0; }
  }
}
