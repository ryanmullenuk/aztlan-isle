import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SeaTurtles } from '../src/entities/SeaTurtles';
import { World } from '../src/world/World';
import { SEA_SURFACE } from '../src/water/Water';
import { generateIsland } from '../src/world/generator';

function fixture(seed = 7) {
  const world = new World(); world.seed = seed; world.layer.fill(-3); world.computeSmooth();
  const turtles = new SeaTurtles(world, SEA_SURFACE);
  return { world, turtles, system: turtles as any, mothers: turtles.list.filter(t => t.family >= 0 && t.mother < 0) };
}

test('two offshore mothers each have three smaller babies with stable family links', () => {
  for (const seed of [7, 31, 99]) {
    const { turtles, mothers } = fixture(seed);
    assert.equal(mothers.length, 2);
    for (const mother of mothers) {
      const babies = turtles.list.filter(t => t.mother === turtles.list.indexOf(mother));
      assert.equal(babies.length, 3);
      assert.ok(babies.every(t => t.family === mother.family && t.scale < mother.scale * .4 && t.state === 'swim'));
      assert.equal(new Set(babies.map(t => t.slot)).size, 3);
    }
    assert.ok(Math.hypot(mothers[0].x - mothers[1].x, mothers[0].z - mothers[1].z) >= 20);
  }
});

test('families spawn in safe water on real generated islands', () => {
  for (const seed of [7, 31]) {
    const world = new World(); generateIsland(world, seed);
    const turtles = new SeaTurtles(world, SEA_SURFACE), system = turtles as any;
    const mothers = turtles.list.filter(t => t.family >= 0 && t.mother < 0);
    assert.equal(mothers.length, 2);
    for (const t of turtles.list.filter(t => t.family >= 0)) assert.equal(system.waterClear(t.x, t.z, t.x, t.z, t.scale), true);
  }
});

test('babies follow turns along their mother trail and families only swim or breathe', () => {
  const { turtles, mothers, system } = fixture(), mother = mothers[0];
  const babies = turtles.list.filter(t => t.mother === turtles.list.indexOf(mother));
  const start = { x: mother.x, z: mother.z };
  mother.heading = 0; mother.tx = mother.x + 6; mother.tz = mother.z + 8; mother.wanderTimer = 100;
  // Keep a nearby beach available: family logic must never request it.
  system.beaches = [{ x: mother.x + 1, z: mother.z + 1 }];
  for (let n = 0; n < 600; n++) {
    for (const t of turtles.list.filter(t => t.family >= 0)) system.think(t, .1);
    for (const t of [mother, ...babies]) {
      assert.ok(t.state === 'swim' || t.state === 'breathe');
      assert.ok(Math.hypot(t.x - mother.x, t.z - mother.z) < 4, 'baby lost its mother');
      assert.ok(t.y <= SEA_SURFACE); assert.ok(Number.isFinite(t.y));
    }
  }
  assert.ok(Math.hypot(mother.x - start.x, mother.z - start.z) > 3);
  assert.ok(mother.trail!.length <= 64);
  assert.ok(babies.every(t => Math.hypot(t.x - start.x, t.z - start.z) > 2));
});

test('water-only movement checks the shell width and swept path against shores and rocks', () => {
  const { world, system } = fixture();
  world.heightAt = (x, z) => Math.abs(x) < .1 && Math.abs(z) < 2 ? 1 : -2;
  assert.equal(system.waterClear(-1, 0, 1, 0, .34), false, 'crossed shore between endpoints');
  assert.equal(system.waterClear(.3, 0, .3, 1, 1.18), false, 'shell overlapped shore');
  assert.equal(system.waterClear(2, 0, 2, 1, 1.18), true);
  world.heightAt = () => -2;
  const cell = world.cellIndexAt(3, 0); world.blockFixed[cell] = 1;
  assert.equal(system.waterClear(2, .5, 4, .5, .34), false, 'crossed submerged fixed rock');
});

