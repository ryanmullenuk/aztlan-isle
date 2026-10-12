import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Economy } from '../src/economy/Economy';
import { BuildingSystem, SCAFFOLD_SINK } from '../src/buildings/Buildings';
import { WORLD } from '../src/config';

function setup() {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 500, stone: 500, belief: 100, grain: 100 });
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false, clearArea: () => 0 };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  return { world, bld };
}

test('construction raises the scaffold, then the building, then sinks the scaffold before announcing it', () => {
  const { world, bld } = setup();
  const done: string[] = [], shown: string[] = [];
  bld.onComplete = (b) => done.push(b.key);
  bld.onRevealed = (b) => shown.push(b.key);
  const b = bld.place('hut', world.half - 1, world.half - 1, 0, true);
  // Instant placement has no scaffold to clear: announced straight away.
  assert.deepEqual(shown, ['hut']);
  bld.remove(b, false); shown.length = 0; done.length = 0;

  const h = bld.place('hut', world.half - 1, world.half - 1, 0);
  const at = (p: number) => { h.progress = p; bld.addProgress(h, 1e-6); };
  at(0.15);
  assert.ok(h.scaffold.visible && h.scaffold.scale.y > 0.2 && h.scaffold.scale.y < 0.9, 'scaffold part-way up');
  assert.equal(h.finished.visible, false, 'nothing of the building yet');
  at(0.6);
  assert.equal(h.scaffold.scale.y, 1, 'scaffold fully up');
  assert.ok(h.finished.visible && h.finished.scale.y > 0.2 && h.finished.scale.y < 0.9, 'building rising inside it');

  bld.addProgress(h, 1e6);
  assert.equal(h.complete, true); assert.deepEqual(done, ['hut']);
  assert.deepEqual(shown, [], 'not announced while the scaffold is still standing');
  bld.update(SCAFFOLD_SINK / 2, 0, 0, 0, false, new THREE.Vector3());
  assert.ok(h.scaffold.visible && h.scaffold.position.y < -0.1, 'scaffold sinking into the ground');
  bld.update(SCAFFOLD_SINK, 0, 0, 0, false, new THREE.Vector3());
  assert.equal(h.scaffold.visible, false); assert.equal(h.scaffold.position.y, 0);
  assert.deepEqual(shown, ['hut'], 'announced once the scaffold has gone');
});
