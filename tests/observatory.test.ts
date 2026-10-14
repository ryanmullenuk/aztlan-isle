import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { GameTime, dayFraction } from '../src/world/Time';
import { Economy } from '../src/economy/Economy';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { Powers } from '../src/economy/Powers';
import { Research, tierForBuilding, tierLabel } from '../src/economy/Research';
import { Forecaster, type ForecastInput } from '../src/economy/Forecast';
import { VolcanoCycle } from '../src/entities/Volcano';
import { observatoryModel, OBS } from '../src/buildings/models';
import { BUILD_MENU } from '../src/ui/tools';
import { BUILD_STAGE } from '../src/economy/Progression';
import { BUILDINGS, OBSERVATORY, POWERS, RESEARCH, TIME, WORLD, needsStonemason } from '../src/config';
import { serialize, applyRest } from '../src/world/Save';
import { islandFile, parseIslandFile } from '../src/world/IslandFile';

/** A research progression with a settable stage and purse (spends are counted). */
function research(stage = 7, rich = true) {
  const ctx = { stage, rich, bypassed: false, spent: 0 };
  const r = new Research({
    stage: () => ctx.stage,
    bypass: () => ctx.bypassed,
    canAfford: () => ctx.rich,
    spend: () => { if (!ctx.rich) return false; ctx.spent++; return true; },
  });
  return { r, ctx };
}

function village() {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 500, stone: 500, belief: 100, grain: 400 });
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  const time = new GameTime(); time.t = .4;
  const pf = new Pathfinder(world), colony = new Colony(world, veg, eco, bld, pf, time, () => .5);
  Object.assign(colony, { jobTimer: 10000, houseTimer: 10000, healthTimer: 10000, lastDay: time.day });
  const c = colony as any;
  const add = (key: Building['key'], x = 10, z = 0) => {
    const size = BUILDINGS[key].size;
    const b = new Building(bld.list.length + 1, key, Math.floor(x + world.half - size[0] / 2), Math.floor(z + world.half - size[1] / 2), 0, 1, world);
    b.complete = true; b.progress = 1;
    b.foundation = new THREE.Mesh(new THREE.BoxGeometry(1, .2, 1));
    b.finished = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    b.scaffold = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    b.group.add(b.foundation, b.finished, b.scaffold); bld.list.push(b); bld.group.add(b.group);
    for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) world.occ[world.idx(x, z)] = b.id + 1;
    return b;
  };
  const person = (x = 0, z = 0) => { const i = colony.spawn('m', x, z); i.rest = i.hunger = 1; i.think = 1000; return i; };
  return { world, eco, veg, bld, time, colony, c, add, person };
}

test('the Observatory: a stage-3 building of wood and plain stone with two priest jobs, inside a mobile budget', () => {
  const def = BUILDINGS.observatory;
  assert.deepEqual(def.size, [3, 3]);
  assert.equal(def.workers, 2);
  assert.equal(def.description, 'Priests observe the sky and volcanic signs to warn of approaching storms and eruptions. Staff the Observatory to receive forecasts and research new village developments.');
  assert.equal(needsStonemason('observatory'), false);
  assert.equal(def.cost.carvedStone, undefined);
  assert.equal(BUILD_STAGE.observatory, 3);
  assert.ok(BUILD_MENU.includes('observatory'));
  assert.equal(tierForBuilding('observatory'), 0, 'needs no research itself');
  const m = observatoryModel();
  assert.ok(m.finished.index!.count / 3 < 6000, 'under 6k triangles');
  assert.equal(m.torches.length, 1, 'one brazier flame');
  m.finished.computeBoundingBox();
  const bb = m.finished.boundingBox!;
  assert.ok(bb.min.x >= -1.5 && bb.max.x <= 1.5 && bb.min.z >= -1.5 && bb.max.z <= 1.5, 'inside its 3×3 footprint');
});

