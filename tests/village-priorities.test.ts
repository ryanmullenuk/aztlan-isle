import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Colony } from '../src/ai/Colony';
import { Economy } from '../src/economy/Economy';
import { World } from '../src/world/World';
import { GameTime } from '../src/world/Time';
import { Pathfinder } from '../src/ai/Pathfinder';
import { applyRest, serialize } from '../src/world/Save';
import { VillagePrioritiesPanel } from '../src/ui/VillagePrioritiesPanel';
import { VILLAGE_PRIORITIES, type VillagePriority } from '../src/ai/VillagePriority';

function setup(pop = 20) {
  const w = new World(); w.layer.fill(1); w.computeSmooth();
  const eco = new Economy(); eco.woodCap = 200; eco.foodCap = 200;
  eco.res.wood = eco.res.stone = 40; eco.res.grain = 70;
  eco.res.fruit = eco.res.meat = eco.res.fish = 0;
  const time = new GameTime(); time.t = .4;
  const buildings: any = { list: [], byId(id: number) { return this.list.find((b: any) => b.id === id); },
    of: () => [], waitingForMaterials: (b: any) => !!b.waiting, nearestStore: () => null };
  const veg: any = { plants: [], findNearest: () => null };
  const colony = new Colony(w, veg, eco, buildings, new Pathfinder(w), time, () => .5);
  for (let i = 0; i < pop; i++) { const p = colony.spawn('m', i, 0); p.hunger = p.rest = 1; }
  const c = colony as any;
  const settle = (priority: VillagePriority) => { colony.setVillagePriority(priority); for (let i = 0; i < 80; i++) c.assignJobs(); };
  const count = (role: string) => colony.list.filter(p => p.role === role).length;
  const site = (key: string, complete = true, n = 4) => {
    const b = { id: buildings.list.length + 1, key, complete, upgrading: false, x: 0, z: 0,
      def: { workers: n, builders: n }, boats: [{}], door: { x: 0, z: 0 }, builders: new Set(), waiting: false };
    buildings.list.push(b); return b;
  };
  return { w, eco, time, buildings, veg, colony, c, settle, count, site };
}

test('Food and Materials shift general gathering demand and settle without oscillation', () => {
  const h = setup(); h.settle('balanced'); const normal = h.count('gatherer');
  h.settle('food'); assert.ok(h.count('gatherer') > normal);
  h.settle('materials'); assert.ok(h.count('gatherer') < normal);
  assert.ok(h.count('woodcutter') > 0 && h.count('miner') > 0);
  const stable = h.colony.list.map(i => [i.role, i.workplace]);
  for (let i = 0; i < 20; i++) h.c.assignJobs();
  assert.deepEqual(h.colony.list.map(i => [i.role, i.workplace]), stable);
});

test('Food fills food workplaces before construction; Materials favours the workshop', () => {
  const food = setup(6); food.site('hut', false); const farm = food.site('farm'); food.settle('food');
  assert.equal(food.colony.list.filter(i => i.workplace === farm.id).length, 4);
  const balanced = setup(6); balanced.site('hut', false); balanced.site('farm'); balanced.settle('balanced');
  assert.equal(balanced.count('builder'), 4);
  const materials = setup(6); materials.site('hut', false); const mason = materials.site('stonemason'); materials.settle('materials');
  assert.equal(materials.colony.list.filter(i => i.workplace === mason.id).length, 3);
});

test('Construction adds ready builders but skips sites waiting for materials and keeps gatherers', () => {
  const h = setup(); for (let i = 0; i < 6; i++) h.site('hut', false);
  const waiting = h.site('temple', false); waiting.waiting = true;
  h.settle('balanced'); const normal = h.count('builder');
  h.settle('construction'); assert.ok(h.count('builder') > normal);
  assert.ok(h.count('gatherer') > 0);
  assert.equal(h.colony.list.filter(i => i.workplace === waiting.id).length, 0);
  h.eco.res.grain = 0; h.settle('construction'); assert.ok(h.count('builder') <= 11);
});

test('busy specialists keep their tasks without consuming the remaining gathering workforce', () => {
  const h = setup(10), site = h.site('hut', false, 8); h.site('farm', true, 8); h.eco.res.grain = 10;
  h.settle('construction'); assert.equal(h.count('builder'), 5); // Low food reserves gatherers.
  for (const p of h.colony.list.filter(i => i.role === 'builder')) h.c.setTask(p, 'build', site.id, 0, 0);
  h.settle('food'); assert.equal(h.count('builder'), 5); assert.equal(h.count('farmer'), 2);
  assert.equal(h.colony.list.filter(i => i.workplace < 0).length, 3);
});

