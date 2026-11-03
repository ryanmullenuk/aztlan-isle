import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDINGS, type BuildingKey } from '../src/config';
import { GeoBuilder } from '../src/render/GeoBuilder';
import { FOOD_LOOKS } from '../src/buildings/looks/food';
import { LOOKS, upgradeLooks } from '../src/buildings/looks';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document ??= { createElement: () => ({ getContext: () => ctx }) };

const FOOD: BuildingKey[] = ['farm', 'maizefarm', 'chinampa', 'smokehouse', 'butcher', 'pigpen', 'chickenpen', 'jetty', 'fishhut', 'woodstore', 'grainstore'];

/** One look drawn on its own: its geometry and any flames it adds. */
function draw(key: BuildingKey, k: number): { geo: THREE.BufferGeometry; torches: THREE.Vector3[] } {
  const [w, d] = BUILDINGS[key].size, b = new GeoBuilder(), torches: THREE.Vector3[] = [];
  FOOD_LOOKS[key]![k](b, w, d, torches);
  return { geo: b.build(), torches };
}

test('every food building has a look for each of its three upgrades, wired into LOOKS', () => {
  for (const key of FOOD) {
    assert.equal(FOOD_LOOKS[key]?.length, 3, `${key} has 3 looks`);
    assert.equal(LOOKS[key], FOOD_LOOKS[key], `${key} looks are in LOOKS`);
  }
});

test('each look adds finite geometry of its own', () => {
  for (const key of FOOD) for (let k = 0; k < 3; k++) {
    const { geo } = draw(key, k);
    const pos = geo.getAttribute('position');
    assert.ok(pos.count > 0, `${key} upgrade ${k + 1} adds geometry`);
    for (const x of pos.array) assert.ok(Number.isFinite(x), `${key} upgrade ${k + 1} finite`);
    // Building looks are rigid: nothing sways in the wind.
    const veg = geo.getAttribute('aVeg');
    for (let i = 0; i < veg.count; i++) assert.equal(veg.getX(i), 0, `${key} upgrade ${k + 1} does not sway`);
  }
});

test('looks stay inside the footprint (the jetty only reaching out along its pier)', () => {
  const eps = 0.005;
  for (const key of FOOD) for (let k = 0; k < 3; k++) {
    const [w, d] = BUILDINGS[key].size;
    const { geo } = draw(key, k);
    const P = geo.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), at = `${key} upgrade ${k + 1} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
      assert.ok(z >= -d / 2 - eps, `${at}: behind the footprint`);
      if (key === 'jetty' && z > d / 2) {
        // Seaward: along the pier and its T-end (lengthened a cell each way), up to where boats moor.
        assert.ok(x >= -1.7 && x <= 2.7 && z <= 1.2 + 6 + 1.0, `${at}: off the pier`);
        continue;
      }
      assert.ok(Math.abs(x) <= w / 2 + eps && z <= d / 2 + eps, `${at}: outside the ${w}×${d} footprint`);
      if (key !== 'jetty' && key !== 'fishhut') assert.ok(y >= -0.03, `${at}: below the ground`);
    }
  }
});

test('the applied looks merge cumulatively, and the jetty lantern lights fires', () => {
  for (const key of FOOD) {
    const [w, d] = BUILDINGS[key].size;
    const counts = [1, 2, 3].map((n) => upgradeLooks(key, n, w, d)!.geo.getAttribute('position').count);
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `${key} grows with each upgrade`);
  }
  assert.equal(draw('jetty', 0).torches.length + draw('jetty', 1).torches.length, 0);
  assert.ok(draw('jetty', 2).torches.length >= 3, 'lanterns burn on the jetty');
});

test('pier and stilt-hut looks follow the land height they are given', () => {
  for (const key of ['jetty', 'fishhut'] as const) {
    const [w, d] = BUILDINGS[key].size, k = key === 'jetty' ? 0 : 1;
    const top = (landY: number) => {
      const b = new GeoBuilder();
      (FOOD_LOOKS[key]![k] as (...a: unknown[]) => void)(b, w, d, [], landY);
      const g = b.build();
      g.computeBoundingBox();
      return g.boundingBox!.max.y;
    };
    assert.ok(Math.abs(top(0.275) - top(0.825) - 0.55) < 1e-4, `${key} look drops with higher land`);
  }
});