test('family breathing returns to swimming and babies and adults fit the same smooth mesh batches', () => {
  const { turtles, mothers, system } = fixture(), mother = mothers[0];
  const baby = turtles.list.find(t => t.mother === turtles.list.indexOf(mother))!;
  for (const t of [mother, baby]) {
    t.breath = 0; system.think(t, .1); assert.equal(t.state, 'breathe');
    for (let n = 0; n < 41; n++) system.think(t, .1);
    assert.equal(t.state, 'swim'); assert.ok(t.breath > 0);
  }
  const meshes = (turtles.meshes as any).meshes;
  assert.equal(meshes.size, 9);
  turtles.meshes.begin();
  for (const t of turtles.list) system.drawTurtle(t, .1);
  turtles.meshes.end();
  for (const { mesh } of meshes.values() as Iterable<any>) {
    assert.equal(mesh.count, turtles.list.length);
    assert.ok(mesh.count <= mesh.instanceMatrix.count);
    const g = mesh.geometry; assert.ok(g.getAttribute('position').count < 15000);
    for (const key of ['position', 'normal', 'color', 'aMat']) for (const v of g.getAttribute(key).array) assert.ok(Number.isFinite(v));
    for (let k = 0; k < mesh.count * 16; k++) assert.ok(Number.isFinite(mesh.instanceMatrix.array[k]));
  }
  // Soft low-poly, as in the reference art: the head is built of flat facets, fine enough to stay rounded.
  const head = meshes.get('head').mesh.geometry, n = head.getAttribute('normal');
  let flat = 0;
  for (let k = 0; k < n.count; k += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(n, k), b = new THREE.Vector3().fromBufferAttribute(n, k + 1);
    if (a.distanceTo(b) < .001) flat++;
  }
  assert.ok(flat > n.count / 3 * 0.95, 'head is drawn as flat facets');
  assert.ok(n.count / 3 > 800, 'enough facets for a rounded head');
});


test('a mother waits when a baby falls behind instead of separating the family', () => {
  const { turtles, mothers, system } = fixture(), mother = mothers[0];
  const baby = turtles.list.find(t => t.mother === turtles.list.indexOf(mother))!;
  mother.tx = mother.x + 6; mother.tz = mother.z; mother.wanderTimer = 100;
  baby.x = mother.x - 3; baby.z = mother.z;
  const x = mother.x, z = mother.z;
  system.think(mother, .1);
  assert.equal(mother.x, x); assert.equal(mother.z, z); assert.equal(mother.speed, 0);
  baby.x = mother.x - 1;
  system.think(mother, .1); assert.ok(mother.speed > 0);
});


test('baby follow targets move continuously between trail samples and swimming eases speed', () => {
  const { turtles, mothers, system } = fixture(), mother = mothers[0];
  const baby = turtles.list.find(t => t.mother === turtles.list.indexOf(mother))!;
  mother.x = 0; mother.z = 0; mother.heading = 0;
  mother.trail = Array.from({ length: 30 }, (_, k) => ({ x: 0, z: -k * .12 }));
  const before = system.followPoint(mother, .6);
  mother.z += .01; const after = system.followPoint(mother, .6);
  assert.ok(Math.abs(after.z - before.z - .01) < 1e-6);
  Object.assign(baby, { x: 0, z: -1.5, heading: 0, speed: 0, state: 'swim', breath: 100 });
  let speed = 0, heading = baby.heading;
  for (let n = 0; n < 120; n++) {
    mother.z += .36 / 60;
    if (Math.hypot(mother.x - mother.trail![0].x, mother.z - mother.trail![0].z) >= .12) mother.trail!.unshift({ x: mother.x, z: mother.z });
    system.think(baby, 1 / 60);
    assert.ok(Math.abs(baby.speed - speed) < .04, 'baby speed jumped');
    assert.ok(Math.abs(baby.heading - heading) < .08, 'baby heading snapped');
    speed = baby.speed; heading = baby.heading;
  }
  assert.ok(baby.z > -1);
});
