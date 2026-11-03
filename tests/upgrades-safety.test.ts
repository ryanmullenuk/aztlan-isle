import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { GameTime } from '../src/world/Time';
import { generateIsland } from '../src/world/generator';
import { Economy } from '../src/economy/Economy';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { StormFire } from '../src/buildings/StormFire';
import { processMedicine } from '../src/buildings/Herbalist';
import { healingCentreModel } from '../src/buildings/models';
import { FX, UPGRADES } from '../src/buildings/Upgrades';
import {
  healerBeds, kennelDogs, lastLonger, lodgeLevel, rareHerbs, seasonFloor, strikeShare, towerAccuracy, towerRange, towerReload, trainSeconds, wellReach, wellRefill,
} from '../src/buildings/SafetyUpgrades';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { Defence, Quarry } from '../src/entities/Defence';
import { Dogs } from '../src/entities/Dogs';
import { Jaguars } from '../src/entities/Jaguars';
import { makeIslander } from '../src/entities/Islander';
import { BUILDINGS, BUILDING_FIRE, DEFENCE, DOGS, FARM_TYPES, HEALTH, HERBALIST, JAGUARS, TIME, WARRIOR, WORLD } from '../src/config';

const flat = { half: 100, layerY: () => 0, groundY: () => 0 } as any;
function make(key: Building['key'], tier = 1, id = 1): Building {
  const b = new Building(id, key, 100, 100, 0, 0, flat);
  b.complete = true;
  b.tier = tier;
  return b;
}
const registry = (list: Building[]) => ({ list, byId: (id: number) => list.find((b) => b.id === id), of: (k: string) => list.filter((b) => b.key === k) }) as any;

test('no upgrade text promises more than its numbers', () => {
  assert.deepEqual(UPGRADES.watchtower!.map((s) => s.text), [
    `Range ${FX.watchtower.range[0]} → ${FX.watchtower.range[1]} paces`,
    `Shoots every ${FX.watchtower.reload[2]} seconds instead of ${FX.watchtower.reload[1]}`,
    `Arrows hit ${FX.watchtower.accuracy[3] * 10} times in 10`,
  ]);
  assert.equal(FX.watchtower.range[0], DEFENCE.range);
  assert.equal(FX.watchtower.reload[0], DEFENCE.reload);
  assert.equal(FX.watchtower.accuracy[0], DEFENCE.accuracy);
  assert.equal(FX.kennel.dogs[0], DOGS.perKennel);
  assert.equal(FX.healer.beds[0], 4);
  assert.match(UPGRADES.herbalist![0].text, new RegExp(`every ${FX.herbalist.seconds / 60} minutes instead of ${HERBALIST.processSeconds / 60}`));
  assert.match(UPGRADES.healer![0].text, new RegExp(`${FX.healer.beds[1]} at once`));
  assert.match(UPGRADES.healer![2].text, new RegExp(`${FX.healer.beds[3]} at once`));
});

test('watchtower upgrades: further, faster and truer, only while the tower is sound', () => {
  const t = make('watchtower');
  assert.deepEqual([towerRange(t), towerReload(t), towerAccuracy(t)], [13, 2.4, 0.8]);
  t.tier = 2;
  assert.deepEqual([towerRange(t), towerReload(t), towerAccuracy(t)], [16, 2.4, 0.8]);
  t.tier = 3;
  assert.deepEqual([towerRange(t), towerReload(t), towerAccuracy(t)], [16, 1.8, 0.8]);
  t.tier = 4;
  assert.deepEqual([towerRange(t), towerReload(t), towerAccuracy(t)], [16, 1.8, 0.9]);
  t.integrity = 0.5;
  assert.equal(towerRange(t), DEFENCE.range, 'damaged: back to the plain tower');

  // A beast at 15 paces: only the taller tower reaches it.
  const shots = (tier: number) => {
    const b = make('watchtower', tier, 9);
    b.group.position.set(0, 1, 0);
    Object.assign(b, { x: 0, z: 0 });
    const D = new Defence({ seed: 3, cellIndexAt: () => 0, heightAt: () => 0.5 } as any, { list: [b] } as any) as any;
    const beast: Quarry = { x: 15, y: 0.5, z: 0 };
    D.hooks = { quarry: () => [{ kind: 'jaguar', ref: beast, aimY: 0.8 }], hit: () => 'hurt', sfx: () => {} };
    for (let k = 0; k < 30 * 30; k++) D.update(1 / 30);
    return D.stats(b).shots;
  };
  assert.equal(shots(1), 0);
  const tall = shots(2), quick = shots(3);
  assert.ok(tall > 0);
  assert.ok(quick > tall, `fire arrows shoot more often (${quick} > ${tall})`);
});

