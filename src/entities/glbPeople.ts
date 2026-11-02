import * as THREE from 'three';
import type { CharacterModelKey } from './CharacterVariants';

/**
 * The islanders' skeleton and model format. The models themselves are built from blocks (see
 * islanderModels.ts) on the rig's 19-bone skeleton (hips, spine, chest, neck, head, shoulders,
 * upper arms, forearms, hands, thighs, shins, feet). The islander rig poses those bones every
 * frame and skins all islanders of a model in one instanced draw.
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

/** The base models: the founding man and woman, children, elders and the heavier-built adults. */
export type BaseModelKey = 'm' | 'f' | 'boy' | 'girl' | 'oldm' | 'oldf' | 'fatm' | 'fatf';

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
