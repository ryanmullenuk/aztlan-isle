import { Gathering } from '../ai/Gathering';
import type { Building } from '../buildings/Buildings';
import { buildingOperational } from '../buildings/BuildingCondition';
import type { Game } from '../Game';
import { Ghosts } from '../render/Ghosts';
import { haptic } from '../ui/Haptics';

export const ANCESTORS = {
  /** Game seconds after the altar stands (and someone has died) before the first asking, and between askings. */
  first: [120, 260] as [number, number],
  gap: [1500, 2700] as [number, number],
  /** How long a wish to visit stays open before it lapses. */
  lasts: 600,
  /** Night begins and ends for the spirits (hours). */
  dusk: 20.3,
  dawn: 5.2,
  /** Most spirits, and most of the living called to meet them. */
  ghosts: 6,
  people: 10,
  /** Game seconds the living stay with them. */
  visitSecs: 150,
  mood: 0.1,
  belief: 25,
};

/** Is it dark enough for the spirits to walk? */
export const spiritHours = (hour: number): boolean => hour >= ANCESTORS.dusk || hour < ANCESTORS.dawn;

/** May someone ask to visit the ancestors: an altar stands, someone has died, and nothing is under way. */
export function mayAsk(altar: boolean, dead: number, state: AncestorState): boolean {
  return altar && dead > 0 && state === 'quiet';
}

/** quiet: nothing; asked: an islander's wish is open; granted: waiting for nightfall; night: the spirits are out. */
export type AncestorState = 'quiet' | 'asked' | 'granted' | 'night';

interface Dead { name: string; f: boolean }

/**
 * The Night of the Ancestors. Once an Ancestor Altar stands and the island has known a death, an
 * islander will now and again ask to visit those who have gone. If the player grants it, the
 * spirits of the dead come out at the altar that night: they stand among the candles, wave to the
 * living who come to see them and talk with them, and are gone again by morning. The village is
 * comforted and the gods are pleased. It is never held unasked, and never without the altar.
 */
export class AncestorNight {
  readonly ghosts = new Ghosts();
  state: AncestorState = 'quiet';
  /** Those who have died (the newest last; saved). */
  dead: Dead[] = [];
  /** Nights held (saved). */
  held = 0;
  private timer: number = ANCESTORS.first[0];
  private asker = -1;
  private until = 0;
  private night: { t: number; altar: number; crowd: Gathering | null; cx: number; cz: number; wave: number } | null = null;

  constructor(private game: Game, private rnd: () => number = Math.random) {}

  /** Someone has died: they join the ancestors. */
  remember(name: string, female: boolean): void {
    this.dead.push({ name, f: female });
    if (this.dead.length > 24) this.dead.shift();
  }

  /** How many of the dead are remembered (those buried before the altar was known count too). */
  get deadCount(): number {
    return Math.max(this.dead.length, this.game.passings?.graves.list.length ?? 0);
  }

  altar(): Building | undefined {
    return this.game.buildings.list.find((b) => b.key === 'ancestoraltar' && buildingOperational(b));
  }

  save(): { state: AncestorState; dead: Dead[]; held: number; timer: number; asker: number; left: number } {
    // A night under way is saved as granted: the spirits come out again when the game is loaded.
    return { state: this.state === 'night' ? 'granted' : this.state, dead: this.dead, held: this.held, timer: this.timer, asker: this.asker, left: Math.max(0, this.until - this.game.time.elapsed) };
  }

