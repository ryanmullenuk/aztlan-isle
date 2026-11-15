import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Economy } from '../src/economy/Economy';
import { BuildingSystem } from '../src/buildings/Buildings';
import { PALACE, chinampaModel, kennelModel, palaceModel, wellModel } from '../src/buildings/models';
import { upgradeLooks } from '../src/buildings/looks';
import { collectWater, addPool, curtainFoot, waterGeometry, waterMaterial, WATER_UNIFORMS } from '../src/buildings/water';
import { BUILDINGS, WORLD } from '../src/config';

function setup() {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 900, stone: 900, belief: 100, grain: 100 });
  eco.goods.carvedstone = 200;
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false, clearArea: () => 0 };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  return { world, eco, bld };
}

test('the palace reports its ponds and fountains as moving water, each pond inside its basin', () => {
  const w = palaceModel().water!;
  assert.ok(w, 'the palace has water');
  // Two plaza ponds, the courtyard pond and the fountain's bowl.
  assert.equal(w.pools.length, 4);
  for (const p of PALACE.pools) {
    const pool = w.pools.find((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.z - p.z) < 1e-6);
    assert.ok(pool, `a pond at ${p.x}, ${p.z}`);
    assert.ok(pool.w <= p.w + 1e-6 && pool.d <= p.d + 1e-6, 'within its kerb');
    assert.ok(pool.y > 0.06 && pool.y < 0.2, `below the kerb top (${pool.y})`);
  }
  const bowl = w.jets.find((j) => j.kind === 'bowl')!;
  assert.ok(curtainFoot(bowl) < Math.min(PALACE.pool.w, PALACE.pool.d) / 2, 'the courtyard fountain falls inside its pond');
  const court = w.pools.find((q) => !q.round && Math.abs(q.z - PALACE.pool.z) < 1e-6 && q.x === 0)!;
  assert.ok(court && court.w <= PALACE.pool.w && court.d <= PALACE.pool.d && court.y > PALACE.h && court.y < PALACE.h + 0.22, 'the courtyard pond');
  // A plaza jet in each pond, the courtyard bowl and its four serpent spouts.
  assert.equal(w.jets.filter((j) => j.kind === 'jet').length, 2);
  assert.equal(w.jets.filter((j) => j.kind === 'bowl').length, 1);
  assert.equal(w.jets.filter((j) => j.kind === 'spout').length, 4);
  for (const j of w.jets) {
    const lands = w.pools.some((p) => Math.abs(p.y - j.land) < 1e-6 && Math.abs(j.x - p.x) < p.w / 2 + 0.2 && Math.abs(j.z - p.z) < p.d / 2 + 0.2);
    assert.ok(lands, `the ${j.kind} at ${j.x.toFixed(2)}, ${j.z.toFixed(2)} falls into a pond`);
  }
  for (const p of w.pools) for (const v of [p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2]) assert.ok(Math.abs(v) < 7, 'inside the footprint');
});

test('the palace keeps no painted-on water, and its plants stand still', () => {
  const g = palaceModel().finished;
  const C = g.getAttribute('color'), old = new THREE.Color(0x2f8a92);
  for (let i = 0; i < C.count; i++) assert.ok(!(Math.abs(C.getX(i) - old.r) < 1e-4 && Math.abs(C.getY(i) - old.g) < 1e-4 && Math.abs(C.getZ(i) - old.b) < 1e-4), 'no static water left');
  const V = g.getAttribute('aVeg');
  let swaying = 0;
  for (let i = 0; i < V.count; i++) if (V.getX(i) !== 0) swaying++;
  // (Only the flowers on stems and the vines, which are leaves and never leaned.)
  assert.ok(swaying < V.count * 0.2);
});

test('the well’s shaft holds water, and its fountain upgrade brings a bowl spilling into a basin', () => {
  const well = wellModel().water!;
  assert.ok(well.pools.some((p) => p.round && Math.abs(p.x) < 1e-6 && Math.abs(p.z) < 1e-6), 'water down the shaft');
  assert.equal(well.jets.length, 0);
  const [w, d] = BUILDINGS.well.size as [number, number];
  assert.equal(upgradeLooks('well', 2, w, d)!.water.jets.length, 0, 'no fountain before its upgrade');
  const f = upgradeLooks('well', 3, w, d)!.water;
  const bowl = f.jets.find((j) => j.kind === 'bowl')!;
  assert.ok(bowl, 'the fountain plays');
  const basin = f.pools.find((p) => p.round && Math.abs(p.y - bowl.land) < 1e-6)!;
  assert.ok(basin && Math.hypot(basin.x - bowl.x, basin.z - bowl.z) < 1e-6, 'it spills into its basin');
  assert.ok(curtainFoot(bowl) <= basin.w / 2 + 1e-6, 'its curtain falls inside the basin');
  assert.ok(f.pools.some((p) => p.round && p.y > bowl.land && p.w < basin.w), 'the bowl brims');
});

test('troughs, dishes and the water garden show moving water', () => {
  assert.ok(kennelModel().water!.pools.length >= 1);
  assert.equal(chinampaModel(4, 4).water!.pools.length, 1);
});

test('water geometry: none without water, pools first, then fountains', () => {
  assert.equal(waterGeometry(undefined), null);
  assert.equal(waterGeometry({ pools: [], jets: [] }), null);
  const { water } = collectWater(() => addPool({ x: 0, y: 0.1, z: 0, w: 1, d: 0.5 }));
  const still = waterGeometry(water)!;
  assert.equal(still.pools, still.geo.index!.count, 'a still pool is all pool');
  const w = palaceModel().water!;
  const both = waterGeometry(w)!;
  assert.ok(both.pools > 0 && both.geo.index!.count > both.pools, 'fountains after the pools');
  for (const v of both.geo.getAttribute('position').array) assert.ok(Number.isFinite(v));
  assert.ok(waterMaterial() === waterMaterial(), 'one shared material');
  assert.ok((waterMaterial().uniforms.uTime as unknown) === WATER_UNIFORMS.uTime, 'driven by one shared clock');
});

test('placed buildings carry their water mesh, shown once finished', () => {
  const { world, bld } = setup();
  const p = bld.place('palace', world.half - 7, world.half - 7, 0, true);
  assert.ok(p.water, 'the palace has its water');
  assert.equal(p.water!.parent, p.finished, 'riding on its model');
  bld.update(0.016, 1, 0, 0, false, new THREE.Vector3());
  assert.ok(p.water!.visible, 'shown on a finished palace');
  const hut = bld.place('hut', world.half + 10, world.half + 10, 0, true);
  assert.equal(hut.water, undefined, 'no water where there is none');
  const site = bld.place('well', world.half + 14, world.half - 12, 0, true);
  site.complete = false;
  bld.update(0.016, 1, 0, 0, false, new THREE.Vector3());
  assert.ok(site.water && !site.water.visible, 'not while it is going up');
});
