import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Demolition } from '../src/buildings/Demolition';

test('rubble stays in footprint, sinks, and clears at ten seconds without disposing shared materials', () => {
  const material = new THREE.MeshStandardMaterial();
  let materialDisposed = false, cleared = 0;
  material.addEventListener('dispose', () => materialDisposed = true);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), material);
  const effect = new Demolition({ id: 2, x: 0, y: 1, z: 0, w: 3, d: 4, complete: true, foundation: mesh, finished: mesh, group: new THREE.Group() } as any, () => cleared++) as any;
  const scene = new THREE.Scene(); scene.add(effect.group);
  assert.equal(effect.update(1.2), false);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < effect.rubble.count; i++) {
    effect.rubble.getMatrixAt(i,m); m.decompose(p,q,s);
    assert.ok(Math.abs(p.x)+s.x <= 1.5 && Math.abs(p.z)+s.z <= 2);
  }
  assert.equal(effect.update(8.7), false); assert.equal(cleared, 0);
  effect.rubble.getMatrixAt(0,m); assert.ok(m.elements[13] < 0);
  assert.equal(effect.update(0.11), true); assert.equal(cleared, 1);
  assert.equal(effect.group.parent, null); assert.equal(materialDisposed, false);
});
