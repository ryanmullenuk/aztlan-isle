import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };

import * as models from '../src/buildings/models';
import { homeProps, propCount } from '../src/buildings/HomeProps';
import { wearInPlace, wearLean, wearLevel, wearMarks } from '../src/buildings/Wear';
import { VillageSmoke, hearthStrength } from '../src/buildings/VillageSmoke';
import { Doors, Washing, type Dwelling } from '../src/buildings/Doors';

const tris = (g: THREE.BufferGeometry) => g.index!.count / 3;
const HOUSES: [string, number, number][] = [['hut', 1, 1], ['home', 1, 1.5], ['home', 2, 1.5], ['home', 3, 1.5], ['home', 4, 1.5]];

test('a household’s things: the same for a seed, different between homes, inside the plot and light', () => {
  for (const [key, tier, half] of HOUSES) {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const a = homeProps(key, tier, seed * 7717), b = homeProps(key, tier, seed * 7717);
      assert.ok(a.geo && b.geo, `${key} ${tier} has things`);
      assert.deepEqual(Array.from(a.geo.getAttribute('position').array), Array.from(b.geo.getAttribute('position').array), 'same seed, same things');
      assert.deepEqual(a.cloths, b.cloths);
      for (const v of a.geo.getAttribute('position').array) assert.ok(Number.isFinite(v));
      a.geo.computeBoundingBox();
      const bb = a.geo.boundingBox!;
      assert.ok(bb.min.x >= -half && bb.max.x <= half && bb.min.z >= -half && bb.max.z <= half && bb.min.y >= -0.02, `${key} ${tier} seed ${seed} inside its plot`);
      for (const c of a.cloths) {
        // A cloth lies along its line and swings across it.
        const ax = Math.abs(Math.cos(c.ry)), az = Math.abs(Math.sin(c.ry));
        assert.ok(Math.abs(c.x) + ax * c.w / 2 + az * 0.08 <= half && Math.abs(c.z) + az * c.w / 2 + ax * 0.08 <= half, 'washing inside the plot, with room to swing');
      }
      assert.ok(tris(a.geo) < 1500, `${key} ${tier} things too heavy (${tris(a.geo)})`);
      seen.add(tris(a.geo) * 1000 + a.cloths.length);
    }
    assert.ok(seen.size > 8, `${key} ${tier}: homes differ (${seen.size} kinds in 60)`);
  }
  assert.ok(propCount('hut', 1) < propCount('home', 1) && propCount('home', 1) < propCount('home', 4), 'more as a home is upgraded');
  assert.equal(homeProps('temple', 1, 5).geo, null);
});

test('doors: a model made for a building hands over its doors; on its own it keeps a shut one', () => {
  const alone = models.homeModel(1), built = models.collectGlows(() => models.homeModel(1));
  assert.equal(alone.doors, undefined);
  assert.equal(built.doors!.length, 1);
  assert.ok(tris(alone.finished) > tris(built.finished), 'the fixed leaf is left out when the door moves');
  assert.equal(models.collectGlows(() => models.homeModel(4)).doors!.length, 2);
  const hut = models.collectGlows(() => models.hutModel());
  assert.ok(hut.doors![0].curtain, 'a hut has a door curtain');
  assert.ok(built.windows!.some((g) => g.win) && built.windows!.some((g) => !g.win), 'windows are told from doorways');
});

const dwelling = (id: number, doors: models.Door[] | undefined, cloths?: Dwelling['cloths']): Dwelling => {
  const group = new THREE.Group();
  group.position.set(id * 4, 1, 3);
  return { id, x: id * 4, z: 3, angle: 0, group, doors, cloths };
};

test('doors stand open by day and are shut at night, in the rain and on empty houses', () => {
  const doors = new Doors();
  const model = models.collectGlows(() => models.homeModel(1));
  const b = dwelling(3, model.doors);
  const yes = () => true;
  doors.update([b], 0.016, 0, false, yes, yes);
  assert.equal(doors.mesh.count, 1);
  assert.equal(b.doorOpen![0], 1, 'open by day from the start');
  const m = new THREE.Matrix4(), tip = new THREE.Vector3();
  const tipZ = () => { doors.mesh.getMatrixAt(0, m); return tip.set(1, 0.5, 0).applyMatrix4(m).z; };
  const openZ = tipZ();
  for (let k = 0; k < 120; k++) doors.update([b], 0.05, 1, false, yes, yes);
  assert.equal(b.doorOpen![0], 0, 'shut at night');
  assert.ok(openZ - tipZ() > 0.15, 'the open leaf stood out from the wall');
  for (let k = 0; k < 120; k++) doors.update([b], 0.05, 0, false, yes, yes);
  assert.equal(b.doorOpen![0], 1);
  for (let k = 0; k < 120; k++) doors.update([b], 0.05, 0, true, yes, yes);
  assert.equal(b.doorOpen![0], 0, 'shut against the rain');
  for (let k = 0; k < 120; k++) doors.update([b], 0.05, 0, false, yes, () => false);
  assert.equal(b.doorOpen![0], 0, 'no one home');
  doors.update([b], 0.05, 0, false, () => false, yes);
  assert.equal(doors.mesh.count, 0, 'not drawn while the house is not standing');
  // Each house keeps its own hours.
  const hours = new Set(Array.from({ length: 30 }, (_, i) => Doors.shutAt(i + 1).toFixed(2)));
  assert.ok(hours.size > 15);
  for (let i = 1; i < 30; i++) assert.ok(Doors.shutAt(i) >= 0.3 && Doors.shutAt(i) <= 0.8);
  // Many houses: the one mesh grows.
  const many = Array.from({ length: 300 }, (_, i) => dwelling(i + 1, model.doors));
  doors.update(many, 0.016, 0, false, yes, yes);
  assert.equal(doors.mesh.count, 300);
});

