export type EncounterKind = 'dolphin' | 'whale' | 'turtle';
export interface EncounterSave {
  remaining: number;
  lastKind?: EncounterKind;
  lastBoat?: string;
  boatRemaining: number;
  speciesRemaining?: number;
}
export interface WildlifeEncounter {
  kind: EncounterKind;
  subject: string;
  text: string;
  duration: number;
  boat?: string;
  valid(): boolean;
  finish(): void;
}

/** Bounded coordination of existing animal routines, using unpaused real play time. */
export class WildlifeEncounters {
  active: WildlifeEncounter | null = null;
  private age = 0;
  private remaining: number;
  private lastKind?: EncounterKind;
  private lastBoat?: string;
  private boatRemaining = 0;
  private speciesRemaining = 0;
  private notifications = true;

  constructor(private hooks: {
    start(kind: EncounterKind, avoidBoat?: string): WildlifeEncounter | null;
    notify(e: WildlifeEncounter): void;
    dismiss(): void;
  }, save?: EncounterSave, private random = () => Math.random()) {
    this.remaining = save && Number.isFinite(save.remaining) ? Math.max(60, Math.min(300, save.remaining)) : 180 + random() * 120;
    if (save && ['dolphin', 'whale', 'turtle'].includes(save.lastKind ?? '')) this.lastKind = save.lastKind;
    if (typeof save?.lastBoat === 'string' && save.lastBoat.length <= 64) this.lastBoat = save.lastBoat;
    this.boatRemaining = Number.isFinite(save?.boatRemaining) ? Math.max(0, Math.min(900, save!.boatRemaining)) : 0;
    this.speciesRemaining = Math.max(0, Math.min(600, Number(save?.speciesRemaining) || 0));
  }

  update(realDt: number, notifications: boolean): void {
    // Discard long wall-time gaps on resume rather than accumulating overdue visits.
    const dt = Number.isFinite(realDt) ? Math.max(0, Math.min(1, realDt)) : 0;
    if (!notifications && this.notifications) this.hooks.dismiss();
    this.notifications = notifications;
    this.boatRemaining = Math.max(0, this.boatRemaining - dt);
    this.speciesRemaining = Math.max(0, this.speciesRemaining - dt);
    if (this.active) {
      this.age += dt;
      if (!this.active.valid() || this.age >= this.active.duration) {
        this.active.finish();
        this.active = null;
        this.hooks.dismiss();
      }
      return;
    }
    if (dt <= 0) return;
    this.remaining -= dt;
    if (this.remaining > 0) return;
    const kinds: EncounterKind[] = ['dolphin', 'whale', 'turtle'];
    const start = Math.floor(this.random() * kinds.length);
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[(start + k) % kinds.length];
      if (kind === this.lastKind && this.speciesRemaining > 0) continue;
      const encounter = this.hooks.start(kind, this.boatRemaining > 0 ? this.lastBoat : undefined);
      if (!encounter) continue;
      this.active = encounter;
      this.age = 0;
      this.lastKind = kind;
      this.speciesRemaining = 600;
      this.remaining = 180 + this.random() * 120;
      if (encounter.boat) { this.lastBoat = encounter.boat; this.boatRemaining = 900; }
      if (notifications) this.hooks.notify(encounter);
      return;
    }
    this.remaining = 45;
  }

  save(): EncounterSave {
    // Existing animals resume their normal routines after loading; never replay an active visit.
    return {
      remaining: Math.max(this.active ? 180 : 60, this.remaining),
      lastKind: this.lastKind, lastBoat: this.lastBoat,
      boatRemaining: this.boatRemaining, speciesRemaining: this.speciesRemaining,
    };
  }
}