test('kennel upgrades: room for more dogs, and trained dogs always see a jaguar off', () => {
  const k = make('kennel', 1, 1), k2 = make('kennel', 2, 2);
  assert.equal(kennelDogs(k), 3);
  assert.equal(kennelDogs(k2), 4);
  k2.tier = 4;
  assert.equal(kennelDogs(k2), 5);
  const dogs = Object.create(Dogs.prototype) as any;
  dogs.bld = registry([k, k2]);
  assert.equal(dogs.capacity, 8);
  k2.integrity = 0.5;
  assert.equal(dogs.capacity, 3, 'a damaged kennel houses none');
  k2.integrity = 1;
  k2.tier = 2;
  assert.equal(dogs.capacity, 7);
  assert.equal(dogs.trained({ kennel: k.id }), false);
  assert.equal(dogs.trained({ kennel: k2.id }), false);
  k2.tier = 3;
  assert.equal(dogs.trained({ kennel: k2.id }), true);

  // One dog in its face: unlikely to back off, unless it is from the training yard.
  const J = Object.create(Jaguars.prototype) as any;
  let roll = 0.99;
  J.rng = { next: () => roll, range: (a: number) => a, chance: () => false };
  J.hooks = { villagers: () => [], sfx: () => {} };
  const dog = { kennel: k.id };
  J.dogs = { engaged: () => [dog], trained: (d: any) => dogs.trained(d) };
  const jag = () => ({ state: 'stalk', resolved: false, recheck: 0, den: { x: 0, z: 0 }, target: 3, fightDog: -1 });
  const a = jag();
  J.confrontCheck(a, 0.1);
  assert.notEqual(a.state, 'retreat');
  dog.kennel = k2.id;
  const b = jag();
  J.confrontCheck(b, 0.1);
  assert.equal(b.state, 'retreat');
  assert.equal((b as any).driven, true);
});

