import * as THREE from 'three';
import { SHADOW_LAYER } from '../render/ShadowLayer';
import { characterModelKey, isElder, type CharacterModelKey } from './CharacterVariants';
import { View } from '../render/View';
import { ISLANDER } from '../config';
import { peopleMaterial, peopleSkinnedMaterial } from '../render/materials';
import { Islander } from './Islander';
import { PartKey, SKELETON, Skeleton, buildPeopleParts } from './PeopleModels';
import { BI, BONE_COUNT, GlbModel, loadGlbPeople } from './glbPeople';
import { CarryPose } from './CarryPose';

/** World units per metre: islanders are modelled at ~1.8 m and stand ~0.62 units tall. */
const S0 = 0.62 / 1.8;

/**
 * Joint angles for one frame of animation (radians; metres for offsets). Conventions:
 * negative thigh / upper-arm X swings forward (upper arm -π is straight up), positive shin X
 * bends the knee, negative forearm X bends the elbow, positive wrist X cocks the hand back,
 * positive foot offset points the toes down (0 keeps the foot flat on the ground), positive
 * lean / hipPitch bend forward, negative headX looks up. "L" is the -x side, "R" the +x side
 * (which holds the tool).
 */
interface Pose {
  drop: number;
  bob: number;
  lean: number;
  twist: number;
  headX: number;
  headY: number;
  headZ: number;
  thL: number;
  thR: number;
  shL: number;
  shR: number;
  uaLx: number;
  uaLz: number;
  uaRx: number;
  uaRz: number;
  faL: number;
  faR: number;
  /** Hip rotation (yaw) and side-to-side sway (roll); the shoulders counter-rotate. */
  hipYaw: number;
  roll: number;
  /** Pelvis tilt forward (a hinge at the hips), extra bend in the lower back and upper chest. */
  hipPitch: number;
  spineX: number;
  chestX: number;
  wrLx: number;
  wrLz: number;
  wrRx: number;
  wrRz: number;
  ftL: number;
  ftR: number;
  /** Legs apart (each thigh out to the side). */
  spread: number;
  /** Shoulder lift (clavicle) per side. */
  shrugL: number;
  shrugR: number;
  /** How firmly each foot is planted (1 = flat on the ground; 0 = swinging, hanging from the shin). */
  plantL: number;
  plantR: number;
  lying: boolean;
  flatBed: boolean;
}

const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const tri = (s: number) => (s < 0.7 ? s / 0.7 : 1 - (s - 0.7) / 0.3);
const ease = (x: number) => x * x * (3 - 2 * x);
const pos = (x: number) => Math.max(0, x);

function blankPose(): Pose {
  return {
    drop: 0, bob: 0, lean: 0, twist: 0, headX: 0, headY: 0, headZ: 0, thL: 0, thR: 0, shL: 0.05, shR: 0.05,
    uaLx: 0, uaLz: 0.16, uaRx: 0, uaRz: 0.16, faL: -0.14, faR: -0.14, hipYaw: 0, roll: 0, hipPitch: 0, spineX: 0, chestX: 0,
    wrLx: 0.08, wrLz: 0, wrRx: 0.08, wrRz: 0, ftL: 0, ftR: 0, spread: 0, shrugL: 0, shrugR: 0, plantL: 1, plantR: 1, lying: false, flatBed: false,
  };
}

/** A walking stride: legs, knees, ankles, hips and the arm swing that goes with them. */
function stride(p: Pose, ph: number, amp: number, knee: number, stance: number, armK: number): void {
  const s = Math.sin(ph), c = Math.cos(ph);
  // Thigh swings (L = -x side leads when s < 0).
  p.thL = s * amp;
  p.thR = -s * amp;
  // Knee: folds most as the leg passes forward (mid-swing), with a small give at heel strike.
  p.shL = stance + Math.pow(pos(-c), 1.4) * knee + pos(-s) * pos(c) * stance * 1.5;
  p.shR = stance + Math.pow(pos(c), 1.4) * knee + pos(s) * pos(-c) * stance * 1.5;
  // A foot is planted while its leg sweeps back under the body (c > 0 for L) and swings through
  // the air otherwise: planted, it lies flat on the ground; swinging, it hangs from the shin, so
  // the boot follows the leg instead of jutting out level behind it.
  p.plantL = smooth01((c + 0.3) / 0.35);
  p.plantR = smooth01((-c + 0.3) / 0.35);
  // Ankles: toe up reaching forward for the heel strike, rolling onto the toe (toe down) behind.
  p.ftL = 0.42 * pos(s - 0.25) * p.plantL - 0.2 * pos(-s) * (1 - p.plantL * 0.6) + 0.12 * (1 - p.plantL);
  p.ftR = 0.42 * pos(-s - 0.25) * p.plantR - 0.2 * pos(s) * (1 - p.plantR * 0.6) + 0.12 * (1 - p.plantR);
  // Hips swing with the leading leg and drop on the swing side; shoulders counter-rotate.
  p.hipYaw = -s * 0.17 * (amp / 0.5);
  p.roll = c * 0.06;
  p.hipPitch = 0.05;
  // Arms swing against the legs, the elbow bending more on the forward swing.
  p.uaLx = -p.thL * armK;
  p.uaRx = -p.thR * armK;
  p.faL = -0.3 - pos(-p.uaLx) * 0.75;
  p.faR = -0.3 - pos(-p.uaRx) * 0.75;
  p.wrLx = p.wrRx = -0.1;
  p.uaLz = p.uaRz = 0.18;
  // The head stays steady against the body's bounce.
  p.headX = -0.04 - Math.sin(ph * 2) * 0.03;
}

/**
 * The pose an islander is shown in: warriors standing about are on guard, and with a foe in
 * reach they fight; children at a loose end crouch to play now and then. (Their task's own anim
 * is unchanged; this is only how they look.)
 */
export function shownAnim(isl: Islander): Islander['anim'] {
  if (isl.warrior && !isl.hidden && !isl.child) {
    if (isl.foe && (isl.anim === 'idle' || isl.anim === 'walk' || isl.anim === 'run')) return 'attack';
    if (isl.anim === 'idle') return 'guard';
  }
  if (isl.child && isl.anim === 'idle' && Math.sin(isl.animT * 0.12 + isl.id * 1.7) > 0.25) return 'play';
  return isl.anim;
}

