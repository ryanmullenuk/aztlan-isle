import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/ai/Colony';
import { makeIslander } from '../src/entities/Islander';

function setup() {
  const home = { id: 1, key: 'home', complete: true, door: { x: 0, z: 0 } };
  const a = makeIslander(1, 'A', 'm', 60, 0, () => 0.5);
  const b = makeIslander(2, 'B', 'f', 2, 0, () => 0.5);
  a.home = b.home = 1;
  const time = { day: 2, hour: 7, isNight: false };
  const eco = { godMode: false, food: 100, res: {}, add() {} };
  const buildings = { list: [home], byId: () => home, nearestStore: () => home, of: () => [] };
  const colony = new Colony({ cellIndexAt: () => 0 } as any, {} as any, eco as any,
    buildings as any, { walkable: () => true } as any, time as any, () => 0.5);
  colony.list.push(a, b);
  return { colony, a, b, time, eco, buildings, home };
}

test('housemates gather in separate walkable slots twice daily, without abandoning carried resources', () => {
  const h = setup(), c = h.colony as any;
  assert.equal(c.familyGather(h.a), true); assert.equal(c.familyGather(h.b), true);
  assert.notEqual(h.a.task!.slot, h.b.task!.slot);
  assert.equal(h.a.task!.target, h.home.id);
  c.releaseTask(h.a); assert.equal(c.familyGather(h.a), false);
  h.time.hour = 17; assert.equal(c.familyGather(h.a), true);
  c.releaseTask(h.a); h.time.day++;
  h.a.carry = { kind: 'log', res: 'wood', n: 3 };
  assert.equal(c.familyGather(h.a), false);
  h.a.carry = null; h.a.hunger = 0.1;
  assert.equal(c.familyGather(h.a), false);
  h.a.hunger = 1; h.colony.hooks.threat = () => true;
  assert.equal(c.familyGather(h.a), false);
});

test('family gathering faces home and returns to work after its brief visit', () => {
  const h = setup(), c = h.colony as any;
  c.familyGather(h.a); c.travel = () => 'arrived';
  h.a.x = h.a.task!.x; h.a.z = h.a.task!.z;
  c.runTask(h.a, 1); assert.equal(h.a.anim, 'idle');
  assert.equal(h.a.heading, Math.atan2(-h.a.x, -h.a.z));
  c.runTask(h.a, 30); assert.equal(h.a.task, null);
});

test('workers deliver actual loads before scheduling any leisure or another job', () => {
  const h = setup(); h.a.carry = { kind: 'log', res: 'wood', n: 3 };
  (h.colony as any).think(h.a);
  assert.equal(h.a.task!.kind, 'deliver'); assert.equal(h.a.carry.n, 3);
});

test('midday hall visits are staggered and limited to one per day', () => {
  const h = setup(), c = h.colony as any;
  h.time.hour = 12; h.a.id = 2; // (id + day) mod 4 = 0
  let visits = 0, work = 0;
  c.goToHall = () => { visits++; return true; }; c.work = () => { work++; return true; };
  c.think(h.a); c.think(h.a);
  assert.equal(visits, 1); assert.equal(work, 1);
  h.eco.food = 0; h.time.day += 4; c.think(h.a);
  assert.equal(visits, 1);
});

test('storm sends distant guards home with their load, preserves jobs, and leaves boats and treatment safe', () => {
  const h = setup(), c = h.colony as any;
  h.a.role = 'warrior'; h.a.warrior = 'jaguar' as any;
  h.a.carry = { kind: 'stone', res: 'stone', n: 2 };
  h.b.task = { kind: 'fish', stage: 2, target: 1, x: 0, z: 0, timer: 0 };
  assert.equal(h.colony.shelterFromStorm(), 1);
  assert.equal(h.a.task!.kind, 'flee'); assert.equal(h.a.role, 'warrior');
  assert.equal(h.a.carry.n, 2); assert.equal(h.b.task!.kind, 'fish');
  c.travel = () => 'arrived'; h.colony.hooks.threat = () => true;
  c.runTask(h.a, 30); assert.equal(h.a.hidden, true); assert.ok(h.a.task);
  h.colony.hooks.threat = () => false; c.runTask(h.a, 10);
  assert.equal(h.a.hidden, false); assert.equal(h.a.task, null);
  h.b.task!.kind = 'heal'; assert.equal(h.colony.shelterFromStorm(), 1);
  assert.equal(h.b.task!.kind, 'heal');
});