test('changing priority preserves active tasks, routes, loads, reservations and explicit jobs', () => {
  const h = setup(), farm = h.site('farm');
  const kinds = ['gather', 'deliver', 'sleep', 'eat', 'hall', 'flee', 'goto', 'capture', 'farm'] as const;
  kinds.forEach((kind, n) => {
    const i = h.colony.list[n]; i.role = n === 8 ? 'farmer' : 'woodcutter'; i.workplace = n === 8 ? farm.id : -1;
    h.c.setTask(i, kind, 0, 10, 0); h.c.requestPath(i, 10, 0);
    if (kind === 'deliver') i.carry = { kind: 'log', res: 'wood', n: 3 };
    if (kind === 'sleep') i.sleeping = true;
  });
  h.veg.plants.push({ reservedBy: h.colony.list[0].id });
  const ordered = h.colony.list[9]; ordered.manualRole = true; ordered.role = 'miner';
  const kid = h.colony.list[10]; kid.child = true;
  const warrior = h.colony.list[11]; warrior.role = 'warrior'; warrior.warrior = 'jaguar';
  const before = h.colony.list.slice(0, 12).map(i => ({ role: i.role, workplace: i.workplace,
    task: i.task, path: i.path, pending: i.pathPending, carry: i.carry }));
  const requests = h.c.queue.slice(), stats = { ...h.colony.pathStats };
  for (const priority of Object.keys(VILLAGE_PRIORITIES)) h.settle(priority as VillagePriority);
  h.colony.list.slice(0, 12).forEach((i, n) => {
    assert.equal(i.task, before[n].task); assert.equal(i.path, before[n].path); assert.equal(i.carry, before[n].carry);
    assert.equal(i.role, before[n].role); assert.equal(i.workplace, before[n].workplace); assert.equal(i.pathPending, before[n].pending);
  });
  assert.equal(h.veg.plants[0].reservedBy, h.colony.list[0].id);
  assert.deepEqual(h.c.queue, requests); assert.deepEqual(h.colony.pathStats, stats);
});

test('a finished delivery allows gradual reassignment without creating paths on the allocation tick', () => {
  const h = setup(); h.settle('materials');
  const p = h.colony.list.find(i => i.role === 'woodcutter')!;
  for (const i of h.colony.list) if (i !== p) h.c.setTask(i, 'wander', -1, i.x, i.z);
  const store = h.site('woodstore', true, 0);
  p.carry = { kind: 'log', res: 'wood', n: 3 }; h.c.setTask(p, 'deliver', store.id, 10, 0);
  h.settle('food'); assert.equal(p.role, 'woodcutter'); assert.equal(p.task!.kind, 'deliver');
  const wood = h.eco.res.wood; h.c.travel = () => 'arrived'; h.c.runTask(p, 1);
  assert.equal(h.eco.res.wood, wood + 3); assert.equal(p.carry, null); assert.equal(p.task, null);
  h.settle('food'); assert.equal(p.role, 'gatherer');
  assert.equal(h.colony.pathStats.queued, 0);
});

test('large workforce changes are limited to two per job tick and stable workplaces are retained', () => {
  const h = setup(100); for (let i = 0; i < 20; i++) h.site('hut', false);
  for (let tick = 0; tick < 50; tick++) {
    const before = h.colony.list.map(p => [p.role, p.workplace]); h.c.assignJobs();
    assert.ok(h.colony.list.filter((p, n) => p.role !== before[n][0] || p.workplace !== before[n][1]).length <= 2);
  }
  const before = h.colony.list.map(p => [p.role, p.workplace]); h.c.assignJobs();
  assert.deepEqual(h.colony.list.map(p => [p.role, p.workplace]), before);
  assert.equal(h.colony.pathStats.queued, 0);
});

test('hungry and tired villagers still choose care before priority work', () => {
  const h = setup(1), p = h.colony.list[0]; h.colony.setVillagePriority('construction');
  const store = { id: 1, door: { x: 0, z: 0 } }; h.buildings.nearestStore = () => store;
  p.hunger = .05; h.c.think(p); assert.equal(p.task!.kind, 'eat');
  h.c.releaseTask(p); p.hunger = 1; p.rest = .05;
  let slept = false; h.c.goSleep = () => { slept = true; }; h.c.think(p); assert.equal(slept, true);
});

