import { OBSERVATORY } from '../config';

/** A storm the weather has already scheduled: its id, game seconds until it arrives, and how long it will last. */
export interface StormOutlook { id: number; inSeconds: number; length: number }
/** The volcano's next stirring: its cycle, and seconds (its own clock) until it starts to smoke. */
export interface VolcanoOutlook { cycle: number; inSeconds: number }

export interface ForecastInput {
  /** A complete, operational Observatory with a priest on its staff. */
  staffed: boolean;
  storm: StormOutlook | null;
  /** A storm is raging now (the emergency alert has taken over). */
  stormActive: boolean;
  volcano: VolcanoOutlook | null;
  /** The volcano is smoking or erupting now. */
  volcanoActive: boolean;
  /** Game speed: storms run on game time, so their real-time estimate shortens at 2× and 3×. */
  speed: number;
  /** Observatory research completed (tier 3 warns of the volcano earlier, tier 10 tells a storm's length). */
  tier: number;
}

export type Hazard = 'storm' | 'volcano';

/** What the alerts should do: post a new forecast, change an existing one's text, or take it down. */
export type ForecastAction =
  | { kind: 'announce' | 'update'; hazard: Hazard; text: string }
  | { kind: 'withdraw'; hazard: Hazard; reason: 'arrived' | 'cancelled' };

export interface ForecastSave {
  /** Ids of the storm and volcano cycle last announced (-1 = none), so a reload doesn't repeat them. */
  storm: number;
  volcano: number;
}

const minutes = (realSeconds: number) => {
  const m = Math.max(1, Math.round(realSeconds / 60));
  return `about ${m} minute${m === 1 ? '' : 's'}`;
};

/**
 * Advance warnings of storms and eruptions, read from the hazards the weather and the volcano have
 * already scheduled (it never creates one). One forecast per hazard however many Observatories
 * stand; only a staffed Observatory announces new ones. A forecast already given stays until its
 * hazard arrives or is cancelled; its time is re-stated when the estimate moves materially.
 */
export class Forecaster {
  /** Last announced storm id and volcano cycle (-1 = none). */
  storm = -1;
  volcano = -1;
  /** The real-time estimate last shown for each (to re-state only on a material change). */
  private shown: Record<Hazard, number> = { storm: NaN, volcano: NaN };
  /** Whether an alert is up for each (a loaded save remembers the ids but shows no stale alert). */
  private up: Record<Hazard, boolean> = { storm: false, volcano: false };

  /** The warning window for the volcano at this research tier (seconds before smoking). */
  static volcanoWindow(tier: number): number {
    return tier >= 3 ? OBSERVATORY.volcanoWindowEarly : OBSERVATORY.volcanoWindow;
  }

  stormText(s: StormOutlook, speed: number, tier: number): string {
    const long = tier >= 10 ? ` It should last ${minutes(s.length / Math.max(1, speed))}.` : '';
    return `Observatory: a storm is gathering, expect it in ${minutes(s.inSeconds / Math.max(1, speed))}.${long} Keep wells reachable and gather 50 Belief to calm it.`;
  }

  volcanoText(v: VolcanoOutlook): string {
    return `Observatory: the fire mountain stirs. Smoke is expected in ${minutes(v.inSeconds)}, then lava five minutes later. Clear the slopes and keep 50 Belief ready to calm it.`;
  }

  update(f: ForecastInput): ForecastAction[] {
    const out: ForecastAction[] = [];
    // Storms.
    const s = f.storm;
    if (this.up.storm && (!s || s.id !== this.storm)) {
      out.push({ kind: 'withdraw', hazard: 'storm', reason: f.stormActive ? 'arrived' : 'cancelled' });
      this.up.storm = false;
    }
    if (s && f.staffed && s.inSeconds <= OBSERVATORY.stormWindow && s.id !== this.storm) {
      this.storm = s.id;
      this.up.storm = true;
      this.shown.storm = s.inSeconds / Math.max(1, f.speed);
      out.push({ kind: 'announce', hazard: 'storm', text: this.stormText(s, f.speed, f.tier) });
    } else if (s && this.up.storm && s.id === this.storm) {
      const real = s.inSeconds / Math.max(1, f.speed);
      // Re-state when the estimate jumps (a change of game speed), not as it simply counts down.
      const expected = this.shown.storm;
      if (Math.abs(real - expected) > OBSERVATORY.retime) {
        this.shown.storm = real;
        out.push({ kind: 'update', hazard: 'storm', text: this.stormText(s, f.speed, f.tier) });
      }
    }
    // The volcano.
    const v = f.volcano;
    if (this.up.volcano && (!v || v.cycle !== this.volcano)) {
      out.push({ kind: 'withdraw', hazard: 'volcano', reason: f.volcanoActive ? 'arrived' : 'cancelled' });
      this.up.volcano = false;
    }
    if (v && f.staffed && v.inSeconds <= Forecaster.volcanoWindow(f.tier) && v.cycle !== this.volcano) {
      this.volcano = v.cycle;
      this.up.volcano = true;
      this.shown.volcano = v.inSeconds;
      out.push({ kind: 'announce', hazard: 'volcano', text: this.volcanoText(v) });
    }
    return out;
  }

  /** Each frame's countdown: shown estimates fall with the hazard so only real jumps re-state them. */
  tick(realDt: number): void {
    for (const h of ['storm', 'volcano'] as const) if (this.up[h]) this.shown[h] -= realDt;
  }

  save(): ForecastSave {
    return { storm: this.storm, volcano: this.volcano };
  }

  restore(s: ForecastSave): void {
    this.storm = Number.isInteger(s.storm) ? s.storm : -1;
    this.volcano = Number.isInteger(s.volcano) ? s.volcano : -1;
  }
}
