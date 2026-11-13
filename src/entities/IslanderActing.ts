import * as THREE from 'three';
import { ISLANDER, TIME } from '../config';
import { BI, BONES, PARENT, type ClipName, type GlbModel } from './glbPeople';
import type { Islander, Role } from './Islander';

/**
 * The islanders' acting: what each one is seen to be doing beyond their task's own animation.
 * Frightened people cower or run looking back, mourners stand with bowed heads, two with nothing
 * to do turn to one another and talk (one speaking with the hands, the other nodding), children
 * chase each other round and play clapping games, and anyone standing about stretches, wipes their
 * brow or looks round now and then. Heads turn to whoever is passing.
 *
 * None of this touches the game: it reads the islanders and changes only how they are drawn.
 * Deciding what to act is plain arithmetic on the islander (no objects made per frame); the
 * gestures are laid over the skeleton after its clip or pose has been played (see `swing` and
 * `reach`), so they work on top of anything.
 */

/** A gesture laid over the body: arms, head and back. */
export type Gesture = 'none' | 'cower' | 'mourn' | 'weep' | 'listen' | 'stretch' | 'brow' | 'scratch' | 'hips' | 'belly' | 'yawn' | 'clap' | 'cheer';

/** What an islander is shown doing this frame (filled in place by `planActing`). */
export interface ActPlan {
  /** The clip to play instead of the usual one (undefined: no change; null: the procedural pose). */
  clip: ClipName | null | undefined;
  gesture: Gesture;
  /** Turn the head toward this point (world), when `look` is set. */
  look: boolean;
  lookX: number;
  lookZ: number;
  /** Turn the whole body toward the look point (two people talking face one another). */
  face: boolean;
  /** Children chasing round: the middle of the ring, its radius, and how far round it they have run (radians). */
  chase: boolean;
  ringX: number;
  ringZ: number;
  ringR: number;
  ringA: number;
  /** A spring in the step (0..1): children skipping along, jumping for joy. */
  hop: number;
  /** Trudging: worn out, hungry or downcast on the move (0..1). */
  slump: number;
  /** How fast the legs go when the clip is a moving one but the islander stands still to the game (chasing). */
  speed: number;
}

export function blankPlan(): ActPlan {
  return { clip: undefined, gesture: 'none', look: false, lookX: 0, lookZ: 0, face: false, chase: false, ringX: 0, ringZ: 0, ringR: 0, ringA: 0, hop: 0, slump: 0, speed: -1 };
}

/** What is going on round an islander, as far as acting goes. */
export interface ActWorld {
  /** Seconds on the rig's own clock (shared by everyone, so two people can take turns). */
  clock: number;
  /** The village is frightened (an eruption, a darkened sun, raiders). */
  afraid: boolean;
  /** Where a funeral is being held, if one is. */
  mournAt: { x: number; z: number } | null;
}

const unit = (n: number) => { const h = Math.sin(n) * 43758.5453; return h - Math.floor(h); };
const wrap = (a: number) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

// ---------------- Variety ----------------

/**
 * The colour of each trade's cloth (the red bands and sash of the tunic are redrawn in it; 0
 * leaves them as painted). Those with no trade, the warriors (who have their helms) and the
 * children keep the red.
 */
export const TRADE_CLOTH: Record<Role, number> = {
  idle: 0,
  warrior: 0,
  builder: 0xd9952b,
  woodcutter: 0x3f8a3a,
  miner: 0x6d7f8c,
  gatherer: 0xc2407a,
  farmer: 0x86b030,
  priest: 0x7a3fb0,
  fisher: 0x2f7fc4,
  butcher: 0x8a2030,
  smoker: 0x5a4636,
  mason: 0x9a9488,
  merchant: 0xe3b53c,
  firemaker: 0xf07a1e,
};

/** The cloth colour an islander's trade gives them (0: as painted). */
export function tradeCloth(isl: { role: Role; child: boolean; npc?: string; warrior?: unknown }): number {
  if (isl.child || isl.npc || isl.warrior) return 0;
  return TRADE_CLOTH[isl.role] ?? 0;
}

/** How tall a child stands beside a grown-up as they near coming of age. */
const CHILD_GROWN = 0.8;

