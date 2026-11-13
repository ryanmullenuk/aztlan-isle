/**
 * Cinematic camera moves for the island's big moments: an eased flight to a flattering framing, a
 * slow orbit and push-in for a few seconds, then the view handed back exactly where the player
 * had it. One at a time, with a cooldown, never while the player is busy, and dropped at once the
 * moment the player touches anything.
 *
 * This file has no DOM or WebGL in it (the letterbox bars live in ui/Letterbox.ts), so the
 * sequencing can be tested in Node.
 */

export type CinematicKind =
  | 'landing' | 'founding' | 'temple' | 'greatTemple' | 'wonder'
  | 'wedding' | 'funeral' | 'raid' | 'eruption' | 'whale';

/** How a cinematic finished: played through, cut short by the player, or never started. */
export type CinematicEnd = 'done' | 'skipped' | 'dropped';

export interface CameraPose { x: number; z: number; dist: number; yaw: number; tilt: number }

/** The part of CameraRig a cinematic drives (goal and cur are both set, so the rig's own easing adds nothing). */
export interface CinematicRig {
  goal: CameraPose;
  cur: CameraPose;
  /** Furthest zoom the rig allows. */
  maxDist?: number;
  /** Set while a move plays: the rig keeps the camera above the ground. */
  scripted?: boolean;
}

export interface CinematicPoint { x: number; z: number; radius?: number }
/** Where to look: a fixed spot, or something that moves (null once it has gone: the move ends). */
export type CinematicSubject = CinematicPoint | (() => CinematicPoint | null);

export interface CinematicsOptions {
  /** False while the player is busy (placing, sculpting, dragging the view, a dialog, Photo Mode…). */
  canPlay?: () => boolean;
  /** The player's setting, and island movement (reduce motion): false plays nothing at all. */
  enabled?: () => boolean;
  onStart?: (kind: CinematicKind) => void;
  onEnd?: (kind: CinematicKind, how: CinematicEnd) => void;
}

export interface PlayOptions {
  /** Always called once if play() returned true: when it finishes, is skipped, or is dropped unplayed. */
  onEnd?: (how: CinematicEnd) => void;
  /** Seconds to wait for the player to finish what they are doing before giving up (default 4). */
  patience?: number;
}

interface Shot {
  /** Camera distance at the start of the shot (never closer than the subject's radius allows). */
  dist: number;
  /** Distance at the end as a fraction of the start: below 1 pushes in, above 1 pulls back. */
  push: number;
  /** Radians turned round the subject over the whole move (centred on the player's own view direction). */
  orbit: number;
  /** Degrees of tilt against the usual pitch (negative looks from lower down). */
  tilt: number;
  /** Seconds held on the subject, between flying in and flying back. */
  hold: number;
  /** Seconds before the same kind may play again. */
  again: number;
  /** A once-in-a-game moment: plays even straight after another cinematic. */
  always?: boolean;
}

/** The framing for each moment. */
export const SHOTS: Record<CinematicKind, Shot> = {
  landing:     { dist: 24, push: 0.86, orbit: 0.35,  tilt: -8,  hold: 4.5, again: 0 },
  founding:    { dist: 21, push: 0.84, orbit: 0.5,   tilt: -10, hold: 4.5, again: 0, always: true },
  temple:      { dist: 30, push: 0.86, orbit: 0.6,   tilt: -12, hold: 5,   again: 90 },
  greatTemple: { dist: 44, push: 0.86, orbit: 0.7,   tilt: -13, hold: 6,   again: 0, always: true },
  wonder:      { dist: 52, push: 0.88, orbit: 0.8,   tilt: -14, hold: 6.5, again: 0, always: true },
  wedding:     { dist: 22, push: 0.82, orbit: 0.45,  tilt: -10, hold: 5,   again: 240 },
  // Slower and stiller: a quiet moment.
  funeral:     { dist: 26, push: 0.93, orbit: 0.2,   tilt: -6,  hold: 5,   again: 240 },
  raid:        { dist: 34, push: 0.85, orbit: -0.3,  tilt: -8,  hold: 4,   again: 240 },
  // Pulls back to take in the whole mountain.
  eruption:    { dist: 80, push: 1.14, orbit: 0.4,   tilt: -14, hold: 5.5, again: 300 },
  whale:       { dist: 30, push: 0.85, orbit: 0.35,  tilt: -14, hold: 5,   again: 480 },
};

