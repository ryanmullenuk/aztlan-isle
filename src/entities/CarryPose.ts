import * as THREE from 'three';
import { BI, type GlbModel } from './glbPeople';
import type { PartKey } from './PeopleModels';

/**
 * How a load is held. Logs, pots, baskets, sacks, stones and meat are carried in both arms in
 * front of the body: the load rests on the palms, fingers angled in toward each other, so both
 * hands are plainly on it (raising the arms overhead tears the skin at the armpits). Hanging fish
 * keep their pole held above the head.
 */
type Hold = 'arms' | 'pole';

interface Grip {
  hold: Hold;
  bottom: number;
  left: THREE.Vector3;
  right: THREE.Vector3;
}
const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const SIDES = ['R', 'L'] as const;
const HOLDS: Partial<Record<PartKey, Hold>> = { log: 'arms', fish: 'pole', stone: 'arms', basket: 'arms', sack: 'arms', meat: 'arms', water: 'arms' };
/** How far the fingers turn in toward each other under a load (radians). */
const TURN_IN = 0.6;

/**
 * Palm up with the fingers forward and turned in toward the middle, for each hand (the .R bones
 * are on the -x side), in the load's frame.
 */
const palmUp = (side: 'R' | 'L') => {
  const q = new THREE.Quaternion().setFromRotationMatrix(side === 'R'
    ? new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0))
    : new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side === 'R' ? 1 : -1) * TURN_IN).multiply(q);
};
/** Fingers up with the palm toward the load's middle (both sides): holding the fish pole. */
const FINGERS_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

/** Two-bone arm placement at the actual load surface; reused scratch objects avoid frame allocations. */
export class CarryPose {
  readonly load = new THREE.Matrix4();
  private grips = new Map<PartKey, Grip>();
  /** Top of the head (in front of any bun), per model. */
  private crowns = new WeakMap<THREE.BufferGeometry, number>();
  private shoulder = new THREE.Vector3();
  private palm = new THREE.Vector3();
  private wrist = new THREE.Vector3();
  private elbow = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private bend = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private fingers = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private loadQ = new THREE.Quaternion();
  private handQ = new THREE.Quaternion();
  private palmUp = { R: palmUp('R'), L: palmUp('L') };
  private local = new THREE.Matrix4();

  constructor(parts: Record<PartKey, THREE.BufferGeometry>) {
    // Find support contacts on the real mesh once, rather than guessing its radius each frame.
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const ray = new THREE.Raycaster();
    for (const [part, hold] of Object.entries(HOLDS) as [PartKey, Hold][]) {
      const geometry = parts[part]; geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
      // Underneath: a log near its ends' inner thirds, anything else toward its outer edges.
      const half = (box.max.x - box.min.x) / 2, mid = (box.min.x + box.max.x) / 2;
      const spread = hold === 'pole' ? .29 : part === 'log' ? .2 : half * .55;
      const contact = (x: number) => {
        ray.set(new THREE.Vector3(x, box.min.y - 1, (box.min.z + box.max.z) / 2), new THREE.Vector3(0, 1, 0));
        const hit = ray.intersectObject(mesh, false)[0];
        if (!hit) throw new Error(`No carrying grip on ${part}`);
        return hit.point.clone();
      };
      this.grips.set(part, { hold, bottom: box.min.y, left: contact(mid - spread), right: contact(mid + spread) });
    }
    material.dispose();
  }

  /** Height of the top of the head over its middle and front (so a bun or plait behind is not the crown). */
  private crown(model: GlbModel): number {
    const g = model.geometry;
    let top = this.crowns.get(g);
    if (top !== undefined) return top;
    const P = g.getAttribute('position'), J = model.joint.head;
    top = -Infinity;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i) - J.z;
      if (Math.abs(x) < 0.05 && z > -0.01 && z < 0.07) top = Math.max(top, P.getY(i));
    }
    if (!Number.isFinite(top)) { g.computeBoundingBox(); top = g.boundingBox!.max.y; }
    this.crowns.set(g, top);
    return top;
  }

  /** Update the model-space prop frame and both hands before skin matrices are uploaded. */
  apply(part: PartKey, model: GlbModel, bones: THREE.Matrix4[], headScale: number): boolean {
    const grip = this.grips.get(part);
    if (!grip) return false; // Chickens keep their existing under-arm pose.
    const J = model.joint;
    let y: number, z: number;
    if (grip.hold === 'pole') {
      // Hanging fish stay in front of the face; their carrying pole sits above the crown.
      const crown = (this.crown(model) - J.head.y) * headScale;
      y = J.head.y - J.chest.y + crown + .02 - grip.left.y; z = .18;
    } else {
      // Resting on the palms just above the waist, held out in front of the belly.
      y = J.hips.y - J.chest.y + .17 - grip.bottom; z = .31;
    }
    this.local.makeTranslation(0, y, z);
    this.load.multiplyMatrices(bones[BI.chest], this.local);
    this.loadQ.setFromRotationMatrix(this.load);
    for (const side of SIDES) {
      const contact = side === 'R' ? grip.left : grip.right;
      this.handQ.copy(this.loadQ).multiply(grip.hold === 'arms' ? this.palmUp[side] : FINGERS_UP);
      this.fingers.set(0, -1, 0).applyQuaternion(this.handQ);
      this.palm.copy(contact).applyMatrix4(this.load);
      // The contact lies on the palm, most of a hand's length past the wrist.
      this.wrist.copy(this.palm).addScaledVector(this.fingers, -model.len.hand * .8);
      this.shoulder.setFromMatrixPosition(bones[BI[`upper_arm${side}`]]);
      this.direction.copy(this.wrist).sub(this.shoulder);
      const distance = this.direction.length();
      const reach = THREE.MathUtils.clamp(distance, Math.abs(model.len.upper - model.len.fore) + .001, model.len.upper + model.len.fore - .001);
      this.direction.divideScalar(distance || 1);
      this.wrist.copy(this.shoulder).addScaledVector(this.direction, reach);
      // Elbows down and a little out by the sides.
      this.bend.set(side === 'R' ? -.55 : .55, -1, -.15).transformDirection(bones[BI.chest]);
      this.bend.addScaledVector(this.direction, -this.bend.dot(this.direction)).normalize();
      const along = (model.len.upper ** 2 - model.len.fore ** 2 + reach ** 2) / (2 * reach);
      const lift = Math.sqrt(Math.max(0, model.len.upper ** 2 - along ** 2));
      this.elbow.copy(this.shoulder).addScaledVector(this.direction, along).addScaledVector(this.bend, lift);
      this.q.setFromUnitVectors(DOWN, this.axis.copy(this.elbow).sub(this.shoulder).normalize());
      bones[BI[`upper_arm${side}`]].compose(this.shoulder, this.q, ONE);
      this.q.setFromUnitVectors(DOWN, this.axis.copy(this.wrist).sub(this.elbow).normalize());
      bones[BI[`forearm${side}`]].compose(this.elbow, this.q, ONE);
      bones[BI[`hand${side}`]].compose(this.wrist, this.handQ, ONE);
    }
    return true;
  }
}