test('Warrior Lodge upgrades: quicker training, tougher warriors and sharper eyes', () => {
  const lodge = make('warroom');
  assert.equal(trainSeconds(lodge), WARRIOR.trainSeconds);
  lodge.tier = 2;
  assert.equal(trainSeconds(lodge), WARRIOR.trainSeconds / 2);
  assert.equal(lodgeLevel([make('warroom', 1, 2), lodge]), 1);
  lodge.repairing = true;
  assert.equal(lodgeLevel([lodge]), 0);
  assert.equal(trainSeconds(lodge), WARRIOR.trainSeconds);
  lodge.repairing = false;

  // Training at the lodge: the timer starts from the shorter time.
  const colony = new Colony(flat, {} as any, new Economy(), registry([lodge]), {} as any, {} as any, () => 0.5) as any;
  const w = makeIslander(1, 'Itzel', 'f', 0, 0, () => 0.5);
  colony.list = [w];
  colony.travel = () => 'arrived';
  w.task = { kind: 'train', target: lodge.id, stage: 0, timer: 0, x: 0, z: 0, res: 'meat' };
  colony.runTask(w, 0.01);
  assert.equal(w.task.timer, WARRIOR.trainSeconds / 2 - 0.01);

  // Caught by a jaguar: a Training ground makes a warrior harder to kill.
  const J = Object.create(Jaguars.prototype) as any;
  const mauls: boolean[] = [];
  let lodgeLvl = 1;
  J.rng = { next: () => 0.12, range: (a: number) => a, chance: () => false };
  J.dogs = null;
  const warrior = makeIslander(2, 'Tenoch', 'm', 0, 0, () => 0.5);
  warrior.warrior = 'jaguar';
  J.hooks = { villagers: () => [warrior], sfx: () => {}, godMode: () => false, maul: (_i: any, k: boolean) => mauls.push(k), lodge: () => lodgeLvl };
  const pounce = () => J.pounce({ lunge: 0, den: { x: 0, z: 0 } }, warrior);
  pounce();
  lodgeLvl = 2;
  pounce();
  assert.deepEqual(mauls, [true, false], `kill chance ${JAGUARS.killChance * 0.5} → ${(JAGUARS.killChance * 0.5) / FX.warroom.tough}`);

  // A warrior 7 paces from a stalking jaguar: only from an Eagle perch does he spot it.
  const world = new World();
  generateIsland(world, WORLD.islandSeed);
  const spotted = (lvl: number) => {
    const Jg = new Jaguars(world) as any;
    const alarms: number[] = [];
    const j = Jg.list[0];
    const v = makeIslander(3, 'Ollin', 'm', j.x + 7, j.z, () => 0.5);
    v.warrior = 'eagle';
    Jg.hooks = { villagers: () => [v], byId: () => v, alarm: (_x: number, _z: number, r: number) => alarms.push(r), maul: () => {}, godMode: () => true, danger: () => {}, sfx: () => {}, lodge: () => lvl };
    Object.assign(j, { state: 'stalk', target: v.id, stalkT: JAGUARS.stalkTime, noticed: false, resolved: false });
    Jg.think(j, 0.01, false, null);
    return j.noticed;
  };
  assert.ok(7 > JAGUARS.villagerNotice && 7 < JAGUARS.villagerNotice * FX.warroom.sight);
  assert.equal(spotted(2), false);
  assert.equal(spotted(3), true);
});

function fireSetup(rolls: number[] = []) {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 200, stone: 200, belief: 100, grain: 100 });
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  const time = new GameTime(); time.t = .4;
  const pf = new Pathfinder(world), colony = new Colony(world, veg, eco, bld, pf, time, () => .5);
  const fires = new StormFire(world, veg, eco, bld, colony, () => rolls.shift() ?? .5);
  colony.hooks.fireJob = i => fires.job(i);
  colony.hooks.pourWater = b => fires.pour(b);
  const add = (key: Building['key'], x = 10, z = 0) => {
    const size = BUILDINGS[key].size;
    const b = new Building(bld.list.length + 1, key, Math.floor(x + world.half - size[0] / 2), Math.floor(z + world.half - size[1] / 2), 0, 1, world);
    b.complete = true; b.progress = 1;
    b.finished = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    bld.list.push(b);
    for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) world.occ[world.idx(x, z)] = b.id + 1;
    return b;
  };
  const person = (x = 0, z = 0) => { const i = colony.spawn('m', x, z); i.rest = i.hunger = 1; i.think = 1000; return i; };
  return { colony, fires, add, person, rolls };
}

