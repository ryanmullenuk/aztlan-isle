import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { FireLights, type FireSpot } from '../src/buildings/FireLights';
import { HALL } from '../src/buildings/models';
import { FX, UPGRADES } from '../src/buildings/Upgrades';
import { eveningFire, fireworksPerJar, lightRange, upgradeMood, upgraded } from '../src/buildings/UpgradeEffects';
import { Colony } from '../src/ai/Colony';
import { BuildingKey, COMFORTS, FOOD_KEYS, DECREES, ECONOMY, FIREWORKS, GREAT_HALL, WORLD } from '../src/config';
import { Economy } from '../src/economy/Economy';
import { packFireworks } from '../src/economy/RareGoods';
import { makeIslander } from '../src/entities/Islander';
import { World } from '../src/world/World';

const stub = { half: 100, layerY: () => 0, groundY: () => 0, cellIndexAt: () => 0, heightAt: () => 0 } as any;
let nextId = 1;
/** A finished building at x, z (world) with `n` upgrades. */
function make(key: BuildingKey, n = 0, x = 0, z = 0): Building {
  const b = new Building(nextId++, key, x + 100, z + 100, 0, 0, stub);
  b.complete = true;
  b.tier = n + 1;
  return b;
}

function colony(list: Building[], hour = 19) {
  const eco = new Economy(); eco.res.belief = 0;
  const bld = { list, byId: (id: number) => list.find((b) => b.id === id), of: (k: BuildingKey) => list.filter((b) => b.key === k), nearestStore: () => null } as any;
  const time = { hour, day: 3, isNight: false } as any;
  const c = new Colony(stub, {} as any, eco, bld, { walkable: () => true } as any, time, () => 0.5);
  return { c, eco };
}

test('every step of the village upgrades says what it now does', () => {
  assert.match(UPGRADES.campfire![1].text, /lift the mood and bring Belief half as much again/);
  assert.match(UPGRADES.firepit![0].text, /Roasted meat/);
  assert.equal(UPGRADES.greathall![0].text, `Shelters up to ${FX.greathall.seats[1]}`);
  assert.equal(HALL.seats.length + HALL.stands.length + HALL.crowd.length, FX.greathall.seats[1]);
});

test('upgrades only count while the building is working', () => {
  const w = make('well', 3);
  assert.ok(upgraded(w, 3));
  assert.ok(!upgraded(make('well', 2), 3));
  w.fire = 0.5;
  assert.ok(!upgraded(w, 3), 'on fire');
  w.fire = 0; w.integrity = 0.5;
  assert.ok(!upgraded(w, 1), 'damaged');
  w.integrity = 1; w.repairing = true;
  assert.ok(!upgraded(w, 1), 'under repair');
});

test('flower beds and a fountain cheer those nearby; the palace garden and feast hall everyone', () => {
  const garden = make('chinampa', 3, 0, 0), fountain = make('well', 3, 30, 0);
  const list = [garden, fountain, make('chinampa', 2, 60, 0)];
  assert.equal(upgradeMood(list, garden.x + 2, garden.z + 2), FX.chinampa.mood);
  assert.equal(upgradeMood(list, fountain.x, fountain.z + 5), FX.well.mood);
  assert.equal(upgradeMood(list, list[2].x, list[2].z), 0, 'only two upgrades');
  assert.equal(upgradeMood(list, garden.x, garden.z + FX.chinampa.moodRange + 1), 0, 'too far');
  // Two gardens close by count once.
  assert.equal(upgradeMood([...list, make('chinampa', 3, 1, 1)], garden.x, garden.z), FX.chinampa.mood);
  const all = [...list, make('palace', 1, 500, 500), make('greathall', 3, -500, 0)];
  assert.ok(Math.abs(upgradeMood(all, 200, 200) - (FX.palace.mood + FX.greathall.mood)) < 1e-9);
  assert.equal(upgradeMood([make('greathall', 2)], 0, 0), 0);
  garden.ruined = true;
  assert.equal(upgradeMood(list, garden.x, garden.z), 0);
});

test('the happiness islanders settle towards includes the upgrades round their home', () => {
  const home = make('hut', 0, 0, 0), hall = make('greathall', 3, 50, 50);
  const run = (list: Building[]) => {
    const { c } = colony(list, 9);
    const isl = makeIslander(1, 'Itzel', 'f', 0, 0, () => 0.5);
    isl.home = home.id; isl.happy = 0; isl.condition = 'sick';
    (c as any).goHeal = () => {};
    (c as any).think(isl);
    return isl.happy;
  };
  const without = run([home]), withHall = run([home, hall]);
  assert.ok(Math.abs(withHall - without - FX.greathall.mood * 0.08) < 1e-9);
});