  restore(d: unknown): void {
    const s = d as Partial<ReturnType<AncestorNight['save']>> | null;
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s.dead)) this.dead = s.dead.filter((x) => x && typeof x.name === 'string').map((x) => ({ name: x.name, f: !!x.f })).slice(-24);
    if (Number.isFinite(s.held)) this.held = s.held!;
    if (Number.isFinite(s.timer)) this.timer = s.timer!;
    // An open wish isn't kept (its pop-up is gone): they will ask again before long.
    this.state = s.state === 'granted' ? 'granted' : 'quiet';
    if (s.state === 'asked') this.timer = ANCESTORS.first[0];
  }

  /** Game time `dt`. */
  update(dt: number): void {
    const g = this.game;
    if (dt <= 0 || g.eco.godMode && this.state === 'quiet') return;
    const altar = this.altar();
    if (this.state === 'night') return this.run(dt, altar);
    if (!altar) {
      // No altar, no visit: a wish or a blessing waiting on one is dropped.
      if (this.state !== 'quiet') this.lapse();
      return;
    }
    if (this.state === 'asked') {
      if (g.time.elapsed > this.until || !g.colony.byId(this.asker)) this.lapse();
      return;
    }
    if (this.state === 'granted') {
      if (spiritHours(g.time.hour)) this.begin(altar);
      return;
    }
    if (!mayAsk(true, this.deadCount, this.state)) return;
    this.timer -= dt;
    if (this.timer <= 0) this.ask();
  }

  /** An islander asks to visit the ancestors. Returns whether anyone did. */
  ask(): boolean {
    const g = this.game;
    if (!mayAsk(!!this.altar(), this.deadCount, this.state)) return false;
    const people = g.colony.list.filter((p) => !p.child && !p.npc && !p.hidden && !p.sleeping);
    this.timer = ANCESTORS.gap[0] + this.rnd() * (ANCESTORS.gap[1] - ANCESTORS.gap[0]);
    if (!people.length) return false;
    const who = people[Math.floor(this.rnd() * people.length)];
    const last = this.dead[this.dead.length - 1]?.name ?? g.passings?.graves.list[g.passings.graves.list.length - 1]?.name;
    this.state = 'asked';
    this.asker = who.id;
    this.until = g.time.elapsed + ANCESTORS.lasts;
    g.ui?.dialog.push({
      icon: 'ask', kicker: `${who.name} has a request`, important: true, art: 'lantern',
      title: 'May we visit the ancestors?',
      body: `${who.name} misses those who have gone${last ? `, ${last} most of all` : ''}. With your blessing, the village will keep a night at the Ancestor Altar, and the spirits of the dead will come out to greet the living.`,
      benefit: `A night with the ancestors: +${ANCESTORS.belief} Belief and a comforted village`,
      actions: [
        { label: 'Grant it', primary: true, run: () => this.grant() },
        { label: 'Not this time', run: () => this.lapse(true) },
      ],
    });
    g.audio?.sfx('select');
    return true;
  }

  /** The player's blessing: the spirits come at nightfall (at once, if it is night already). */
  grant(): void {
    if (this.state !== 'asked') return;
    const g = this.game;
    this.state = 'granted';
    g.ui?.dialog.forget((d) => d.title === 'May we visit the ancestors?');
    if (!spiritHours(g.time.hour)) g.ui?.toast('Granted. The ancestors will come to the altar at nightfall.', 'milestone');
    haptic('light');
  }

  private lapse(refused = false): void {
    if (this.state === 'night') return;
    const who = this.game.colony.byId(this.asker);
    if (refused && who) who.happy = Math.max(0, who.happy - 0.05);
    this.game.ui?.dialog.forget((d) => d.title === 'May we visit the ancestors?');
    this.state = 'quiet';
    this.asker = -1;
  }

  private begin(altar: Building): void {
    const g = this.game, [dx, dz] = altar.dir, px = -dz, pz = dx;
    const fx = altar.door.x, fz = altar.door.z;
    // The spirits stand in a shallow arc before the stair; the living a few steps further out.
    const n = Math.max(2, Math.min(ANCESTORS.ghosts, this.deadCount));
    const who = this.dead.slice(-n);
    const at = [];
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5, side = u * Math.min(3.2, 0.75 * (n - 1) + 0.6), out = 0.9 + (1 - Math.abs(u) * 2) * 0.5 + (k % 2) * 0.25;
      const x = fx + dx * out + px * side, z = fz + dz * out + pz * side;
      const gender: 'm' | 'f' = who[k] ? (who[k].f ? 'f' : 'm') : k % 2 ? 'f' : 'm';
      at.push({ gender, x, z, y: g.world.groundY(x, z), heading: Math.atan2(dx, dz) + u * 0.5 });
    }
    this.ghosts.appear(at);
    const cx = fx + dx * 1.2, cz = fz + dz * 1.2;
    const crowd = new Gathering(g.colony, 'wave', cx, cz);
    const slots: { x: number; z: number }[] = [];
    for (let k = 0; k < 14; k++) {
      const row = k < 8 ? 0 : 1, m = row ? 6 : 8, u = ((row ? k - 8 : k) + 0.5) / m - 0.5;
      const out = 2.5 + row * 0.75 - Math.abs(u) * 0.5, side = u * (row ? 3.6 : 4.2);
      slots.push({ x: fx + dx * out + px * side, z: fz + dz * out + pz * side });
    }
    crowd.call(ANCESTORS.people, slots, (i) => !!i.warrior);
    // The one who asked comes too, whatever they were doing.
    const asker = g.colony.byId(this.asker);
    if (asker && !asker.child && asker.condition === 'well' && !crowd.ids.includes(asker.id)) {
      const s = slots[slots.length - 1];
      crowd.join(asker, s.x, s.z);
    }
    this.state = 'night';
    this.night = { t: 0, altar: altar.id, crowd, cx, cz, wave: 0 };
    const names = who.map((d) => d.name);
    const those = names.length > 2 ? `${names.slice(-3, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and ');
    g.ui?.dialog.push({
      icon: 'star', kicker: 'Night of the Ancestors', important: true, art: 'lantern',
      title: 'The ancestors have come',
      body: `The candles are lit at the Ancestor Altar, and the spirits of the dead stand among them${those ? `: ${those}` : ''}. The village goes to greet them. They will be gone by morning.`,
      actions: [
        { label: 'Go and watch', primary: true, run: () => g.focusAt({ x: cx, z: cz }) },
        { label: 'Carry on' },
      ],
    });
    g.audio?.sfx('milestone');
  }

  /** The living go home, comforted (if any came). */
  private farewell(): void {
    const g = this.game, a = this.night;
    if (!a?.crowd) return;
    const came = a.crowd.present;
    a.crowd.release();
    a.crowd = null;
    this.held++;
    if (!came) return;
    g.colony.moodBoost += ANCESTORS.mood;
    g.eco.add('belief', ANCESTORS.belief);
    g.ui?.toast(`The village has spoken with its ancestors and goes home comforted (+${ANCESTORS.belief} Belief).`, 'milestone');
    haptic('medium');
  }

  private run(dt: number, altar: Building | undefined): void {
    const g = this.game, a = this.night!;
    a.t += dt;
    // The living wave when they arrive and now and then after; between times they stand and talk.
    if (a.crowd) {
      a.wave -= dt;
      if (a.wave <= -6) a.wave = 4;
      a.crowd.anim = a.t < 14 || a.wave > 0 ? 'wave' : 'idle';
      a.crowd.update();
      if (a.t > ANCESTORS.visitSecs || (a.t > 30 && !a.crowd.size)) this.farewell();
    }
    // Each spirit turns to the nearest of the living.
    const spots = this.ghosts.spots();
    for (let k = 0; k < spots.length; k++) {
      let best = null as { x: number; z: number } | null, bd = 36;
      for (const i of g.colony.list) {
        const d = (i.x - spots[k].x) ** 2 + (i.z - spots[k].z) ** 2;
        if (d < bd && !i.hidden) { bd = d; best = i; }
      }
      if (best) this.ghosts.face(k, best.x, best.z);
    }
    // Daybreak (or the altar gone): they fade.
    if (!spiritHours(g.time.hour) || !altar || altar.id !== a.altar) {
      this.farewell();
      this.ghosts.vanish();
      this.night = null;
      this.state = 'quiet';
      this.asker = -1;
      this.timer = ANCESTORS.gap[0] + this.rnd() * (ANCESTORS.gap[1] - ANCESTORS.gap[0]);
    }
  }
}