test('well upgrades: buckets fill faster, and water is carried to fires further away', () => {
  const h = fireSetup(), well = h.add('well', -25), house = h.add('hut', 25), p = h.person(-20, 0);
  h.fires.unlocked = true;
  assert.ok(h.fires.ignite(house));
  assert.ok(Math.hypot(well.x - house.x, well.z - house.z) > BUILDING_FIRE.wellReach);
  assert.equal(h.fires.job(p), null, 'too far from the plain well');
  assert.match(h.fires.status(house), /No well near enough/);
  well.tier = 3;
  assert.equal(wellReach(well), BUILDING_FIRE.wellReach * FX.well.range);
  assert.equal(h.fires.job(p)?.well, well, 'the bucket chain reaches it');
  well.integrity = 0.6;
  assert.equal(wellReach(well), BUILDING_FIRE.wellReach);

  // At the well: filling the bucket takes 2 seconds, or 2 / 1.5 with a stone lining.
  well.integrity = 1;
  const fill = (tier: number) => {
    well.tier = tier;
    const c = h.colony as any;
    p.x = well.door.x; p.z = well.door.z;
    c.setTask(p, 'firefight', house.id, well.door.x, well.door.z);
    p.task.building = well.id; p.task.phase = 0;
    c.travel = () => 'arrived';
    c.fightFire(p, 0.01);
    return p.task.timer;
  };
  assert.equal(fill(1), 2);
  assert.equal(fill(2), 2 / FX.well.refill);
  assert.equal(wellRefill(well), FX.well.refill);
});

test('roofed and raised stores catch fire half as often in storms', () => {
  for (const key of ['woodstore', 'grainstore'] as const) {
    const s = make(key);
    assert.equal(strikeShare(s), 1);
    s.tier = 3;
    assert.equal(strikeShare(s), 0.5);
    s.integrity = 0.5;
    assert.equal(strikeShare(s), 1);
    // The next strike's timer, then a bolt on a building (0) that picks the store (last); the fourth roll decides whether it takes.
    const lit = (tier: number, roll: number) => {
      const h = fireSetup([0.5, 0, 0.99, roll]);
      h.add('well', -10);
      const store = h.add(key, 15);
      store.tier = tier;
      h.fires.unlocked = true;
      h.fires.strikeIn = 0;
      h.fires.update(0.1, 'storm');
      return store.fire > 0;
    };
    assert.equal(lit(1, 0.7), true, `${key}: no roof, every bolt that picks it`);
    assert.equal(lit(3, 0.7), false, `${key}: roofed, half of them come down elsewhere`);
    assert.equal(lit(3, 0.3), true);
  }
  assert.equal(strikeShare(make('hut')), 1);
});

test('Healing Centre upgrades: more beds, built into the model, and a steam bath', () => {
  const c = make('healer');
  assert.deepEqual([1, 2, 3, 4].map((t) => ((c.tier = t), healerBeds(c))), [4, 6, 6, 8]);
  const verts = [1, 2, 4].map((t) => healingCentreModel(t).finished.getAttribute('position').count);
  assert.ok(verts[0] < verts[1] && verts[1] < verts[2], `beds are drawn (${verts})`);

  // Six patients: four beds and two indoors, then all in beds once upgraded.
  c.tier = 1;
  const colony = new Colony(flat, {} as any, new Economy(), registry([c]), {} as any, {} as any, () => 0.5) as any;
  colony.list = [1, 2, 3, 4, 5, 6].map((id) => makeIslander(id, `P${id}`, 'f', 0, 0, () => 0.5));
  for (const i of colony.list) { colony.afflict(i, 'sick'); colony.goHeal(i); }
  assert.deepEqual(colony.list.map((i: any) => i.task.slot), [0, 1, 2, 3, -1, -1]);
  c.tier = 2;
  for (const i of colony.list.slice(4)) i.task.slot = colony.freeBed(c);
  assert.deepEqual(colony.list.map((i: any) => i.task.slot), [0, 1, 2, 3, 4, 5]);

  // Steam bath: those in care there hold on half as long again; not those still on their way.
  const [a, b] = colony.list;
  a.task.stage = 3;
  b.task.stage = 0;
  c.tier = 3;
  a.conditionT = b.conditionT = 1000;
  colony.ail(a, 15);
  colony.ail(b, 15);
  assert.equal(a.conditionT, 1000 - 15 / FX.healer.heal);
  assert.equal(b.conditionT, 985);
  assert.equal(lastLonger([c], undefined), 1);
});