/**
 * An islander's size beside the standard figure: grown-ups a little taller or shorter (by id, so
 * it never changes and needs no saving), children small and growing steadily until they come of age.
 */
export function bodyScale(isl: { id: number; child: boolean; age?: number; npc?: string }): number {
  if (isl.npc) return 1;
  if (isl.child) {
    const grown = THREE.MathUtils.clamp((isl.age ?? 0) / (ISLANDER.childGrowDays * TIME.dayLength), 0, 1);
    return ISLANDER.childScale + (CHILD_GROWN - ISLANDER.childScale) * grown;
  }
  return 0.95 + unit(isl.id * 53.7 + 4.1) * 0.1;
}

// ---------------- Deciding what to act ----------------

/** Gatherings where people stand about together and talk. */
const SOCIAL = new Set(['family', 'bonfire', 'hall']);

/** Free to turn to a neighbour and talk: standing idle, well, with empty hands and nothing pressing. */
export function canChat(isl: Islander): boolean {
  if (isl.hidden || isl.sleeping || isl.anim !== 'idle' || isl.carry || isl.warrior || isl.npc || isl.condition !== 'well' || isl.waveT > 0) return false;
  if (isl.task && !SOCIAL.has(isl.task.kind)) return false;
  return isl.child || !(isl.happy < 0.35 || isl.hunger < 0.2 || isl.rest < 0.15);
}

/** How close two people stand to talk, and how close a passer-by comes to be looked at (world units). */
export const CHAT_REACH = 1.3;
export const LOOK_REACH = 2.4;
/** How near the grave the mourners stand. */
const MOURN_REACH = 4.5;
/** Seconds one of a pair speaks before the other answers. */
const TURN = 3.6;
/** Children playing together: a round of chasing, then a clapping game, then tumbling. */
const PLAY_ROUND = 17, CHASE_SECS = 7.5, CLAP_SECS = 5.5;
/** How fast children chase round (world units a second). */
const CHASE_SPEED = 1.15;

/** How long each fidget lasts (seconds). */
const FIDGET_SECS: Partial<Record<Gesture, number>> = { stretch: 2.6, brow: 1.9, scratch: 2.1, hips: 3.6, belly: 2.6, yawn: 2.5, cheer: 1.8 };
const FIDGET_SLOT = 11;
const ADULT_FIDGETS: Gesture[] = ['stretch', 'brow', 'scratch', 'hips', 'hips', 'brow'];

/**
 * The small thing someone standing about does now and then: a stretch, a hand across the brow, a
 * scratch of the head, hands on hips; a yawn when tired, a hand on the belly when hungry; children
 * jump with their arms up. Each islander keeps their own time, so no two do it together.
 */
export function fidgetFor(isl: { id: number; child: boolean; rest: number; hunger: number; tool: string }, clock: number): Gesture {
  const u = clock + unit(isl.id * 12.9 + 0.7) * FIDGET_SLOT;
  const slot = Math.floor(u / FIDGET_SLOT), t = u - slot * FIDGET_SLOT;
  const r = unit(isl.id * 78.2 + slot * 37.7);
  if (r > 0.6) return 'none';
  let kind: Gesture = isl.child ? 'cheer' : ADULT_FIDGETS[Math.floor(unit(isl.id * 3.3 + slot * 91.1) * ADULT_FIDGETS.length)];
  if (!isl.child && isl.rest < 0.3 && r < 0.4) kind = 'yawn';
  else if (isl.hunger < 0.35 && r < 0.4) kind = 'belly';
  // A tool in the hand: nothing that needs both arms.
  if (isl.tool !== 'none' && (kind === 'stretch' || kind === 'hips' || kind === 'cheer')) kind = 'brow';
  const dur = FIDGET_SECS[kind] ?? 2;
  const start = 0.8 + unit(isl.id * 5.1 + slot * 17.3) * (FIDGET_SLOT - dur - 1.6);
  return t >= start && t < start + dur ? kind : 'none';
}

const MOVING_OK = new Set<string>(['idle', 'walk', 'run', 'sit', 'eat', 'carry']);

/**
 * What an islander is shown doing. `base` is the clip they would play anyway and `shown` the pose
 * they are shown in (see IslanderRig's clipFor and shownAnim); `near` is the nearest other islander
 * drawn in full (or null), and `mutual` whether that one's nearest is this islander in turn.
 */
