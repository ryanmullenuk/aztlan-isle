import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bathing, BATHE, freshWater } from '../src/ai/Bathing';
import { BloodClouds, BLOOD } from '../src/render/BloodCloud';

/** A tiny world: dry land everywhere except a round pond (inland, so not the sea) in the middle. */
function pondWorld() {
  const N = 40, cell = 1;
  const layer = new Int8Array(N * N).fill(1), riverY = new Float32Array(N * N).fill(NaN);
  const inPond = (x: number, z: number) => Math.hypot(x, z) < 6;
  const w: any = {
    N, version: 1, layer, riverY, occ: new Int32Array(N * N),
    idx: (x: number, z: number) => z * N + x, inBounds: (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N,
    centerX: (gx: number) => (gx - N / 2 + 0.5) * cell, centerZ: (gz: number) => (gz - N / 2 + 0.5) * cell,
    cellIndexAt: (x: number, z: number) => { const gx = Math.floor(x / cell + N / 2), gz = Math.floor(z / cell + N / 2); return gx >= 0 && gz >= 0 && gx < N && gz < N ? gz * N + gx : -1; },
    heightAt: (x: number, z: number) => (inPond(x, z) ? -0.9 : 0.5),
    isSea: () => false, isLandCell: (i: number) => layer[i] >= 1, blocked: () => false,
  };
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) if (inPond(w.centerX(gx), w.centerZ(gz))) layer[gz * N + gx] = 0;
  return w;
}

function swimmer(id = 1, x = 9, z = 0): any {
  return { id, name: 'Tecu', x, z, y: 0.5, heading: 0, happy: 0.4, hunger: 1, rest: 1, condition: 'well', think: 0 };
}

test('fresh water: the pond is swimmable, dry land is not, and the sea is never counted', () => {
  const w = pondWorld();
  assert.ok(freshWater(w, 0, 0)!.depth > BATHE.minDepth);
  assert.equal(freshWater(w, 10, 10), null);
  w.isSea = () => true;
  assert.equal(freshWater(w, 0, 0), null, 'the sea (sharks) is not for bathing');
});

test('an idle islander walks to the water, swims and treads water, then climbs out happier', () => {
  const w = pondWorld(), isl = swimmer(), swam: any[] = [];
  const b = new Bathing({
    world: w, people: () => [isl], fair: () => true,
    walkTo: (i, x, z) => { i.x = x; i.z = z; },
    swam: (i) => { swam.push(i); i.happy += BATHE.happy; },
  }, () => 0.5);
  assert.ok(b.swimSpots().length > 0);
  assert.ok(b.invite());
  b.update(0.1);
  assert.equal(isl.flung?.mode, 'bathe', 'never got in');
  let treaded = false, deepest = Infinity;
  for (let t = 0; t < 400 && b.list.length; t += 0.1) {
    b.update(0.1);
    if (isl.flung && !isl.flung.stroke) treaded = true;
    if (isl.flung) deepest = Math.min(deepest, isl.y);
    if (isl.flung) assert.ok(freshWater(w, isl.x, isl.z) || Math.hypot(isl.x, isl.z) < 7.5, 'swam out of the water');
  }
  assert.ok(treaded, 'never trod water');
  assert.ok(deepest < 0.07 - 0.3, 'not down in the water');
  assert.equal(swam.length, 1);
  assert.equal(isl.flung, undefined);
  assert.ok(isl.happy > 0.4);
});

test('nobody bathes in foul weather, and a swimmer plucked out by the god stops bathing', () => {
  const w = pondWorld(), isl = swimmer();
  const b = new Bathing({ world: w, people: () => [isl], fair: () => false, walkTo: (i, x, z) => { i.x = x; i.z = z; }, swam: () => {} }, () => 0.5);
  b.update(BATHE.every[1] + 1);
  assert.equal(b.list.length, 0);
  b.invite();
  b.update(0.1);
  isl.flung = { mode: 'held', rx: 0, rz: 0, vx: 0, vy: 0, vz: 0, t: 0, wx: 0, wz: 0 };
  b.update(0.1);
  assert.equal(b.list.length, 0);
});

test('where a shark takes someone, a red cloud spreads in the water and fades away', () => {
  const c = new BloodClouds();
  c.spawn(1, 0, 2);
  assert.equal(c.count, 1);
  c.update(1);
  assert.ok(c.group.children.length >= BLOOD.puffs);
  for (let t = 0; t < BLOOD.secs + 1; t += 0.5) c.update(0.5);
  assert.equal(c.count, 0);
  assert.equal(c.group.children.length, 0);
});
