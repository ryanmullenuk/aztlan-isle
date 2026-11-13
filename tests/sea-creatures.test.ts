import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MorayEels, MORAY } from '../src/entities/MorayEels';
import { jellyModelGeometry } from '../src/entities/Jellyfish';
import { World } from '../src/world/World';

function sea(seed = 7, layer = -1) {
  const world = new World(); world.seed = seed; world.layer.fill(layer); world.computeSmooth();
  return world;
}

function homes(world: World) {
  const out: { x: number; z: number }[] = [];
  for (let x = -30; x <= 30; x += 2.5) for (let z = -30; z <= 30; z += 2.5) out.push({ x, z });
  return out.filter((h) => world.heightAt(h.x, h.z) >= MORAY.bed[0] && world.heightAt(h.x, h.z) <= MORAY.bed[1]);
}

test('moray eels: a modest, well-spaced, seeded population in their crevices', () => {
  const w = sea();
  const hs = homes(w);
  assert.ok(hs.length > 40, `fixture sea floor at ${w.heightAt(0, 0)} gives no homes`);
  const a = new MorayEels(w, hs), b = new MorayEels(w, hs);
  assert.ok(a.list.length >= MORAY.count[0] && a.list.length <= MORAY.count[1]);
  assert.deepEqual(a.list.map((e) => [e.hx, e.hz, e.length]), b.list.map((e) => [e.hx, e.hz, e.length]));
  for (const e of a.list) for (const o of a.list) if (e !== o) assert.ok(Math.hypot(e.hx - o.hx, e.hz - o.hz) >= MORAY.spacing);
  // No usable homes: no eels (and no crash).
  assert.equal(new MorayEels(w, []).list.length, 0);
});

test('moray eels lurk, swim a loop home, and bolt into their holes when disturbed', () => {
  const w = sea();
  const m = new MorayEels(w, homes(w));
  const e = m.list[0];
  assert.equal(e.state, 'lurk');
  e.timer = 0;
  let swam = false, back = false;
  for (let i = 0; i < 60 * 60 && !back; i++) {
    m.update(1 / 30);
    if (e.state === 'swim') swam = true;
    else if (swam && e.state === 'lurk') back = true;
    assert.ok(Number.isFinite(e.x + e.y + e.z + e.heading + e.pitch));
    // Never strays far from its crevice.
    assert.ok(Math.hypot(e.x - e.hx, e.z - e.hz) < e.loopR * 2 + e.length);
  }
  assert.ok(swam && back, 'eel never completed a swim loop');
  m.scare(e.x, e.z);
  assert.equal(e.state, 'hide');
  for (let i = 0; i < 30; i++) m.update(1 / 30);
  assert.ok(e.out <= 0, 'eel still showing after bolting');
  // Threat hook (e.g. a boat overhead) works the same way.
  const f = m.list[1];
  m.threats = () => [{ x: f.x, z: f.z }];
  m.update(1 / 30);
  assert.equal(f.state, 'hide');
});

test('the baked moon-jelly is reframed to the procedural bell and tagged for the pulse shader', () => {
  // A stand-in "baked" jelly: a dome (widest at its rim) with a thin arm and a tentacle hanging below.
  const pts: number[] = [], cols: number[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    pts.push(Math.cos(a) * 0.6, 2.0, Math.sin(a) * 0.6); // rim
    pts.push(Math.cos(a) * 0.3, 2.35, Math.sin(a) * 0.3); // dome
  }
  pts.push(0, 2.45, 0, 0.05, 1.0, 0, 0.5, 0, 0.1);
  for (let i = 0; i < pts.length / 3; i++) cols.push(0.9, 0.8, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const j = jellyModelGeometry(g);
  j.computeBoundingBox();
  assert.ok(Math.abs(j.boundingBox!.max.y - 0.48) < 1e-5);
  assert.ok(Math.abs(Math.max(j.boundingBox!.max.x, j.boundingBox!.max.z) - 1) < 1e-5);
  const part = j.getAttribute('aPart'), along = j.getAttribute('aAlong');
  const n = part.count;
  assert.equal(part.getX(0), 0); // rim: bell
  assert.ok(along.getX(0) > 0.9);
  assert.equal(part.getX(n - 2), 1); // near the middle, below: oral arm
  assert.equal(part.getX(n - 1), 2); // further out, below: tentacle
  assert.ok(Math.abs(along.getX(n - 1) - 1) < 1e-5);
  assert.ok(j.getAttribute('aCol') && !j.getAttribute('color'));
});