/** Procedural animation for every islander activity. */
export function poseFor(isl: Islander, female: boolean, skel?: Skeleton): Pose {
  const t = isl.animT;
  const p = blankPose();
  const sk = skel ?? SKELETON[female ? 'f' : 'm'];
  // Bed care is authoritative even if a previous walking animation is still set.
  if (isl.task?.kind === 'heal' && isl.task.phase === 1 && isl.task.stage === 3 && (isl.task.slot ?? -1) >= 0 && isl.condition !== 'well') {
    p.lying = true; p.flatBed = true;
    p.thL = p.thR = p.shL = p.shR = 0;
    p.uaLz = p.uaRz = 0.06; p.faL = p.faR = -0.08;
    p.bob = Math.sin(t * 1.2) * 0.002;
    return p;
  }
  switch (shownAnim(isl)) {
    case 'idle': {
      // Breathing, a slow weight shift onto one hip, relaxed arms, looking around.
      const br = Math.sin(t * 1.7);
      const shift = Math.sin(t * 0.43);
      p.chestX = -br * 0.025;
      p.shrugL = p.shrugR = br * 0.02;
      p.bob = br * 0.004;
      p.roll = shift * 0.045;
      p.hipYaw = shift * 0.05;
      p.thL = -0.04 + shift * 0.04;
      p.thR = 0.05 - shift * 0.04;
      p.shL = 0.06 + pos(shift) * 0.2;
      p.shR = 0.06 + pos(-shift) * 0.2;
      p.spread = 0.03;
      p.uaLx = Math.sin(t * 1.1) * 0.06;
      p.uaRx = -Math.sin(t * 1.1) * 0.06;
      p.faL = -0.18 + Math.sin(t * 0.9) * 0.05;
      p.faR = -0.2 - Math.sin(t * 0.8) * 0.05;
      p.headY = Math.sin(t * 0.37) * 0.5;
      p.headX = Math.sin(t * 0.23) * 0.08;
      p.twist = Math.sin(t * 0.37) * 0.1;
      break;
    }
    case 'walk': {
      // The healer walks at half the villagers' pace, so its stride cadence follows that pace.
      stride(p, t * 7.5 * (isl.npc === 'healer' ? isl.speed / ISLANDER.walkSpeed : 1), 0.36, 0.72, 0.08, 0.9);
      p.lean = 0.06;
      if (isElder(isl) && !isl.carry && isl.tool === 'none') {
        // Elders: a shorter, stooped step, leaning on a staff planted ahead with each stride.
        stride(p, t * 6.2, 0.28, 0.6, 0.12, 0.5);
        p.lean = 0.16; p.hipPitch = 0.1; p.headX = -0.12;
        p.uaRx = -0.45 + Math.sin(t * 6.2) * 0.12; p.uaRz = 0.2; p.faR = -0.55; p.wrRx = 0.1;
      }
      break;
    }
    case 'carry': {
      // Base gait; drawSkinned solves the final hand contacts against each load's mesh.
      const kind = isl.carry?.kind;
      stride(p, t * 6.8, 0.34, 0.66, 0.12, 0.8);
      p.lean = 0.02;
      p.roll *= 1.4;
      if (kind === 'log') {
        // Log across the shoulders: both hands up beside the head holding it, elbows out.
        p.uaLx = p.uaRx = -2.35;
        p.uaLz = p.uaRz = 0.62;
        p.faL = p.faR = -1.75;
        p.wrLx = p.wrRx = 0.35;
        p.lean = 0.12;
        p.headX = 0.12;
      } else if (kind === 'chicken') {
        // Bird tucked under the right arm; the left arm swings.
        p.uaRx = -0.15;
        p.uaRz = 0.4;
        p.faR = -1.45;
        p.wrRx = -0.3;
      } else {
        // Load balanced on the head: both arms up steadying it, elbows bent, hands flat.
        p.uaLx = p.uaRx = -2.7 + Math.sin(t * 6.8) * 0.05;
        p.uaLz = p.uaRz = 0.32;
        p.faL = p.faR = -0.7;
        p.wrLx = p.wrRx = 0.55;
        p.headX = 0.02;
      }
      break;
    }
    case 'run': {
      const ph = t * 11;
      stride(p, ph, 0.72, 1.45, 0.16, 1.0);
      p.faL = p.faR = -1.35;
      p.faL -= pos(-p.uaLx) * 0.3;
      p.faR -= pos(-p.uaRx) * 0.3;
      p.wrLx = p.wrRx = -0.2;
      p.lean = 0.22;
      p.hipPitch = 0.1;
      p.hipYaw *= 1.2;
      p.roll = Math.cos(ph) * 0.05;
      // Both feet off the ground for a moment each stride.
      p.bob = pos(Math.sin(ph * 2)) * 0.05;
      break;
    }
    case 'chop':
    case 'mine': {
      const mine = isl.anim === 'mine';
      const s = (t * (mine ? 1.05 : 1.35)) % 1;
      // Slow wind-up overhead, a fast strike, then the follow-through settles.
      const k = s < 0.6 ? ease(s / 0.6) : s < 0.72 ? 1 - Math.pow((s - 0.6) / 0.12, 2) : 0;
      const hit = s > 0.7 && s < 0.9 ? Math.sin(((s - 0.7) / 0.2) * Math.PI) : 0;
      p.uaLx = p.uaRx = -0.55 - k * 2.4;
      p.uaLz = p.uaRz = -0.26 + k * 0.2;
      p.faL = p.faR = -0.22 - k * 0.7;
      p.wrLx = p.wrRx = k * 0.6 - hit * 0.35;
      // Arch back and turn to the tool side on the wind-up; drive down and forward through the strike.
      p.lean = (mine ? 0.2 : 0.08) + (1 - k) * (mine ? 0.34 : 0.26) - k * 0.14 + hit * 0.06;
      p.hipPitch = 0.06 + (1 - k) * (mine ? 0.16 : 0.1);
      p.twist = (k - 0.4) * 0.4;
      p.hipYaw = (k - 0.4) * 0.12;
      p.spread = 0.07;
      p.thL = -0.3;
      p.thR = 0.2;
      p.shL = 0.3 + (1 - k) * 0.22 + hit * 0.1;
      p.shR = 0.22 + (1 - k) * 0.16 + hit * 0.08;
      p.ftR = 0.12;
      p.headX = -k * 0.35 + (1 - k) * 0.3;
      p.drop = 0.03;
      break;
    }
    case 'farm': {
      // Hoeing: hinged at the hips, knees flexed, arms swinging the hoe down in an arc.
      const ph = t * 3.2;
      const k = Math.sin(ph) * 0.5 + 0.5;
      p.uaLx = p.uaRx = -0.75 - k * 1.55;
      p.uaLz = p.uaRz = -0.2;
      p.faL = p.faR = -0.4 - k * 0.7;
      p.wrLx = p.wrRx = k * 0.35 - (1 - k) * 0.2;
      p.hipPitch = 0.25 + (1 - k) * 0.08;
      p.lean = 0.32 + (1 - k) * 0.22;
      p.twist = (k - 0.5) * 0.18;
      p.headX = 0.25;
      p.spread = 0.06;
      p.thL = -0.5;
      p.shL = 0.7;
      p.thR = 0.1;
      p.shR = 0.45;
      p.drop = 0.1;
      break;
    }
    case 'harvest': {
      const ph = t * 4;
      if (isl.reachHigh) {
        // Up on tiptoe, reaching into the branches with alternating hands.
        p.uaLx = -2.75 + Math.sin(ph) * 0.2;
        p.uaRx = -2.55 + Math.cos(ph) * 0.25;
        p.uaLz = p.uaRz = 0.1;
        p.faL = -0.3 - pos(Math.sin(ph)) * 0.5;
        p.faR = -0.3 - pos(Math.cos(ph)) * 0.5;
        p.wrLx = p.wrRx = -0.3;
        p.headX = -0.45;
        p.chestX = -0.08;
        const tip = pos(Math.sin(ph * 0.5));
        p.ftL = p.ftR = 0.35 + tip * 0.35;
        p.bob = tip * 0.03;
      } else {
        // Squatting low, reaching down and forward to pick, weight rocking side to side.
        const k = Math.sin(ph * 0.6) * 0.5 + 0.5;
        p.thL = p.thR = -1.25 - k * 0.15;
        p.shL = p.shR = 1.9 + k * 0.2;
        p.spread = 0.12;
        p.hipPitch = 0.3;
        p.lean = 0.45 + k * 0.15;
        p.roll = Math.sin(ph * 0.3) * 0.05;
        p.uaLx = -1.05 + Math.sin(ph) * 0.3;
        p.uaRx = -1.05 - Math.sin(ph) * 0.3;
        p.uaLz = p.uaRz = 0.12;
        p.faL = -0.5 - pos(Math.sin(ph)) * 0.4;
        p.faR = -0.5 - pos(-Math.sin(ph)) * 0.4;
        p.wrLx = p.wrRx = -0.35;
        p.headX = 0.25;
        p.drop = 0.12;
      }
      break;
    }
    case 'fish': {
      // Down on one knee at the water's edge, watching, then the spear stabs down two-handed.
      const s = (t * 0.55) % 1;
      const k = s < 0.75 ? ease(s / 0.75) * 0.25 : 0.25 + Math.sin(((s - 0.75) / 0.25) * Math.PI) * 0.75;
      p.thL = -1.35; p.shL = 1.55; p.thR = 0.3; p.shR = 1.95; p.ftR = 1.0;
      p.drop = 0.22; p.hipPitch = 0.2; p.lean = 0.35 + k * 0.25;
      p.uaLx = -1.65 + k * 0.85; p.uaLz = 0.05; p.faL = -0.7 + k * 0.45; p.wrLx = 0.6;
      p.uaRx = -1.35 + k * 0.7; p.uaRz = 0.25; p.faR = -0.9 + k * 0.4; p.wrRx = 0.3;
      p.twist = 0.15; p.headX = 0.45 - k * 0.1;
      break;
    }
    case 'build': {
      // Down on one knee, hammering with the right hand, steadying the work with the left.
      const ph = t * 9;
      const hit = Math.sin(ph);
      p.thL = -1.4;
      p.shL = 1.5;
      p.thR = 0.35;
      p.shR = 1.95;
      p.ftR = 1.0;
      p.hipPitch = 0.15;
      p.lean = 0.35;
      p.uaRx = -1.35 + hit * 0.6;
      p.faR = -0.95 + hit * 0.45;
      p.wrRx = pos(hit) * 0.4 - pos(-hit) * 0.3;
      p.uaLx = -0.95;
      p.uaLz = 0.05;
      p.faL = -0.9;
      p.twist = 0.12;
      p.headX = 0.35;
      p.drop = 0.22;
      break;
    }
    case 'pray': {
      // Kneeling back on the heels, arms raised, bowing slowly to the ground and up again.
      const ph = t * 0.9;
      const bow = Math.sin(ph) * 0.5 + 0.5;
      p.drop = sk.hipY - sk.thigh - 0.07;
      p.thL = p.thR = 0.05 - bow * 0.3;
      p.shL = p.shR = 1.55 + bow * 0.3;
      p.ftL = p.ftR = 1.35;
      p.hipPitch = bow * 0.35;
      p.uaLx = p.uaRx = -2.6 + bow * 0.4;
      p.uaLz = p.uaRz = 0.35;
      p.faL = p.faR = -0.2 - bow * 0.3;
      p.wrLx = p.wrRx = -0.3;
      p.lean = 0.1 + bow * 0.55;
      p.headX = -0.2 + bow * 0.4;
      break;
    }
    case 'wave': {
      // Looking up at the player, leaning back a touch, one arm high and waving from the elbow and wrist.
      const ph = t * 8.5;
      p.headX = -0.62;
      p.lean = -0.08;
      p.chestX = -0.06;
      p.uaRx = -2.75 + Math.sin(ph * 0.5) * 0.08;
      p.uaRz = -0.55;
      p.faR = -0.35 + Math.sin(ph) * 0.5;
      p.wrRz = Math.sin(ph) * 0.3;
      p.shrugR = 0.05;
      p.uaLx = -0.15;
      p.uaLz = 0.14;
      p.faL = -0.3;
      p.roll = -0.04;
      p.shL = 0.18;
      p.bob = pos(Math.sin(ph * 0.5)) * 0.012;
      break;
    }
    case 'sit': {
      // On a bench: thighs level, shins down, hands resting on the knees; breathing, glancing about.
      p.thL = p.thR = -1.5;
      p.shL = p.shR = 1.45;
      p.spread = 0.04;
      p.ftL = p.ftR = 0.05;
      p.uaLx = p.uaRx = -0.32;
      p.uaLz = p.uaRz = 0.1;
      p.faL = p.faR = -1.05;
      p.wrLx = p.wrRx = -0.15;
      p.spineX = 0.04 + Math.sin(t * 0.9) * 0.015;
      p.headY = Math.sin(t * 0.23 + isl.id) * 0.35;
      p.headX = 0.05 + Math.sin(t * 0.31 + isl.id * 2) * 0.06;
      p.bob = Math.sin(t * 1.8) * 0.003;
      break;
    }
    case 'eat': {
      const ph = t * 3;
      const bite = pos(Math.sin(ph));
      p.uaRx = -0.75 + bite * -0.2;
      p.faR = -1.75 - bite * 0.2;
      p.wrRx = -0.4;
      p.uaRz = -0.15;
      p.uaLx = -0.4;
      p.faL = -1.05;
      p.wrLx = -0.2;
      p.headX = 0.12 - bite * 0.1;
      p.chestX = 0.04;
      p.bob = Math.sin(t * 2) * 0.004;
      p.shL = 0.15;
      break;
    }
    case 'dance': {
      const beat = t * 4.4 + isl.id * 0.8;
      p.bob = Math.abs(Math.sin(beat)) * 0.045;
      p.hipYaw = Math.sin(beat * 0.5) * 0.20;
      p.roll = Math.sin(beat) * 0.06;
      p.thL = Math.max(0, Math.sin(beat)) * -0.22;
      p.thR = Math.max(0, -Math.sin(beat)) * -0.22;
      p.shL = Math.max(0, Math.sin(beat)) * 0.30;
      p.shR = Math.max(0, -Math.sin(beat)) * 0.30;
      p.uaLx = -0.6 + Math.sin(beat * 0.5) * 0.25;
      p.uaRx = -0.6 - Math.sin(beat * 0.5) * 0.25;
      p.uaLz = p.uaRz = 0.45;
      p.faL = p.faR = -0.9;
      p.headY = Math.sin(beat * 0.5) * 0.12;
      break;
    }
    case 'guard': {
      // Braced on guard: feet apart, knees soft, weight forward, looking about.
      const br = Math.sin(t * 1.6);
      p.spread = 0.09; p.thL = -0.28; p.thR = 0.18; p.shL = 0.32; p.shR = 0.26; p.ftR = 0.12;
      p.lean = 0.07; p.hipPitch = 0.05; p.drop = 0.03; p.bob = br * 0.004;
      p.headY = Math.sin(t * 0.5) * 0.45;
      if (isl.warrior === 'eagle') {
        // Bow held low across the body in the off hand, the draw hand resting on the string.
        p.uaLx = -0.55; p.uaLz = 0.2; p.faL = -0.55; p.wrLx = 0;
        p.uaRx = -0.6; p.uaRz = -0.1; p.faR = -1.3; p.twist = -0.15;
      } else {
        // Shield raised before the chest, spear upright at the side.
        p.uaLx = -1.05 + br * 0.03; p.uaLz = 0.42; p.faL = -1.45; p.wrLx = 0.1;
        p.uaRx = -0.25; p.uaRz = 0.12; p.faR = -1.25; p.wrRx = -0.2; p.twist = 0.12;
      }
      break;
    }
    case 'attack': {
      p.spread = 0.1; p.ftR = 0.15;
      if (isl.warrior === 'eagle') {
        // Side-on stance: bow arm straight out, the string drawn back to the cheek, then loosed.
        const s = (t * 0.8) % 1, draw = s < 0.65 ? ease(s / 0.65) : 1 - ease((s - 0.65) / 0.35);
        p.twist = -0.55; p.hipYaw = -0.25; p.headY = 0.5; p.lean = 0.04;
        p.thL = -0.3; p.thR = 0.3; p.shL = 0.2; p.shR = 0.18;
        p.uaLx = -1.5; p.uaLz = 0.05; p.faL = -0.05; p.wrLx = 0;
        p.uaRx = -1.45; p.uaRz = -0.15 - draw * 0.55; p.faR = -0.6 - draw * 1.6; p.wrRx = 0.1;
        p.chestX = -draw * 0.04;
      } else {
        // A javelin throw: shield forward, spear drawn back overhead, then hurled with a lunge.
        const s = (t * 0.7) % 1, k = tri(s);
        p.uaRx = -2.75 + k * 1.55; p.uaRz = 0.15; p.faR = -0.35 - (1 - k) * 0.65; p.wrRx = k * 0.35;
        p.uaLx = -1.2; p.uaLz = 0.5; p.faL = -1.35;
        p.lean = 0.05 + k * 0.3; p.twist = (1 - k) * 0.4 - 0.1; p.hipYaw = (1 - k) * 0.15;
        p.thL = 0.25 - k * 0.1; p.thR = -0.45 + k * 0.15; p.shL = 0.15; p.shR = 0.45 + k * 0.1;
        p.drop = 0.04 + k * 0.03; p.headX = 0.05;
      }
      break;
    }
    case 'play': {
      // Crouched low, scattering grain or poking at the ground, bobbing on the heels.
      const ph = t * 3.5;
      p.thL = p.thR = -1.35; p.shL = p.shR = 2.0; p.spread = 0.14; p.hipPitch = 0.25;
      p.lean = 0.4 + Math.sin(ph * 0.5) * 0.06; p.drop = 0.12;
      p.uaLx = -1.1 + Math.sin(ph) * 0.35; p.uaRx = -0.95; p.uaLz = p.uaRz = 0.15;
      p.faL = -0.45 - pos(Math.sin(ph)) * 0.5; p.faR = -0.7; p.wrLx = p.wrRx = -0.3;
      p.headX = 0.3; p.headY = Math.sin(t * 0.7) * 0.3; p.bob = pos(Math.sin(ph)) * 0.01;
      break;
    }
    case 'sleep':
      // Curled on the side a little, knees drawn up, breathing slowly.
      p.lying = true;
      p.uaLz = p.uaRz = 0.18;
      p.uaLx = -0.6;
      p.faL = p.faR = -0.9;
      p.thL = -0.55;
      p.thR = -0.35;
      p.shL = 0.9;
      p.shR = 0.7;
      p.ftL = p.ftR = 0.3;
      p.chestX = Math.sin(t * 1.2) * 0.03;
      p.bob = Math.sin(t * 1.2) * 0.004;
      break;
  }
  return p;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
/**
 * About one adult in five wears the elder look. Taken from the islander's id, so it needs no saving
 * and never changes; it is only a look (nobody ages).
 */
export { isElder };
/** Whether the children's models are loaded (else children are drawn as small founding islanders). */
const hasChildModel = (skins: Partial<Record<CharacterModelKey, unknown>> | undefined) => !!skins?.boy && !!skins?.girl;
/** Built-in body parts, no longer drawn (the character models are the bodies). */
const BODY = new Set<string>(['pelvis', 'chest', 'head', 'uarm', 'farm', 'thigh', 'shin'].flatMap((b) => [`${b}_m`, `${b}_f`]));
const TOOLS = ['axe', 'pick', 'hoe', 'spear', 'hammer'] as const;
const LOADS: Record<string, PartKey> = { log: 'log', stone: 'stone', fruit: 'basket', grain: 'sack', herbs: 'basket', fish: 'fish', meat: 'meat', chicken: 'chicken' };
/** Ankle height (metres) the planted foot keeps, and the knee's radius when kneeling. */
const FOOT_H = 0.1;
/** Seconds to blend from one activity's pose into the next, and the pose values that blend. */
const BLEND = 0.22;
const BLEND_KEYS = ['drop', 'bob', 'lean', 'twist', 'headX', 'headY', 'headZ', 'thL', 'thR', 'shL', 'shR', 'uaLx', 'uaLz', 'uaRx', 'uaRz', 'faL', 'faR',
  'hipYaw', 'roll', 'hipPitch', 'spineX', 'chestX', 'wrLx', 'wrLz', 'wrRx', 'wrRz', 'ftL', 'ftR', 'spread', 'shrugL', 'shrugR', 'plantL', 'plantR'] as const;
const KNEE_R = 0.06;

/** One character model drawn with GPU skinning: every islander of that model in one draw. */
interface SkinSet {
  model: GlbModel;
  mesh: THREE.InstancedMesh;
  accent: THREE.InstancedBufferAttribute;
  /** Per islander: elder hair (0 or 1), its tone, and whether to hide the beard (boys). */
  look: THREE.InstancedBufferAttribute;
  tex: THREE.DataTexture;
  data: Float32Array;
  /** Rows (islanders) the bone texture holds: grown by doubling, so each frame uploads little. */
  rows: number;
  n: number;
}

/**
 * Articulated islanders: the two character models (the main male and female), each a smoothly
 * skinned body on a 19-bone skeleton (hips, spine, chest, neck, head, shoulders, elbows, wrists,
 * knees, ankles) posed every frame, with its feet kept on the ground; all islanders of a model are
 * one instanced draw. Tools, headdresses and carried loads ride on the posed hands, head and chest.
 */
export class IslanderRig {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private accents = new Map<string, THREE.InstancedBufferAttribute>();
  private count = new Map<string, number>();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private m = {
    base: new THREE.Matrix4(),
    pelvis: new THREE.Matrix4(),
    chest: new THREE.Matrix4(),
    head: new THREE.Matrix4(),
    ua: new THREE.Matrix4(),
    fa: new THREE.Matrix4(),
    th: new THREE.Matrix4(),
    sh: new THREE.Matrix4(),
    out: new THREE.Matrix4(),
  };
  /** Posed bone frames for the islander being drawn (model space, metres). */
  private W = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
  private skins: Partial<Record<CharacterModelKey, SkinSet>> = {};
  private carryPose: CarryPose;
  private skin = new THREE.Color();
  private accent = new THREE.Color();
  readonly ring: THREE.Mesh;
  private groupRings: THREE.InstancedMesh;
  /**
   * Beyond this distance from the camera an islander is only a few pixels tall: drawn as a simple
   * figure (body in their cloth colour, head in their skin tone) instead of the jointed model.
   * Set each frame from the screen size (see Game); Infinity draws everyone in full.
   */
  lodDist = Infinity;
  private pawnBody: THREE.InstancedMesh;
  private pawnHead: THREE.InstancedMesh;
  /** Shadow-only stand-ins for the islanders drawn in full (a few dozen triangles each, not thousands). */
  private shadowBody: THREE.InstancedMesh;
  private shadowHead: THREE.InstancedMesh;

  constructor() {
    // Props (tools, headdresses, carried loads); the bodies are the two character models.
    const parts = buildPeopleParts();
    this.carryPose = new CarryPose(parts);
    for (const [key, geo] of Object.entries(parts) as [PartKey, THREE.BufferGeometry][]) {
      if (BODY.has(key)) geo.dispose();
      else this.addMesh(key, geo, ISLANDER.max);
    }
    loadGlbPeople()
      .then((glb) => {
        for (const g of Object.keys(glb) as CharacterModelKey[]) this.skins[g] = this.makeSkin(glb[g]);
      })
      .catch((err) => console.error('Islander models failed to load.', err));
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9, depthWrite: false })
    );
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.group.add(this.ring);
    this.groupRings = new THREE.InstancedMesh(this.ring.geometry, this.ring.material, ISLANDER.max);
    this.groupRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.groupRings.count = 0;
    this.groupRings.frustumCulled = false;
    this.groupRings.renderOrder = 5;
    this.group.add(this.groupRings);
    // The far figure, in model metres like the character models (1.8 m tall, stocky).
    const pawnMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const pawn = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, pawnMat, ISLANDER.max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    this.pawnBody = pawn(new THREE.CylinderGeometry(0.3, 0.32, 1.2, 6).translate(0, 0.6, 0));
    this.pawnHead = pawn(new THREE.IcosahedronGeometry(0.3, 0).translate(0, 1.45, 0));
    this.shadowBody = pawn(this.pawnBody.geometry);
    this.shadowHead = pawn(this.pawnHead.geometry);
    for (const m of [this.shadowBody, this.shadowHead]) m.layers.set(SHADOW_LAYER);
  }

  private addMesh(key: string, geo: THREE.BufferGeometry, cap: number): void {
    const acc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    acc.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAccent', acc);
    const mesh = new THREE.InstancedMesh(geo, peopleMaterial(), cap);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.meshes.set(key, mesh);
    this.accents.set(key, acc);
    this.group.add(mesh);
  }

  private makeSkin(model: GlbModel): SkinSet {
    const cap = ISLANDER.max;
    const rows = 32;
    const data = new Float32Array(BONE_COUNT * 16 * rows);
    const tex = new THREE.DataTexture(data, BONE_COUNT * 4, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const { mat, depth } = peopleSkinnedMaterial(tex, model.map, model.skinUv);
    const geo = model.geometry;
    const accent = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    accent.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAccent', accent);
    const look = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    look.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iLook', look);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.customDepthMaterial = depth;
    // Its shadow comes from the simple stand-in figure (see shadowBody), not this detailed body.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(mesh);
    return { model, mesh, accent, look, tex, data, rows, n: 0 };
  }

  private rot(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder = 'XYZ', s = 1): THREE.Matrix4 {
    this.e.set(rx, ry, rz, order);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(s, s, s);
    return out.compose(this.v, this.q, this.s);
  }

  /** out = parent × T(x, y, z) × R(rx, ry, rz). */
  private child(out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder = 'XYZ', s = 1): void {
    out.multiplyMatrices(parent, this.rot(this.tmp, x, y, z, rx, ry, rz, order, s));
  }

  /** Write one instance of a part (packed), with skin tone and accent colour. */
  private put(key: string, m: THREE.Matrix4): void {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    const i = this.count.get(key) ?? 0;
    if (i >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, this.skin);
    this.accents.get(key)?.setXYZ(i, this.accent.r, this.accent.g, this.accent.b);
    this.count.set(key, i + 1);
  }

  /**
   * Pose the full skeleton (model space, metres). The pelvis height comes from the legs: it sits
   * so the lower foot's ankle (or a kneeling knee) rests on the ground, so crouches, lunges and
   * strides stay planted without hand-tuned drops.
   */
  private poseSkeleton(model: GlbModel, p: Pose, headScale: number, groundL = 0, groundR = 0): void {
    const J = model.joint, L = model.len, W = this.W;
    const hips = J.hips;
    if (p.lying) {
      this.rot(W[BI.hips], 0, 0.16 + p.bob, 0.35, -Math.PI / 2, 0, p.flatBed ? 0 : 0.3);
    } else {
      const hipDY = J.thighL.y - hips.y;
      // Each foot stands on the ground under it (groundL / groundR: its height above the body's
      // spot, on slopes and steps). The hips sit where no leg dips below its ground; then a planted
      // foot left hanging above lower ground lets the hips settle a little, the other knee bending
      // to keep its foot on its own ground (two-bone IK in the leg's swing plane).
      // The hip sway (roll) lifts one hip joint and drops the other; the legs splay a little outward.
      const hx = Math.abs(J.thighL.x - hips.x), splay = Math.cos(0.05 + p.spread);
      const legs = [[p.thL, p.shL, groundL, p.plantL, -hx * Math.sin(p.roll)], [p.thR, p.shR, groundR, p.plantR, hx * Math.sin(p.roll)]] as const;
      const ankle = (a: number, k: number) => (-L.thigh * Math.cos(a) - L.shin * Math.cos(a + k)) * splay;
      let need = -Infinity;
      for (const [th, sh, gnd, , lift] of legs) {
        const a = p.hipPitch + th;
        need = Math.max(need, Math.max(FOOT_H + gnd - ankle(a, sh), KNEE_R + gnd + L.thigh * Math.cos(a) * splay) - hipDY - lift);
      }
      let settle = 0;
      for (const [th, sh, gnd, plant, lift] of legs) {
        const gap = need + hipDY + lift + ankle(p.hipPitch + th, sh) - (FOOT_H + gnd);
        // Only the difference in ground height between the feet (on flat ground the stride's own shape stands).
        if (plant > 0.5 && gap > 0.003) settle = Math.max(settle, Math.min(gap, Math.abs(groundL - groundR), 0.16));
      }
      need -= settle;
      for (const side of [0, 1] as const) {
        const [th, sh, gnd, , lift] = legs[side], a = p.hipPitch + th;
        // How far below the hip joint this foot's ankle must be, and the knee bend that gives it.
        const reach = need + hipDY + lift - (FOOT_H + gnd);
        if (ankle(a, sh) >= -reach) continue;
        const c = THREE.MathUtils.clamp((reach / splay - L.thigh * Math.cos(a)) / L.shin, -1, 1);
        const k = Math.max(sh, Math.acos(c) - a);
        if (side === 0) p.shL = k; else p.shR = k;
      }
      this.rot(W[BI.hips], 0, need + p.bob, 0, p.hipPitch, p.twist * 0.4 + p.hipYaw, p.roll, 'YXZ');
    }
    // Torso: the bend and counter-twist spread over the lower back and chest.
    const tw = (p.twist - p.hipYaw * 1.9) * 0.5;
    this.child(W[BI.spine], W[BI.hips], J.spine.x - hips.x, J.spine.y - hips.y, J.spine.z - hips.z, p.lean * 0.55 + p.spineX, tw, -p.roll * 0.6, 'YXZ');
    this.child(W[BI.chest], W[BI.spine], J.chest.x - J.spine.x, J.chest.y - J.spine.y, J.chest.z - J.spine.z, p.lean * 0.45 + p.chestX, tw, -p.roll * 0.7, 'YXZ');
    this.child(W[BI.neck], W[BI.chest], J.neck.x - J.chest.x, J.neck.y - J.chest.y, J.neck.z - J.chest.z, p.headX * 0.4, p.headY * 0.35, p.headZ * 0.4, 'YXZ');
    this.child(W[BI.head], W[BI.neck], J.head.x - J.neck.x, J.head.y - J.neck.y, J.head.z - J.neck.z, p.headX * 0.6, p.headY * 0.65, p.headZ * 0.6, 'YXZ', headScale);
    // Arms (L = -x side = the model's .R bones) and legs.
    for (const side of [-1, 1] as const) {
      const L_ = side < 0;
      const b = L_ ? 'R' : 'L';
      const sh = BI[`shoulder${b}`], ua = BI[`upper_arm${b}`], fa = BI[`forearm${b}`], hd = BI[`hand${b}`];
      const jS = J[`shoulder${b}`], jU = J[`upper_arm${b}`];
      const shrug = L_ ? p.shrugL : p.shrugR;
      this.child(W[sh], W[BI.chest], jS.x - J.chest.x, jS.y - J.chest.y, jS.z - J.chest.z, 0, 0, side * shrug);
      this.child(W[ua], W[sh], jU.x - jS.x, jU.y - jS.y, jU.z - jS.z, L_ ? p.uaLx : p.uaRx, 0, side * (L_ ? p.uaLz : p.uaRz));
      this.child(W[fa], W[ua], 0, -L.upper, 0, L_ ? p.faL : p.faR, 0, 0);
      this.child(W[hd], W[fa], 0, -L.fore, 0, L_ ? p.wrLx : p.wrRx, 0, side * (L_ ? p.wrLz : p.wrRz));
      const th = BI[`thigh${b}`], sn = BI[`shin${b}`], ft = BI[`foot${b}`];
      const jT = J[`thigh${b}`];
      const a = L_ ? p.thL : p.thR, k = L_ ? p.shL : p.shR;
      this.child(W[th], W[BI.hips], jT.x - hips.x, jT.y - hips.y, jT.z - hips.z, a, 0, side * (0.05 + p.spread));
      this.child(W[sn], W[th], 0, -L.thigh, 0, k, 0, 0);
      // A planted foot stays flat to the ground unless the pose tips it; a swinging one hangs from the shin.
      const flat = p.lying ? 0 : -(p.hipPitch + a + k) * (L_ ? p.plantL : p.plantR);
      this.child(W[ft], W[sn], 0, -L.shin, 0, flat + (L_ ? p.ftL : p.ftR), 0, 0);
    }
  }

  /** Upload the populated part of each instance buffer, rather than its 200-person capacity. */
  private upload(attribute: THREE.BufferAttribute | THREE.InstancedBufferAttribute, count: number): void {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, Math.min(count, attribute.count) * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  /** Ground height under a world point (set by the game; flat ground when absent). */
  groundAt: ((x: number, z: number) => number) | null = null;
  /** Per islander: the last pose drawn, and a short blend from it when the activity changes. */
  private blends = new Map<number, { anim: string; from: Pose; last: Pose; t: number }>();

  /** Ease from the previous activity's pose into the new one over a fraction of a second. */
  private blend(isl: Islander, p: Pose, dt: number): Pose {
    let b = this.blends.get(isl.id);
    if (!b) {
      b = { anim: isl.anim, from: { ...p }, last: { ...p }, t: BLEND };
      this.blends.set(isl.id, b);
    }
    if (b.anim !== isl.anim) {
      b.anim = isl.anim;
      Object.assign(b.from, b.last);
      b.t = 0;
    }
    if (b.t < BLEND && !p.lying && !b.from.lying) {
      b.t = Math.min(BLEND, b.t + Math.max(0, dt));
      const k = ease(b.t / BLEND);
      const P = p as unknown as Record<string, number>, F = b.from as unknown as Record<string, number>;
      for (const key of BLEND_KEYS) P[key] = F[key] + (P[key] - F[key]) * k;
    }
    Object.assign(b.last, p);
    return p;
  }

  /** How far the ground under each foot sits above (or below) the body's own spot, in model metres. */
  private feetGround(isl: Islander, model: GlbModel, p: Pose, sc: number): [number, number] {
    if (!this.groundAt || isl.floorY !== null || p.lying) return [0, 0];
    const L = model.len, out: [number, number] = [0, 0];
    const sin = Math.sin(isl.heading), cos = Math.cos(isl.heading);
    for (const side of [0, 1] as const) {
      const a = p.hipPitch + (side ? p.thR : p.thL), k = side ? p.shR : p.shL;
      // The foot's place in the body's frame: out to its side, and forward or back with the stride.
      const fx = (side ? 1 : -1) * Math.abs(model.joint.footL.x), fz = -(L.thigh * Math.sin(a) + L.shin * Math.sin(a + k));
      const wx = isl.x + (fx * cos + fz * sin) * sc, wz = isl.z + (-fx * sin + fz * cos) * sc;
      out[side] = THREE.MathUtils.clamp((this.groundAt(wx, wz) - isl.y) / sc, -0.08, 0.08);
    }
    return out;
  }

  update(list: Islander[], selected: number, _dt: number, group?: ReadonlySet<number>): void {
    this.count.clear();
    const M = this.m;
    const skinned = !!this.skins.m && !!this.skins.f;
    if (skinned) for (const set of Object.values(this.skins)) set.n = 0;
    let pawns = 0, shadows = 0;
    const far2 = this.lodDist * this.lodDist;
    for (const isl of list) {
      if (isl.hidden) continue;
      // Off screen: skip posing the jointed body (the villager keeps working as normal).
      if (!View.sees(isl.x, isl.y + 0.35, isl.z, 0.6)) continue;
      if (skinned && isl.id !== selected && !group?.has(isl.id) && View.dist2(isl.x, isl.y, isl.z) > far2) {
        // Far away: the simple figure, bobbing a little as they walk.
        const sc = S0 * (isl.child ? ISLANDER.childScale : 1);
        const bob = isl.speed > 0.05 ? Math.abs(Math.sin(isl.x * 3.1 + isl.z * 2.7)) * 0.02 : 0;
        this.rot(M.base, isl.x, isl.y + bob, isl.z, 0, isl.heading, 0, 'XYZ', sc);
        this.pawnBody.setMatrixAt(pawns, M.base);
        this.pawnHead.setMatrixAt(pawns, M.base);
        this.pawnBody.setColorAt(pawns, this.accent.setHex(isl.cloth));
        this.pawnHead.setColorAt(pawns, this.skin.setHex(isl.skin));
        pawns++;
        continue;
      }
      const g = isl.gender;
      const sk = SKELETON[g];
      const p = this.blend(isl, poseFor(isl, g === 'f', sk), _dt);
      this.skin.setHex(isl.skin);
      this.accent.setHex(isl.cloth2);
      const sc = S0 * (isl.child ? ISLANDER.childScale : 1) * (g === 'f' ? 0.98 : 1);
      this.rot(M.base, isl.x, isl.y, isl.z, 0, isl.heading, 0, 'XYZ', sc);
      if (skinned) {
        this.shadowBody.setMatrixAt(shadows, M.base);
        this.shadowHead.setMatrixAt(shadows++, M.base);
      }
      // The children's own models have their big heads built in; only the founding pair's would need enlarging.
      const hs = isl.child && !hasChildModel(this.skins) ? 1.22 : 1;
      // Nothing to draw until the character models have loaded.
      if (skinned) this.drawSkinned(isl, this.skins[characterModelKey(isl)] ?? this.skins[g]!, p, hs, sc);
    }
    // Forget the blends of islanders who have gone.
    if (this.blends.size > list.length + 16) {
      const alive = new Set(list.map((l) => l.id));
      for (const id of this.blends.keys()) if (!alive.has(id)) this.blends.delete(id);
    }
    for (const m of [this.pawnBody, this.pawnHead]) {
      m.count = pawns;
      if (!pawns) continue;
      this.upload(m.instanceMatrix, pawns);
      if (m.instanceColor) this.upload(m.instanceColor, pawns);
    }
    for (const m of [this.shadowBody, this.shadowHead]) {
      m.count = shadows;
      if (shadows) this.upload(m.instanceMatrix, shadows);
    }
    for (const [key, mesh] of this.meshes) {
      const n = this.count.get(key) ?? 0;
      mesh.count = n;
      if (n === 0) continue;
      this.upload(mesh.instanceMatrix, n);
      if (mesh.instanceColor) this.upload(mesh.instanceColor, n);
      const acc = this.accents.get(key);
      if (acc) this.upload(acc, n);
    }
    if (skinned) {
      for (const s of Object.values(this.skins)) {
        s.mesh.count = s.n;
        if (!s.n) continue;
        this.upload(s.mesh.instanceMatrix, s.n);
        if (s.mesh.instanceColor) this.upload(s.mesh.instanceColor, s.n);
        this.upload(s.accent, s.n);
        this.upload(s.look, s.n);
        s.tex.needsUpdate = true;
      }
    }
    const sel = list.find((l) => l.id === selected);
    this.ring.visible = !!sel && !sel.hidden && !group?.size;
    let rings = 0;
    if (group?.size) for (const person of list) {
      if (!group.has(person.id) || person.hidden) continue;
      this.tmp.makeTranslation(person.x, person.y + 0.04, person.z);
      this.groupRings.setMatrixAt(rings++, this.tmp);
    }
    this.groupRings.count = rings;
    if (rings) this.upload(this.groupRings.instanceMatrix, rings);
    if (sel) {
      this.ring.position.set(sel.x, sel.y + 0.04, sel.z);
      this.ring.scale.setScalar(sel.child ? 0.7 : 1);
    }
    void ZERO;
    void TOOLS;
  }

  /** Skinned character model: pose the skeleton, write its skin matrices, then attach props. */
  private drawSkinned(isl: Islander, set: SkinSet, p: Pose, hs: number, sc = S0): void {
    const i = set.n;
    if (i >= set.mesh.instanceMatrix.count) return;
    const M = this.m, W = this.W, J = set.model.joint;
    if (i >= set.rows) {
      // More islanders on screen than the bone texture holds: double it.
      const rows = Math.min(ISLANDER.max, set.rows * 2);
      const data = new Float32Array(BONE_COUNT * 16 * rows);
      data.set(set.data);
      set.data = data;
      set.rows = rows;
      set.tex.dispose();
      set.tex.image = { data, width: BONE_COUNT * 4, height: rows };
      set.tex.needsUpdate = true;
    }
    const [gL, gR] = this.feetGround(isl, set.model, p, sc);
    this.poseSkeleton(set.model, p, hs, gL, gR);
    const load = isl.task?.kind === 'firefight' && isl.task.water ? 'water' : isl.carry?.kind ? LOADS[isl.carry.kind] : undefined;
    const gripping = !!load && !p.lying && this.carryPose.apply(load, set.model, W, hs);
    const row = i * BONE_COUNT * 16;
    for (let b = 0; b < BONE_COUNT; b++) {
      this.tmp2.multiplyMatrices(W[b], set.model.bindInv[b]);
      set.data.set(this.tmp2.elements, row + b * 16);
    }
    set.mesh.setMatrixAt(i, M.base);
    set.mesh.setColorAt(i, this.skin);
    set.accent.setXYZ(i, this.accent.r, this.accent.g, this.accent.b);
    // Elders: grey hair for women, white hair and beard for men (linear tones). Boys: no beard.
    // The elders' own models already have grey and white hair; only greyed when drawn on the founding pair.
    const elder = isElder(isl) && set.model !== this.skins?.oldm?.model && set.model !== this.skins?.oldf?.model;
    // (A hair tone above 1.5 also flags the healer's white robe for the shader.)
    set.look.setXYZ(i, elder ? 1 : 0, (isl.gender === 'f' ? 0.46 : 0.7) + (isl.npc === 'healer' ? 2 : 0), isl.child && isl.gender === 'm' ? 1 : 0);
    set.n = i + 1;
    // Headdress: warriors wear jaguar or eagle helms, priests the grand feather fan.
    const hd = isl.warrior ? isl.warrior : isl.npc === 'healer' ? 'hd_plume' : isl.role === 'priest' && !isl.child ? 'hd_fan' : null;
    if (hd) {
      const fit = set.model.hat;
      M.out.multiplyMatrices(M.base, W[BI.head]).multiply(this.rot(this.tmp, 0, fit.y, fit.z, 0, 0, 0, 'XYZ', fit.s));
      this.put(hd as PartKey, M.out);
    }
    const shown = shownAnim(isl);
    // Kit by trade, as in the character sheets: jaguar warriors carry a round shield on the forearm,
    // eagle warriors a quiver and bow across the back, and fishers wear a red headband with a net
    // bundled on the back.
    if (!isl.child && isl.anim !== 'sleep') {
      if (isl.warrior === 'jaguar') {
        M.out.multiplyMatrices(M.base, W[BI.forearmR]).multiply(this.rot(this.tmp, -0.07, -set.model.len.fore * 0.45, 0.02, 0, 0, 0));
        this.put('shield', M.out);
      } else if (isl.warrior === 'eagle') {
        M.out.multiplyMatrices(M.base, W[BI.chest]);
        this.put('quiver', M.out);
        // The bow: in the off hand on guard or shooting, otherwise slung on the back.
        if (shown === 'guard' || shown === 'attack') {
          M.out.multiplyMatrices(M.base, W[BI.handR]).multiply(this.rot(this.tmp, 0, -set.model.len.hand * 0.3, 0.01, 0, 0, 0));
          this.put('bowhand', M.out);
        } else {
          M.out.multiplyMatrices(M.base, W[BI.chest]);
          this.put('bowback', M.out);
        }
      } else if (isl.role === 'fisher') {
        const fit = set.model.hat;
        M.out.multiplyMatrices(M.base, W[BI.head]).multiply(this.rot(this.tmp, 0, fit.y, fit.z, 0, 0, 0, 'XYZ', fit.s));
        this.put('fishband', M.out);
        if (!isl.carry) {
          M.out.multiplyMatrices(M.base, W[BI.chest]);
          this.put('netpack', M.out);
        }
      }
    }
    // Tool in the right (+x) hand.
    let tool: string = isl.carry || isl.anim === 'sleep' || isl.anim === 'pray' || isl.anim === 'eat' || isl.anim === 'sit' ? 'none' : isl.tool;
    // Eagle warriors fight with the bow; elders out walking lean on a staff.
    if (isl.warrior === 'eagle' && (shown === 'guard' || shown === 'attack')) tool = 'none';
    if (tool === 'none' && shown === 'walk' && !isl.carry && !isl.child && isElder(isl)) tool = 'staff';
    if (tool !== 'none') {
      M.out.multiplyMatrices(M.base, W[BI.handL]);
      // Gripped in the palm, a little past the wrist.
      M.out.multiply(this.rot(this.tmp, 0, -set.model.len.hand * 0.3, 0.01, 0, 0, 0));
      this.put(tool as PartKey, M.out);
    }
    // Carried load: on the head, across the shoulders (log) or under the arm (chicken).
    const c = isl.task?.kind === 'firefight' && isl.task.water ? 'water' : isl.carry?.kind;
    if (c && (c === 'water' || LOADS[c])) {
      M.chest.multiplyMatrices(M.base, W[BI.chest]);
      const up = J.head.y - J.chest.y;
      if (gripping) M.out.multiplyMatrices(M.base, this.carryPose.load);
      else if (c === 'chicken') M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0.2, up - 0.3, 0.12, 0, 0.3, 0));
      else if (c === 'log') M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0, J.upper_armL.y - J.chest.y + 0.1, -0.12, 0, 0.25, 0));
      else M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0, up + 0.36, 0.02, 0, 0, 0));
      this.put(c === 'water' ? 'water' : LOADS[c], M.out);
    }
  }
}
