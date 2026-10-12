import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';
import { World } from '../src/world/World';
import { GameTime } from '../src/world/Time';
import { Economy } from '../src/economy/Economy';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { StormFire } from '../src/buildings/StormFire';
import { buildingOperational } from '../src/buildings/BuildingCondition';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { Powers } from '../src/economy/Powers';
import { Lightning } from '../src/render/Lightning';
import { fireBuildingCard } from '../src/ui/FireBuildingCard';
import { BUILDINGS, ISLANDER, WORLD } from '../src/config';
import { serialize, applyRest } from '../src/world/Save';
import { islandFile, parseIslandFile } from '../src/world/IslandFile';
import { UI } from '../src/ui/UI';

function setup() {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 200, stone: 200, belief: 100, grain: 100 });
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  const time = new GameTime(); time.t = .4;
  const pf = new Pathfinder(world), colony = new Colony(world, veg, eco, bld, pf, time, () => .5);
  const fires = new StormFire(world, veg, eco, bld, colony, () => .5);
  colony.hooks.fireJob = i => fires.job(i);
  colony.hooks.fireRouteFailed = (i, well, fire) => fires.routeFailed(i, well, fire);
  colony.hooks.pourWater = b => fires.pour(b);
  Object.assign(colony, { jobTimer: 10000, houseTimer: 10000, healthTimer: 10000, lastDay: time.day });
  const c = colony as any;
  const add = (key: Building['key'], x = 10, z = 0) => {
    const size = BUILDINGS[key].size;
    const b = new Building(bld.list.length + 1, key, Math.floor(x + world.half - size[0] / 2),
      Math.floor(z + world.half - size[1] / 2), 0, 1, world);
    b.complete = true; b.progress = 1;
    b.foundation = new THREE.Mesh(new THREE.BoxGeometry(1, .2, 1));
    b.finished = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    b.scaffold = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    b.group.add(b.foundation, b.finished, b.scaffold); bld.list.push(b); bld.group.add(b.group);
    for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) world.occ[world.idx(x, z)] = b.id + 1;
    return b;
  };
  const person = (x = 0, z = 0) => { const i = colony.spawn('m', x, z); i.rest = i.hunger = 1; i.think = 1000; return i; };
  const tick = (dt = .1, weather: 'storm' | 'rain' | 'clear' = 'clear') => { fires.update(dt, weather); colony.update(dt); };
  return { world, eco, veg, bld, time, pf, colony, fires, c, add, person, tick };
}

test('early villages are protected until a working well and Calm resources are available; unlock persists', () => {
  const h = setup(), house = h.add('hut');
  h.fires.update(1, 'storm'); assert.equal(h.fires.ignite(house), false);
  const well = h.add('well', -10); h.eco.res.belief = 49;
  h.fires.update(1, 'storm'); assert.equal(h.fires.unlocked, false);
  h.eco.res.belief = 50; h.fires.update(1, 'storm'); assert.equal(h.fires.unlocked, true);
  h.eco.res.belief = 0; well.integrity = .5; h.fires.update(1, 'clear'); assert.equal(h.fires.unlocked, true);
  assert.equal(h.fires.ignite(house), true);
  const f = setup(); f.fires.restore(h.fires.save()); assert.equal(f.fires.unlocked, true);
});

test('most land strikes are harmless; strikes, fire effects and dispatch have fixed bounds', () => {
  const h = setup(); h.add('well', -15); const homes = [h.add('hut', 15), h.add('hut', 25), h.add('hut', 35)];
  h.fires.update(1, 'clear'); let strikes = 0; h.fires.onStrike = () => strikes++;
  h.fires.strikeIn = 0; h.fires.update(.1, 'storm'); assert.equal(homes.filter(b => b.fire > 0).length, 0);
  h.fires.ignite(homes[0]); h.fires.ignite(homes[1]); assert.equal(h.fires.ignite(homes[2]), false);
  h.fires.render(1, new THREE.PerspectiveCamera());
  assert.equal((h.fires as any).flames.count, 6); assert.equal((h.fires as any).bars.count, 2);
  const health = homes.map(b => b.integrity), timer = h.fires.strikeIn;
  h.fires.update(0, 'storm'); h.fires.update(-1, 'storm');
  assert.deepEqual(homes.map(b => b.integrity), health); assert.equal(h.fires.strikeIn, timer);
  h.fires.update(10, 'clear'); assert.equal(strikes, 1);
});