export function planActing(out: ActPlan, isl: Islander, base: ClipName | null, shown: string, w: ActWorld, near: Islander | null, mutual: boolean): ActPlan {
  out.clip = undefined; out.gesture = 'none'; out.look = false; out.face = false; out.chase = false; out.hop = 0; out.slump = 0; out.speed = -1;
  if (isl.hidden || isl.sleeping || isl.anim === 'sleep' || isl.npc) return out;
  const moving = isl.anim === 'walk' || isl.anim === 'run';
  const standing = shown === 'idle';
  const well = isl.condition === 'well' && !(isl.injured > 0);
  let nd = Infinity;
  if (near && !near.hidden) nd = Math.hypot(near.x - isl.x, near.z - isl.z);

  // Fear: on the move they run looking back over the shoulder; standing, they cower.
  if (w.afraid && !isl.safe && isl.floorY === null && !isl.warrior) {
    if (moving && !isl.carry && well) { out.clip = 'run_look_back'; return out; }
    if (standing || shown === 'play') {
      out.clip = 'sad_idle';
      out.gesture = 'cower';
      // Huddling up to whoever is nearest.
      if (nd < CHAT_REACH && near) { out.look = true; out.lookX = near.x; out.lookZ = near.z; }
      return out;
    }
  }

  // A funeral: those gathered at the grave stand with heads bowed, and now and then wipe their eyes.
  const m = w.mournAt;
  if (m && !isl.task && !isl.warrior && !isl.carry && (isl.anim === 'idle' || isl.anim === 'pray') && Math.hypot(m.x - isl.x, m.z - isl.z) < MOURN_REACH) {
    // One in three kneels in prayer (their task's own pose); the rest stand grieving.
    if (isl.anim === 'pray' && isl.id % 3 === 0) return out;
    out.clip = 'sad_idle';
    const u = w.clock * 0.11 + unit(isl.id * 9.7);
    out.gesture = u - Math.floor(u) < 0.26 ? 'weep' : 'mourn';
    return out;
  }

  // Trudging along worn out, hungry or downcast.
  if (isl.anim === 'walk' && !isl.child) {
    out.slump = isl.rest < 0.2 || isl.hunger < 0.2 ? 1 : isl.happy < 0.35 ? 0.6 : 0;
  }
  // Children with empty hands skip rather than walk.
  if (isl.child && isl.anim === 'walk' && !isl.carry && well && base === 'walk' && isl.happy >= 0.4) {
    out.clip = 'jog';
    out.hop = 1;
  }

  const idleClip = base === 'idle' || base === 'talk' || base === 'chat' || base === 'turn';
  const free = (standing || shown === 'play') && (idleClip || base === null || base === 'roll') && canChat(isl);
  if (free && near && nd < CHAT_REACH && mutual && canChat(near) && near.child === isl.child) {
    const lo = Math.min(isl.id, near.id), hi = Math.max(isl.id, near.id), pair = unit(lo * 17.3 + hi * 5.9);
    out.look = true; out.lookX = near.x; out.lookZ = near.z;
    if (isl.child) {
      // Two children: chasing round and round, then a clapping game, then tumbling about.
      const u = w.clock + pair * PLAY_ROUND, t = u - Math.floor(u / PLAY_ROUND) * PLAY_ROUND;
      if (t < CHASE_SECS) {
        const r = Math.max(0.32, nd / 2);
        out.chase = true;
        out.ringX = (isl.x + near.x) / 2; out.ringZ = (isl.z + near.z) / 2; out.ringR = r;
        // Easing in and out of the run, and ending where they began (a whole number of laps).
        const laps = Math.max(1, Math.round((CHASE_SPEED * CHASE_SECS * 0.8) / (Math.PI * 2 * r)));
        const k = t / CHASE_SECS, e = k * k * (3 - 2 * k);
        out.ringA = e * laps * Math.PI * 2 * (pair < 0.5 ? 1 : -1);
        out.speed = (laps * Math.PI * 2 * r / CHASE_SECS) * 6 * k * (1 - k);
        out.clip = 'jog';
        out.look = false;
        return out;
      }
      if (t < CHASE_SECS + CLAP_SECS) {
        out.clip = 'idle';
        out.gesture = 'clap';
        out.face = true;
        out.hop = 0.6;
        return out;
      }
      // Tumbling: whatever they would do alone (rolls, crouching to play).
      return out;
    }
    // Two grown-ups: facing one another, taking turns to speak.
    out.face = true;
    const turn = Math.floor((w.clock + pair * TURN * 2) / TURN);
    const speaker = (turn % 2 === 0) === (isl.id === lo);
    if (speaker) out.clip = (turn + isl.id) % 3 === 0 ? 'chat' : 'talk';
    else { out.clip = 'idle'; out.gesture = 'listen'; }
    return out;
  }

  // Alone with nothing to do: a fidget now and then.
  if (standing && (base === 'idle' || base === null) && !isl.carry && !isl.warrior && isl.waveT <= 0) {
    const f = fidgetFor(isl, w.clock);
    if (f !== 'none') {
      out.gesture = f;
      if (f === 'cheer') out.hop = 1;
      return out;
    }
  }
  // Someone passing: the head turns to follow them.
  if (near && nd < LOOK_REACH && MOVING_OK.has(shown) && (near.speed > 0.05 || nd < CHAT_REACH)) {
    out.look = true; out.lookX = near.x; out.lookZ = near.z;
  }
  return out;
}