test('ten sequential tiers: each unlocks something real, prerequisites never loop, the Observatory comes first', () => {
  assert.equal(RESEARCH.length, 10);
  for (let i = 0; i < RESEARCH.length; i++) {
    const t = RESEARCH[i];
    assert.ok(t.unlocks.length + t.upgrades.length + t.gains.length > 0, t.name);
    assert.ok(t.stage >= BUILD_STAGE.observatory!, 'never before the Observatory can be built');
    if (i) assert.ok(t.stage >= RESEARCH[i - 1].stage && t.time > RESEARCH[i - 1].time - 1);
    // A tier's own buildings are never needed to reach it.
    for (const k of t.unlocks) assert.ok((BUILD_STAGE[k] ?? 1) >= t.stage, `${k} sits at or after tier ${i + 1}'s stage`);
  }
  const all = RESEARCH.flatMap((t) => t.unlocks);
  assert.equal(new Set(all).size, all.length, 'each building gated by one tier');
});

test('all ten research transitions: started explicitly, paid once, studied by priests on duty', () => {
  const { r, ctx } = research();
  for (let tier = 1; tier <= 10; tier++) {
    for (const k of RESEARCH[tier - 1].unlocks) assert.equal(r.requirement(k), tierLabel(tier));
    assert.equal(r.state(tier), 'available');
    if (tier < 10) assert.match(r.lockReason(tier + 1), /first/);
    assert.equal(r.start(tier), '');
    assert.equal(r.state(tier), 'active');
    assert.match(r.start(tier), /Being studied/, 'no double start');
    assert.equal(r.advance(RESEARCH[tier - 1].time / 2, 0), 0, 'no priest on duty: paused');
    assert.equal(r.progress, 0);
    assert.equal(r.advance(RESEARCH[tier - 1].time - 0.001, 2), 0);
    assert.equal(r.advance(0.002, 2), tier, `tier ${tier} completes`);
    assert.equal(r.done, tier); assert.equal(r.active, 0);
    for (const k of RESEARCH[tier - 1].unlocks) assert.equal(r.requirement(k), '');
  }
  assert.equal(ctx.spent, 10, 'each tier charged exactly once');
  assert.equal(r.state(10), 'done');
});

test('locks explain themselves: order, stage, one study at a time and cost', () => {
  const { r, ctx } = research(3);
  assert.equal(r.lockReason(2), 'Study The Count of Seasons (tier 1) first');
  r.done = 3;
  assert.equal(r.lockReason(4), 'Reach Community (settlement stage 4)');
  ctx.stage = 4;
  ctx.rich = false;
  assert.match(r.start(4), /Not enough/); assert.equal(r.active, 0); assert.equal(ctx.spent, 0);
  ctx.rich = true;
  assert.equal(r.start(4), '');
  r.done = 3;
  assert.equal(r.lockReason(5), 'Study Market Days (tier 4) first');
  assert.equal(r.upgradeRequirement('templeUpgrade'), 'Great Pyramid upgrades need Observatory research: The Tribute Calendar (tier 9)');
  // Sandbox and GODMODE skip every gate.
  ctx.bypassed = true;
  assert.equal(r.requirement('greattemple'), '');
  assert.equal(r.upgradeRequirement('tradeBoats'), '');
});

test('staffing: one priest studies at 60%, two at full speed, and more Observatories never go faster', () => {
  assert.equal(Research.rate(0), 0);
  assert.equal(Research.rate(1), OBSERVATORY.speedOne);
  assert.equal(Research.rate(2), 1);
  assert.equal(Research.rate(6), 1, 'capped');
  const { r } = research();
  r.start(1);
  r.advance(10, 1);
  assert.ok(Math.abs(r.progress - 6) < 1e-9);
  assert.ok(Math.abs(r.remaining(1) - (RESEARCH[0].time - 6) / 0.6) < 1e-9);
  assert.equal(r.remaining(0), Infinity);
});