test('herbalist upgrades: quicker medicine, longer-lasting patients, and less spread of sickness', () => {
  const eco = new Economy();
  eco.goods.herbs = 2;
  const h = make('herbalist', 2);
  processMedicine(h, eco, FX.herbalist.seconds);
  assert.equal(eco.goods.medicine, 1);
  h.tier = 1;
  processMedicine(h, eco, FX.herbalist.seconds);
  assert.equal(eco.goods.medicine, 1, 'three minutes without drying racks');

  // Remedy shelf: everyone ill anywhere holds on a quarter longer, and more with a steam bath.
  const centre = make('healer', 3, 2);
  h.tier = 3;
  assert.equal(lastLonger([h], undefined), FX.herbalist.illness);
  assert.equal(lastLonger([h, centre], centre), FX.herbalist.illness * FX.healer.heal);
  h.upgrading = true;
  assert.equal(lastLonger([h], undefined), 1, 'not while it is being upgraded');
  h.upgrading = false;
  h.fire = 0.4;
  assert.equal(lastLonger([h], undefined), 1, 'not while it burns');
  h.fire = 0;

  // Healer's lore: a sick housemate passes it on half as often.
  const caught = (tier: number) => {
    h.tier = tier;
    const colony = new Colony(flat, {} as any, new Economy(), registry([h]), {} as any, {} as any, () => 0.5) as any;
    colony.hooks = {};
    colony.list = Array.from({ length: HEALTH.minPopulation }, (_, i) => makeIslander(10 + i, `V${i}`, i % 2 ? 'm' : 'f', 0, 0, () => 0.5));
    const [a, b] = colony.list;
    a.home = b.home = 7;
    colony.afflict(a, 'sick');
    const spread = (HEALTH.spreadChancePerDay * HEALTH.checkSeconds) / TIME.dayLength * HEALTH.herbalistSpread;
    const p = (HEALTH.sickChancePerDay * HEALTH.checkSeconds) / TIME.dayLength;
    const roll = spread * 0.75;
    assert.ok(roll > p && roll > spread * FX.herbalist.spread);
    colony.rnd = () => roll;
    colony.sicken();
    return b.condition === 'sick';
  };
  assert.equal(caught(3), true);
  assert.equal(caught(4), false);
});

test('herbal garden upgrades: full growth all year, and rare herbs that count double', () => {
  const g = make('herbalgarden');
  const floor = FARM_TYPES.herbalgarden!.seasonFloor;
  assert.equal(seasonFloor(g, floor), floor);
  g.tier = 3;
  assert.equal(seasonFloor(g, floor), 1);
  assert.equal(seasonFloor(make('farm', 3), 0), 0);

  assert.equal(rareHerbs(g, 4, () => 0), 4, 'not before the third upgrade');
  g.tier = 4;
  assert.equal(rareHerbs(g, 4, () => 0.2), 8);
  assert.equal(rareHerbs(g, 4, () => 0.5), 4);
  let k = 0;
  assert.equal(rareHerbs(g, 6, () => [0.1, 0.9, 0.9][k++ % 3]), 8, 'one in three');

  // The harvest a gardener carries off.
  const farm = make('herbalgarden', 4, 1), processor = make('herbalist', 1, 2);
  farm.growth = 1;
  const colony = new Colony(flat, {} as any, new Economy(), registry([farm, processor]), {} as any, {} as any, () => 0.2) as any;
  const i = makeIslander(1, 'Itzel', 'f', 0, 0, () => 0.5);
  colony.list = [i];
  i.task = { kind: 'farm', target: 1, stage: 2, timer: 0, x: 0, z: 0 };
  colony.runTask(i, 1);
  assert.equal(i.carry?.res, 'herbs');
  assert.equal(i.carry?.n, 8);
});