// ---------------- Laying gestures over the skeleton ----------------

/** Each bone with everything hanging from it (so turning a shoulder carries the arm and hand). */
const TREE: number[][] = BONES.map((b) => BONES.map((c, i) => {
  for (let p: (typeof BONES)[number] | null = c; p; p = PARENT[p]) if (p === b) return i;
  return -1;
}).filter((i) => i >= 0));

const _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _o = new THREE.Vector3(), _r = new THREE.Vector3();

/**
 * Turn a bone (and all that hangs from it) by `angle` about an axis through its joint, on top of
 * whatever the clip or pose has done. The axis is in the model's frame (x across, y up, z ahead),
 * or in the frame of the bone `frame` when one is given. Positive x bends forward, positive y
 * turns toward the +x side, as in the rig's poses.
 */
export function swing(W: THREE.Matrix4[], bone: number, ax: number, ay: number, az: number, angle: number, frame = -1): void {
  if (Math.abs(angle) < 1e-4) return;
  _a.set(ax, ay, az);
  if (frame >= 0) _a.transformDirection(W[frame]); else _a.normalize();
  _o.setFromMatrixPosition(W[bone]);
  _m.makeRotationAxis(_a, angle);
  _r.copy(_o).applyMatrix4(_m);
  _m.setPosition(_o.x - _r.x, _o.y - _r.y, _o.z - _r.z);
  for (const d of TREE[bone]) W[d].premultiply(_m);
}

const DOWN = new THREE.Vector3(0, -1, 0), ONE = new THREE.Vector3(1, 1, 1);
const _sh = new THREE.Vector3(), _t = new THREE.Vector3(), _dir = new THREE.Vector3(), _bend = new THREE.Vector3(), _el = new THREE.Vector3(), _wr = new THREE.Vector3();
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _mm = new THREE.Matrix4();

function lerpInto(m: THREE.Matrix4, to: THREE.Matrix4, k: number): void {
  const e = m.elements, t = to.elements;
  for (let j = 0; j < 16; j++) e[j] += (t[j] - e[j]) * k;
}

/**
 * Bring a hand to a point: the arm on `side` ('L' is the +x side, which holds the tool) is bent
 * so its wrist reaches (x, y, z), given in the frame of bone `frame` as an offset from that bone's
 * joint (metres). The elbow goes toward `hint` (model frame). `k` blends from the arm as it was (0)
 * to the reach (1). A point out of reach is pointed at with a straight arm.
 */