test('rain slows damage, Calm stops new strikes, and extinguishing never restores condition', () => {
  const wet = setup(), dry = setup(); wet.fires.unlocked = dry.fires.unlocked = true;
  const a = wet.add('hut'), b = dry.add('hut'); wet.fires.ignite(a); dry.fires.ignite(b);
  wet.fires.update(10, 'rain'); dry.fires.update(10, 'clear'); assert.ok(a.integrity > b.integrity);
  const eco = wet.eco, power: any = Object.create(Powers.prototype);
  Object.assign(power, { state: 'storm', eco, time: wet.time, notify() {}, onStormEnd() {} });
  power.calm(); assert.equal(power.state, 'clear'); assert.equal(eco.res.belief, 50);
  wet.fires.strikeIn = 0; let newStrikes = 0; wet.fires.onStrike = () => newStrikes++;
  wet.fires.update(1, power.state); assert.equal(newStrikes, 0); assert.ok(a.fire > 0);
  const damaged = a.integrity; wet.fires.pour(a); wet.fires.pour(a); wet.fires.pour(a);
  assert.equal(a.fire, 0); assert.equal(a.integrity, damaged); assert.equal(buildingOperational(a), false);
});

test('water collection and pouring use real queued routes, carry no inventory resources and extinguish fires', () => {
  const h = setup(), well = h.add('well', -5), house = h.add('hut', 5), p = h.person();
  h.fires.unlocked = true; h.fires.ignite(house);
  house.fire = 1; // A developed fire requires repeated water trips even with stronger buckets.
  const wood = h.eco.res.wood, stone = h.eco.res.stone, phases = new Set<number>();
  for (let n = 0; n < 1500 && house.fire > 0; n++) {
    h.tick(); if (p.task?.kind === 'firefight') phases.add(p.task.phase ?? 0);
  }
  assert.equal(house.fire, 0); assert.ok(house.integrity < 1 && house.integrity > 0);
  assert.deepEqual([...phases].sort(), [0, 1, 2, 3]); assert.equal(p.carry, null);
  assert.equal(h.eco.res.wood, wood); assert.equal(h.eco.res.stone, stone);
  assert.ok(h.colony.pathStats.completed >= 4); assert.equal(well.integrity, 1);
});

test('manual jobs, deliveries, reservations, rest, illness and young islanders are not recruited', () => {
  const h = setup(), well = h.add('well', -5), house = h.add('hut', 5); h.fires.unlocked = true; h.fires.ignite(house);
  const ordered = h.person(); ordered.manualRole = true;
  const delivery = h.person(); delivery.carry = { kind: 'log', res: 'wood', n: 3 }; h.c.setTask(delivery, 'deliver', -1, 0, 0);
  const harvest = h.person(); h.c.setTask(harvest, 'gather', 0, 0, 0); h.veg.plants.push({ reservedBy: harvest.id });
  const asleep = h.person(); asleep.sleeping = true;
  const hungry = h.person(); hungry.hunger = .1;
  const tired = h.person(); tired.rest = .1;
  const child = h.person(); child.child = true;
  const sick = h.person(); sick.condition = 'sick';
  const before = h.colony.list.map(i => ({ task: i.task, carry: i.carry }));
  for (const p of h.colony.list) h.c.tryFirefighting(p);
  h.colony.list.forEach((p, n) => { assert.equal(p.task, before[n].task); assert.equal(p.carry, before[n].carry); });
  assert.equal(h.veg.plants[0].reservedBy, harvest.id);
  const available = h.person(); h.c.setTask(available, 'flee', well.id, well.door.x, well.door.z); available.hidden = true;
  h.c.tryFirefighting(available); assert.equal(available.task!.kind, 'firefight'); assert.equal(available.hidden, false);
  const task = available.task; h.colony.shelterFromStorm(); assert.equal(available.task, task);
});

