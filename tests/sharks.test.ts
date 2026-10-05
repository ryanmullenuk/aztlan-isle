import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { Coral } from '../src/entities/Coral';
import { Sharks, hammerheadGeometry } from '../src/entities/Sharks';
import { SEA_SURFACE } from '../src/water/Water';

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

test('hammerheads: pods of three or four over the reefs, always swimming in deep water under the surface', () => {
  const w = island();
  const coral = new Coral(w);
  const schools = coral.patches.slice(0, 6).map((p) => ({ x: p.x, z: p.z }));
  let scattered = 0;
  const sharks = new Sharks(w, coral.patches, { schools, scatter: () => { scattered++; } }) as any;
  assert.ok(sharks.pods.length >= 2, `${sharks.pods.length} pods`);
  for (let k = 0; k < sharks.pods.length; k++) {
    const n = sharks.sharks.filter((s: any) => s.pod === k).length;
    assert.ok(n >= 3 && n <= 4);
  }
  const states = new Set<string>();
  for (let t = 0; t < 120 * 30; t++) {
    sharks.update(1 / 30);
    for (const p of sharks.pods) states.add(p.state);
    if (t % 30 === 0) for (const s of sharks.sharks) {
      assert.ok(w.heightAt(s.x, s.z) < -0.8, `shark in the shallows at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
      assert.ok(s.y + 0.42 * s.scale < SEA_SURFACE + 0.02, 'fin out of the water');
      assert.ok(s.y < -0.45, 'swimming at the surface');
    }
  }
  // Over two minutes they cruise, circle, chase fish (which scatter) and swim off.
  for (const st of ['cruise', 'circle', 'chase', 'leave']) assert.ok(states.has(st), `never ${st}`);
  assert.ok(scattered > 0, 'never chased the fish close enough to scatter them');
});

test('hammerhead model: hammer wider than the body, nose forward, long upper tail lobe', () => {
  const g = hammerheadGeometry();
  g.computeBoundingBox();
  const b = g.boundingBox!;
  assert.ok(b.max.x > 0.2 && b.min.x < -0.2, 'hammer too narrow');
  assert.ok(b.max.z > 0.5 && b.min.z < -0.6);
  assert.ok(b.max.y > 0.28, 'no tall dorsal or tail lobe');
});
