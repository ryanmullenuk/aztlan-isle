import * as THREE from 'three';
import { characterVariant, type CharacterModelKey } from './CharacterVariants';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The islander characters (public/models/islander_*.glb, each with a colour texture .jpg): the
 * founding man and woman, a boy and a girl, an older man and woman, and a heavier-built man and
 * woman. Static low-poly meshes (the newer ones simplified from their high-detail sources to about
 * 3,000 triangles) that are rigged here, at load, onto the rig's own
 * 19-bone skeleton (hips, spine, chest, neck, head, shoulders, upper arms, forearms, hands,
 * thighs, shins, feet) from measured joint positions and automatic skin weights. The islander rig
 * poses those bones every frame and skins all islanders of a model in one instanced draw.
 *
 * Each bone has a bind frame: at its joint, with limbs turned so -y runs down the bone (the rig's
 * convention for limbs) and the torso bones upright. Skin matrix = posed frame × bind frame⁻¹.
 */

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upper_armL', 'forearmL', 'handL',
  'shoulderR', 'upper_armR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
export const BONE_COUNT = BONES.length;
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

export interface GlbModel {
  /** Bind-pose geometry (metres, facing +z) with aSkinI / aSkinW (4 influences). */
  geometry: THREE.BufferGeometry;
  /** Joint positions in the bind pose. */
  joint: Record<BoneName, THREE.Vector3>;
  /** Inverse bind frames, one per bone. */
  bindInv: THREE.Matrix4[];
  /** Colour texture. */
  map: THREE.Texture;
  /** A texture coordinate on the bare face, to paint over a hidden beard. */
  skinUv: THREE.Vector2;
  /** How headdresses sit on this head (offset from the head joint, metres, and scale). */
  hat: { y: number; z: number; s: number };
  /** Limb lengths (joint to joint; hand = wrist to finger tips). */
  len: { upper: number; fore: number; thigh: number; shin: number; hand: number };
}

export type GlbPeople = Record<CharacterModelKey, GlbModel>;

/** Which models are loaded: the two founding islanders, children, elders and the heavier-built adults. */
export type BaseModelKey = 'm' | 'f' | 'boy' | 'girl' | 'oldm' | 'oldf' | 'fatm' | 'fatf';
const MODEL_FILE: Record<BaseModelKey, string> = {
  m: 'islander_male', f: 'islander_female', boy: 'islander_boy', girl: 'islander_girl',
  oldm: 'islander_oldm', oldf: 'islander_oldf', fatm: 'islander_fatm', fatf: 'islander_fatf',
};
const FILES = Object.fromEntries(Object.entries(MODEL_FILE).map(([k, f]) => [k, { mesh: `models/${f}.glb`, tex: `models/${f}.jpg` }])) as Record<BaseModelKey, { mesh: string; tex: string }>;
/** Female models (skirts follow the thighs more closely; no beard). */
const FEMALE = new Set<BaseModelKey>(['f', 'girl', 'oldf', 'fatf']);
/** Models with a beard (hair on the lower face), which the shader can hide for boys. */
const BEARDED = new Set<BaseModelKey>(['m', 'oldm', 'fatm']);

type V3 = [number, number, number];
/** Mirror a +x (L) joint to the -x (R) side. */
const mir = (p: V3): V3 => [-p[0], p[1], p[2]];

/**
 * Joint positions (metres, bind pose, facing +z, L = +x) for the two character models, measured
 * from their meshes: the elbow, wrist, knee and ankle sit where the limbs bend and the wrist and
 * boot bands are. The ends (head top, finger tips, toes) only shape the skin weights.
 */
/**
 * A model's rig: measured joints, the ends that shape the weights, headdress fit, and (for builds
 * other than the founding pair) how thick its body and limbs are and how far out the arms hang, so
 * a heavy belly or a child's big head is weighted to the right bones.
 */
export interface Rig {
  joint: Record<BoneName, V3>; top: V3; tipL: V3; toeL: V3; hat: { y: number; z: number; s: number };
  /** Radius multipliers for the torso, the limbs and the head (1 = the founding pair). */
  girth?: { torso: number; limb: number; head: number };
  /** Vertices nearer the middle than this (|x|, metres) are never part of an arm. */
  armX?: number;
  /** The women's underskirt: radii across and front-to-back at its top and hem, and its centre. */
  skirt?: SkirtFit | null;
}
/** The wrap that closes a skirt or kilt: radii across and front-to-back at its top and hem, its
 * centre, and (when measured from the model) its hem height and the cloth and hem texels. */
export interface SkirtFit { rx: [number, number]; rz: [number, number]; cz: number; hemY?: number; cream?: [number, number]; gold?: [number, number] }

/** A rig from the left-side limb joints and the spine heights (all mirrored for the right). */
function rig(L: Record<'shoulder' | 'upper_arm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot', V3>, spine: { hips: V3; spine: V3; chest: V3; neck: V3; head: V3 },
  rest: Omit<Rig, 'joint'>): Rig {
  return {
    joint: {
      ...spine,
      shoulderL: L.shoulder, upper_armL: L.upper_arm, forearmL: L.forearm, handL: L.hand,
      shoulderR: mir(L.shoulder), upper_armR: mir(L.upper_arm), forearmR: mir(L.forearm), handR: mir(L.hand),
      thighL: L.thigh, shinL: L.shin, footL: L.foot, thighR: mir(L.thigh), shinR: mir(L.shin), footR: mir(L.foot),
    },
    ...rest,
  };
}