test('evening fires: upgrades widen the pull and scale the mood and Belief', () => {
  assert.deepEqual(eveningFire(make('bonfire')), { range: 1, mood: 1, belief: 1 });
  assert.deepEqual(eveningFire(make('bonfire', 1)), { range: FX.bonfire.range, mood: 1, belief: 1 });
  assert.deepEqual(eveningFire(make('bonfire', 3)), { range: FX.bonfire.range, mood: FX.bonfire.mood, belief: FX.bonfire.belief });
  assert.deepEqual(eveningFire(make('firepit', 2)), { range: 1, mood: FX.firepit.mood, belief: 1 });
  assert.deepEqual(eveningFire(make('firepit', 3)), { range: FX.firepit.range, mood: FX.firepit.mood, belief: 1 });
  assert.deepEqual(eveningFire(make('campfire', 2)), { range: 1, mood: FX.campfire.evening, belief: FX.campfire.evening });
});

test('dancing at an upgraded bonfire brings more Belief and joy', () => {
  const measure = (n: number) => {
    const fire = make('bonfire', n);
    const { c, eco } = colony([fire]);
    const isl = makeIslander(1, 'Tenoch', 'm', fire.x + 1.75, fire.z, () => 0.5);
    isl.happy = 0;
    isl.task = { kind: 'bonfire', target: fire.id, stage: 2, timer: 30, x: isl.x, z: isl.z };
    (c as any).runTask(isl, 10);
    return { happy: isl.happy, belief: eco.res.belief };
  };
  const plain = measure(0), loud = measure(2), feast = measure(3);
  assert.ok(Math.abs(plain.belief - COMFORTS.bonfireBelief * 10) < 1e-9);
  assert.ok(Math.abs(loud.belief - plain.belief * FX.bonfire.belief) < 1e-9);
  assert.equal(loud.happy, plain.happy);
  assert.ok(Math.abs(feast.happy - plain.happy * FX.bonfire.mood) < 1e-9);
});

test('a Long table draws villagers from half as far again', () => {
  const pick = (n: number) => {
    const pit = make('firepit', n, 90, 0);
    const { c } = colony([pit]);
    const isl = makeIslander(1, 'Xochitl', 'f', 0, 0, () => 0.5);
    isl.hunger = 1; isl.rest = 1;
    (c as any).wander = () => {};
    (c as any).think(isl);
    return isl.task?.kind;
  };
  assert.notEqual(pick(2), 'bonfire', '90 paces is too far for a plain fire pit');
  assert.equal(pick(3), 'bonfire');
});

test('a clay oven makes roasted meat a quarter more filling', () => {
  const eat = (n: number) => {
    const pit = make('firepit', n, 10, 0), store = make('grainstore', 0, 0, 0);
    const { c, eco } = colony([pit, store], 12);
    for (const k of FOOD_KEYS) eco.res[k] = 0;
    eco.res.meat = 5;
    const isl = makeIslander(1, 'Citlali', 'f', store.door.x, store.door.z, () => 0.5);
    isl.hunger = 0;
    isl.task = { kind: 'eat', target: store.id, stage: 0, timer: 0, x: store.door.x, z: store.door.z };
    (c as any).travel = () => 'arrived';
    (c as any).runTask(isl, 0.01);
    assert.equal(isl.task?.stage, 2);
    // The rest of the meal comes when it is finished.
    return isl.hunger + ECONOMY.mealRestore;
  };
  const plain = ECONOMY.mealRestore + COMFORTS.firepitMeal;
  assert.ok(Math.abs(eat(0) - plain) < 1e-9);
  assert.ok(Math.abs(eat(1) - plain * FX.firepit.meal) < 1e-9);
});

test('the Great Hall: more benches shelter up to 150, and a bell tower is heard island-wide', () => {
  const hall = make('greathall', 0, 0, 0);
  const { c } = colony([hall], 12);
  assert.equal(c.hallCrowd(hall), 0);
  hall.tier = 2;
  assert.equal(HALL.seats.length + HALL.stands.length + c.hallCrowd(hall), FX.greathall.seats[1]);
  // Every place in a full hall is distinct.
  const spots = new Set<string>();
  for (let k = 0; k < FX.greathall.seats[1]; k++) {
    const p = (c as any).slotPos(k);
    spots.add(`${p.x},${p.z}`);
    assert.ok(Math.abs(p.x) < HALL.edge && Math.abs(p.z) < HALL.edge, 'on the platform');
  }
  assert.equal(spots.size, FX.greathall.seats[1]);
  hall.fire = 1;
  assert.equal(c.hallCrowd(hall), 0, 'only while the hall is working');
  hall.fire = 0;

  const far = GREAT_HALL.callRadius + 40;
  const answer = (n: number) => {
    hall.tier = n + 1;
    const isl = makeIslander(7, 'Yaretzi', 'f', hall.door.x + far, hall.door.z, () => 0.5);
    c.list = [isl];
    return c.sanctuary(hall.x, hall.z, true);
  };
  assert.equal(answer(1), 0, 'out of earshot');
  assert.equal(answer(2), 1, 'the bell tower carries');
  assert.equal(c.list[0].task?.kind, 'hall');
});