test('unreachable wells fail safely through the normal queue and are not retried every frame', () => {
  const h = setup(), well = h.add('well', -5), house = h.add('hut', 5), p = h.person();
  h.fires.unlocked = true; h.fires.ignite(house);
  // Trap the access point inside a separate solid obstacle, not the well's allowed footprint.
  const [cx, cz] = h.world.cellOf(well.door.x, well.door.z);
  for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 2; x <= cx + 2; x++) h.world.occ[h.world.idx(x, z)] = 999;
  h.world.navigationVersion++;
  for (let n = 0; n < 80; n++) h.tick();
  assert.ok(house.fire > 0); assert.ok((h.fires as any).failed.size > 0);
  const queued = h.colony.pathStats.queued;
  for (let n = 0; n < 80; n++) { h.fires.update(.1, 'clear'); h.c.tryFirefighting(p); }
  assert.equal(h.colony.pathStats.queued, queued);
  for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 2; x <= cx + 2; x++) if (h.world.occ[h.world.idx(x, z)] === 999) h.world.occ[h.world.idx(x, z)] = 0;
  h.world.navigationVersion++; h.fires.update(.1, 'clear'); h.c.releaseTask(p); h.c.tryFirefighting(p);
  assert.equal(p.task!.kind, 'firefight');
});

test('occupied homes and shelters evacuate without losing unrelated resource reservations', () => {
  const h = setup(), home = h.add('home'), sleepers = [h.person(), h.person(), h.person()];
  const kinds = ['sleep', 'flee', 'hall'] as const;
  sleepers.forEach((p, n) => { p.home = home.id; h.c.setTask(p, kinds[n], home.id, home.x, home.z); p.hidden = true; p.sleeping = n === 0; });
  const collector = h.person(); h.c.setTask(collector, 'gather', 0, 0, 0); h.veg.plants.push({ reservedBy: collector.id });
  h.fires.unlocked = true; h.fires.ignite(home);
  for (const p of sleepers) { assert.equal(p.hidden, false); assert.equal(p.sleeping, false); assert.equal(p.task, null); assert.equal(p.x, home.door.x); }
  assert.equal(home.housing, 0); assert.equal(h.veg.plants[0].reservedBy, collector.id);
  h.c.goSleep(sleepers[0]); assert.notEqual(sleepers[0].task!.target, home.id);
});

test('production and active worker tasks stop when damaged and resume only after paid builder repairs', () => {
  const h = setup(), farm = h.add('farm'); farm.growth = .2; const p = h.person(); p.role = 'farmer'; p.workplace = farm.id;
  h.c.work(p); farm.integrity = .6;
  h.c.runTask(p, 1); assert.equal(p.task, null); assert.equal(h.c.work(p), false);
  h.bld.update(5, 1, 0, 0, false, new THREE.Vector3()); assert.equal(farm.growth, .2);
  const cost = h.bld.repairCost(farm), before = h.eco.res.wood;
  h.bld.repair(farm); assert.equal(farm.repairing, true); assert.equal(h.eco.res.wood, before - cost.wood);
  h.bld.repair(farm); assert.equal(h.eco.res.wood, before - cost.wood);
  p.role = 'builder'; p.workplace = farm.id; h.c.work(p); h.c.travel = () => 'arrived';
  for (let n = 0; n < 10 && farm.repairing; n++) { if (!p.task) h.c.work(p); h.c.runTask(p, 4); }
  assert.equal(farm.integrity, 1); assert.equal(farm.repairing, false); assert.equal(farm.progress, 1);
  h.bld.update(1, 2, 0, 0, false, new THREE.Vector3()); assert.ok(farm.growth > .2);
});

