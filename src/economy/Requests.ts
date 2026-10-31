import type { BuildingKey } from '../config';
import type { Building } from '../buildings/Buildings';
import type { Islander } from '../entities/Islander';

/** A wish an islander has voiced: build `key` (near `near`, if given) before `until` (game seconds). */
export interface IslanderRequest {
  id: number;
  who: number;
  key: BuildingKey;
  text: string;
  /** Said when it is granted. */
  thanks: string;
  near?: { x: number; z: number; r: number };
  /** Buildings of this kind already standing when asked (a new one is what grants it). */
  before: number[];
  until: number;
  belief: number;
}

/** What the request board needs from the game. */
export interface RequestWorld {
  people: () => Islander[];
  buildings: () => Building[];
  byId: (id: number) => Building | undefined;
  /** '' when the player may build it now; otherwise why not. */
  canBuild: (key: BuildingKey) => string;
  freeBeds: () => number;
  sandbox: () => boolean;
}

/** Seconds of game time between new requests, how long one stays open, and how many at once. */
export const REQUESTS = { gap: [150, 300] as [number, number], lasts: 900, max: 2, belief: 15, happy: 0.25 };

interface Template {
  key: BuildingKey;
  /** Who asks, and whether this wish suits the island now. */
  fits: (isl: Islander, w: RequestWorld) => boolean;
  text: (name: string) => string;
  thanks: (name: string) => string;
  /** Wanted near their home, within this many cells. */
  nearHome?: number;
}

const near = (b: Building, x: number, z: number, r: number) => Math.hypot(b.x - x, b.z - z) <= r;
const has = (w: RequestWorld, key: BuildingKey) => w.buildings().some((b) => b.key === key);
const home = (isl: Islander, w: RequestWorld) => (isl.home >= 0 ? w.byId(isl.home) : undefined);

const TEMPLATES: Template[] = [
  {
    key: 'well', nearHome: 14,
    fits: (isl, w) => { const h = home(isl, w); return !!h && !w.buildings().some((b) => b.key === 'well' && near(b, h.x, h.z, 14)); },
    text: (n) => `${n} would love a Well near their home: the walk for water is long.`,
    thanks: (n) => `${n} draws fresh water from the new Well.`,
  },
  {
    key: 'torch', nearHome: 8,
    fits: (isl, w) => { const h = home(isl, w); return !!h && !isl.child && !w.buildings().some((b) => b.key === 'torch' && near(b, h.x, h.z, 8)); },
    text: (n) => `${n} is uneasy after dark: a Torch by their home, please.`,
    thanks: (n) => `${n} sleeps soundly by the light of the new Torch.`,
  },
  {
    key: 'hut',
    fits: (isl, w) => isl.home < 0 && !isl.child && w.freeBeds() === 0,
    text: (n) => `${n} has nowhere to sleep: build a Hut.`,
    thanks: (n) => `${n} has a roof over their head at last.`,
  },
  {
    key: 'smokehouse',
    fits: (isl, w) => isl.role === 'fisher' && !has(w, 'smokehouse'),
    text: (n) => `${n} asks for a Smokehouse, so the catch keeps through the storms.`,
    thanks: (n) => `${n} hangs the first fish in the new Smokehouse.`,
  },
  {
    key: 'fishhut',
    fits: (isl, w) => isl.role === 'fisher' && !has(w, 'fishhut'),
    text: (n) => `${n} dreams of a Fisherman’s Hut out over the water.`,
    thanks: (n) => `${n} watches the sea from the new Fisherman’s Hut.`,
  },
  {
    key: 'grainstore',
    fits: (isl, w) => isl.role === 'farmer' && !has(w, 'grainstore'),
    text: (n) => `${n} needs a Food Store for the harvest.`,
    thanks: (n) => `${n} fills the new Food Store with baskets of grain.`,
  },
  {
    key: 'bonfire',
    fits: (isl, w) => !isl.child && isl.happy < 0.7 && !has(w, 'bonfire'),
    text: (n) => `${n} misses songs in the evening: build a Bonfire.`,
    thanks: (n) => `${n} leads the first song round the new Bonfire.`,
  },
  {
    key: 'bannersun',
    fits: (_isl, w) => has(w, 'market') && !w.buildings().some((b) => b.key.startsWith('banner') || b.key === 'pennants' || b.key === 'flagstring' || b.key === 'featherbanner'),
    text: (n) => `${n} thinks the village needs colour: put up a Sun Banner.`,
    thanks: (n) => `${n} admires the new Sun Banner.`,
  },
  {
    key: 'firepit',
    fits: (isl, w) => isl.role === 'butcher' && !has(w, 'firepit'),
    text: (n) => `${n} would roast the meat on a Cooking Firepit.`,
    thanks: (n) => `${n} has the Firepit roaring.`,
  },
];

