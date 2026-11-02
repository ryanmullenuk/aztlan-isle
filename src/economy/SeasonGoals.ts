import type { Game } from '../Game';
import { haptic } from '../ui/Haptics';

export const SEASON_GOAL = {
  /** Belief for meeting a season's goal, and the lift in the village's mood. */
  belief: 25,
  mood: 0.06,
  /** No goals in the first few days, while the village finds its feet. */
  firstDay: 3,
};

export type SeasonGoalKind = 'grow' | 'stores' | 'food' | 'cheer';

/** One season's goal: what it asks, and the number to reach by the season's end. */
export interface SeasonGoal { kind: SeasonGoalKind; target: number; season: number; year: number }

/** What each season asks, given the village as the season opens. */
export function goalFor(season: number, year: number, v: { population: number; storeCap: number }): SeasonGoal {
  const pop = Math.max(2, v.population);
  switch (season) {
    // Spring: new life. A couple more islanders by summer.
    case 0: return { kind: 'grow', target: pop + 2, season, year };
    // Summer: building weather. Wood and stone laid by for the year.
    case 1: return { kind: 'stores', target: Math.min(Math.floor(v.storeCap * 0.8), 40 + pop * 4), season, year };
    // Autumn: the harvest. Food stored before winter.
    case 2: return { kind: 'food', target: pop * 6, season, year };
    // Winter: the dark months. Keep spirits up.
    default: return { kind: 'cheer', target: 60, season, year };
  }
}

/** The goal as a line of text, with how far along it is. */
export function goalText(g: SeasonGoal, now: number): string {
  const n = Math.floor(now);
  switch (g.kind) {
    case 'grow': return `Spring goal: grow to ${g.target} islanders by summer (${Math.min(n, g.target)}/${g.target})`;
    case 'stores': return `Summer goal: ${g.target} wood and ${g.target} stone stored by autumn (${Math.min(n, g.target)}/${g.target})`;
    case 'food': return `Autumn goal: ${g.target} food stored before winter (${Math.min(n, g.target)}/${g.target})`;
    case 'cheer': return `Winter goal: keep the village happy (${Math.min(n, 100)}% / ${g.target}%) until spring`;
  }
}

/**
 * Seasonal goals: as each season opens the village sets itself a goal for it (more islanders in
 * spring, stores in summer, food before winter, good cheer through winter). Met by the season's
 * end, the gods are pleased (Belief) and the village is cheered; missed, the village is told why
 * it matters (a hungry winter, a slow year). Shown with the objectives.
 */
export class SeasonGoals {
  goal: SeasonGoal | null = null;
  /** The season (year × 4 + season) last opened, so each is set up once. */
  private opened = -1;

  constructor(private game: Game) {}

  save(): { goal: SeasonGoal | null; opened: number } {
    return { goal: this.goal, opened: this.opened };
  }

  restore(d: unknown): void {
    const o = d as { goal?: SeasonGoal | null; opened?: number } | null;
    if (!o || typeof o !== 'object') return;
    if (Number.isFinite(o.opened)) this.opened = Number(o.opened);
    const g = o.goal;
    if (g && ['grow', 'stores', 'food', 'cheer'].includes(g.kind) && Number.isFinite(g.target)) this.goal = { ...g };
  }

  /** How far along the goal is now. */
  progress(g: SeasonGoal): number {
    const game = this.game, list = game.colony.list.filter((i) => !i.npc);
    switch (g.kind) {
      case 'grow': return list.length;
      case 'stores': return Math.min(game.eco.res.wood, game.eco.res.stone);
      case 'food': return game.eco.food;
      case 'cheer': return list.length ? (list.reduce((s, i) => s + i.happy, 0) / list.length) * 100 : 0;
    }
  }

  /** The goal line for the objectives list (null when there is none). */
  get text(): string | null {
    return this.goal ? goalText(this.goal, this.progress(this.goal)) : null;
  }

  get met(): boolean {
    return !!this.goal && this.progress(this.goal) >= this.goal.target;
  }

  update(): void {
    const g = this.game, t = g.time;
    if (g.eco.godMode || t.day < SEASON_GOAL.firstDay) return;
    const now = t.year * 4 + t.seasonIndex;
    if (now === this.opened) return;
    // The season has turned: judge the last goal, then set this season's.
    if (this.goal) this.judge(this.goal);
    this.opened = now;
    this.goal = goalFor(t.seasonIndex, t.year, { population: g.colony.list.filter((i) => !i.npc).length, storeCap: g.eco.woodCap });
    g.ui?.toast(`${goalText(this.goal, this.progress(this.goal)).split(' (')[0]}.`, 'info');
  }

  private judge(goal: SeasonGoal): void {
    const g = this.game;
    if (this.progress(goal) >= goal.target) {
      g.eco.add('belief', SEASON_GOAL.belief);
      g.colony.moodBoost += SEASON_GOAL.mood;
      g.ui?.notice({ title: 'Season’s goal met', line: goalText(goal, goal.target).split(' (')[0], benefit: `+${SEASON_GOAL.belief} Belief · a happier village`, icon: 'tick', kicker: 'The season ends' });
      g.audio?.sfx('milestone');
      haptic('success');
    } else {
      const why = goal.kind === 'food' ? 'Food is short going into winter: farms and fishing grow slowly in the cold.'
        : goal.kind === 'stores' ? 'The stores are thin for the year ahead.'
        : goal.kind === 'grow' ? 'The village grew slowly this spring.'
        : 'The winter was a gloomy one.';
      g.ui?.toast(`Season’s goal missed. ${why}`, 'warn');
    }
  }
}
