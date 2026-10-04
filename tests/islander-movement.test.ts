import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { avoidCrowd } from '../src/ai/CrowdAvoidance';
import { makeIslander, Islander } from '../src/entities/Islander';
import { World } from '../src/world/World';
import { GameTime } from '../src/world/Time';
import { Economy } from '../src/economy/Economy';
import { SpatialHash } from '../src/world/SpatialHash';

function setup() {
  const world = new World(); world.layer.fill(1); world.computeSmooth();
  const time = new GameTime(); time.t = 0.4;
  const eco = new Economy(); eco.res.grain = 10;
  const colony = new Colony(world, { plants: [] } as any, eco,
    { list: [], of: () => [], nearestStore: () => null } as any,
    new Pathfinder(world), time, () => 0.5);
  Object.assign(colony, { jobTimer: 1000, houseTimer: 1000, healthTimer: 1000, lastDay: time.day });
  return { colony, world };
}

test('hungry founders keep walking when food exists but no campfire/store has been built', () => {
  const { colony } = setup();
  const person = colony.spawn('m', 0, 0);
  person.hunger = 0.05; person.rest = 1;
  person.task = { kind: 'wander', stage: 0, target: -1, timer: 100, x: 4, z: 0 };
  const task = person.task;
  for (let i = 0; i < 50; i++) colony.update(0.1);
  assert.equal(person.task, task, 'movement must not be cancelled on every AI update');
  assert.ok(person.x > 2, `founder stayed at ${person.x}`);
});

test('a walker blocked by a cluster can retreat into open ground after a short wait', () => {
  const person = makeIslander(1, 'A', 'm', 0, 0, () => 0.5);
  const grid = new SpatialHash<Islander>(2); grid.insert(person);
  for (const [i, angle] of [-0.65, 0, 0.65].entries()) {
    const neighbour = makeIslander(i + 2, 'B', 'f', Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, () => 0.5);
    grid.insert(neighbour);
  }
  assert.deepEqual(avoidCrowd(person, 1, 0, 1, grid, () => true), { x: 0, z: 0 });
  person.stuck = 1;
  const velocity = avoidCrowd(person, 1, 0, 1, grid, () => true);
  assert.ok(Math.hypot(velocity.x, velocity.z) > 0.9, 'blocked person needs an escape direction');
  assert.ok(velocity.x <= 0.01, 'escape must move around or away from the cluster');
});

test('idle walkers with unfinished paths separate; people resting in place stay put', () => {
  const { colony } = setup();
  const a = colony.spawn('m', 0, 0), b = colony.spawn('f', 0.05, 0);
  a.anim = 'idle'; a.path = [{ x: 4, z: 0 }]; a.pathIdx = 0;
  a.task = { kind: 'goto', stage: 1, target: -1, timer: 0, x: 4, z: 0 };
  b.anim = 'eat'; b.task = { kind: 'eat', stage: 2, target: 1, timer: 3, x: b.x, z: b.z };
  colony.grid.insert(a); colony.grid.insert(b);
  (colony as any).separate(0.1);
  assert.ok(a.x < 0, 'collision-stopped walker should separate');
  assert.equal(b.x, 0.05, 'eating person should retain their place');
});

test('a dense group reaches separate destinations rather than remaining frozen together', () => {
  const { colony } = setup();
  const destinations: {x: number; z: number}[] = [];
  for (let k = 0; k < 12; k++) {
    const angle = k * Math.PI * 2 / 12;
    const person = colony.spawn(k % 2 ? 'm' : 'f', Math.cos(angle) * 0.4, Math.sin(angle) * 0.4);
    // Half the group crosses through the others, exercising opposing travel directions.
    const target = { x: -Math.cos(angle) * 5, z: -Math.sin(angle) * 5 };
    destinations.push(target); colony.walkTo(person, target.x, target.z); person.think = 1000;
  }
  for (let i = 0; i < 600; i++) colony.update(0.1);
  for (const [k, person] of colony.list.entries()) {
    const target = destinations[k];
    assert.ok(Math.hypot(person.x - target.x, person.z - target.z) < 0.5,
      `person ${person.id} still blocked at ${person.x}, ${person.z}`);
  }
});

test('a route steers round a knot of people when asked to, and goes straight through otherwise', () => {
  const world = new World(); world.layer.fill(1); world.computeSmooth();
  const pf = new Pathfinder(world);
  const straight = pf.find(0, 0, 10, 0)!;
  assert.ok(straight.every((p) => Math.abs(p.z) < 0.6), 'straight line along the row');
  // A crowd standing across the way, cells x 3..6 on the row and the rows either side.
  const avoid = new Set<number>();
  for (let x = 3; x <= 6; x++) for (const z of [-1, 0, 1]) avoid.add(world.cellIndexAt(x + 0.5, z + 0.5));
  const round = pf.find(0, 0, 10, 0, { avoid })!;
  const crossed = round.some((p) => avoid.has(world.cellIndexAt(p.x, p.z)));
  assert.equal(crossed, false, 'detours round the crowd');
});

test('someone shut inside a building footprint walks out to open ground, then on to their job', () => {
  const { colony, world } = setup();
  const person = colony.spawn('m', 0.5, 0.5);
  // A building goes up round them (occupying a 3x3 block).
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.occ[world.cellIndexAt(0.5 + dx, 0.5 + dz)] = 9;
  (colony as any).setTask(person, 'wander', -1, 8, 0.5);
  person.task!.timer = 99;
  for (let k = 0; k < 30 * 20; k++) colony.update(1 / 30);
  assert.equal(world.occ[world.cellIndexAt(person.x, person.z)], 0, 'out of the footprint');
  assert.ok(person.x > 3, `walked on toward the goal (x ${person.x.toFixed(2)})`);
});