test('destruction leaves blocked rebuildable ruins, retaining tier and upgrade progress through repair', () => {
  const h = setup(), b = h.add('home'); b.tier = 3; b.upgrading = true; b.progress = .37;
  h.fires.unlocked = true; h.fires.ignite(b); b.integrity = .001;
  let removals = 0; h.bld.onRemove = () => removals++;
  h.fires.update(1, 'clear'); assert.equal(b.ruined, true); assert.equal(b.fire, 0); assert.equal(removals, 1);
  assert.equal(b.housing, 0); assert.equal(b.finished.scale.y, .15); assert.equal(h.bld.byId(b.id), b);
  assert.equal(h.world.occ[h.world.idx(b.cx, b.cz)], b.id + 1);
  h.eco.res.wood = h.eco.res.stone = 200;
  h.bld.repair(b); h.bld.addProgress(b, 100);
  assert.equal(b.ruined, false); assert.equal(b.tier, 3); assert.equal(b.upgrading, true); assert.equal(b.progress, .37);
  assert.equal(b.integrity, 1); assert.equal(b.finished.scale.y, 1);
});

test('damaged wells cannot supply water, repairs require resources, and burning repairs cannot start', () => {
  const h = setup(), well = h.add('well'), home = h.add('hut', 20), p = h.person(); h.fires.unlocked = true;
  well.integrity = .5; h.fires.ignite(home); assert.equal(h.fires.job(p), null);
  assert.match(h.fires.status(home), /No working well/);
  h.eco.res.wood = h.eco.res.stone = 0; assert.match(h.bld.repair(well), /need/); assert.equal(well.repairing, false);
  h.eco.res.wood = h.eco.res.stone = 200; assert.match(h.bld.repair(home), /Extinguish/); assert.equal(home.repairing, false);
  h.bld.repair(well); h.bld.addProgress(well, 100); h.fires.update(.1, 'clear'); assert.equal(h.fires.job(p)?.well, well);
});

test('fire card shows condition, repair costs and Calm; ruined cards offer rebuilding with levels retained', () => {
  const h = setup(), b = h.add('well'); b.integrity = .4; b.fire = .6;
  const dom = new JSDOM(fireBuildingCard(b, 'Fetching water.', h.bld.repairCost(b), true, true));
  assert.match(dom.window.document.body.textContent!, /supplies islanders fighting building fires/);
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('[data-a="repair"]')!.disabled, true);
  assert.ok(dom.window.document.querySelector('[data-a="calmfire"]'));
  b.fire = 0; b.ruined = true; b.integrity = 0;
  dom.window.document.body.innerHTML = fireBuildingCard(b, 'Destroyed.', h.bld.repairCost(b), true, false);
  assert.match(dom.window.document.body.textContent!, /Rebuild.*wood.*stone/s);
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('[data-a="repair"]')!.disabled, false);
  dom.window.close();
});

test('lightning on land uses bounded existing buffers without ocean spray', () => {
  const bolt: any = new Lightning();
  bolt.strike(0, 1, 0, 25, new THREE.Vector3(10, 10, 10), () => .5, 1, false);
  assert.equal(bolt.spray.points.geometry.drawRange.count, 0);
  assert.equal(bolt.spray.count, 0); assert.ok(bolt.steam.count > 0);
  assert.ok(bolt.mesh.geometry.drawRange.count <= bolt.mesh.geometry.index.count);
  for (const number of bolt.mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(number));
});

