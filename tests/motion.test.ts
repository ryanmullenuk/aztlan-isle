import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { WORLD } from '../src/config';
import { Breeze } from '../src/render/Breeze';

test('island movement off: no gusts and no blowing leaves', () => {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  const breeze = new Breeze(w, 3) as any;
  const target = new THREE.Vector3(w.meadow.x, 0, w.meadow.z);
  let gusted = false;
  for (let i = 0; i < 600; i++) {
    breeze.update(0.1, target, 30);
    if (breeze.strength > 0) gusted = true;
  }
  assert.ok(gusted, 'the breeze never blew with movement on');
  breeze.still = true;
  for (let i = 0; i < 600; i++) {
    breeze.update(0.1, target, 30);
    assert.equal(breeze.strength, 0);
    assert.ok(breeze.leaves.every((l: any) => !l.mesh.visible), 'a leaf is still blowing');
  }
});