export function reach(W: THREE.Matrix4[], model: Pick<GlbModel, 'len'>, side: 'L' | 'R', frame: number, x: number, y: number, z: number, hx: number, hy: number, hz: number, k: number): void {
  if (k <= 0.001) return;
  const ua = BI[`upper_arm${side}`], fa = BI[`forearm${side}`], hd = BI[`hand${side}`], U = model.len.upper, F = model.len.fore;
  _sh.setFromMatrixPosition(W[ua]);
  _t.set(x, y, z).applyMatrix4(W[frame]);
  _dir.copy(_t).sub(_sh);
  const dist = _dir.length() || 1e-6;
  const r = THREE.MathUtils.clamp(dist, Math.abs(U - F) + 0.001, U + F - 0.001);
  _dir.divideScalar(dist);
  _wr.copy(_sh).addScaledVector(_dir, r);
  _bend.set(hx, hy, hz);
  _bend.addScaledVector(_dir, -_bend.dot(_dir));
  if (_bend.lengthSq() < 1e-6) _bend.set(0, -1, 0).addScaledVector(_dir, _dir.y);
  _bend.normalize();
  const along = (U * U - F * F + r * r) / (2 * r), lift = Math.sqrt(Math.max(0, U * U - along * along));
  _el.copy(_sh).addScaledVector(_dir, along).addScaledVector(_bend, lift);
  _q.setFromUnitVectors(DOWN, _ax.copy(_el).sub(_sh).normalize());
  lerpInto(W[ua], _mm.compose(_sh, _q, ONE), k);
  _q.setFromUnitVectors(DOWN, _ax.copy(_wr).sub(_el).normalize());
  lerpInto(W[fa], _mm.compose(_el, _q, ONE), k);
  lerpInto(W[hd], _mm.compose(_wr, _q, ONE), k);
}

/** Which way the head faces (radians from straight ahead, positive toward +x), read from its posed frame. */
export function headYaw(W: THREE.Matrix4[]): number {
  const e = W[BI.head].elements;
  return Math.atan2(e[8], e[10]);
}

/** Turn the head (and a little of the neck) by `yaw` and nod it by `pitch` (positive: down). */
export function turnHead(W: THREE.Matrix4[], yaw: number, pitch: number): void {
  swing(W, BI.neck, 0, 1, 0, yaw * 0.4);
  swing(W, BI.head, 0, 1, 0, yaw * 0.6);
  swing(W, BI.neck, 1, 0, 0, pitch * 0.4, BI.chest);
  swing(W, BI.head, 1, 0, 0, pitch * 0.6, BI.chest);
}

/**
 * Lay a gesture over the posed skeleton, `k` of the way in (0..1). `t` is the clock (seconds) and
 * `id` keeps each islander out of step with the rest. `arms` false leaves the arms be (hands full).
 */