test('fires, ruins and paid repairs survive real serialisation and restore; older saves stay undamaged', async () => {
  const h = setup(); h.add('campfire', -20); const burning = h.add('hut', 0), ruined = h.add('home', 10), repairing = h.add('farm', 20);
  h.fires.unlocked = true; h.fires.ignite(burning); h.bld.ruin(ruined); ruined.tier = 3;
  repairing.integrity = .6; repairing.upgrading = true; repairing.progress = .37;
  h.bld.repair(repairing); h.bld.addProgress(repairing, 5);
  const game = (h: ReturnType<typeof setup>) => {
    Object.assign(h.veg, { serializeLogs: () => [], serializePlanted: () => [], restorePlanted() {}, restoreLogs() {}, refreshHeights() {} });
    return { world: h.world, colony: h.colony, fires: h.fires, eco: h.eco, time: h.time, veg: h.veg, buildings: h.bld,
      stats: { sculpted: 0, marked: 0, boats: 0 }, milestones: new Set(), islandName: 'Aztlan',
      rig: { goal: { x: 0, z: 0, dist: 20, yaw: 0 }, jumpTo() {} }, setIslandName() {} } as any;
  };
  const data = serialize(game(h));
  const portable = parseIslandFile(await islandFile(data).text()); assert.deepEqual(portable.fires, data.fires);
  const fresh = setup();
  // Use the real restoration method, with simple geometry for placement in this CPU test.
  (fresh.bld as any).place = (key: Building['key'], cx: number, cz: number, rot: number) => {
    const size = BUILDINGS[key].size; const b = fresh.add(key, cx - fresh.world.half + size[0] / 2, cz - fresh.world.half + size[1] / 2); b.rot = rot; return b;
  };
  applyRest(game(fresh), portable);
  const [camp, fire, ruin, repair] = fresh.bld.list;
  assert.equal(camp.integrity, 1); assert.equal(fire.fire, burning.fire); assert.equal(fire.integrity, burning.integrity);
  assert.equal(ruin.ruined, true); assert.equal(ruin.tier, 3); assert.equal(ruin.finished.scale.y, .15);
  assert.equal(repair.repairing, true); assert.equal(repair.repairProgress, repairing.repairProgress); assert.equal(repair.progress, .37);
  assert.equal(fresh.fires.unlocked, true);
  let alerts = 0; fresh.fires.onAlert = () => alerts++; fresh.fires.announceRestored(); assert.equal(alerts, 1);
  const old = structuredClone(portable); delete old.fires;
  for (const b of old.buildings) for (const field of ['integrity','fire','ruined','repairing','repairProgress','fireAlerted']) delete (b as any)[field];
  const legacy = setup(); (legacy.bld as any).place = (key: Building['key'], cx: number, cz: number) => legacy.add(key, cx - legacy.world.half + BUILDINGS[key].size[0] / 2, cz - legacy.world.half + BUILDINGS[key].size[1] / 2);
  applyRest(game(legacy), old); assert.equal(legacy.fires.unlocked, false);
  assert.ok(legacy.bld.list.every(b => b.integrity === 1 && b.fire === 0 && !b.ruined && !b.repairing));
  for (const [field, value] of [['fire', 2], ['integrity', -.1], ['repairProgress', 3], ['ruined', 'yes']] as const) {
    const bad = JSON.parse(await islandFile(data).text()); bad.save.buildings[0][field] = value;
    assert.throws(() => parseIslandFile(JSON.stringify(bad)));
  }
});

test('bridges enable water delivery; a blocked fire destination never receives water remotely', () => {
  const h = setup(), well = h.add('well', -8), home = h.add('hut', 8), p = h.person(-4, 0);
  for (let z = 0; z < h.world.N; z++) for (let x = h.world.half - 1; x <= h.world.half + 1; x++) h.world.layer[h.world.idx(x, z)] = 0;
  h.world.computeSmooth(); h.fires.unlocked = true; h.fires.ignite(home);
  for (let n = 0; n < 250; n++) h.tick();
  assert.ok(home.fire > 0); assert.ok((h.fires as any).failed.size > 0);
  for (let x = h.world.half - 1; x <= h.world.half + 1; x++) for (let z = h.world.half - 1; z <= h.world.half + 2; z++) h.world.bridge[h.world.idx(x, z)] = 1;
  h.world.navigationVersion++; h.c.releaseTask(p); p.think = 1000;
  for (let n = 0; n < 1800 && home.fire > 0; n++) h.tick();
  assert.equal(home.fire, 0); assert.equal(p.carry, null); assert.equal(well.fire, 0);
});

