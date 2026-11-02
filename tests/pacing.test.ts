import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuildingSystem } from '../src/buildings/Buildings';
import { BUILDINGS, BUILD_RISE, BUILD_SITES, TEMPLE, ISLANDER } from '../src/config';
import { BUILD_STAGE, SETTLE_DAYS, TOP_STAGE } from '../src/economy/Progression';
import { goalFor, goalText } from '../src/economy/SeasonGoals';
import { RAID, defence, plunder } from '../src/economy/Raids';

const system = (keys: string[], population = 0) =>
  ({ list: keys.map((key) => ({ key, complete: true })), eco: { godMode: false }, population: () => population }) as any;

test('each further building of a kind costs more, up to a cap; houses start rising later; decor never', () => {
  const cost = (keys: string[], key: string) => BuildingSystem.prototype.costFor.call(system(keys), key as any);
  const base = BUILDINGS.woodstore.cost;
  assert.deepEqual(cost([], 'woodstore'), base);
  assert.deepEqual(cost(['woodstore', 'woodstore'].slice(0, BUILD_RISE.free - 1), 'woodstore'), base);
  const third = cost(Array(BUILD_RISE.free).fill('woodstore'), 'woodstore');
  assert.ok(third.wood > base.wood, 'the next one past the free few costs more');
  const many = cost(Array(40).fill('woodstore'), 'woodstore');
  assert.equal(many.wood, Math.ceil(base.wood * BUILD_RISE.cap));
  assert.deepEqual(cost(Array(3).fill('hut'), 'hut'), BUILDINGS.hut.cost, 'the first few huts stay cheap');
  assert.deepEqual(cost(Array(20).fill('torch'), 'torch'), BUILDINGS.torch.cost);
});

test('building sites under way grow with the village', () => {
  const cap = (n: number) => BuildingSystem.prototype.siteCap.call(system([], n));
  assert.equal(cap(2), BUILD_SITES.base);
  assert.ok(cap(30) > cap(6));
  assert.equal(cap(1000), BUILD_SITES.max);
});

test('the temple comes after the town halls, and lifts Belief well above the early trickle', () => {
  assert.ok(BUILD_STAGE.temple! > BUILD_STAGE.greathall! && BUILD_STAGE.temple! > BUILD_STAGE.market!);
  assert.ok(BUILD_STAGE.healer! > BUILD_STAGE.maizefarm!, 'health after food');
  assert.ok(TEMPLE.beliefFactor[1] >= 2 && TEMPLE.beliefFactor[0] === 1);
  assert.ok(ISLANDER.beliefPerHappyPerSecond * TEMPLE.beliefFactor[1] >= 0.03, 'with a temple, Belief is back to a healthy rate');
  assert.equal(SETTLE_DAYS.length, TOP_STAGE + 1);
  assert.ok(SETTLE_DAYS.every((d, i) => i < 2 || d >= SETTLE_DAYS[i - 1]), 'later stages need at least as long');
});

test('each season sets its own goal, scaled to the village', () => {
  const v = { population: 10, storeCap: 200 };
  assert.deepEqual(goalFor(0, 1, v), { kind: 'grow', target: 12, season: 0, year: 1 });
  assert.equal(goalFor(1, 1, v).kind, 'stores');
  assert.ok(goalFor(1, 1, v).target <= 160);
  assert.deepEqual(goalFor(2, 1, v), { kind: 'food', target: 60, season: 2, year: 1 });
  assert.equal(goalFor(3, 1, v).kind, 'cheer');
  assert.match(goalText(goalFor(2, 1, v), 25), /Autumn goal: 60 food stored before winter \(25\/60\)/);
});

test('raiders are deterred by defence, and take less when met on the beach', () => {
  assert.ok(defence(1, 1) >= RAID.deter, 'a warrior and a watchtower see them off');
  assert.ok(defence(2, 0) < RAID.deter, 'two warriors alone do not');
  const stores = { food: 100, wood: 80, stone: 40 };
  const free = plunder(stores, false), met = plunder(stores, true);
  assert.deepEqual(free, { food: 25, wood: 12, stone: 6 });
  assert.ok(met.food < free.food && met.wood < free.wood);
  assert.deepEqual(plunder({ food: 1e5, wood: 1e5, stone: 1e5 }, false), RAID.carry, 'two canoes carry only so much');
});