export function applyGesture(W: THREE.Matrix4[], model: Pick<GlbModel, 'len' | 'joint'>, g: Gesture, k: number, t: number, id: number, arms = true): void {
  if (g === 'none' || k <= 0.001) return;
  const J = model.joint, C = BI.chest, H = BI.head, hips = BI.hips;
  // Places on the body, as offsets from the chest and head joints (metres, bind pose).
  const headTop = 0.3, ear = J.upper_armL.x - J.head.x - 0.01, belly = J.hips.y + 0.24 - J.chest.y;
  const ph = t + id * 1.37;
  switch (g) {
    case 'cower': {
      // Hunched and trembling, hands up to the head, eyes darting about.
      const shake = Math.sin(ph * 41) * 0.012 + Math.sin(ph * 29.3) * 0.008;
      swing(W, BI.spine, 1, 0, 0, 0.26 * k, hips);
      swing(W, C, 1, 0, 0, 0.16 * k, hips);
      swing(W, C, 0, 1, 0, shake * k, hips);
      turnHead(W, Math.sin(ph * 2.1) * Math.sin(ph * 0.63) * 0.55 * k, (0.12 + shake * 2) * k);
      if (arms) {
        reach(W, model, 'L', H, ear, 0.16 + shake, 0.07, 0.4, -0.2, 1, k);
        reach(W, model, 'R', H, -ear, 0.16 - shake, 0.07, -0.4, -0.2, 1, k);
      }
      break;
    }
    case 'mourn':
    case 'weep': {
      // Head bowed, hands clasped low before the body, swaying a little; weeping, a hand comes up to the eyes.
      swing(W, BI.spine, 1, 0, 0, 0.07 * k, hips);
      swing(W, BI.spine, 0, 0, 1, Math.sin(ph * 0.55) * 0.025 * k, hips);
      turnHead(W, 0, (0.34 + Math.sin(ph * 0.8) * 0.03) * k);
      if (arms) {
        reach(W, model, 'L', C, 0.035, belly, 0.2, 1, -0.6, -0.3, k);
        if (g === 'weep') reach(W, model, 'R', H, -0.07 + Math.sin(ph * 3.1) * 0.025, 0.1, 0.24, -1, -0.5, 0.2, k);
        else reach(W, model, 'R', C, -0.035, belly, 0.2, -1, -0.6, -0.3, k);
      }
      break;
    }
    case 'listen': {
      // Nodding along, in spells.
      const spell = Math.max(0, Math.sin(ph * 0.9) - 0.2);
      turnHead(W, 0, Math.max(0, Math.sin(ph * 5.5)) * 0.16 * spell * k);
      break;
    }
    case 'stretch': {
      // Arms flung up and out, back arched, chin lifted.
      swing(W, BI.spine, 1, 0, 0, -0.1 * k, hips);
      swing(W, C, 1, 0, 0, -0.1 * k, hips);
      turnHead(W, 0, -0.25 * k);
      if (arms) {
        const out = 0.34 + Math.sin(ph * 1.3) * 0.04;
        reach(W, model, 'L', C, out, 0.7, -0.08, 1, 0, -0.4, k);
        reach(W, model, 'R', C, -out, 0.7, -0.08, -1, 0, -0.4, k);
      }
      break;
    }
    case 'brow': {
      // The back of the off hand drawn across the forehead.
      turnHead(W, 0, 0.1 * k);
      if (arms) reach(W, model, 'R', H, Math.sin(ph * 4.2) * 0.07 - 0.02, 0.2, 0.24, -1, -0.3, 0.3, k);
      break;
    }
    case 'scratch': {
      // A scratch at the back of the head, the head tipped toward the hand.
      swing(W, H, 0, 0, 1, 0.12 * k, hips);
      if (arms) reach(W, model, 'R', H, -ear * 0.75, headTop * 0.8 + Math.sin(ph * 9) * 0.02, -0.06, -1, 0.2, -0.3, k);
      break;
    }
    case 'hips': {
      // Hands on hips, chest out, a long look to either side.
      swing(W, C, 1, 0, 0, -0.06 * k, hips);
      turnHead(W, Math.sin(ph * 0.9) * 0.7 * k, 0);
      if (arms) {
        const hy = J.hips.y + 0.2 - J.chest.y, hx = Math.abs(J.thighL.x - J.hips.x) + 0.12;
        reach(W, model, 'L', C, hx, hy, 0.0, 1, 0, -0.9, k);
        reach(W, model, 'R', C, -hx, hy, 0.0, -1, 0, -0.9, k);
      }
      break;
    }
    case 'belly': {
      // A hand rubbing an empty belly, looking down at it.
      turnHead(W, 0, 0.2 * k);
      if (arms) reach(W, model, 'R', C, -0.02 + Math.sin(ph * 3.4) * 0.05, belly + Math.cos(ph * 3.4) * 0.04, 0.22, -1, -0.5, -0.2, k);
      break;
    }
    case 'yawn': {
      // Head back, a hand to the mouth, shoulders rising.
      swing(W, C, 1, 0, 0, -0.07 * k, hips);
      turnHead(W, 0, -0.28 * k);
      if (arms) reach(W, model, 'R', H, -0.03, 0.03, 0.26, -1, -0.5, 0.2, k);
      break;
    }
    case 'clap': {
      // A clapping game: hands meeting in front of the chest.
      const c = Math.abs(Math.sin(ph * 6.5)) * 0.11;
      turnHead(W, 0, -0.08 * k);
      if (arms) {
        reach(W, model, 'L', C, 0.02 + c, 0.02, 0.3, 1, -0.6, 0, k);
        reach(W, model, 'R', C, -0.02 - c, 0.02, 0.3, -1, -0.6, 0, k);
      }
      break;
    }
    case 'cheer': {
      // Both arms up, waving, face to the sky.
      turnHead(W, 0, -0.3 * k);
      if (arms) {
        const s = Math.sin(ph * 9) * 0.08;
        reach(W, model, 'L', C, 0.3 + s, 0.7, 0.02, 1, 0, -0.3, k);
        reach(W, model, 'R', C, -0.3 + s, 0.7, 0.02, -1, 0, -0.3, k);
      }
      break;
    }
  }
}