test('large group firefighting starts at most one departure a second and preserves the frame budget', () => {
  const h = setup(); h.add('well', -8); const a = h.add('hut', 8), b = h.add('hut', 18);
  for (let n = 0; n < 100; n++) h.person(-5, n * .01);
  h.fires.unlocked = true; h.fires.ignite(a); h.fires.ignite(b);
  h.tick(.1); assert.equal(h.colony.list.filter(p => p.task?.kind === 'firefight').length, 1);
  const before = h.colony.pathStats.completed; h.tick(.1);
  assert.ok(h.colony.pathStats.completed - before <= ISLANDER.pathRequestsPerFrame);
  for (let n = 0; n < 40; n++) h.tick(.1);
  assert.ok(h.colony.list.filter(p => p.task?.kind === 'firefight').length <= 4);
  assert.equal(ISLANDER.pathRequestsPerFrame, 5); assert.equal(ISLANDER.pathBudgetMs, 3);
});


test('fire alerts are distinct per building and only select a building on View', () => {
  const dom = new JSDOM('<main></main>'), original = globalThis.document;
  (globalThis as any).document = dom.window.document;
  try {
    const ui: any = Object.create(UI.prototype), doc = dom.window.document;
    let viewed = 0, focused = 0, burning = true;
    Object.assign(ui, { alerts: [], zen: true, alertButton: doc.createElement('button'), alertPanel: doc.createElement('div'),
      game: { focusAt: () => focused++ } });
    const at = () => burning ? { x: 0, z: 0 } : null;
    for (const id of [1, 2, 1]) ui.toast('Hut is on fire.', 'warn', at, { key: `fire:${id}`, onView: () => viewed++ });
    assert.equal(ui.alerts.length, 2); ui.pruneAlerts(); assert.equal(viewed, 0);
    ui.alertPanel.querySelector('.alert-entry button').click(); assert.equal(viewed, 1); assert.equal(focused, 1);
    burning = false; ui.pruneAlerts(); assert.equal(ui.alerts.length, 0);
  } finally { (globalThis as any).document = original; dom.window.close(); }
});

test('interrupted market deliveries retain goods and crews at sea finish their return', () => {
  const h = setup(), store = h.add('campfire', -10), market = h.add('market', 10), jetty = h.add('jetty', 20);
  const p = h.person(), sailor = h.person(); market.integrity = .6;
  p.carry = { kind: 'basket', res: 'fruit', n: 3, market: market.id };
  h.c.deliver(p); assert.equal(p.carry.n, 3); assert.equal(p.carry.market, undefined); assert.equal(p.task?.target, store.id);
  store.integrity = .5; h.c.releaseTask(p); h.c.deliver(p); assert.equal(p.carry.n, 3); assert.equal(p.task, null);
  h.c.setTask(sailor, 'fish', jetty.id, jetty.door.x, jetty.door.z); sailor.task!.stage = 3; sailor.hidden = true;
  jetty.integrity = .8; h.c.runTask(sailor, .1); assert.equal(sailor.task?.kind, 'fish'); assert.equal(sailor.hidden, true);
});

test('collected water can still be poured after its well is removed, and urgent needs cancel firefighting', () => {
  const h = setup(), well = h.add('well', -8), fire = h.add('hut', 8), p = h.person(fire.door.x, fire.door.z);
  h.fires.unlocked = true; h.fires.ignite(fire);
  h.c.setTask(p, 'firefight', fire.id, fire.door.x, fire.door.z);
  Object.assign(p.task!, { building: well.id, phase: 3, water: true, timer: .1 }); h.bld.list.splice(h.bld.list.indexOf(well), 1);
  const before = fire.fire; h.c.runTask(p, .2); assert.ok(fire.fire < before); assert.equal(p.task, null);
  h.c.setTask(p, 'firefight', fire.id, 0, 0); p.task!.building = well.id;
  p.hunger = 0; h.colony.update(.1); assert.notEqual(p.task?.kind, 'firefight');
});