export const CINEMATIC = {
  /** Seconds after any cinematic before another may start. */
  cooldown: 40,
  /** Shortest and longest flight in and out (longer the further the camera has to travel). */
  travel: [1.5, 3.2] as const,
  /** Default seconds a triggered move waits for the player to be free. */
  patience: 4,
};

/** Smooth start and stop (quintic). */
const ease = (t: number): number => {
  t = Math.min(1, Math.max(0, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixPose = (a: CameraPose, b: CameraPose, t: number): CameraPose => ({
  x: mix(a.x, b.x, t), z: mix(a.z, b.z, t),
  // Zoom eases evenly on a log scale: halving the distance feels the same at any range.
  dist: Math.exp(mix(Math.log(a.dist), Math.log(b.dist), t)),
  yaw: mix(a.yaw, b.yaw, t), tilt: mix(a.tilt, b.tilt, t),
});

interface Playing {
  kind: CinematicKind;
  shot: Shot;
  subject: () => CinematicPoint | null;
  at: CinematicPoint;
  /** Where the camera was when the move began, and where the player's own aim was (handed back at the end). */
  from: CameraPose;
  saved: CameraPose;
  t: number;
  inSecs: number;
  outSecs: number;
  /** Seconds at which the flight back begins (brought forward if the subject goes away). */
  outAt: number;
  onEnd?: (how: CinematicEnd) => void;
}

interface Waiting { kind: CinematicKind; subject: CinematicSubject; left: number; onEnd?: (how: CinematicEnd) => void }

export class Cinematics {
  /** A quick way to switch them all off (the lead's `enabled` option is the usual way). */
  enabled = true;
  private now: Playing | null = null;
  private waiting: Waiting | null = null;
  /** Real seconds this has been running (cooldowns are in real time, whatever the game speed). */
  private clock = 0;
  private readyAt = 0;
  private lastPlayed = new Map<CinematicKind, number>();

  constructor(private rig: CinematicRig, private opts: CinematicsOptions = {}) {}

  /** The cinematic on screen now, if any. */
  get active(): CinematicKind | null {
    return this.now?.kind ?? null;
  }

  get playing(): boolean {
    return !!this.now;
  }

  /** 0..1: how far the letterbox is in (for anything that wants to follow the move frame by frame). */
  get presence(): number {
    const n = this.now;
    if (!n) return 0;
    return n.t < n.outAt ? ease(n.t / n.inSecs) : 1 - ease((n.t - n.outAt) / n.outSecs);
  }

  private allowed(kind: CinematicKind): boolean {
    if (!this.enabled || this.opts.enabled?.() === false) return false;
    if (this.now || this.waiting) return false;
    if (this.clock < this.readyAt && !SHOTS[kind].always) return false;
    const last = this.lastPlayed.get(kind);
    return last === undefined || this.clock - last >= SHOTS[kind].again;
  }

  /**
   * Ask for a cinematic. Returns false (and does nothing) if they are switched off, another is
   * playing or waiting, or it is too soon after the last. If the player is busy it waits a few
   * seconds for them to finish, and is dropped if they don't.
   */
  play(kind: CinematicKind, subject: CinematicSubject, o: PlayOptions = {}): boolean {
    if (!this.allowed(kind)) return false;
    if (this.opts.canPlay?.() === false) {
      const left = o.patience ?? CINEMATIC.patience;
      if (left <= 0) return false;
      this.waiting = { kind, subject, left, onEnd: o.onEnd };
      return true;
    }
    return this.begin(kind, subject, o.onEnd);
  }

  private begin(kind: CinematicKind, subject: CinematicSubject, onEnd?: (how: CinematicEnd) => void): boolean {
    const get = typeof subject === 'function' ? subject : () => subject;
    const at = get();
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return false;
    const shot = SHOTS[kind], rig = this.rig;
    const saved = { ...rig.goal }, from = { ...rig.cur };
    // Further to fly (across the island, or a long way in or out) takes a little longer.
    const far = Math.hypot(at.x - from.x, at.z - from.z) / 60 + Math.abs(Math.log(Math.max(1, from.dist) / this.distFor(shot, at))) * 0.6;
    const secs = Math.min(CINEMATIC.travel[1], CINEMATIC.travel[0] + far * 0.6);
    this.now = { kind, shot, subject: get, at: { ...at }, from, saved, t: 0, inSecs: secs, outSecs: secs, outAt: secs + shot.hold, onEnd };
    this.lastPlayed.set(kind, this.clock);
    rig.scripted = true;
    this.opts.onStart?.(kind);
    return true;
  }

  private distFor(shot: Shot, at: CinematicPoint): number {
    const d = Math.max(8, shot.dist, (at.radius ?? 0) * 3.2);
    return Math.min(d, this.rig.maxDist ?? Infinity);
  }

  /** The framing at this moment of the move: a slow drift round and in on the subject, start to finish. */
  private framing(n: Playing): CameraPose {
    const total = n.outAt + n.outSecs;
    const u = Math.min(1, n.t / total);
    const d0 = this.distFor(n.shot, n.at);
    const d1 = Math.min(Math.max(6, d0 * n.shot.push), this.rig.maxDist ?? Infinity);
    return {
      x: n.at.x, z: n.at.z,
      dist: Math.exp(mix(Math.log(d0), Math.log(d1), u)),
      // Centred on the direction the player was already looking, so nothing spins round.
      yaw: n.saved.yaw + n.shot.orbit * (u - 0.5),
      tilt: n.shot.tilt,
    };
  }

  /** Every frame, in real seconds, before the rig's own update. */
  update(realDt: number): void {
    const dt = Math.max(0, realDt);
    this.clock += dt;
    const w = this.waiting;
    if (w) {
      if (!this.enabled || this.opts.enabled?.() === false) this.drop();
      else if (this.opts.canPlay?.() !== false) {
        this.waiting = null;
        if (!this.begin(w.kind, w.subject, w.onEnd)) w.onEnd?.('dropped');
      } else if ((w.left -= dt) <= 0) this.drop();
    }
    const n = this.now;
    if (!n) return;
    // The player has started something, or switched cinematics off: let go at once.
    if (this.opts.canPlay?.() === false || !this.enabled || this.opts.enabled?.() === false) { this.skip(); return; }
    n.t += dt;
    const live = n.subject();
    if (live && Number.isFinite(live.x) && Number.isFinite(live.z)) { n.at.x = live.x; n.at.z = live.z; }
    // The subject has gone (the whale dived, the canoes left): fly back now.
    else if (n.t < n.outAt) n.outAt = Math.max(n.t, Math.min(n.outAt, n.inSecs));
    if (n.t >= n.outAt + n.outSecs) { this.finish('done', true); return; }
    const shot = this.framing(n);
    const pose = n.t < n.outAt
      ? mixPose(n.from, shot, ease(n.t / n.inSecs))
      : mixPose(shot, n.saved, ease((n.t - n.outAt) / n.outSecs));
    this.rig.goal = pose;
    this.rig.cur = { ...pose };
  }

  /**
   * Stop now and give the view back (any tap, click, key, wheel or drag calls this). The player's
   * aim is restored exactly; the camera glides the short way back under the rig's own easing.
   */
  skip(): boolean {
    if (this.waiting) this.drop();
    if (!this.now) return false;
    this.finish('skipped', false);
    return true;
  }

  private drop(): void {
    const w = this.waiting;
    this.waiting = null;
    w?.onEnd?.('dropped');
  }

  private finish(how: CinematicEnd, snap: boolean): void {
    const n = this.now;
    if (!n) return;
    this.now = null;
    this.rig.goal = { ...n.saved };
    if (snap) this.rig.cur = { ...n.saved };
    this.rig.scripted = false;
    this.readyAt = this.clock + CINEMATIC.cooldown;
    this.opts.onEnd?.(n.kind, how);
    n.onEnd?.(how);
  }
}
