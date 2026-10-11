import * as THREE from 'three';
import { BI, type GlbModel } from './glbPeople';
import type { PartKey } from './PeopleModels';

interface Grip {
  bottom: number;
  left: THREE.Vector3;
  right: THREE.Vector3;
}
const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const SIDES = ['R', 'L'] as const;

/** Two-bone arm placement at the actual load surface; reused scratch objects avoid frame allocations. */
export class CarryPose {
  readonly load = new THREE.Matrix4();
  private grips = new Map<PartKey, Grip>();
  private shoulder = new THREE.Vector3();
  private palm = new THREE.Vector3();
  private wrist = new THREE.Vector3();
  private elbow = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private bend = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private handUp = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private handQ = new THREE.Quaternion();
  private turnUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI);
  private local = new THREE.Matrix4();

  constructor(parts: Record<PartKey, THREE.BufferGeometry>) {
    // Find support contacts on the real mesh once, rather than guessing its radius each frame.
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const ray = new THREE.Raycaster();
    for (const part of ['log','stone','basket','sack','fish','meat'] as PartKey[]) {
      const geometry = parts[part]; geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const spread = part === 'log' ? .31 : part === 'fish' ? .29 : part === 'stone' || part === 'meat' ? .06 : .1;
      const mesh = new THREE.Mesh(geometry,material); mesh.updateMatrixWorld();
      const contact = (x: number) => {
        ray.set(new THREE.Vector3(x,box.min.y-1,0),new THREE.Vector3(0,1,0));
        const hit = ray.intersectObject(mesh,false)[0];
        if (!hit) throw new Error(`No carrying grip on ${part}`);
        return hit.point.clone();
      };
      this.grips.set(part,{ bottom:box.min.y, left:contact(-spread), right:contact(spread) });
    }
    material.dispose();
  }

  /** Update the model-space prop frame and both hands before skin matrices are uploaded. */
  apply(part: PartKey, model: GlbModel, bones: THREE.Matrix4[], headScale: number): boolean {
    const grip = this.grips.get(part);
    if (!grip) return false; // Chickens keep their existing under-arm pose.
    const J = model.joint;
    if (!model.geometry.boundingBox) model.geometry.computeBoundingBox();
    const crown = (model.geometry.boundingBox!.max.y - J.head.y) * headScale;
    let y: number, z: number, yaw = 0;
    if (part === 'log') {
      y = J.upper_armL.y - J.chest.y + .1; z = -.12; yaw = .25;
    } else if (part === 'fish') {
      // Hanging fish stay in front of the face; their carrying pole sits above the crown.
      y = J.head.y - J.chest.y + crown + .02 - grip.left.y; z = .18;
    } else {
      y = J.head.y - J.chest.y + crown + .012 - grip.bottom; z = .02;
    }
    this.q.setFromAxisAngle(this.axis.set(0,1,0),yaw);
    this.local.compose(this.axis.set(0,y,z),this.q,ONE);
    this.load.multiplyMatrices(bones[BI.chest],this.local);
    this.handQ.setFromRotationMatrix(this.load).multiply(this.turnUp);
    this.handUp.set(0,-1,0).applyQuaternion(this.handQ);
    for (const side of SIDES) {
      const contact = side === 'R' ? grip.left : grip.right;
      this.palm.copy(contact).applyMatrix4(this.load);
      // The contact lies inside the finger/palm surface, rather than at the wrist joint.
      this.wrist.copy(this.palm).addScaledVector(this.handUp,-model.len.hand*.8);
      this.shoulder.setFromMatrixPosition(bones[BI[`upper_arm${side}`]]);
      this.direction.copy(this.wrist).sub(this.shoulder);
      const distance = this.direction.length();
      const reach = THREE.MathUtils.clamp(distance,Math.abs(model.len.upper-model.len.fore)+.001,model.len.upper+model.len.fore-.001);
      this.direction.divideScalar(distance || 1);
      this.wrist.copy(this.shoulder).addScaledVector(this.direction,reach);
      // Bend the elbow out from the torso in its current frame.
      this.bend.set(side === 'R' ? -1 : 1,-.25,.12).transformDirection(bones[BI.chest]);
      this.bend.addScaledVector(this.direction,-this.bend.dot(this.direction)).normalize();
      const along = (model.len.upper**2-model.len.fore**2+reach**2)/(2*reach);
      const out = Math.sqrt(Math.max(0,model.len.upper**2-along**2));
      this.elbow.copy(this.shoulder).addScaledVector(this.direction,along).addScaledVector(this.bend,out);
      this.q.setFromUnitVectors(DOWN,this.axis.copy(this.elbow).sub(this.shoulder).normalize());
      bones[BI[`upper_arm${side}`]].compose(this.shoulder,this.q,ONE);
      this.q.setFromUnitVectors(DOWN,this.axis.copy(this.wrist).sub(this.elbow).normalize());
      bones[BI[`forearm${side}`]].compose(this.elbow,this.q,ONE);
      bones[BI[`hand${side}`]].compose(this.wrist,this.handQ,ONE);
    }
    return true;
  }
}