test('unlocks are enforced in placement and upgrades, with the research named', () => {
  const h = village();
  const { r } = research(7);
  h.bld.progressionRequirement = (k) => r.requirement(k);
  h.bld.progressionUpgrade = (b) => (b.key === 'temple' ? r.upgradeRequirement('templeUpgrade') : b.key === 'boatworkshop' && b.tier === 2 ? r.upgradeRequirement('tradeBoats') : '');
  h.add('campfire', -30);
  h.add('stonemason', -20, 10).tier = 4;
  assert.equal(h.bld.constructionRequirement('maizefarm'), 'Observatory research: The Count of Seasons (tier 1)');
  assert.equal(h.bld.constructionRequirement('observatory'), '');
  assert.equal(h.bld.canPlace('well', h.world.half, h.world.half + 10, 0).reason, 'Observatory research: Signs of Fire and Water (tier 3)');
  const temple = h.add('temple', 20, 20);
  assert.match(h.bld.canUpgrade(temple).reason, /The Tribute Calendar \(tier 9\)/);
  const yard = h.add('boatworkshop', -20, -20); yard.tier = 2;
  assert.match(h.bld.canUpgrade(yard).reason, /Star Paths \(tier 8\)/);
  yard.tier = 1;
  assert.ok(!/Star Paths/.test(h.bld.canUpgrade(yard).reason), 'larger fishing boats need no research');
  r.done = 9;
  assert.equal(h.bld.constructionRequirement('well'), '');
  assert.ok(!/research/i.test(h.bld.canUpgrade(temple).reason));
  // GODMODE skips research gates as it skips the stage gates.
  r.done = 0; h.eco.godMode = true;
  assert.equal(h.bld.constructionRequirement('greattemple'), '');
});

test('older saves: research already achieved is credited, so an established village is never blocked', () => {
  const none = research().r; none.migrate(() => false, { templeTier: 0, boatTier: 1 });
  assert.equal(none.done, 0);
  const market = research().r; market.migrate((k) => k === 'market' || k === 'maizefarm', { templeTier: 0, boatTier: 1 });
  assert.equal(market.done, 4, 'Market Days and every tier below');
  const pyramid = research().r; pyramid.migrate((k) => k === 'temple', { templeTier: 3, boatTier: 1 });
  assert.equal(pyramid.done, 9);
  const trade = research().r; trade.migrate(() => false, { templeTier: 0, boatTier: 3 });
  assert.equal(trade.done, 8);
  const keep = research().r; keep.done = 6; keep.migrate((k) => k === 'well', { templeTier: 0, boatTier: 1 });
  assert.equal(keep.done, 6, 'never lowered');
});

test('priests staff the Observatory, keep the night watch on its deck, and respect their needs', () => {
  const h = village();
  const obs = h.add('observatory', 6, 0);
  const people = [0, 1, 2, 3].map((k) => h.person(k * 0.6 - 1, 3));
  h.c.assignJobs();
  const priests = people.filter((p) => p.role === 'priest' && p.workplace === obs.id);
  assert.equal(priests.length, 1, 'a small village spares one sky-watcher');
  assert.equal(h.colony.observatoryStaff(), 1);
  for (let k = 0; k < 4; k++) h.person(k * 0.6 - 1, 5);
  h.c.assignJobs(); h.c.assignJobs();
  assert.equal(h.colony.observatoryStaff(), 2, 'two once there are eight workers');
  // By day: at the stela keeping the count, studying.
  const p = h.colony.list.find((i) => i.role === 'priest')!;
  p.think = 0; p.task = null;
  assert.ok(h.c.work(p)); assert.equal(p.task!.kind, 'observe'); assert.equal(p.task!.phase, 0);
  for (let n = 0; n < 600 && p.task?.stage !== 2; n++) h.colony.update(0.1);
  assert.equal(p.task!.stage, 2);
  h.colony.update(0.1);
  assert.ok(h.colony.observing >= 1, 'counted as on duty');
  // By night: up on the deck at the sighting post; released, back to the ground.
  h.c.releaseTask(p); h.time.t = 0.95;
  assert.ok(h.time.isNight);
  assert.ok(h.c.work(p)); assert.equal(p.task!.phase, 1);
  for (let n = 0; n < 600 && p.task?.stage !== 2; n++) h.colony.update(0.1);
  assert.equal(p.floorY, obs.y + OBS.h);
  h.c.releaseTask(p);
  assert.equal(p.floorY, null);
  // Sick priests leave the staff; demolition releases the staff.
  p.condition = 'sick';
  assert.equal(h.colony.observatoryStaff(), 1);
  h.bld.remove(obs, false);
  h.c.assignJobs();
  assert.equal(h.colony.observatoryStaff(), 0);
});

test('research and progress survive damage, demolition and rebuilding (they belong to the village)', () => {
  const h = village();
  const { r } = research();
  r.start(1); r.advance(50, 2);
  const obs = h.add('observatory', 6, 0);
  h.bld.ruin(obs);
  assert.equal(r.advance(10, h.colony.observing), 0, 'paused while nobody can observe');
  h.bld.remove(obs, false);
  h.add('observatory', -6, 0);
  assert.equal(r.active, 1); assert.equal(r.progress, 50);
});

