import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IslanderRig, poseFor } from '../src/entities/IslanderRig';
import { BI, BONES, RIGS, type BoneName } from '../src/entities/glbPeople';

/** A rig posing the founding man's skeleton, without loading any model files. */
function rigFor(key: keyof typeof RIGS = 'm') {
  const r = RIGS[key];
  const joint = Object.fromEntries(BONES.map((b) => [b, new THREE.Vector3(...r.joint[b])])) as Record<BoneName, THREE.Vector3>;
  const model: any = {
    joint,
    len: {
      upper: joint.upper_armL.distanceTo(joint.forearmL), fore: joint.forearmL.distanceTo(joint.handL),
      thigh: joint.thighL.distanceTo(joint.shinL), shin: joint.shinL.distanceTo(joint.footL), hand: 0.18,
    },
  };
  const rig: any = Object.create(IslanderRig.prototype);
  Object.assign(rig, {
    e: new THREE.Euler(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), tmp: new THREE.Matrix4(),
    W: BONES.map(() => new THREE.Matrix4()), blends: new Map(), groundAt: null,
  });
  return { rig, model };
}
const person = (anim: string, animT: number): any => ({ id: 7, anim, animT, gender: 'm', task: null, carry: null, heading: 0, x: 0, y: 0, z: 0, floorY: null });
const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
/** How far a bone's frame is tipped from upright (radians). */
const tilt = (m: THREE.Matrix4) => new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m)).angleTo(new THREE.Vector3(0, 1, 0));

test('walking: one foot is always planted flat on the ground; the swinging foot hangs from its shin', () => {
  const { rig, model } = rigFor();
  for (let k = 0; k < 24; k++) {
    const p = poseFor(person('walk', (k / 24) * ((Math.PI * 2) / 7.5)), false);
    rig.poseSkeleton(model, p, 1, 0, 0);
    const feet = [[BI.footR, p.plantL, BI.shinR], [BI.footL, p.plantR, BI.shinL]] as const; // L = -x = the model's .R bones
    const low = Math.min(at(rig.W[BI.footL]).y, at(rig.W[BI.footR]).y);
    assert.ok(Math.abs(low - 0.1) < 0.003, `the lower ankle stands on the ground (${low})`);
    assert.ok(Math.max(p.plantL, p.plantR) > 0.85, 'a foot is planted at every moment of the stride');
    for (const [foot, plant, shin] of feet) {
      if (plant > 0.99) assert.ok(tilt(rig.W[foot]) < 0.5, 'a planted foot lies nearly flat (heel and toe roll aside)');
      // Swinging: the boot follows the shin rather than staying level with the ground.
      if (plant < 0.01) assert.ok(tilt(rig.W[foot]) > tilt(rig.W[shin]) * 0.5 - 0.05, 'a swinging foot follows its shin');
    }
  }
});

test('the stride keeps a believable knee bend and never hops', () => {
  const { rig, model } = rigFor();
  let lowHip = Infinity, highHip = -Infinity;
  for (let k = 0; k < 24; k++) {
    const p = poseFor(person('walk', (k / 24) * ((Math.PI * 2) / 7.5)), false);
    assert.ok(p.shL < 1.0 && p.shR < 1.0, 'no knee kicks up behind past 57°');
    rig.poseSkeleton(model, p, 1, 0, 0);
    const y = at(rig.W[BI.hips]).y;
    lowHip = Math.min(lowHip, y); highHip = Math.max(highHip, y);
  }
  assert.ok(highHip - lowHip < 0.06, `the hips rise and fall gently (${(highHip - lowHip).toFixed(3)} m)`);
});

test('on a slope each foot stands on its own ground (two-bone IK), within a centimetre', () => {
  const { rig, model } = rigFor('fatf');
  for (const [gL, gR] of [[0.05, -0.05], [-0.06, 0.02], [0.08, 0.08]]) {
    rig.poseSkeleton(model, poseFor(person('idle', 0), true), 1, gL, gR);
    // groundL is the islander's L (-x) foot: the model's .R bones.
    assert.ok(Math.abs(at(rig.W[BI.footR]).y - (0.1 + gL)) < 0.01, `left foot on its ground (${gL})`);
    assert.ok(Math.abs(at(rig.W[BI.footL]).y - (0.1 + gR)) < 0.01, `right foot on its ground (${gR})`);
  }
});

test('changing activity blends the pose over a fraction of a second instead of snapping', () => {
  const { rig } = rigFor();
  const isl = person('walk', 0.3);
  const walk = rig.blend(isl, poseFor(isl, false), 1 / 60);
  isl.anim = 'chop';
  const first = rig.blend(isl, poseFor(isl, false), 1 / 60);
  const target = poseFor(isl, false);
  assert.ok(Math.abs(first.uaRx - walk.uaRx) < Math.abs(target.uaRx - walk.uaRx) * 0.2, 'the first frame stays close to the walk');
  let p = first;
  for (let k = 0; k < 30; k++) p = rig.blend(isl, poseFor(isl, false), 1 / 60);
  assert.ok(Math.abs(p.uaRx - poseFor(isl, false).uaRx) < 1e-9, 'and settles fully into the new activity');
});
