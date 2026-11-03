import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDINGS, type BuildingKey } from '../src/config';
import { LOOKS, upgradeLooks } from '../src/buildings/looks';
import { VILLAGE_LOOKS } from '../src/buildings/looks/village';
import { UPGRADES } from '../src/buildings/Upgrades';

const VILLAGE: BuildingKey[] = ['campfire', 'bonfire', 'firepit', 'well', 'greathall', 'palace', 'firemaker', 'market', 'tradedock', 'observatory'];
/** Buildings that turn freely within their plot: their looks keep round the middle. */
const FREE_TURN: BuildingKey[] = ['well', 'bonfire', 'firepit'];

const sizeOf = (key: BuildingKey) => BUILDINGS[key].size as [number, number];
const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

test('every village building has a look for each of its three upgrades', () => {
  for (const key of VILLAGE) {
    assert.equal(VILLAGE_LOOKS[key]?.length, 3, `${key} has three looks`);
    assert.equal(UPGRADES[key]?.length, 3, `${key} has three upgrades`);
    assert.equal(LOOKS[key], VILLAGE_LOOKS[key], `${key}'s looks are the ones in use`);
  }
});

test('each upgrade adds geometry of its own, finite and rigid', () => {
  for (const key of VILLAGE) {
    const [w, d] = sizeOf(key);
    let before = 0;
    for (let n = 1; n <= 3; n++) {
      const look = upgradeLooks(key, n, w, d);
      assert.ok(look, `${key} upgrade ${n} draws something`);
      const pos = look.geo.getAttribute('position');
      assert.ok(pos.count > before, `${key} upgrade ${n} adds to the upgrades before it`);
      before = pos.count;
      for (let i = 0; i < pos.count; i++) assert.ok(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)), `${key} vertex ${i} is finite`);
      const veg = look.geo.getAttribute('aVeg');
      for (let i = 0; i < veg.count; i++) assert.equal(veg.getX(i), 0, `${key} upgrade ${n} does not sway`);
    }
  }
});

test('the looks stay within the footprint (the trade dock’s berth runs out over the water)', () => {
  const eps = 1e-3;
  for (const key of VILLAGE) {
    const [w, d] = sizeOf(key);
    const bb = bounds(upgradeLooks(key, 3, w, d)!.geo);
    assert.ok(bb.min.x >= -w / 2 - eps && bb.max.x <= w / 2 + eps, `${key} within ±${w / 2} in x (${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)})`);
    assert.ok(bb.min.z >= -d / 2 - eps, `${key} within its back edge (${bb.min.z.toFixed(2)})`);
    if (key === 'tradedock') {
      // The second berth reaches out beside the pier, short of its T-end, its piles down into the water.
      assert.ok(bb.max.z > d / 2 && bb.max.z < 1.2 + 6, `trade dock berth runs out to ${bb.max.z.toFixed(2)}`);
      continue;
    }
    assert.ok(bb.max.z <= d / 2 + eps, `${key} within its front edge (${bb.max.z.toFixed(2)})`);
    assert.ok(bb.min.y >= -0.01, `${key} stays above the ground (${bb.min.y.toFixed(3)})`);
  }
});

test('the looks of free-turning buildings stay round the middle', () => {
  for (const key of FREE_TURN) {
    const [w, d] = sizeOf(key);
    const pos = upgradeLooks(key, 3, w, d)!.geo.getAttribute('position');
    let r = 0;
    for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
    assert.ok(r <= (Math.min(w, d) / 2) * 1.06, `${key} looks reach ${r.toFixed(2)} from the middle`);
  }
});

test('the front middle stays clear for the way in', () => {
  // Buildings with a door or entrance at the front middle (+z): nothing new stands in the way.
  const doors: [BuildingKey, number, number][] = [['greathall', 0.75, 2.8], ['palace', 2.0, 3.5], ['market', 0.6, 1.5], ['observatory', 0.3, 0.6], ['firemaker', 0.35, 1.0]];
  for (const [key, halfW, z0] of doors) {
    const [w, d] = sizeOf(key);
    const pos = upgradeLooks(key, 3, w, d)!.geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Overhead things (garlands under a beam) don't block the way.
      if (y > 1.6) continue;
      assert.ok(!(Math.abs(x + (key === 'firemaker' ? 0.92 : 0)) < halfW && z > z0 && z < d / 2), `${key} keeps its way in clear (vertex at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
});

test('the campfire and bonfire looks add no flames (their flames burn as whole village fires)', () => {
  for (const key of ['campfire', 'bonfire'] as BuildingKey[]) {
    const [w, d] = sizeOf(key);
    assert.equal(upgradeLooks(key, 3, w, d)!.torches.length, 0, key);
  }
  for (const key of ['firepit', 'tradedock'] as BuildingKey[]) {
    const [w, d] = sizeOf(key);
    assert.ok(upgradeLooks(key, 3, w, d)!.torches.length > 0, `${key}'s oven or beacon is lit`);
  }
});