/**
 * Islanders' requests: now and then someone asks for something the village lacks (a Well by their
 * house, a Torch for the dark, a Smokehouse for the fishers). Build it before long and they are
 * delighted: a little Belief and a happier islander. A wish left unbuilt simply lapses.
 */
export class RequestBoard {
  list: IslanderRequest[] = [];
  private nextId = 1;
  private timer: number;
  private check = 0;
  onGranted: (r: IslanderRequest, who: Islander | undefined) => void = () => {};
  onAsked: (r: IslanderRequest, who: Islander) => void = () => {};
  onLapsed: (r: IslanderRequest) => void = () => {};

  constructor(private w: RequestWorld, private rnd: () => number, private clock: () => number) {
    this.timer = REQUESTS.gap[0];
  }

  update(dt: number): void {
    if (dt <= 0 || this.w.sandbox()) return;
    this.check -= dt;
    if (this.check > 0) return;
    this.check = 2;
    const now = this.clock();
    for (const r of [...this.list]) {
      const done = this.w.buildings().find((b) => b.key === r.key && b.complete && !r.before.includes(b.id) && (!r.near || near(b, r.near.x, r.near.z, r.near.r)));
      if (done) {
        this.list = this.list.filter((x) => x !== r);
        this.onGranted(r, this.w.people().find((p) => p.id === r.who));
      } else if (now > r.until || !this.w.people().some((p) => p.id === r.who)) {
        this.list = this.list.filter((x) => x !== r);
        this.onLapsed(r);
      }
    }
    this.timer -= 2;
    if (this.timer > 0 || this.list.length >= REQUESTS.max) return;
    this.timer = REQUESTS.gap[0] + this.rnd() * (REQUESTS.gap[1] - REQUESTS.gap[0]);
    this.ask(now);
  }

  /** Someone voices a wish that suits the island now (and isn't already asked for). */
  private ask(now: number): void {
    const people = this.w.people().filter((p) => !this.list.some((r) => r.who === p.id) && !p.sleeping);
    const options: { t: Template; isl: Islander }[] = [];
    for (const t of TEMPLATES) {
      if (this.list.some((r) => r.key === t.key) || this.w.canBuild(t.key)) continue;
      for (const isl of people) if (t.fits(isl, this.w)) options.push({ t, isl });
    }
    if (!options.length) return;
    const { t, isl } = options[Math.floor(this.rnd() * options.length)];
    const h = t.nearHome ? home(isl, this.w) : undefined;
    const r: IslanderRequest = {
      id: this.nextId++, who: isl.id, key: t.key, text: t.text(isl.name), thanks: t.thanks(isl.name),
      near: h ? { x: h.x, z: h.z, r: t.nearHome! } : undefined,
      before: this.w.buildings().filter((b) => b.key === t.key).map((b) => b.id),
      until: now + REQUESTS.lasts, belief: REQUESTS.belief,
    };
    this.list.push(r);
    this.onAsked(r, isl);
  }

  of(islanderId: number): IslanderRequest | undefined {
    return this.list.find((r) => r.who === islanderId);
  }

  save(): IslanderRequest[] {
    return this.list.map((r) => ({ ...r, before: [...r.before] }));
  }

  restore(data: unknown, buildingIds?: Map<number, number>): void {
    if (!Array.isArray(data)) return;
    this.list = [];
    for (const r of data as IslanderRequest[]) {
      if (!r || typeof r.text !== 'string' || typeof r.key !== 'string' || !Number.isFinite(r.until)) continue;
      const who = r.who;
      // Building ids change on loading: map the ones that were standing when it was asked.
      const before = Array.isArray(r.before) ? r.before.filter(Number.isFinite).map((id) => buildingIds?.get(id) ?? id) : [];
      this.list.push({ ...r, who, id: this.nextId++, before });
    }
  }
}
