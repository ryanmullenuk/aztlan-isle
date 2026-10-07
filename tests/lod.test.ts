import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { modelLo, cropLo } from '../src/buildings/Buildings';
import { homeModel, cropModel } from '../src/buildings/models';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { Vegetation } from '../src/vegetation/Vegetation';

const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

test('far buildings: same vertices without the tiny details, far crops a few lumps', () => {
  const home = homeModel(1).finished;
  const lo = modelLo(home);
  assert.ok(tris(lo) < tris(home) * 0.7, `${tris(lo)} of ${tris(home)}`);
  assert.equal(lo.getAttribute('position'), home.getAttribute('position'), 'the far model should share the vertices');
  assert.equal(modelLo(home), lo, 'built once');
  const crops = cropModel(4, 4, true, 'veg');
  const far = cropLo(crops);
  assert.ok(tris(far) * 5 < tris(crops), `${tris(far)} of ${tris(crops)}`);
  // The lumps cover the same field.
  crops.computeBoundingBox(); far.computeBoundingBox();
  assert.ok(far.boundingBox!.max.x > crops.boundingBox!.max.x - 0.5 && far.boundingBox!.min.z < crops.boundingBox!.min.z + 0.5);
});

test('trees change detail one by one with their own distance, not a whole chunk at once', () => {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  const veg = new Vegetation(w, 'low') as any;
  veg.build();
  const cam = new THREE.Vector3(w.meadow.x, w.heightAt(w.meadow.x, w.meadow.z) + 6, w.meadow.z), target = new THREE.Vector3(w.meadow.x, 0, w.meadow.z);
  for (let i = 0; i < 3; i++) veg.update(0.3, cam, target, 48, 1, 0, 32);
  // Within one chunk some trees are near and some far.
  let mixed = 0;
  for (const cm of veg.chunks.values()) if (cm.far && cm.mesh.count > 0 && cm.far.count > 0) mixed++;
  assert.ok(mixed > 0, 'no chunk holds both near and far trees');
  for (const cm of veg.chunks.values()) if (cm.far) {
    assert.equal(cm.far.geometry, cm.def.lo);
    assert.notEqual(cm.mesh.geometry, cm.def.lo);
    assert.equal(cm.far.boundingSphere, cm.mesh.boundingSphere, 'both halves share the whole chunk bounds');
  }
  // A tree right on the switching distance does not flip back and forth.
  const before = new Set(veg.farIds);
  cam.x += 0.5;
  for (let i = 0; i < 3; i++) veg.update(0.3, cam, target, 48, 1, 0, 32);
  let flipped = 0;
  for (const id of veg.farIds) if (!before.has(id)) flipped++;
  assert.ok(flipped < 20, `${flipped} trees changed detail for a half-step of the camera`);
});