test('the Eternal flame trickles Belief; the Treasury finds a pearl each day', () => {
  const fire = make('campfire', 3), palace = make('palace', 2, 50, 50);
  const { c, eco } = colony([fire, palace]);
  (c as any).processPaths = () => {};
  (c as any).assignJobs = () => {};
  (c as any).assignHousing = () => {};
  (c as any).sicken = () => {};
  c.update(60);
  assert.ok(Math.abs(eco.res.belief - FX.campfire.beliefPerMinute) < 1e-6);
  const pearls = eco.goods.pearls;
  (c as any).dawn();
  assert.equal(eco.goods.pearls, pearls + FX.palace.pearlsPerDay);
  palace.tier = 2;
  (c as any).dawn();
  assert.equal(eco.goods.pearls, pearls + FX.palace.pearlsPerDay, 'no treasury yet');
});

test('the second throne: two decrees in force at once, kept apart and only once built', () => {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 900, stone: 900, belief: 100 });
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false, clearArea: () => 0 };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  const p = bld.place('palace', world.half - 7, world.half - 7, 0, true);
  assert.equal(bld.setDecree(p, 'harvest', true), false, 'no second throne yet');
  p.tier = 4;
  assert.equal(bld.setDecree(p, 'build', true), false, 'already in force');
  assert.equal(bld.setDecree(p, 'harvest', true), true);
  assert.deepEqual(bld.decrees(), ['build', 'harvest']);
  assert.equal(bld.decreeFactor('build'), DECREES.build.factor);
  assert.equal(bld.decreeFactor('harvest'), DECREES.harvest.factor);
  assert.equal(bld.decreeFactor('gods'), 1);
  assert.equal(bld.setDecree(p, 'harvest'), false, 'the other throne has it');
  assert.equal(bld.setDecree(p, 'gods'), true);
  assert.deepEqual(bld.decrees(), ['gods', 'harvest']);
  p.fire = 1;
  assert.deepEqual(bld.decrees(), [], 'a burning palace issues none');
});

test('fireworks: a bigger kiln packs more from each jar', () => {
  assert.equal(fireworksPerJar(make('firemaker'), FIREWORKS.perJar), FIREWORKS.perJar);
  assert.equal(fireworksPerJar(make('firemaker', 1), FIREWORKS.perJar), FX.firemaker.perJar);
  const eco = new Economy();
  eco.goods.gunpowder = 1;
  assert.equal(packFireworks(eco, FX.firemaker.perJar), true);
  assert.equal(eco.goods.fireworks, FX.firemaker.perJar);
  eco.goods.gunpowder = 1; eco.goods.fireworks = FIREWORKS.cap - FX.firemaker.perJar + 1;
  assert.equal(packFireworks(eco, FX.firemaker.perJar), false, 'no room');
});

test('a brazier and the Eternal flame light the ground wider and brighter', () => {
  assert.equal(lightRange(make('torch')), 1);
  assert.equal(lightRange(make('torch', 1)), FX.torch.light);
  assert.equal(lightRange(make('campfire', 2)), 1);
  assert.equal(lightRange(make('campfire', 3)), FX.campfire.lightRange);
  const glowOf = (range?: number) => {
    const F = new FireLights() as any;
    const fire: FireSpot = { key: 'a', pos: new THREE.Vector3(0, 0.3, 0), ground: 0, big: false, range };
    F.update(1 / 30, 0, 1, [fire], new THREE.Vector3());
    const m = new THREE.Matrix4(), s = new THREE.Vector3();
    F.glow.getMatrixAt(0, m);
    s.setFromMatrixScale(m);
    const lit = F.lights.find((l: any) => l.key === 'a');
    return { r: s.x, dist: lit.light.distance, bright: lit.bright };
  };
  const plain = glowOf(), wide = glowOf(FX.torch.light);
  assert.ok(Math.abs(wide.r - plain.r * FX.torch.light) < 1e-6);
  assert.ok(Math.abs(wide.dist - plain.dist * FX.torch.light) < 1e-6);
  assert.ok(wide.bright > plain.bright);
});