test('washing hangs on the lines and is taken in when it rains', () => {
  const washing = new Washing();
  let props = homeProps('home', 1, 1);
  for (let seed = 2; !props.cloths.length; seed++) props = homeProps('home', 1, seed);
  const b = dwelling(2, undefined, props.cloths);
  washing.update([b], 0.016, false, () => true);
  assert.equal(washing.mesh.count, props.cloths.length);
  for (let k = 0; k < 200; k++) washing.update([b], 0.05, true, () => true);
  assert.equal(washing.mesh.count, 0, 'taken in');
  for (let k = 0; k < 200; k++) washing.update([b], 0.05, false, () => true);
  assert.equal(washing.mesh.count, props.cloths.length, 'hung out again');
  const veg = washing.mesh.geometry.getAttribute('aVeg'), P = washing.mesh.geometry.getAttribute('position');
  for (let i = 0; i < P.count; i++) if (P.getY(i) === 0) assert.equal(veg.getX(i), 0, 'still where it is pegged');
});

test('hearth smoke: thin by day, most at supper, embers at night; each fire keeps its own plume', () => {
  assert.ok(hearthStrength(0) < 0.5 && hearthStrength(0) > 0.1);
  assert.ok(hearthStrength(0.35) > 0.9);
  assert.ok(hearthStrength(1) < hearthStrength(0));
  // With the clock: breakfast, the midday meal and supper stand out from the working day.
  const noon = hearthStrength(0, 0.41), work = hearthStrength(0, 0.5), supper = hearthStrength(0.2, 0.72), small = hearthStrength(1, 0.05);
  assert.ok(noon > work && supper > noon && small < work);
  const smoke = new VillageSmoke();
  assert.equal(smoke.points.geometry.drawRange.count, 0);
  const a = { key: 1, x: 1, y: 2, z: 3, power: 1 }, b = { key: 2, x: 5, y: 2, z: 3, power: 0.5 };
  for (let k = 0; k < 40; k++) smoke.sync([a, b]);
  assert.equal(smoke.spots, 2);
  assert.equal(smoke.strength(1), 1);
  assert.equal(smoke.strength(2), 0.5);
  // The first fire goes out: the second keeps its strength (and its points), the first dies away.
  smoke.sync([b]);
  assert.equal(smoke.strength(2), 0.5);
  assert.ok(smoke.strength(1) > 0 && smoke.strength(1) < 1, 'dying away, not cut off');
  for (let k = 0; k < 40; k++) smoke.sync([b]);
  assert.equal(smoke.spots, 1);
  for (let k = 0; k < 40; k++) smoke.sync([]);
  assert.equal(smoke.points.geometry.drawRange.count, 0, 'nothing drawn with no fires');
  // Far more fires than there is room for: no error, the extra go without.
  smoke.sync(Array.from({ length: 500 }, (_, i) => ({ key: 100 + i, x: i, y: 0, z: 0, power: 1 })));
  assert.ok(smoke.spots <= 220 && smoke.points.geometry.drawRange.count <= smoke.points.geometry.getAttribute('position').count);
});

test('wear: sound buildings are untouched; damaged ones crack, lose plaster and lean', () => {
  assert.equal(wearLevel({ complete: true }), 0);
  assert.equal(wearLevel({ complete: true, integrity: 1 }), 0);
  assert.equal(wearLevel({ complete: true, integrity: 0.9 }), 1);
  assert.equal(wearLevel({ complete: true, integrity: 0.3 }), 2);
  assert.equal(wearLevel({ complete: true, integrity: 0, ruined: true }), 2);
  assert.equal(wearLevel({ complete: false, integrity: 0.3 }), 0);
  assert.deepEqual(wearLean(0, 7), [0, 0]);
  for (const make of [() => models.homeModel(1), () => models.hutModel(), () => models.smokehouseModel(3, 3), () => models.grainstoreModel()]) {
    const g = make().finished;
    assert.equal(wearMarks(g, 0, 5), null);
    const m1 = wearMarks(g, 1, 5)!, m2 = wearMarks(g, 2, 5)!;
    assert.ok(m1 && m2 && tris(m2) > tris(m1), 'worse damage, more marks');
    assert.ok(tris(m2) < 400, 'marks are light');
    assert.deepEqual(Array.from(wearMarks(g, 2, 5)!.getAttribute('position').array), Array.from(m2.getAttribute('position').array), 'the same every session');
    // Every mark lies on the model: inside its bounds (a little proud of its faces).
    g.computeBoundingBox(); m2.computeBoundingBox();
    const bb = g.boundingBox!.clone().expandByScalar(0.12);
    assert.ok(bb.containsBox(m2.boundingBox!));
    for (const v of m2.getAttribute('position').array) assert.ok(Number.isFinite(v));
    // Leaning: the top moves, the footings stay; colours only ever darken.
    const before = g.clone();
    wearInPlace(g, 2, 5);
    const [lx, lz] = wearLean(2, 5);
    assert.ok(Math.hypot(lx, lz) > 0.02 && Math.hypot(lx, lz) < 0.06);
    const P0 = before.getAttribute('position'), P1 = g.getAttribute('position'), C0 = before.getAttribute('color'), C1 = g.getAttribute('color');
    for (let i = 0; i < P0.count; i += 7) {
      const y = Math.max(0, P0.getY(i));
      assert.ok(Math.abs(P1.getX(i) - (P0.getX(i) + lx * y)) < 1e-5 && Math.abs(P1.getZ(i) - (P0.getZ(i) + lz * y)) < 1e-5 && P1.getY(i) === P0.getY(i));
      assert.ok(C1.getX(i) <= C0.getX(i) + 1e-6);
    }
  }
});