export const RIGS: Record<BaseModelKey, Rig> = {
  m: (() => {
    const L = { shoulder: [0.06, 1.38, -0.04] as V3, upper_arm: [0.2, 1.38, -0.06] as V3, forearm: [0.28, 1.15, -0.06] as V3, hand: [0.32, 0.95, -0.01] as V3, thigh: [0.1, 0.97, -0.03] as V3, shin: [0.17, 0.48, -0.03] as V3, foot: [0.21, 0.1, -0.05] as V3 };
    return {
      joint: {
        hips: [0, 0.98, -0.02], spine: [0, 1.1, -0.02], chest: [0, 1.26, -0.03], neck: [0, 1.44, -0.02], head: [0, 1.53, -0.01],
        shoulderL: L.shoulder, upper_armL: L.upper_arm, forearmL: L.forearm, handL: L.hand,
        shoulderR: mir(L.shoulder), upper_armR: mir(L.upper_arm), forearmR: mir(L.forearm), handR: mir(L.hand),
        thighL: L.thigh, shinL: L.shin, footL: L.foot, thighR: mir(L.thigh), shinR: mir(L.shin), footR: mir(L.foot),
      },
      top: [0, 1.9, 0], tipL: [0.36, 0.68, 0.04], toeL: [0.26, 0.02, 0.12], hat: { y: 0.03, z: 0, s: 1.25 },
    };
  })(),
  f: (() => {
    const L = { shoulder: [0.06, 1.39, 0.02] as V3, upper_arm: [0.19, 1.39, 0.01] as V3, forearm: [0.25, 1.15, 0.0] as V3, hand: [0.28, 0.97, 0.06] as V3, thigh: [0.09, 0.97, 0.05] as V3, shin: [0.16, 0.47, 0.05] as V3, foot: [0.19, 0.1, 0.07] as V3 };
    return {
      joint: {
        hips: [0, 0.98, 0.04], spine: [0, 1.1, 0.04], chest: [0, 1.27, 0.03], neck: [0, 1.45, 0.01], head: [0, 1.54, 0.02],
        shoulderL: L.shoulder, upper_armL: L.upper_arm, forearmL: L.forearm, handL: L.hand,
        shoulderR: mir(L.shoulder), upper_armR: mir(L.upper_arm), forearmR: mir(L.forearm), handR: mir(L.hand),
        thighL: L.thigh, shinL: L.shin, footL: L.foot, thighR: mir(L.thigh), shinR: mir(L.shin), footR: mir(L.foot),
      },
      top: [0, 1.9, 0.02], tipL: [0.32, 0.68, 0.12], toeL: [0.23, 0.02, 0.2], hat: { y: 0.06, z: -0.01, s: 1.4 },
    };
  })(),
  // Measured from the models' front and side views on a 5 cm grid (all are 1.9 tall; children are
  // scaled down in play, and their big heads are part of the model).
  boy: rig(
    { shoulder: [0.06, 1.2, 0], upper_arm: [0.18, 1.2, -0.01], forearm: [0.26, 1.0, -0.01], hand: [0.3, 0.77, 0.01], thigh: [0.09, 0.72, 0], shin: [0.13, 0.4, 0], foot: [0.17, 0.12, -0.01] },
    { hips: [0, 0.8, 0], spine: [0, 0.95, 0], chest: [0, 1.1, 0], neck: [0, 1.27, 0], head: [0, 1.33, 0] },
    { top: [0, 1.9, 0], tipL: [0.31, 0.6, 0.03], toeL: [0.2, 0.02, 0.15], hat: { y: 0.12, z: 0, s: 1.5 }, girth: { torso: 0.85, limb: 0.9, head: 1.9 } },
  ),
  girl: rig(
    { shoulder: [0.06, 1.31, 0.1], upper_arm: [0.17, 1.31, 0.1], forearm: [0.24, 1.1, 0.1], hand: [0.3, 0.89, 0.12], thigh: [0.09, 0.88, 0.1], shin: [0.14, 0.42, 0.1], foot: [0.17, 0.1, 0.1] },
    { hips: [0, 0.94, 0.1], spine: [0, 1.06, 0.1], chest: [0, 1.2, 0.1], neck: [0, 1.42, 0.12], head: [0, 1.46, 0.14] },
    { top: [0, 1.9, 0.14], tipL: [0.32, 0.7, 0.14], toeL: [0.2, 0.02, 0.23], hat: { y: 0.1, z: 0, s: 1.5 }, girth: { torso: 0.85, limb: 0.9, head: 1.6 },
      skirt: { rx: [0.17, 0.21], rz: [0.11, 0.14], cz: 0.1 } },
  ),
  oldm: rig(
    { shoulder: [0.07, 1.44, 0], upper_arm: [0.21, 1.44, 0], forearm: [0.32, 1.18, 0], hand: [0.36, 1.0, 0.04], thigh: [0.1, 0.97, 0], shin: [0.17, 0.48, 0], foot: [0.22, 0.11, -0.01] },
    { hips: [0, 0.98, 0], spine: [0, 1.12, 0], chest: [0, 1.3, 0], neck: [0, 1.52, 0], head: [0, 1.58, 0] },
    { top: [0, 1.9, 0], tipL: [0.38, 0.8, 0.06], toeL: [0.26, 0.02, 0.16], hat: { y: 0.03, z: 0, s: 1.25 } },
  ),
  oldf: rig(
    { shoulder: [0.06, 1.4, -0.01], upper_arm: [0.17, 1.4, -0.01], forearm: [0.24, 1.18, -0.01], hand: [0.3, 0.96, 0.02], thigh: [0.09, 0.97, 0], shin: [0.15, 0.48, 0], foot: [0.19, 0.1, 0] },
    { hips: [0, 0.98, 0], spine: [0, 1.1, 0], chest: [0, 1.27, 0], neck: [0, 1.47, 0], head: [0, 1.56, 0] },
    { top: [0, 1.9, 0], tipL: [0.32, 0.78, 0.04], toeL: [0.23, 0.02, 0.15], hat: { y: 0.05, z: 0, s: 1.35 },
      skirt: { rx: [0.19, 0.23], rz: [0.12, 0.15], cz: 0.0 } },
  ),
  fatm: rig(
    { shoulder: [0.1, 1.4, -0.02], upper_arm: [0.32, 1.4, -0.02], forearm: [0.44, 1.14, -0.02], hand: [0.46, 0.94, 0.02], thigh: [0.15, 0.86, 0], shin: [0.23, 0.4, 0], foot: [0.23, 0.1, 0] },
    { hips: [0, 0.92, 0], spine: [0, 1.06, 0], chest: [0, 1.24, 0], neck: [0, 1.44, 0], head: [0, 1.49, 0] },
    { top: [0, 1.9, 0], tipL: [0.48, 0.74, 0.05], toeL: [0.27, 0.02, 0.18], hat: { y: 0.06, z: 0, s: 1.4 }, girth: { torso: 1.8, limb: 1.5, head: 1.1 }, armX: 0.3 },
  ),
  fatf: rig(
    { shoulder: [0.08, 1.42, 0.04], upper_arm: [0.22, 1.42, 0.04], forearm: [0.36, 1.18, 0.06], hand: [0.4, 1.0, 0.09], thigh: [0.13, 0.88, 0.04], shin: [0.2, 0.46, 0.04], foot: [0.22, 0.1, 0.04] },
    { hips: [0, 0.96, 0.04], spine: [0, 1.12, 0.04], chest: [0, 1.3, 0.04], neck: [0, 1.51, 0.06], head: [0, 1.56, 0.06] },
    { top: [0, 1.9, 0.06], tipL: [0.43, 0.82, 0.1], toeL: [0.25, 0.02, 0.19], hat: { y: 0.06, z: 0, s: 1.4 }, girth: { torso: 1.6, limb: 1.35, head: 1.1 }, armX: 0.26,
      skirt: { rx: [0.27, 0.32], rz: [0.18, 0.22], cz: 0.06 } },
  ),
};

/** Four bone influences per vertex: indices into BONES and their weights. */
type Skin = { si: Float32Array; sw: Float32Array };

/**
 * The weights stored in a skinned GLB (exported from Blender with bones named as in BONES),
 * remapped to the rig's bone order; null for a static mesh.
 */
function storedSkin(m: THREE.Mesh): Skin | null {
  const sk = m as THREE.SkinnedMesh;
  const I = m.geometry.getAttribute('skinIndex'), W = m.geometry.getAttribute('skinWeight');
  if (!sk.isSkinnedMesh || !I || !W) return null;
  const map = sk.skeleton.bones.map((b) => (b.name in BI ? BI[b.name as BoneName] : -1));
  if (map.some((b) => b < 0)) return null;
  const si = new Float32Array(I.count * 4), sw = new Float32Array(I.count * 4);
  for (let i = 0; i < I.count; i++) for (let k = 0; k < 4; k++) {
    si[i * 4 + k] = map[I.getComponent(i, k)];
    sw[i * 4 + k] = W.getComponent(i, k);
  }
  return { si, sw };
}

