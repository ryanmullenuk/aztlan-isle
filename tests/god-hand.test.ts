import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { WORLD } from '../src/config';
import { GodHand, HAND } from '../src/entities/GodHand';
import { SEA_SURFACE } from '../src/water/Water';

function setup() {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  const taken: string[] = [], freed: boolean[] = [];
  const sharks: { x: number; z: number }[] = [], jellies: { x: number; z: number; r: number }[] = [];
  const hand = new GodHand(w, { sharks: () => sharks, jellies: () => jellies, release: () => {}, taken: (_i, by) => taken.push(by), freed: (_i, swam) => freed.push(swam) });
  const m = w.meadow;
  const isl = { x: m.x, y: w.heightAt(m.x, m.z), z: m.z, heading: 0, sleeping: false } as any;
  // Open sea: the first deep sea cell found.
  let sea = { x: 0, z: 0 };
  for (let i = 0; i < w.N * w.N; i++) if (w.isSea(i) && w.heightAt(w.centerX(i % w.N), w.centerZ(Math.floor(i / w.N))) < -1.5) { sea = { x: w.centerX(i % w.N), z: w.centerZ(Math.floor(i / w.N)) }; if (Math.abs(sea.x) < w.half - 12 && Math.abs(sea.z) < w.half - 12) break; }
  return { w, hand, isl, sea, sharks, jellies, taken, freed };
}
const run = (hand: GodHand, secs: number, until?: () => boolean) => { for (let t = 0; t < secs; t += 1 / 60) { hand.update(1 / 60); if (until?.()) return t; } return secs; };

test('the hand lifts an islander, who hangs and swings beneath it, and a throw on land never kills', () => {
  const { w, hand, isl, taken, freed } = setup();
  hand.grab(isl, isl.x, isl.z);
  assert.equal(isl.flung.mode, 'held');
  run(hand, 1);
  assert.ok(isl.y > w.heightAt(isl.x, isl.z) + 0.6, 'not lifted off the ground');
  // A quick sweep of the hand sets the body swinging.
  hand.moveTo(isl.x + 6, isl.z);
  let swing = 0;
  run(hand, 0.5, () => { swing = Math.max(swing, Math.abs(isl.flung.rx) + Math.abs(isl.flung.rz)); return false; });
  assert.ok(swing > 0.15, `the body barely swung (${swing})`);
  hand.release();
  assert.equal(isl.flung.mode, 'air');
  assert.equal(hand.held, null);
  run(hand, 12, () => !isl.flung);
  assert.equal(isl.flung, undefined, 'never got back up');
  assert.deepEqual(taken, []);
  assert.deepEqual(freed, [false]);
  assert.ok(Math.abs(isl.y - w.heightAt(isl.x, isl.z)) < 0.05, 'not standing on the ground');
});

test('thrown in the sea they swim back to shore, unless a shark or the jellyfish reach them first', () => {
  for (const danger of ['none', 'shark', 'jellyfish'] as const) {
    const { w, hand, isl, sea, sharks, jellies, taken, freed } = setup();
    isl.x = sea.x; isl.z = sea.z; isl.y = 3;
    isl.flung = { mode: 'air', rx: 0, rz: 0, vx: 0, vy: 0, vz: 0, t: 0, wx: 0, wz: 0 };
    (hand as any).busy.add(isl);
    run(hand, 3, () => isl.flung?.mode === 'swim');
    assert.equal(isl.flung?.mode, 'swim', 'did not start swimming');
    assert.ok(isl.y < SEA_SURFACE, 'not in the water');
    const shore = isl.flung.shore;
    assert.ok(shore, 'no shore to swim for');
    if (danger === 'shark') sharks.push({ x: (isl.x + shore.x) / 2, z: (isl.z + shore.z) / 2 });
    if (danger === 'jellyfish') jellies.push({ x: (isl.x + shore.x) / 2, z: (isl.z + shore.z) / 2, r: 1 });
    const far = Math.hypot(shore.x - isl.x, shore.z - isl.z);
    run(hand, far / HAND.swimSpeed + 20, () => !isl.flung);
    assert.equal(isl.flung, undefined);
    if (danger === 'none') {
      assert.deepEqual(taken, []);
      assert.deepEqual(freed, [true]);
      assert.ok(w.heightAt(isl.x, isl.z) > SEA_SURFACE - 0.3, 'not ashore');
    } else {
      assert.deepEqual(taken, [danger]);
      assert.deepEqual(freed, []);
    }
  }
});
