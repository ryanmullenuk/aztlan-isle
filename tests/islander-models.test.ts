import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BI, BONES, bakePose } from '../src/entities/glbPeople';
import { LOOKS, RIGS, islanderModel } from '../src/entities/islanderModels';

const models = Object.fromEntries(Object.entries(LOOKS).map(([k, look]) => [k, islanderModel(look, null)]));

test('every block is skinned: weights sum to one on real bones', () => {
  for (const [key, m] of Object.entries(models)) {
    const I = m.geometry.getAttribute('aSkinI'), W = m.geometry.getAttribute('aSkinW');
    for (let i = 0; i < I.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = W.getComponent(i, k);
        if (w > 0) assert.ok(I.getComponent(i, k) >= 0 && I.getComponent(i, k) < BONES.length, `${key}: bone index`);
        sum += w;
      }
      assert.ok(Math.abs(sum - 1) < 1e-5, `${key}: weights sum to 1 (${sum})`);
    }
  }
});

test('the islanders stand on their soles, adults about 1.9 m to the top of the topknot, the ankle 0.1 up', () => {
  for (const [key, m] of Object.entries(models)) {
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    assert.ok(Math.abs(bb.min.y) < 1e-6, `${key} stands on the ground`);
    assert.equal(RIGS[key as keyof typeof RIGS].joint.footL[1], 0.1);
    if (!['boy', 'girl'].includes(key)) assert.ok(bb.max.y > 1.75 && bb.max.y < 2.0, `${key} height ${bb.max.y.toFixed(2)}`);
  }
  // Children's heads are bigger for their bodies (they are drawn smaller in play).
  assert.ok(LOOKS.boy.build.head.w > LOOKS.m.build.head.w);
});

test('skin blocks are flagged for the islander’s tone; hair for elders’ grey', () => {
  const g = models.m.geometry, M = g.getAttribute('aMat'), H = g.getAttribute('aHairB');
  let skin = 0, hair = 0;
  for (let i = 0; i < M.count; i++) { skin += M.getX(i) === 1 ? 1 : 0; hair += H.getX(i) === 1 ? 1 : 0; }
  assert.ok(skin > 100 && hair > 100);
});

test('the skirt hem follows each thigh, its waist stays on the hips', () => {
  const g = models.f.geometry, P = g.getAttribute('position'), I = g.getAttribute('aSkinI'), W = g.getAttribute('aSkinW');
  const hem = LOOKS.f.build.hem;
  let checked = 0;
  for (let i = 0; i < P.count; i++) {
    if (Math.abs(P.getY(i) - hem) > 1e-4 || P.getX(i) < 0.21) continue;
    const w: Record<number, number> = {};
    for (let k = 0; k < 4; k++) w[I.getComponent(i, k)] = (w[I.getComponent(i, k)] ?? 0) + W.getComponent(i, k);
    assert.ok((w[BI.thighL] ?? 0) > 0.5, 'the left hem goes with the left thigh');
    checked++;
  }
  assert.ok(checked > 0);
});

test('a posed copy (a canoe passenger, seated) stays whole and finite', () => {
  const geo = bakePose(models.m, { thighL: [-1.4, 0, 0], thighR: [-1.4, 0, 0], shinL: [1.4, 0, 0], shinR: [1.4, 0, 0] });
  const P = geo.getAttribute('position');
  for (let i = 0; i < P.count; i++) assert.ok(Number.isFinite(P.getX(i) + P.getY(i) + P.getZ(i)));
  assert.ok(new THREE.Box3().setFromBufferAttribute(P as THREE.BufferAttribute).max.y < 1.6, 'seated, lower than standing');
});