/** Distance from p to the segment ab. */
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t);
}

/**
 * Skin weights for a static character mesh: each vertex goes to the bones whose surface (segment
 * distance less the limb's radius, carried over the mesh surface) is nearest, blended over the
 * closest three. Arms and legs only
 * take vertices on their own side (and legs only below the hips); the head only above the neck.
 * The skirt hangs from the hips, drawn partly toward the thigh on its side lower down, so a leg
 * swinging forward carries the hem with it instead of poking through. Hair (flagged by `hair`) hangs
 * from the head, handing over to the chest down the back, so raised arms don't drag it.
 *
 * Given `base` weights (painted in Blender, see scripts/blender), the body takes those instead,
 * less any bone that may not move that vertex (an arm on the skirt, a leg on the other side);
 * hair and skirts are still weighted here.
 */
function autoSkin(P: THREE.BufferAttribute, index: ArrayLike<number>, rig: Rig, hair: Uint8Array, skirtFollow = 0.55, skirtX = 0, base?: Skin | null): Skin {
  const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
  const J = rig.joint;
  type Seg = { b: number; a: THREE.Vector3; e: THREE.Vector3; r: number; side: number; kind: 'torso' | 'head' | 'arm' | 'shoulder' | 'leg' };
  const G = rig.girth ?? { torso: 1, limb: 1, head: 1 }, T = G.torso, Lm = G.limb;
  const segs: Seg[] = [
    { b: BI.hips, a: v(J.hips), e: v(J.spine), r: 0.16 * T, side: 0, kind: 'torso' },
    { b: BI.spine, a: v(J.spine), e: v(J.chest), r: 0.15 * T, side: 0, kind: 'torso' },
    { b: BI.chest, a: v(J.chest), e: v(J.neck), r: 0.16 * T, side: 0, kind: 'torso' },
    { b: BI.neck, a: v(J.neck), e: v(J.head), r: 0.06 * Math.max(1, T * 0.8), side: 0, kind: 'torso' },
    { b: BI.head, a: v(J.head), e: v(rig.top), r: 0.12 * G.head, side: 0, kind: 'head' },
  ];
  for (const [s, b] of [[1, 'L'], [-1, 'R']] as const) {
    const m = (p: V3): V3 => (s > 0 ? p : mir(p));
    segs.push(
      { b: BI[`shoulder${b}`], a: v(J[`shoulder${b}`]), e: v(J[`upper_arm${b}`]), r: 0.06 * Lm, side: s, kind: 'shoulder' },
      { b: BI[`upper_arm${b}`], a: v(J[`upper_arm${b}`]), e: v(J[`forearm${b}`]), r: 0.055 * Lm, side: s, kind: 'arm' },
      { b: BI[`forearm${b}`], a: v(J[`forearm${b}`]), e: v(J[`hand${b}`]), r: 0.045 * Lm, side: s, kind: 'arm' },
      { b: BI[`hand${b}`], a: v(J[`hand${b}`]), e: v(m(rig.tipL)), r: 0.05 * Lm, side: s, kind: 'arm' },
      { b: BI[`thigh${b}`], a: v(J[`thigh${b}`]), e: v(J[`shin${b}`]), r: 0.075 * Lm, side: s, kind: 'leg' },
      { b: BI[`shin${b}`], a: v(J[`shin${b}`]), e: v(J[`foot${b}`]), r: 0.06 * Lm, side: s, kind: 'leg' },
      { b: BI[`foot${b}`], a: v(J[`foot${b}`]), e: v(m(rig.toeL)), r: 0.05 * Lm, side: s, kind: 'leg' },
    );
  }
  const hipY = J.hips[1], kneeY = J.shinL[1], neckY = J.neck[1], chestY = J.chest[1];

  const hemY = kneeY + 0.12;
  const n = P.count;
  const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const thighL = segs.find((s) => s.b === BI.thighL)!, thighR = segs.find((s) => s.b === BI.thighR)!;
  const armSide = (s: Seg) => p.x * s.side >= (rig.armX ?? 0.13) && !(p.y < hipY + 0.02 && p.x * s.side < skirtX + 0.015);
  const allowed = (s: Seg) =>
    !((s.kind === 'arm' && (p.x * s.side < (rig.armX ?? 0.13) || segDist(p, s.a, s.e) - s.r > 0.07 * Lm ||
        // Below the waist, the skirt's own width is never part of an arm (the hands hang beside it).
        (p.y < hipY + 0.02 && p.x * s.side < skirtX + 0.015))) ||
      (s.kind === 'shoulder' && (p.x * s.side < 0.03 || p.y < chestY)) ||
      (s.kind === 'leg' && (p.x * s.side < -0.02 || p.y > hipY + 0.03)) ||
      (s.kind === 'head' && p.y < neckY - 0.02));

  // Weld the mesh (UV seams split vertices) and link it up, so distances can be measured over the
  // surface: the hand hanging beside the hip is close to it through the air but far from it along
  // the body (up the arm and back down the side), which is what keeps the two apart.
  const uid = new Int32Array(n);
  const key = new Map<string, number>();
  const rep: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`;
    let u = key.get(k);
    if (u === undefined) key.set(k, (u = rep.push(i) - 1));
    uid[i] = u;
  }
  const U = rep.length;
  const adj: number[][] = Array.from({ length: U }, () => []);
  for (let t = 0; t < index.length; t += 3) {
    const v3 = [0, 1, 2].map((k) => uid[index[t + k]]);
    for (let k = 0; k < 3; k++) adj[v3[k]].push(v3[(k + 1) % 3]), adj[v3[(k + 1) % 3]].push(v3[k]);
  }
  const pos = (u: number, out: THREE.Vector3) => out.fromBufferAttribute(P, rep[u]);
  const q2 = new THREE.Vector3();
  // Per bone: straight-line distance to its surface (weighted up, so the surface route wins
  // wherever one exists), then spread over the mesh.
  const K = 3;
  const dist = segs.map(() => new Float64Array(U));
  segs.forEach((s, bi) => {
    const d = dist[bi];
    const heap: [number, number][] = [];
    const push = (e: [number, number]) => {
      heap.push(e);
      for (let c = heap.length - 1; c > 0; ) {
        const pa = (c - 1) >> 1;
        if (heap[pa][0] <= heap[c][0]) break;
        [heap[pa], heap[c]] = [heap[c], heap[pa]];
        c = pa;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let c = 0; ; ) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    for (let u = 0; u < U; u++) {
      pos(u, p);
      d[u] = allowed(s) ? K * Math.max(0, segDist(p, s.a, s.e) - s.r) : Infinity;
      if (d[u] < Infinity) push([d[u], u]);
    }
    while (heap.length) {
      const [du, u] = pop();
      if (du > d[u]) continue;
      pos(u, p);
      for (const w of adj[u]) {
        const nd = du + p.distanceTo(pos(w, q2));
        if (nd < d[w]) {
          d[w] = nd;
          push([nd, w]);
        }
      }
    }
  });
  const armIdx = segs.map((s, k) => (s.kind === 'arm' ? k : -1)).filter((k) => k >= 0);

  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(P, i);
    const u = uid[i];
    const set = (list: [number, number][]) => {
      list.sort((a, b) => b[1] - a[1]);
      const top = list.slice(0, 4);
      const tot = top.reduce((s, e) => s + e[1], 0) || 1;
      for (let k = 0; k < 4; k++) {
        si[i * 4 + k] = top[k]?.[0] ?? 0;
        sw[i * 4 + k] = top[k] ? top[k][1] / tot : 0;
      }
    };
    if (hair[i] && p.y > chestY - 0.2) {
      const t = THREE.MathUtils.clamp((neckY - p.y) / (neckY - (chestY - 0.2)), 0, 1);
      set(t > 0 ? [[BI.head, 1 - t], [BI.chest, t]] : [[BI.head, 1]]);
      continue;
    }
    // The skirt: between the hips and just above the knee, away from the legs inside it, and nearer
    // (over the surface) the hips than the arms hanging beside it.
    const dLeg = Math.min(segDist(p, thighL.a, thighL.e), segDist(p, thighR.a, thighR.e));
    const dArm = Math.min(...armIdx.map((k) => (allowed(segs[k]) ? dist[k][u] : Infinity)));
    if (p.y < hipY + 0.02 && p.y > kneeY + 0.06 && dLeg > 0.085 * Lm && dArm > dist[0][u]) {
      const t = THREE.MathUtils.clamp((hipY - p.y) / (hipY - hemY), 0, 1) * skirtFollow;
      const list: [number, number][] = [[BI.hips, 1 - t]];
      if (Math.abs(p.x) < 0.05) list.push([BI.thighL, t * 0.5], [BI.thighR, t * 0.5]);
      else list.push([p.x > 0 ? BI.thighL : BI.thighR, t]);
      set(list);
      continue;
    }
    if (base) {
      // Blender's weights already keep each arm to itself, so an arm bone may keep any vertex on its
      // own side and clear of the skirt (the measured arm line can sit a little in front of an
      // elbow, which must not be left on the chest to trail behind as a spike).
      const ok = new Set(segs.filter((s) => (s.kind === 'arm' ? armSide(s) : allowed(s))).map((s) => s.b));
      const list: [number, number][] = [];
      for (let k = 0; k < 4; k++) if (base.sw[i * 4 + k] > 0.01 && ok.has(base.si[i * 4 + k])) list.push([base.si[i * 4 + k], base.sw[i * 4 + k]]);
      if (list.length) {
        set(list);
        continue;
      }
    }
    const cand: [number, number][] = [];
    segs.forEach((s, k) => {
      if (!allowed(s)) return;
      const d = Math.max(0.005, dist[k][u]);
      cand.push([s.b, 1 / Math.pow(d + 0.02, 4)]);
    });
    cand.sort((a, b) => b[1] - a[1]);
    const top3 = cand.slice(0, 3);
    const tot = top3.reduce((s, e) => s + e[1], 0);
    set(top3.filter((e) => e[1] / tot > 0.05));
  }
  return { si, sw };
}

const ARM = new Set<number>([BI.upper_armL, BI.forearmL, BI.handL, BI.upper_armR, BI.forearmR, BI.handR]);

/**
 * The models' arms are joined to the body in places below the armpit (the inner arm to the side,
 * finger tips to the skirt hem): thin triangles that would stretch like webbing whenever an arm
 * lifts. This leaves those triangles (one corner on the arm, another on the body) out of the
 * surface used to measure skin distances, so weight never leaks across them; the model itself keeps
 * every triangle (unweldArms then lets the arm part from the body cleanly).
 */
function cutBridges(P: THREE.BufferAttribute, index: ArrayLike<number>, si: Float32Array, sw: Float32Array, belowY: number): number[] {
  const arm = (i: number) => {
    let a = 0;
    for (let k = 0; k < 4; k++) if (ARM.has(si[i * 4 + k])) a += sw[i * 4 + k];
    return a;
  };
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const v = [0, 1, 2].map((k) => index[t + k]);
    const a = v.map(arm);
    const bridge = Math.max(...a) - Math.min(...a) > 0.5 && Math.max(...v.map((i) => P.getY(i))) < belowY;
    if (!bridge) out.push(...v);
  }
  return out;
}

/**
 * Vertices whose texture colour matches the hair (the colour at the top of the head): so long hair
 * can be skinned to the head rather than whatever limb it hangs beside.
 */
function hairMask(P: THREE.BufferAttribute, uv: THREE.BufferAttribute, map: THREE.Texture): Uint8Array {
  const out = new Uint8Array(P.count);
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (!cx) return out;
  cx.drawImage(img, 0, 0);
  const D = cx.getImageData(0, 0, cv.width, cv.height).data;
  const texel = (i: number) => {
    const x = THREE.MathUtils.clamp(Math.floor(uv.getX(i) * cv.width), 0, cv.width - 1);
    const y = THREE.MathUtils.clamp(Math.floor(uv.getY(i) * cv.height), 0, cv.height - 1);
    const k = (y * cv.width + x) * 4;
    return [D[k], D[k + 1], D[k + 2]];
  };
  let top = 0;
  for (let i = 1; i < P.count; i++) if (P.getY(i) > P.getY(top)) top = i;
  const h = texel(top);
  for (let i = 0; i < P.count; i++) {
    const c = texel(i);
    if (Math.hypot(c[0] - h[0], c[1] - h[1], c[2] - h[2]) < 28) out[i] = 1;
  }
  return out;
}

/** Read texture colours by vertex (its texture coordinate), from a canvas copy of the map. */
function texelReader(map: THREE.Texture, UV: THREE.BufferAttribute): ((i: number) => number[]) | null {
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (!cx) return null;
  cx.drawImage(img, 0, 0);
  const D = cx.getImageData(0, 0, cv.width, cv.height).data;
  return (i: number) => {
    const x = THREE.MathUtils.clamp(Math.floor(UV.getX(i) * cv.width), 0, cv.width - 1);
    const y = THREE.MathUtils.clamp(Math.floor(UV.getY(i) * cv.height), 0, cv.height - 1);
    const k = (y * cv.width + x) * 4;
    return [D[k], D[k + 1], D[k + 2]];
  };
}
/** The skirt's cream cloth, its gold hem (yellow, not the orange of skin) and the red sash. */
const isCream = (c: number[]) => c[0] > 190 && c[1] > 175 && c[2] > 140 && Math.max(...c) - Math.min(...c) < 72;
const isGold = (c: number[]) => c[0] > 195 && c[1] > 165 && c[1] / c[0] > 0.74 && c[2] < 120;
const isRed = (c: number[]) => c[0] > 110 && c[1] < c[0] * 0.45;
const isCloth = (c: number[]) => isCream(c) || isGold(c) || isRed(c);

/**
 * Triangles of thigh skin hidden under a skirt (between the waist and just above the hem, on the
 * thigh and coloured as bare skin, never the cloth around it) are left out.
 */
function slimThighs(P: THREE.BufferAttribute, si: Float32Array, sw: Float32Array, J: Record<BoneName, THREE.Vector3>, hemY: number, limb: number, texel: ((i: number) => number[]) | null): void {
  const thighs = [[J.thighL, J.shinL], [J.thighR, J.shinR]] as const;
  const p = new THREE.Vector3(), ab = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i);
    if (p.y > J.hips.y - 0.02 || p.y < hemY) continue;
    // Never the skirt's own cloth, nor the arms hanging beside it.
    if (!texel || isCloth(texel(i))) continue;
    let arm = 0;
    for (let k = 0; k < 4; k++) if (ARM.has(si[i * 4 + k])) arm += sw[i * 4 + k];
    if (arm > 0.4) continue;
    for (const [a, e] of thighs) {
      if (segDist(p, a, e) > 0.16 * limb) continue;
      // Toward the thigh's axis: by up to a fifth, easing in from the hem so the leg below is unchanged.
      ab.subVectors(e, a);
      const t = THREE.MathUtils.clamp(c.subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
      c.copy(a).addScaledVector(ab, t);
      const k = 0.2 * THREE.MathUtils.smoothstep(p.y, hemY, hemY + 0.06);
      p.lerp(c, k);
      P.setXYZ(i, p.x, p.y, p.z);
      break;
    }
  }
}

/** Above the ankle, a vertex's foot weight passes to the shin (fully by 3 cm up): the boot's shaft stays on the shin. */
function footToAnkle(P: THREE.BufferAttribute, si: Float32Array, sw: Float32Array, ankleY: number): void {
  const pairs = [[BI.footL, BI.shinL], [BI.footR, BI.shinR]] as const;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i);
    if (y < ankleY + 0.005) continue;
    const keep = 1 - THREE.MathUtils.smoothstep(y, ankleY + 0.005, ankleY + 0.035);
    for (const [foot, shin] of pairs) {
      let fk = -1, sk = -1;
      for (let k = 0; k < 4; k++) { if (si[i * 4 + k] === foot) fk = k; if (si[i * 4 + k] === shin) sk = k; }
      if (fk < 0 || sw[i * 4 + fk] <= 0) continue;
      const moved = sw[i * 4 + fk] * (1 - keep);
      sw[i * 4 + fk] -= moved;
      if (sk < 0) {
        // No shin influence yet: take an empty slot, else the weakest other one.
        sk = -1;
        for (let k = 0; k < 4; k++) if (k !== fk && (sk < 0 || sw[i * 4 + k] < sw[i * 4 + sk])) sk = k;
        si[i * 4 + sk] = shin;
      }
      sw[i * 4 + sk] += moved;
      let tot = 0;
      for (let k = 0; k < 4; k++) tot += sw[i * 4 + k];
      for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot || 1;
    }
  }
}

/**
 * Where the simplified mesh welded an arm to the body (a forearm resting on a belly or a skirt),
 * triangles bridge a vertex wholly on the arm and one wholly on the body, and stretch like webbing
 * when the arm moves. Each such triangle (below the armpit) goes with the side most of it belongs
 * to: its corners on the other side get duplicates weighted like the rest of the triangle, so it
 * moves as one piece. Every other triangle keeps its smooth weights; the shoulders are untouched.
 */
function unweldArms(P: THREE.BufferAttribute, N: THREE.BufferAttribute, UV: THREE.BufferAttribute, index: number[], si: Float32Array, sw: Float32Array, hair: Uint8Array, armpitY: number) {
  const n = P.count;
  const arm = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) if (ARM.has(si[i * 4 + k])) arm[i] += sw[i * 4 + k];
  const copies = new Map<string, number>();
  const extra: { src: number; donor: number }[] = [];
  const out = index.slice();
  for (let t = 0; t < index.length; t += 3) {
    const v = [index[t], index[t + 1], index[t + 2]], a = v.map((i) => arm[i]);
    if (Math.max(...a) < 0.9 || Math.min(...a) > 0.1 || v.some((i) => P.getY(i) >= armpitY)) continue;
    const toArm = (a[0] + a[1] + a[2]) / 3 >= 0.5;
    // The corner most firmly on the winning side lends its weights to the strays.
    const donor = v[a.indexOf(toArm ? Math.max(...a) : Math.min(...a))];
    for (let k = 0; k < 3; k++) {
      if (toArm ? a[k] >= 0.5 : a[k] < 0.5) continue;
      const key = `${v[k]}>${donor}`;
      let c = copies.get(key);
      if (c === undefined) { c = n + extra.length; extra.push({ src: v[k], donor }); copies.set(key, c); }
      out[t + k] = c;
    }
  }
  if (!extra.length) return { P, N, UV, si, sw, hair, index: out };
  const m = n + extra.length;
  const pos = new Float32Array(m * 3), nor = new Float32Array(m * 3), uv = new Float32Array(m * 2);
  const SI = new Float32Array(m * 4), SW = new Float32Array(m * 4), H = new Uint8Array(m);
  pos.set((P.array as Float32Array).subarray(0, n * 3)); nor.set((N.array as Float32Array).subarray(0, n * 3)); uv.set((UV.array as Float32Array).subarray(0, n * 2));
  SI.set(si); SW.set(sw); H.set(hair);
  extra.forEach(({ src, donor }, e) => {
    const c = n + e;
    pos.set([P.getX(src), P.getY(src), P.getZ(src)], c * 3);
    nor.set([N.getX(src), N.getY(src), N.getZ(src)], c * 3);
    uv.set([UV.getX(src), UV.getY(src)], c * 2);
    H[c] = hair[src];
    for (let k = 0; k < 4; k++) { SI[c * 4 + k] = si[donor * 4 + k]; SW[c * 4 + k] = sw[donor * 4 + k]; }
  });
  return { P: new THREE.BufferAttribute(pos, 3), N: new THREE.BufferAttribute(nor, 3), UV: new THREE.BufferAttribute(uv, 2), si: SI, sw: SW, hair: H, index: out };
}

/** Flip any triangle whose winding disagrees with its vertex normals (turned inside out by simplification). */
function faceOutward(P: THREE.BufferAttribute, N: THREE.BufferAttribute, index: number[]): number[] {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    a.fromBufferAttribute(P, index[t]); b.fromBufferAttribute(P, index[t + 1]); c.fromBufferAttribute(P, index[t + 2]);
    n.subVectors(b, a).cross(c.sub(a));
    m.fromBufferAttribute(N, index[t]).add(a.fromBufferAttribute(N, index[t + 1])).add(b.fromBufferAttribute(N, index[t + 2]));
    if (n.dot(m) < 0) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  }
  return index;
}

/**
 * Measure a model's skirt or kilt from the mesh and its colours: the cream cloth and gold hem
 * around the hips (arms and hair left out), so the wrap that closes its sides sits just inside the
 * real panels, reaches their hem, and is cut from the same cloth. Null if no cloth is found.
 */
function fitSkirt(P: THREE.BufferAttribute, UV: THREE.BufferAttribute, map: THREE.Texture, J: Record<BoneName, THREE.Vector3>, hair: Uint8Array): SkirtFit | null {
  const texel = texelReader(map, UV);
  if (!texel) return null;

  // Clear of the hands hanging beside the skirt.
  const maxX = Math.max(0.15, J.handL.x - 0.09), hipY = J.hips.y;
  let X = 0, Z0 = Infinity, Z1 = -Infinity, low = Infinity, cream: [number, number] | null = null, gold: [number, number] | null = null, back = Infinity, goldBack = Infinity;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (hair[i] || Math.abs(x) > maxX || y > hipY || y < J.shinL.y - 0.05) continue;
    const c = texel(i), cloth = isCream(c), hem = isGold(c);
    if (!cloth && !hem) continue;
    // The hem: the lowest cloth at the back middle of the skirt (nothing else hangs there).
    if (Math.abs(x) < 0.1 && z < J.hips.z) low = Math.min(low, y);
    if (y > hipY - 0.22 && y < hipY - 0.08) {
      X = Math.max(X, Math.abs(x)); Z0 = Math.min(Z0, z); Z1 = Math.max(Z1, z);
      if (cloth && Math.abs(x) < 0.08 && z < back) { back = z; cream = [UV.getX(i), UV.getY(i)]; }
    }
    if (hem && Math.abs(x) < 0.12 && z < goldBack) { goldBack = z; gold = [UV.getX(i), UV.getY(i)]; }
  }
  if (!cream || !Number.isFinite(Z0) || X < 0.05) return null;
  const rx = X * 0.86, rz = ((Z1 - Z0) / 2) * 0.86, cz = (Z0 + Z1) / 2;
  return { rx: [rx, rx * 1.18], rz: [rz, rz * 1.22], cz, hemY: low + 0.012, cream, gold: gold ?? cream };
}

/**
 * The women's skirt is a front and a back panel, open at the hips: from the side, and with every
 * stride, the bare thigh showed between them. This wrap closes it: an elliptical tube of the same
 * cream cloth, just inside the panels, from under the waistband to a gold hem level with theirs,
 * flaring a little. The top rides the hips; lower down each side follows its thigh more and more,
 * the front and back middle shared, so it moves with the legs without letting them through.
 */
function underskirt(P: THREE.BufferAttribute, UV: THREE.BufferAttribute, J: Record<BoneName, THREE.Vector3>, size: SkirtFit, follows = 0.82, inset = 1): THREE.BufferGeometry {
  // From under the waistband to a little below the panels' hem, nearer the knee.
  const hipY = J.hips.y, topY = hipY + 0.01, hemY = size.hemY ?? J.shinL.y + 0.075, cz = size.cz;
  // Texture coordinates of the skirt's cream cloth (middle of the back panel) and its gold hem.
  const uvAt = (x: number, y: number, z: number) => {
    let best = Infinity, at = 0;
    for (let i = 0; i < P.count; i++) {
      const d = (P.getX(i) - x) ** 2 + (P.getY(i) - y) ** 2 + (P.getZ(i) - z) ** 2;
      if (d < best) { best = d; at = i; }
    }
    return [UV.getX(at), UV.getY(at)];
  };
  const back = cz - size.rz[0] * 0.95;
  const cream = size.cream ?? uvAt(0.04, hipY - 0.17, back), gold = size.gold ?? uvAt(0.04, J.shinL.y + 0.165, back);
  const rows: { y: number; uv: number[] }[] = [
    { y: topY, uv: cream }, { y: hipY - 0.1, uv: cream }, { y: hipY - 0.2, uv: cream }, { y: hemY + 0.12, uv: cream },
    { y: hemY + 0.035, uv: cream }, { y: hemY + 0.03, uv: gold }, { y: hemY - 0.01, uv: gold },
  ];
  const seg = 18;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [];
  for (const r of rows) {
    const t = THREE.MathUtils.clamp((topY - r.y) / (topY - hemY), 0, 1);
    const rx = THREE.MathUtils.lerp(size.rx[0], size.rx[1], t) * inset, rz = THREE.MathUtils.lerp(size.rz[0], size.rz[1], t) * inset;
    // It moves with the panels round it (the same pull toward each thigh), so it never shows through them.
    const follow = t * follows;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const x = Math.sin(a) * rx, z = cz + Math.cos(a) * rz;
      pos.push(x, r.y, z);
      const n = new THREE.Vector3(Math.sin(a) / rx, 0.12, Math.cos(a) / rz).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(r.uv[0], r.uv[1]);
      const left = THREE.MathUtils.smoothstep(x / rx, -0.35, 0.35);
      si.push(BI.hips, BI.thighL, BI.thighR, 0);
      sw.push(1 - follow, follow * left, follow * (1 - left), 0);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < seg; k++) {
    const a = r * (seg + 1) + k, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const n = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aHairB', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aSkinI', new THREE.Float32BufferAttribute(si, 4));
  g.setAttribute('aSkinW', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  return g;
}

async function loadOne(loader: GLTFLoader, g: BaseModelKey): Promise<GlbModel> {
  const url = (u: string) => new URL(u, document.baseURI).href;
  const [gltf, map] = await Promise.all([loader.loadAsync(url(FILES[g].mesh)), new THREE.TextureLoader().loadAsync(url(FILES[g].tex))]);
  map.flipY = false;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  gltf.scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error(`${FILES[g].mesh}: no mesh`);
  const m = mesh as THREE.Mesh;
  const src = m.geometry.clone().applyMatrix4(m.matrixWorld);
  const painted = storedSkin(m);
  const rig = RIGS[g];
  const joint = {} as Record<BoneName, THREE.Vector3>;
  for (const b of BONES) joint[b] = new THREE.Vector3(...rig.joint[b]);

  // Bind frames: at each joint, limbs turned so -y runs down the bone.
  const down = new THREE.Vector3(0, -1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const frame = (at: THREE.Vector3, to?: THREE.Vector3) => {
    const q = to ? new THREE.Quaternion().setFromUnitVectors(down, to.clone().sub(at).normalize()) : new THREE.Quaternion();
    return new THREE.Matrix4().compose(at, q, one);
  };
  const bindFrames = (): THREE.Matrix4[] => BONES.map((b) => {
    const s = b.slice(-1);
    if (b.startsWith('upper_arm')) return frame(joint[b], joint[`forearm${s}` as BoneName]);
    if (b.startsWith('forearm')) return frame(joint[b], joint[`hand${s}` as BoneName]);
    // The hand carries on in the forearm's direction.
    if (b.startsWith('hand')) return frame(joint[b], joint[b].clone().multiplyScalar(2).sub(joint[`forearm${s}` as BoneName]));
    if (b.startsWith('thigh')) return frame(joint[b], joint[`shin${s}` as BoneName]);
    if (b.startsWith('shin')) return frame(joint[b], joint[`foot${s}` as BoneName]);
    return frame(joint[b]);
  });

  let P = src.getAttribute('position') as THREE.BufferAttribute;
  let hair = hairMask(P, src.getAttribute('uv') as THREE.BufferAttribute, map);
  const tris = src.index ? Array.from(src.index.array as ArrayLike<number>) : Array.from({ length: P.count }, (_, i) => i);
  // Twice: the second time measuring distances over the surface without the hand-to-hip bridges,
  // so no weight leaks across them (no triangle is removed from the model itself).
  const bridgeY = joint.hips.y + 0.1;
  // Skirt and kilt panels follow the thighs closely, so a striding leg stays under them.
  const follow = FEMALE.has(g) ? 0.85 : 0.72;
  // Measure the skirt first: its width keeps the hands from claiming its cloth.
  const fit = g === 'm' ? null : fitSkirt(P, src.getAttribute('uv') as THREE.BufferAttribute, map, joint, hair);
  const skirtX = fit && g !== 'f' ? fit.rx[0] / 0.86 : 0;
  const first = autoSkin(P, tris, rig, hair, follow, skirtX, painted);
  // (Without the hand-to-hip bridges only while measuring distances over the surface.)
  const kept = cutBridges(P, tris, first.si, first.sw, bridgeY);
  const skin = autoSkin(P, kept, rig, hair, follow, skirtX, painted);
  // The boot's shaft goes with the shin: only the foot itself turns at the ankle.
  footToAnkle(P, skin.si, skin.sw, joint.footL.y);
  // Where the simplified mesh welded a forearm or hand to the body (an arm resting on a belly or a
  // skirt), give each its own copy of the shared vertices, so the arm lifts away cleanly: no
  // webbing stretched between them and no holes cut in either.
  const split = unweldArms(P, src.getAttribute('normal') as THREE.BufferAttribute, src.getAttribute('uv') as THREE.BufferAttribute, tris, skin.si, skin.sw, hair, joint.upper_armL.y - 0.12);
  P = split.P;
  hair = split.hair;
  const { si, sw } = split;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', P);
  geometry.setAttribute('normal', split.N);
  geometry.setAttribute('uv', split.UV);
  // Colour comes from the texture: white vertex colour, no per-person tint.
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(P.count * 3).fill(1), 3));
  geometry.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array(P.count * 2), 2));
  geometry.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(P.count), 1));
  // Hair vertices, so elders' hair can be drawn grey or white; and the beard (hair on the front of
  // the face, below the eyes), which boys don't have.
  const UV = split.UV;
  const beardTop = joint.head.y + 0.09;
  const beard = new Float32Array(P.count);
  let skinUv = new THREE.Vector2(0.5, 0.5), best = Infinity;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (BEARDED.has(g) && hair[i] && z > joint.head.z + 0.03 && y < beardTop) beard[i] = 1;
    // The bare face: front of the head, between the eyes and the mouth.
    if (!hair[i] && z > joint.head.z + 0.06) {
      const d = Math.abs(x) + Math.abs(y - (joint.head.y + 0.1)) * 2;
      if (d < best) {
        best = d;
        skinUv = new THREE.Vector2(UV.getX(i), UV.getY(i));
      }
    }
  }
  // One attribute for both (0 skin/cloth, 1 hair, 2 beard): WebGL allows only 16 vertex inputs.
  const hb = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) hb[i] = beard[i] ? 2 : hair[i] ? 1 : 0;
  geometry.setAttribute('aHairB', new THREE.Float32BufferAttribute(hb, 1));
  geometry.setAttribute('aSkinI', new THREE.Float32BufferAttribute(si, 4));
  geometry.setAttribute('aSkinW', new THREE.Float32BufferAttribute(sw, 4));
  // Triangles the simplifier turned inside out face the right way again (else they are culled,
  // leaving see-through slivers on wristbands and hems).
  geometry.setIndex(faceOutward(P, split.N, split.index));
  // The founding woman's skirt is closed by a wrap underneath; the other women's models by one sized to them.
  // The founding woman's skirt keeps its tuned wrap; every other model's skirt or kilt gets one
  // measured from its own mesh and cloth (the founding man's kilt needs none).
  const skirt = g === 'f' ? { rx: [0.2, 0.25] as [number, number], rz: [0.128, 0.165] as [number, number], cz: 0.065, cream: fit?.cream, gold: fit?.gold } : g === 'm' ? null : fit ?? rig.skirt;
  // Under a skirt the thighs stay whole (a leg swinging out behind must stay joined), but slimmer
  // inside it, so the panels following them cover them through the stride.
  if (skirt) slimThighs(P, si, sw, joint, skirt.hemY ?? joint.shinL.y + 0.075, rig.girth?.limb ?? 1, texelReader(map, UV));
  // The founding woman's tuned wrap as it was; the measured ones a little further inside their panels.
  const body = skirt ? mergeGeometries([geometry, g === 'f' ? underskirt(P, UV, joint, skirt) : underskirt(P, UV, joint, skirt, follow, 0.9)])! : geometry;
  // The stocky proportions (geometry and joints together), then the bind frames from the final joints.
  const child = g === 'boy' || g === 'girl';
  const tip = new THREE.Vector3(...rig.tipL);
  stockify(body, joint, [tip], child);
  body.computeBoundingSphere();
  const headScale = child ? STOCKY.child.head : STOCKY.adult.head;
  return {
    geometry: body,
    map,
    skinUv,
    hat: { y: rig.hat.y * headScale, z: rig.hat.z * headScale, s: rig.hat.s * headScale },
    joint,
    bindInv: bindFrames().map((mm) => mm.clone().invert()),
    len: {
      upper: joint.upper_armL.distanceTo(joint.forearmL),
      fore: joint.forearmL.distanceTo(joint.handL),
      thigh: joint.thighL.distanceTo(joint.shinL),
      shin: joint.shinL.distanceTo(joint.footL),
      hand: joint.handL.distanceTo(tip),
    },
  };
}

/** A light cloth texel for coloured accessory vertices; the shared colour map is unchanged. */
function lightTexel(map:THREE.Texture):THREE.Vector2 {
  const image=map.image as {width:number;height:number};
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx) return new THREE.Vector2(.5,.5);
  ctx.drawImage(map.image as CanvasImageSource,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
  let best=0,at=0;
  for(let i=0;i<data.length;i+=4){const light=Math.min(data[i],data[i+1],data[i+2]);if(light>best){best=light;at=i/4;}}
  return new THREE.Vector2((at%image.width+.5)/image.width,(Math.floor(at/image.width)+.5)/image.height);
}

/**
 * The islanders' proportions: stocky and fun to watch. Legs are shortened and thickened, the body
 * broadened (the arms riding out with the shoulders, and a touch shorter), and the head enlarged
 * about the neck. Children, whose models already have big heads, get a gentler version.
 */
const STOCKY = {
  adult: { leg: 0.8, legW: 1.12, width: 1.14, depth: 1.07, arm: 0.9, head: 1.3 },
  child: { leg: 0.9, legW: 1.05, width: 1.06, depth: 1.03, arm: 0.95, head: 1.08 },
};
const LEG = new Set<number>([BI.thighL, BI.shinL, BI.footL, BI.thighR, BI.shinR, BI.footR]);
const ARM_L = new Set<number>([BI.upper_armL, BI.forearmL, BI.handL]);
const ARM_R = new Set<number>([BI.upper_armR, BI.forearmR, BI.handR]);

/**
 * Reshape a skinned body to the stocky proportions, in its bind pose: each vertex is moved by the
 * parts it is weighted to (legs, arms, head or trunk), so the seams stay joined; the joints are
 * moved the same way (the caller rebuilds the bind frames and limb lengths from them).
 */
function stockify(geometry: THREE.BufferGeometry, joint: Record<BoneName, THREE.Vector3>, ends: THREE.Vector3[], child: boolean): void {
  const S = child ? STOCKY.child : STOCKY.adult;
  const hipY = joint.hips.y, drop = hipY * (1 - S.leg), zc = joint.hips.z;
  const neck = joint.neck.clone();
  const trunk = (p: THREE.Vector3, out = new THREE.Vector3()) => out.set(p.x * S.width, p.y - drop, zc + (p.z - zc) * S.depth);
  const leg = (p: THREE.Vector3, out = new THREE.Vector3()) => out.set(p.x * S.legW, p.y * S.leg, zc + (p.z - zc) * S.depth);
  const neckAt = trunk(neck);
  const head = (p: THREE.Vector3, out = new THREE.Vector3()) => out.copy(p).sub(neck).multiplyScalar(S.head).add(neckAt);
  const shoulder = { L: trunk(joint.upper_armL), R: trunk(joint.upper_armR) };
  const arm = (p: THREE.Vector3, side: 'L' | 'R', out = new THREE.Vector3()) => trunk(p, out).sub(shoulder[side]).multiplyScalar(S.arm).add(shoulder[side]);

  const P = geometry.getAttribute('position') as THREE.BufferAttribute;
  const SI = geometry.getAttribute('aSkinI') as THREE.BufferAttribute;
  const SW = geometry.getAttribute('aSkinW') as THREE.BufferAttribute;
  const p = new THREE.Vector3(), a = new THREE.Vector3(), acc = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.set(P.getX(i), P.getY(i), P.getZ(i));
    let wl = 0, wh = 0, wal = 0, war = 0;
    for (let k = 0; k < 4; k++) {
      const b = Math.round(SI.getComponent(i, k)), w = SW.getComponent(i, k);
      if (LEG.has(b)) wl += w;
      else if (b === BI.head) wh += w;
      else if (b === BI.neck) wh += w * 0.5;
      else if (ARM_L.has(b)) wal += w;
      else if (ARM_R.has(b)) war += w;
    }
    const wt = Math.max(0, 1 - wl - wh - wal - war);
    acc.set(0, 0, 0);
    if (wl) acc.addScaledVector(leg(p, a), wl);
    if (wh) acc.addScaledVector(head(p, a), wh);
    if (wal) acc.addScaledVector(arm(p, 'L', a), wal);
    if (war) acc.addScaledVector(arm(p, 'R', a), war);
    if (wt) acc.addScaledVector(trunk(p, a), wt);
    const sum = wl + wh + wal + war + wt;
    acc.divideScalar(sum || 1);
    P.setXYZ(i, acc.x, acc.y, acc.z);
  }
  P.needsUpdate = true;
  geometry.computeBoundingSphere();
  // The joints, by the same rules.
  for (const b of BONES) {
    const j = joint[b], i = BI[b];
    if (LEG.has(i)) leg(j, j);
    else if (b === 'head') head(j, j);
    else if (ARM_L.has(i)) arm(j, 'L', j);
    else if (ARM_R.has(i)) arm(j, 'R', j);
    else trunk(j, j);
  }
  // Ends that set limb lengths (finger tips) follow their limb.
  for (const e of ends) arm(e, e.x >= 0 ? 'L' : 'R', e);
}

let pending: Promise<GlbPeople> | null = null;

/** Load (once) every character model. */
export function loadGlbPeople(): Promise<GlbPeople> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const keys = Object.keys(MODEL_FILE) as BaseModelKey[];
  pending = Promise.all(keys.map((k) => loadOne(loader, k))).then((list) => {
    const base = Object.fromEntries(keys.map((k, i) => [k, list[i]])) as Record<BaseModelKey, GlbModel>;
    return { ...base, m_loosehair: characterVariant(base.m, 'm', lightTexel(base.m.map)), f_flower: characterVariant(base.f, 'f', lightTexel(base.f.map)) };
  });
  return pending;
}

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upper_armL: 'shoulderL', forearmL: 'upper_armL', handL: 'forearmL',
  shoulderR: 'chest', upper_armR: 'shoulderR', forearmR: 'upper_armR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};

/**
 * A static copy of a model in a fixed pose (CPU skinned), for figures that never move on their
 * own, such as canoe passengers. Rotations are Euler XYZ per bone with the islander rig's
 * conventions: limbs hang straight down at zero (so upper arms and thighs are absolute to their
 * parent, not the model's A-pose), negative X swings a thigh / upper arm forward, positive shin X
 * bends the knee, negative forearm X bends the elbow. The hips sit at the origin.
 */
export function bakePose(model: GlbModel, rot: Partial<Record<BoneName, [number, number, number]>>): THREE.BufferGeometry {
  const J = model.joint, L = model.len;
  const W: THREE.Matrix4[] = [];
  const e = new THREE.Euler(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), o = new THREE.Vector3();
  for (const b of BONES) {
    const par = PARENT[b];
    if (!par) o.set(0, 0, 0);
    else if (b.startsWith('forearm')) o.set(0, -L.upper, 0);
    else if (b.startsWith('hand')) o.set(0, -L.fore, 0);
    else if (b.startsWith('shin')) o.set(0, -L.thigh, 0);
    else if (b.startsWith('foot')) o.set(0, -L.shin, 0);
    else o.copy(J[b]).sub(J[par]);
    const r = rot[b] ?? [0, 0, 0];
    q.setFromEuler(e.set(r[0], r[1], r[2]));
    const local = new THREE.Matrix4().compose(o, q, one);
    W.push(par ? W[BI[par]].clone().multiply(local) : local);
  }
  // Bind-pose hips at the origin: shift every skin matrix down by the hip height.
  const lift = new THREE.Matrix4().makeTranslation(0, J.hips.y, 0);
  const S = W.map((w, i) => w.clone().multiply(model.bindInv[i]).multiply(lift));
  const src = model.geometry;
  const geo = src.clone();
  geo.deleteAttribute('iAccent');
  const P = geo.getAttribute('position'), N = geo.getAttribute('normal');
  const SI = src.getAttribute('aSkinI'), SW = src.getAttribute('aSkinW');
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    m.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(i, k);
      if (w <= 0) continue;
      const s = S[SI.getComponent(i, k)].elements;
      for (let j = 0; j < 16; j++) m.elements[j] += s[j] * w;
    }
    // Vertices were stored relative to the bind hips; put them back before skinning.
    p.fromBufferAttribute(P, i).sub(o.set(0, J.hips.y, 0)).applyMatrix4(m);
    P.setXYZ(i, p.x, p.y, p.z);
    n.fromBufferAttribute(N, i).applyMatrix3(nm.setFromMatrix4(m)).normalize();
    N.setXYZ(i, n.x, n.y, n.z);
  }
  geo.deleteAttribute('aSkinI');
  geo.deleteAttribute('aSkinW');
  geo.computeBoundingSphere();
  return geo;
}