test('fallback gathering respects full stores, unavailable resources and individual job overrides', () => {
  const h = setup(1), p = h.colony.list[0], attempted: string[] = [];
  h.eco.res.grain = h.eco.foodCap; h.colony.setVillagePriority('food');
  h.c.startGather = () => { attempted.push('fruit'); return true; };
  h.c.startSpearfish = () => { attempted.push('fish'); return true; };
  h.c.startChop = () => { attempted.push('wood'); return false; }; // No suitable unreserved tree.
  h.c.startMine = () => { attempted.push('stone'); return true; };
  assert.equal(h.c.selfDirected(p), true); assert.deepEqual(attempted, ['wood', 'stone']);
  attempted.length = 0; h.eco.res.grain = 10; h.colony.setVillagePriority('materials');
  h.c.startChop = () => { attempted.push('wood'); return true; };
  h.c.selfDirected(p); assert.deepEqual(attempted, ['wood']);
  attempted.length = 0; p.manualRole = true; p.role = 'gatherer';
  h.c.selfDirected(p); assert.deepEqual(attempted, ['fruit']);
});

test('storm shelter remains in force through priority changes and releases normally afterwards', () => {
  const h = setup(1), home = h.site('home'), p = h.colony.list[0]; p.home = home.id; p.x = 60;
  assert.equal(h.colony.shelterFromStorm(), 1); const task = p.task;
  h.settle('construction'); assert.equal(p.task, task); assert.equal(p.task!.kind, 'flee');
  h.c.travel = () => 'arrived'; h.colony.hooks.threat = () => true;
  h.c.runTask(p, 30); assert.equal(p.hidden, true);
  h.settle('food'); assert.equal(p.task, task);
  h.colony.hooks.threat = () => false; h.c.runTask(p, 10); assert.equal(p.task, null); assert.equal(p.hidden, false);
});

test('save serialisation and restore preserve all priorities; old or invalid local saves use Balanced', () => {
  const h = setup(0);
  const game: any = { world: h.w, colony: h.colony, eco: h.eco, time: h.time, islandName: 'Aztlan',
    veg: { plants: [], serializeLogs: () => [], serializePlanted: () => [], restorePlanted() {}, restoreLogs() {}, refreshHeights() {} },
    buildings: { list: [], recomputeCaps() {} }, stats: { sculpted: 0, marked: 0, boats: 0 }, milestones: new Set(),
    rig: { goal: { x: 0, z: 0, dist: 20, yaw: 0 }, jumpTo() {} }, setIslandName() {} };
  for (const priority of Object.keys(VILLAGE_PRIORITIES)) {
    h.colony.setVillagePriority(priority); const data = serialize(game);
    h.colony.setVillagePriority('balanced'); applyRest(game, data); assert.equal(h.colony.villagePriority, priority);
  }
  const old = serialize(game); delete old.villagePriority; applyRest(game, old);
  assert.equal(h.colony.villagePriority, 'balanced');
  h.colony.setVillagePriority('food'); applyRest(game, { ...old, villagePriority: 'bad' } as any);
  assert.equal(h.colony.villagePriority, 'balanced');
});

test('collapsed panel selects exactly one preference, syncs restored saves and handles keyboard controls', () => {
  const dom = new JSDOM('<body></body>'); (globalThis as any).document = dom.window.document;
  let value: VillagePriority = 'balanced', opens = 0, writes = 0;
  const panel = new VillagePrioritiesPanel(() => value, next => { value = next; writes++; }, () => { opens++; });
  document.body.append(panel.button, panel.panel);
  assert.equal(panel.panel.classList.contains('hidden'), true);
  panel.button.click(); assert.equal(opens, 1); assert.equal(panel.button.getAttribute('aria-expanded'), 'true');
  const food = panel.panel.querySelector<HTMLButtonElement>('[data-priority="food"]')!;
  food.click(); assert.equal(value, 'food'); assert.equal(writes, 1);
  assert.equal(panel.panel.querySelectorAll('[aria-pressed="true"]').length, 1);
  let leaked = 0; document.body.addEventListener('keydown', () => leaked++);
  food.focus(); food.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal((document.activeElement as HTMLElement).dataset.priority, 'materials');
  food.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panel.panel.classList.contains('hidden'), true); assert.equal(document.activeElement, panel.button); assert.equal(leaked, 0);
  value = 'construction'; panel.sync(); assert.match(panel.button.textContent!, /Construction/);
  assert.equal(writes, 1); assert.equal(panel.button.getAttribute('aria-expanded'), 'false');
  dom.window.close();
});
