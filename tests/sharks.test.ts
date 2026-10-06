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

test('sharks are solid and steer around rocks and each other without overlapping', () => {
  const w = new World(); w.layer.fill(-4); w.smooth.fill(-4);
  w.blockFixed[w.cellIndexAt(0, 0)] = 1;
  const group = new Sharks(w, [{ x: -6, z: 0, r: 4 }], { schools: [], scatter() {} }) as any;
  assert.equal(group.mesh.material.opacity, 1);
  assert.equal(group.mesh.material.depthWrite, true);
  const starts = group.sharks.map((s: any) => ({x:s.x,z:s.z}));
  group.pods[0].tx = 8; group.pods[0].tz = 0; group.pods[0].timer = 100;
  for (let k = 0; k < 900; k++) {
    group.update(1/30);
    for (const s of group.sharks) {
      assert.ok(group.clearWater(s.x,s.z,s.scale*0.72), 'rock clearance');
      for (const o of group.sharks) if (o !== s)
        assert.ok(Math.hypot(s.x-o.x,s.z-o.z) >= (s.scale+o.scale)*0.72, 'sharks overlap');
    }
  }
  assert.ok(group.sharks.some((s: any,i: number) => Math.hypot(s.x-starts[i].x,s.z-starts[i].z) > 5), 'must keep swimming');
});