test('rebuilding reactivates dependent systems once; a new fire pauses a paid repair without discarding it', () => {
  const h = setup(), pen = h.add('pigpen'); let rebuilt = 0; h.bld.onRebuilt = () => rebuilt++;
  h.bld.ruin(pen); h.bld.repair(pen); h.bld.addProgress(pen, 1000); assert.equal(rebuilt, 1);
  pen.integrity = .5; h.bld.repair(pen); h.bld.addProgress(pen, 5); const progress = pen.repairProgress;
  h.fires.unlocked = true; h.fires.ignite(pen); h.bld.addProgress(pen, 10); assert.equal(pen.repairProgress, progress);
  h.fires.pour(pen); h.fires.pour(pen); h.bld.addProgress(pen, 1000);
  assert.equal(pen.integrity, 1); assert.equal(pen.repairing, false); assert.equal(rebuilt, 1);
});


test('a prolonged unattended fire destroys an occupied building and ignition produces one alert', () => {
  const h = setup(), home = h.add('hut'), p = h.person(); let alerts = 0;
  h.fires.unlocked = true; h.fires.onAlert = () => alerts++;
  h.c.setTask(p, 'sleep', home.id, home.door.x, home.door.z); p.hidden = p.sleeping = true;
  assert.equal(h.fires.ignite(home), true); assert.equal(h.fires.ignite(home), false); assert.equal(alerts, 1);
  home.integrity = .001; h.fires.update(1, 'clear'); assert.equal(home.ruined, true); assert.equal(home.fire, 0);
  assert.equal(p.hidden, false); assert.equal(p.sleeping, false); assert.ok(h.world.occ[h.world.idx(home.cx,home.cz)] > 0);
});

test('repair builders at a stonemason remain builders and player assignments pause safely during a fire', () => {
  const h = setup(), shop = h.add('stonemason'), p = h.person(); shop.integrity = .5; h.bld.repair(shop);
  p.role = 'builder'; p.workplace = shop.id; p.manualRole = true;
  h.c.assignJobs(); assert.equal(p.role, 'builder'); assert.equal(p.workplace, shop.id);
  h.fires.unlocked = true; h.fires.ignite(shop); h.c.assignJobs();
  assert.equal(p.manualRole, true); assert.equal(p.workplace, shop.id); assert.equal(p.role, 'builder');
});


test('a building strike ignites at its actual roof and bounded effects remain visible above tall roofs', () => {
  const h = setup(), house = h.add('hut', 8); h.add('well', -8);
  house.finished.geometry = new THREE.BoxGeometry(2, 8, 2); const strikes: number[] = [];
  (h.fires as any).rnd = () => .1; h.fires.onStrike = (_, y) => strikes.push(y); h.fires.strikeIn = 0;
  h.fires.update(.1, 'storm'); assert.ok(house.fire > 0); assert.equal(strikes[0], house.y + 4);
  const camera = new THREE.PerspectiveCamera(); h.fires.render(22, camera);
  const flames = (h.fires as any).flames, m = new THREE.Matrix4(); flames.getMatrixAt(0, m);
  assert.ok(m.elements[13] > house.y + 3); assert.equal(flames.material.uniforms.uTime.value, 22);
  (h.fires as any).bars.getMatrixAt(0, m); assert.ok(m.elements[13] > house.y + 5);
});

test('Healing Centre treatment pauses while damaged, resumes after repair and evacuates when burning', () => {
  const h = setup(), clinic = h.add('healer'), p = h.person(); h.eco.goods.medicine = 1;
  p.condition = 'sick'; p.conditionT = 1000; h.c.setTask(p, 'heal', clinic.id, clinic.door.x, clinic.door.z);
  Object.assign(p.task!, { phase: 1, stage: 3, care: 5, slot: 0 }); clinic.integrity = .5;
  h.c.runTask(p, 10); assert.equal(p.task!.care, 5); assert.equal(h.eco.goods.medicine, 1);
  h.bld.repair(clinic); h.bld.addProgress(clinic, 1000); h.c.runTask(p, 60);
  assert.equal(p.condition, 'well'); assert.equal(h.eco.goods.medicine, 0);
  h.fires.unlocked = true; h.fires.ignite(clinic); assert.equal(p.sleeping, false); assert.equal(p.floorY, null);
});