function forecast(over: Partial<ForecastInput> = {}): ForecastInput {
  return { staffed: true, storm: null, stormActive: false, volcano: null, volcanoActive: false, speed: 1, tier: 0, ...over };
}

test('storm forecasts: only from a staffed Observatory, inside the window, once, re-stated and withdrawn', () => {
  const f = new Forecaster();
  const storm = (inSeconds: number, id = 1) => ({ id, inSeconds, length: 100 });
  assert.deepEqual(f.update(forecast({ storm: storm(200), staffed: false })), [], 'no staff: no forecast');
  assert.deepEqual(f.update(forecast({ storm: storm(OBSERVATORY.stormWindow + 60) })), [], 'beyond the window');
  const a = f.update(forecast({ storm: storm(180) }));
  assert.equal(a.length, 1); assert.equal(a[0].kind, 'announce');
  assert.match((a[0] as any).text, /about 3 minutes/);
  assert.match((a[0] as any).text, /wells/);
  assert.deepEqual(f.update(forecast({ storm: storm(179) })), [], 'no duplicate');
  // A second staffed Observatory changes nothing: one forecast per hazard.
  assert.deepEqual(f.update(forecast({ storm: storm(178), staffed: true })), []);
  // 3× speed: the real-time estimate drops sharply, so it is re-stated.
  const u = f.update(forecast({ storm: storm(177), speed: 3 }));
  assert.equal(u[0]?.kind, 'update'); assert.match((u[0] as any).text, /about 1 minute/);
  // Arrival withdraws it (the storm's own alert takes over).
  assert.deepEqual(f.update(forecast({ storm: null, stormActive: true })), [{ kind: 'withdraw', hazard: 'storm', reason: 'arrived' }]);
  // Weather switched off before it came: cancelled.
  f.update(forecast({ storm: storm(100, 2) }));
  assert.deepEqual(f.update(forecast({ storm: null })), [{ kind: 'withdraw', hazard: 'storm', reason: 'cancelled' }]);
  // The Binding of the Years also tells its length.
  assert.match(f.stormText(storm(120, 3), 1, 10), /last about 2 minutes/);
  assert.doesNotMatch(f.stormText(storm(120, 3), 1, 9), /last/);
});

test('volcano forecasts read the real cycle; Signs of Fire and Water warns earlier; calming moves to the next cycle', () => {
  const f = new Forecaster();
  const v = new VolcanoCycle(7);
  v.remaining = 400;
  const look = () => (v.phase === 'dormant' ? { cycle: v.cycle, inSeconds: v.remaining } : null);
  assert.deepEqual(f.update(forecast({ volcano: look() })), [], 'beyond the basic 5-minute window');
  const early = f.update(forecast({ volcano: look(), tier: 3 }));
  assert.equal(early[0]?.kind, 'announce');
  assert.match((early[0] as any).text, /about 7 minutes/);
  v.update(400);
  assert.equal(v.phase, 'smoking');
  assert.deepEqual(f.update(forecast({ volcano: look(), volcanoActive: true, tier: 3 })), [{ kind: 'withdraw', hazard: 'volcano', reason: 'arrived' }]);
  assert.ok(v.calm(() => true));
  v.update(25);
  assert.equal(v.phase, 'dormant'); assert.equal(v.cycle, 1);
  v.remaining = 100;
  assert.equal(f.update(forecast({ volcano: look(), tier: 3 }))[0]?.kind, 'announce', 'the next cycle is forecast afresh');
});

test('forecast memory survives a reload without repeating; the window counts down only while time runs', () => {
  const f = new Forecaster();
  f.update(forecast({ storm: { id: 4, inSeconds: 100, length: 90 } }));
  const g = new Forecaster(); g.restore(f.save());
  assert.deepEqual(g.update(forecast({ storm: { id: 4, inSeconds: 90, length: 90 } })), [], 'not announced again after loading');
  // Paused: no time passes, so no re-statement.
  f.tick(0);
  assert.deepEqual(f.update(forecast({ storm: { id: 4, inSeconds: 100, length: 90 } })), []);
});