/** Trudging: the back rounded and the head hanging, `k` of the way (0..1). */
export function applySlump(W: THREE.Matrix4[], k: number): void {
  if (k <= 0.001) return;
  swing(W, BI.spine, 1, 0, 0, 0.1 * k, BI.hips);
  swing(W, BI.chest, 1, 0, 0, 0.09 * k, BI.hips);
  turnHead(W, 0, 0.24 * k);
}

// ---------------- What each islander carries from frame to frame ----------------

/** Per islander: the gesture showing and how far in, where the head and body are turned, and so on (all eased). */
export interface ActState {
  gesture: Gesture;
  g: number;
  look: number;
  yaw: number;
  ox: number;
  oz: number;
  hop: number;
  slump: number;
  /** The nearest other islander found by the last search, and which search that was. */
  near: Islander | null;
  stamp: number;
}

export function blankState(): ActState {
  return { gesture: 'none', g: 0, look: 0, yaw: 0, ox: 0, oz: 0, hop: 0, slump: 0, near: null, stamp: -1 };
}

/** Seconds to ease a gesture in or out. */
const GESTURE_FADE = 0.32;
const toward = (v: number, to: number, rate: number, dt: number) => v + (to - v) * Math.min(1, rate * dt);

/**
 * Ease an islander's carried state toward this frame's plan: a gesture fades out before the next
 * fades in, the body turns smoothly to face a friend, and a child running round in play is carried
 * off their spot and back without a jump. `heading` is the islander's own (the game's).
 */
export function easeActing(st: ActState, plan: ActPlan, isl: { x: number; z: number; heading: number }, dt: number): void {
  if (st.gesture !== plan.gesture) {
    st.g -= dt / GESTURE_FADE;
    if (st.g <= 0) { st.g = 0; st.gesture = plan.gesture; }
  } else if (st.gesture !== 'none') st.g = Math.min(1, st.g + dt / GESTURE_FADE);
  else st.g = 0;
  let yaw = 0, ox = 0, oz = 0;
  if (plan.chase) {
    const a0 = Math.atan2(isl.x - plan.ringX, isl.z - plan.ringZ), a = a0 + plan.ringA;
    ox = plan.ringX + Math.sin(a) * plan.ringR - isl.x;
    oz = plan.ringZ + Math.cos(a) * plan.ringR - isl.z;
    yaw = wrap(a + (plan.ringA >= 0 ? 1 : -1) * Math.PI / 2 - isl.heading);
    if (Math.abs(plan.ringA) < 1e-3) yaw = 0;
  } else if (plan.face && plan.look) {
    yaw = wrap(Math.atan2(plan.lookX - isl.x, plan.lookZ - isl.z) - isl.heading);
  }
  st.yaw += wrap(yaw - st.yaw) * Math.min(1, (plan.chase ? 9 : 4) * dt);
  st.yaw = wrap(st.yaw);
  st.ox = toward(st.ox, ox, 10, dt);
  st.oz = toward(st.oz, oz, 10, dt);
  st.hop = toward(st.hop, plan.hop, 5, dt);
  st.slump = toward(st.slump, plan.slump, 2.5, dt);
}

/** How far the head may turn to look at something (radians). */
const LOOK_MAX = 1.15;

/**
 * Turn the head toward the plan's look point (eased, and no further than a neck allows), on top
 * of whatever the clip has the head doing. `facing` is the heading the body is drawn at.
 */
export function applyLook(W: THREE.Matrix4[], st: ActState, plan: ActPlan, x: number, z: number, facing: number, dt: number): void {
  let want = 0;
  if (plan.look) {
    const dx = plan.lookX - x, dz = plan.lookZ - z;
    if (dx * dx + dz * dz > 1e-4) {
      const c = Math.cos(facing), s = Math.sin(facing);
      // Into the body's frame (it faces +z), then less whatever turn the head already has.
      const yaw = wrap(Math.atan2(dx * c - dz * s, dx * s + dz * c) - headYaw(W));
      // Someone straight behind is not craned at.
      want = Math.abs(yaw) > 2.4 ? 0 : THREE.MathUtils.clamp(yaw, -LOOK_MAX, LOOK_MAX);
    }
  }
  st.look = toward(st.look, want, 5, dt);
  if (Math.abs(st.look) > 0.004) turnHead(W, st.look, 0);
}
