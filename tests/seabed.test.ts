import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD } from '../src/config';
import { generateIsland } from '../src/world/generator';
import { World } from '../src/world/World';
import { Seabed, SEABED_DENSITY } from '../src/entities/Seabed';
import { SEA_SURFACE } from '../src/water/Water';

const island = () => { const w = new World(); generateIsland(w, WORLD.islandSeed, 'classic', 3); return w; };

/** Every instance drawn now: kind, position and scale (order-free, so rebuilt chunks compare equal). */
function shown(s: Seabed): string[] {
  const out: string[] = [], m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (const o of s.group.children) {
    const mesh = o as THREE.InstancedMesh;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      out.push(`${mesh.name} ${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)} ${sc.y.toFixed(3)}`);
    }
  }
  return out.sort();
}

test('seabed: big reef fields, kelp, meadows and sponges grow from the seed alone, only on the open shelf and under the surface', () => {
  const w = island(), a = new Seabed(w), b = new Seabed(island());
  const snap = shown(a);
  assert.deepEqual(snap, shown(b), 'the same island grows the same seabed');
  assert.deepEqual(a.hotspots(), b.hotspots());
  const kinds = new Set(snap.map((s) => s.split(' ')[0]));
  for (const k of ['elkhorn', 'pillar', 'plates', 'mound', 'mushroom', 'barrel', 'vase', 'ball', 'kelp', 'meadow', 'fan', 'star', 'urchin', 'clam']) assert.ok(kinds.has(`seabed-${k}`), `no ${k}`);

  const g = w.glade!;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (const o of a.group.children) {
    const mesh = o as THREE.InstancedMesh;
    mesh.geometry.computeBoundingBox();
    const top = mesh.geometry.boundingBox!.max.y;
    assert.ok(mesh.geometry.getAttribute('position').count < 300, `${mesh.name} is too heavy`);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      const bed = w.heightAt(p.x, p.z);
      assert.ok(bed <= -0.35, `${mesh.name} on the beach at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      assert.ok(w.isSeaAt(p.x, p.z), `${mesh.name} in a lake or river`);
      assert.ok(Math.hypot(p.x - g.x, p.z - g.z) > g.r, `${mesh.name} in the glade's lake`);
      assert.ok(!w.blocked(w.cellIndexAt(p.x, p.z)), `${mesh.name} on a blocked cell`);
      assert.ok(p.y + top * sc.y <= SEA_SURFACE - 0.08, `${mesh.name} breaks the surface`);
    }
  }

  // Reef fish gather at the big reefs: their middles lie on the shelf.
  const spots = a.hotspots();
  assert.ok(spots.length >= 8, `${spots.length} reef hotspots`);
  for (const s of spots.slice(0, 8)) assert.ok(w.heightAt(s.x, s.z) < -0.2 && w.isSeaAt(s.x, s.z));
});

test('seabed: fewer instances on lower presets, within budget', () => {
  const s = new Seabed(island());
  const budget = { ultra: 7000, high: 6200, medium: 4800, low: 3300 };
  const counts: Record<string, number> = {};
  for (const preset of ['ultra', 'high', 'medium', 'low'] as const) {
    s.setPreset(preset);
    counts[preset] = s.shown();
    assert.ok(counts[preset] <= budget[preset], `${preset}: ${counts[preset]} instances`);
  }
  assert.ok(counts.ultra > counts.high && counts.high > counts.medium && counts.medium > counts.low);
  assert.ok(counts.low > 500, 'still a reef on low');
  assert.equal(SEABED_DENSITY.ultra, 1);
  // The small touches (starfish, urchins, clams, rubble) are the first to go.
  const minor = s.group.children.filter((o) => /seabed-(star|urchin|clam|rubble)$/.test(o.name));
  assert.ok(minor.length > 0 && minor.every((o) => (o as THREE.InstancedMesh).count === 0));
});

test('seabed: sculpting hides and restores growth locally, matching a reloaded island', () => {
  const w = island(), s = new Seabed(w), before = shown(s);
  const spot = s.hotspots()[0], [cx, cz] = w.cellOf(spot.x, spot.z);
  const old = new Map<number, number>();
  for (let z = cz - 4; z <= cz + 4; z++) for (let x = cx - 4; x <= cx + 4; x++) { const i = w.idx(x, z); old.set(i, w.layer[i]); w.layer[i] = 2; }
  w.computeSmooth();
  s.refresh(cx - 6, cz - 6, cx + 6, cz + 6);
  const edited = shown(s);
  assert.ok(edited.length < before.length, 'the reef under new land is gone');
  assert.deepEqual(edited, shown(new Seabed(w)), 'matches a seabed grown on the edited island');
  // Elsewhere nothing moved.
  const far = (list: string[]) => list.filter((e) => { const [, x, , z] = e.split(' ').map(Number); return Math.hypot(x - spot.x, z - spot.z) > 12; });
  assert.deepEqual(far(edited), far(before));
  for (const [i, l] of old) w.layer[i] = l;
  w.computeSmooth();
  s.refresh(cx - 6, cz - 6, cx + 6, cz + 6);
  assert.deepEqual(shown(s), before);
});