test('storms are decided ahead of dusk, so the forecast storm is the one that comes', () => {
  const p: any = Object.create(Powers.prototype);
  Object.assign(p, { state: 'clear', stormDelay: -1, stormId: 0, stormLength: 0, randomWeather: true, timer: 0, rnd: () => 0, time: new GameTime(), notify() {}, onStormStart: () => true, onStormEnd() {}, strikeTimer: 0 });
  p.rollStorm(true);
  const o = p.stormOutlook;
  assert.ok(o && o.inSeconds >= POWERS.stormRollLead, 'decided minutes ahead');
  assert.ok(o.inSeconds - POWERS.stormRollLead >= POWERS.nightStormDelay[0]);
  p.rollStorm(true);
  assert.equal(p.stormOutlook.id, o.id, 'a pending storm is never re-rolled');
  p.startStorm();
  assert.equal(p.timer, o.length, 'it lasts as forecast');
  assert.equal(p.stormOutlook, null);
  p.state = 'clear'; p.rollStorm(false); p.clearWeather();
  assert.equal(p.stormOutlook, null, 'weather switched off: cancelled');
  p.rollStorm(true);
  const saved = p.schedule;
  const q: any = Object.create(Powers.prototype); Object.assign(q, { stormDelay: -1, stormId: 0, stormLength: 0, randomWeather: true });
  q.restoreSchedule(saved);
  assert.deepEqual(q.stormOutlook, p.stormOutlook, 'saved and restored');
  // The decision point sits the lead time before dusk on the clock.
  const dusk = dayFraction(20.2);
  assert.ok(dusk > 0.8 && dusk < 0.86);
  assert.ok(POWERS.stormRollLead / TIME.dayLength < dusk - dayFraction(5.5));
});

test('research, the storm schedule and forecast memory round-trip through saves and island files; older saves migrate', async () => {
  const h = village();
  const game = (v: ReturnType<typeof village>, extra: object) => {
    Object.assign(v.veg, { serializeLogs: () => [], serializePlanted: () => [], restorePlanted() {}, restoreLogs() {}, refreshHeights() {} });
    return { world: v.world, colony: v.colony, eco: v.eco, time: v.time, veg: v.veg, buildings: v.bld,
      stats: { sculpted: 0, marked: 0, boats: 0 }, milestones: new Set<string>(), islandName: 'Aztlan',
      rig: { goal: { x: 0, z: 0, dist: 20, yaw: 0 }, jumpTo() {} }, setIslandName() {}, ...extra } as any;
  };
  const { r } = research(); r.done = 3; r.start(4); r.advance(42, 2);
  const f = new Forecaster(); f.storm = 7; f.volcano = 2;
  h.add('market', 0, 0);
  const data = serialize(game(h, { research: r, forecaster: f }));
  assert.deepEqual(data.research, { done: 3, active: 4, progress: 42 });
  const file = parseIslandFile(await islandFile(data).text());
  const fresh = village();
  (fresh.bld as any).place = (key: Building['key'], cx: number, cz: number) => fresh.add(key, cx - fresh.world.half + BUILDINGS[key].size[0] / 2, cz - fresh.world.half + BUILDINGS[key].size[1] / 2);
  const r2 = research().r, f2 = new Forecaster();
  applyRest(game(fresh, { research: r2, forecaster: f2 }), file);
  assert.deepEqual(r2.save(), { done: 3, active: 4, progress: 42 });
  assert.deepEqual(f2.save(), { storm: 7, volcano: 2 });
  // An older save (no research): the built Market Square credits tiers 1–4.
  const old = structuredClone(file); delete (old as any).research;
  const legacy = village();
  (legacy.bld as any).place = (key: Building['key'], cx: number, cz: number) => legacy.add(key, cx - legacy.world.half + BUILDINGS[key].size[0] / 2, cz - legacy.world.half + BUILDINGS[key].size[1] / 2);
  const r3 = research().r;
  applyRest(game(legacy, { research: r3, forecaster: new Forecaster() }), old);
  assert.equal(r3.done, 4);
  const bad = JSON.parse(await islandFile(data).text()); bad.save.research.done = 11;
  assert.throws(() => parseIslandFile(JSON.stringify(bad)));
});
