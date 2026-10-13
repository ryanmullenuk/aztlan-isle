import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Economy } from '../src/economy/Economy';
import { BuildingSystem } from '../src/buildings/Buildings';
import { palaceModel } from '../src/buildings/models';
import { buildingNotice } from '../src/ui/buildingNotice';
import { BUILD_MENU } from '../src/ui/tools';
import { BUILD_STAGE } from '../src/economy/Progression';
import { BUILDINGS, DECREES, PALACE_RULES, WORLD } from '../src/config';

function setup() {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 900, stone: 900, belief: 100, grain: 100 });
  eco.goods.carvedstone = 200;
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false, clearArea: () => 0 };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  return { world, eco, bld };
}

test('the palace is twice the Great Hall, a late monument in the build menu', () => {
  const [w, d] = BUILDINGS.palace.size, [hw, hd] = BUILDINGS.greathall.size;
  assert.deepEqual([w, d], [hw * 2, hd * 2]);
  assert.ok(BUILD_MENU.includes('palace'));
  assert.ok((BUILD_STAGE.palace ?? 0) > (BUILD_STAGE.greathall ?? 0));
  assert.ok(BUILDINGS.palace.buildTime > BUILDINGS.greathall.buildTime * 2 && BUILDINGS.palace.buildTime < BUILDINGS.greattemple.buildTime);
  assert.ok((BUILDINGS.palace.cost.carvedStone ?? 0) > 0, 'built of carved stone');
  assert.equal(buildingNotice({ key: 'palace', tier: 1, label: BUILDINGS.palace.name, lastWork: { upgrade: false, fromTier: 1 } }).benefit, 'Royal decrees can now be issued');
});

test('the palace model fills its footprint, rises in four phases and has lit braziers', () => {
  const m = palaceModel();
  m.finished.computeBoundingBox();
  const bb = m.finished.boundingBox!;
  for (const v of [bb.min.x, bb.min.z]) assert.ok(v >= -7.01 && v < -6.5, `footprint edge ${v}`);
  for (const v of [bb.max.x, bb.max.z]) assert.ok(v <= 7.01 && v > 6.5, `footprint edge ${v}`);
  assert.ok(bb.max.y > 4.5, 'taller than the Great Hall');
  const phases = m.finished.userData.constructionPhases as number[];
  assert.equal(phases.length, 4);
  assert.equal(phases[3], m.finished.index!.count);
  assert.ok(phases.every((p, k) => k === 0 || p > phases[k - 1]));
  assert.ok(m.torches.length >= 8);
});

test('decrees: one in force from a standing palace, changed for Belief, speeding their work', () => {
  const { world, eco, bld } = setup();
  assert.equal(bld.decree(), null);
  assert.equal(bld.decreeFactor('build'), 1);
  const p = bld.place('palace', world.half - 7, world.half - 7, 0, true);
  assert.equal(bld.decree(), PALACE_RULES.firstDecree);
  assert.equal(bld.decreeFactor('build'), DECREES.build.factor);
  // Build Together: a hut goes up 25% faster.
  const hut = bld.place('hut', world.half + 10, world.half + 10, 0);
  bld.addProgress(hut, 10);
  assert.ok(Math.abs(hut.progress - (10 * DECREES.build.factor) / BUILDINGS.hut.buildTime) < 1e-9);

  const belief = eco.res.belief;
  assert.equal(bld.setDecree(p, 'build'), false, 'already in force');
  assert.equal(bld.setDecree(p, 'harvest'), true);
  assert.equal(eco.res.belief, belief - PALACE_RULES.decreeCost);
  assert.equal(bld.decree(), 'harvest');
  assert.equal(bld.decreeFactor('build'), 1);
  assert.equal(bld.decreeFactor('harvest'), DECREES.harvest.factor);
  eco.res.belief = 0;
  assert.equal(bld.setDecree(p, 'gods'), false, 'not enough Belief');
  bld.remove(p, false);
  assert.equal(bld.decree(), null, 'no palace, no decree');
});