test('fire destruction frees the old jetty boat slots for rebuilding', () => {
  const h = setup(), jetty = h.add('jetty'); jetty.boats = [17,18]; jetty.tradeBoats = 2;
  h.bld.ruin(jetty); assert.deepEqual(jetty.boats, []); assert.equal(jetty.tradeBoats, 0);
  h.bld.repair(jetty); h.bld.addProgress(jetty, 1000); assert.equal(jetty.ruined, false); assert.equal(jetty.boats.length, 0);
});

test('small lightning fires grow to bonfire height using the same bounded flame batch', async () => {
  const {villageFire}=await import('../src/buildings/VillageFire');
  const h=setup(),house=h.add('hut');h.fires.unlocked=true;h.fires.ignite(house);
  const camera=new THREE.PerspectiveCamera(),small=new THREE.Matrix4(),large=new THREE.Matrix4();
  h.fires.render(0,camera);const flames=(h.fires as any).flames as THREE.InstancedMesh;flames.getMatrixAt(1,small);
  assert.equal(flames.count,3);house.fire=1;h.fires.render(0,camera);flames.getMatrixAt(1,large);
  const smallScale=new THREE.Vector3().setFromMatrixScale(small),largeScale=new THREE.Vector3().setFromMatrixScale(large);
  flames.geometry.computeBoundingBox();const flameHeight=flames.geometry.boundingBox!.max.y;
  const bonfire=villageFire();bonfire.geometry.computeBoundingBox();const bonfireHeight=bonfire.geometry.boundingBox!.max.y;
  assert.ok(smallScale.y*flameHeight<.6);assert.ok(Math.abs(largeScale.y*flameHeight/bonfireHeight-1)<.09);
  assert.ok(largeScale.x>smallScale.x*3);assert.equal(flames.count,3);assert.equal((h.fires as any).bars.count,1);
  h.fires.pour(house);h.fires.render(0,camera);const watered=new THREE.Matrix4();flames.getMatrixAt(1,watered);
  assert.ok(new THREE.Vector3().setFromMatrixScale(watered).y<largeScale.y,'water visibly reduces the fire');
});

test('a healthy unattended storm fire destroys a building in about 60 game seconds',()=>{
  for(const weather of ['rain','storm'] as const){
    const h=setup(),house=h.add('hut');h.fires.unlocked=true;h.fires.ignite(house);
    for(let k=0;k<590;k++)h.fires.update(.1,weather);
    assert.equal(house.ruined,false);assert.ok(house.integrity<.04);
    for(let k=0;k<20;k++)h.fires.update(.1,weather);
    assert.equal(house.ruined,true);assert.equal(house.fire,0);assert.equal(house.integrity,0);
  }
  const dry=setup(),house=dry.add('hut');dry.fires.unlocked=true;dry.fires.ignite(house);
  dry.fires.update(49,'clear');assert.equal(house.ruined,false);dry.fires.update(1,'clear');assert.equal(house.ruined,true);
});

test('fire growth and damage agree across frame sizes and retain their current state on pause',()=>{
  const results=[];
  for(const dt of [.05,.1,1,10]){
    const h=setup(),house=h.add('hut');h.fires.unlocked=true;h.fires.ignite(house);
    for(let k=0;k<40/dt;k++)h.fires.update(dt,'rain');
    const state={fire:house.fire,integrity:house.integrity};h.fires.update(0,'rain');assert.deepEqual({fire:house.fire,integrity:house.integrity},state);results.push(state);
  }
  for(const state of results){assert.ok(Math.abs(state.fire-results[0].fire)<1e-10);assert.ok(Math.abs(state.integrity-results[0].integrity)<1e-10);}
});
