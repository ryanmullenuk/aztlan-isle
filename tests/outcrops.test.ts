import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { Outcrops } from '../src/terrain/Outcrops';
import { boulderGeometry } from '../src/render/rocks';
import { rockGeometry } from '../src/vegetation/models';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

/** Every placed instance's position (of one kind: crag, slab or scree, or all). */
function placed(o: Outcrops, kind = ''): THREE.Vector3[] {
  const out: THREE.Vector3[] = [], m = new THREE.Matrix4();
  for (const mesh of o.group.children as THREE.InstancedMesh[]) {
    if (kind && mesh.name !== `outcrops-${kind}`) continue;
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      out.push(new THREE.Vector3().setFromMatrixPosition(m));
    }
  }
  return out;
}

test('outcrops: crags in the cliffs and bedrock on the rocky hills, the same every time; scree only on Ultra', () => {
  const w = island();
  const o = new Outcrops(w);
  assert.ok(o.counts.crag > 50, `crags ${o.counts.crag}`);
  assert.ok(o.counts.slab > 50, `slabs ${o.counts.slab}`);
  assert.equal(o.counts.scree, 0);
  const before = placed(o).map((p) => p.toArray().join());
  const again = placed(new Outcrops(w)).map((p) => p.toArray().join());
  assert.deepEqual(again, before);
  o.setUltra(true);
  assert.ok(o.counts.scree > 200 && o.counts.slab > 0);
  o.setUltra(false);
  assert.equal(o.counts.scree, 0);
  // None on sandy beaches.
  for (const p of placed(o)) {
    const i = w.cellIndexAt(p.x, p.z);
    if (i >= 0 && w.layer[i] >= 1) assert.ok(w.sandy[i] < 0.6, 'rock out on the sand');
  }
});

test('outcrops: cleared from under buildings and paths, and follow the land when it is reshaped', () => {
  const w = island();
  const o = new Outcrops(w);
  // A cliff with crags in it.
  const p = placed(o, 'crag').find((v) => { const i = w.cellIndexAt(v.x, v.z); return i >= 0 && w.layer[i] >= 2; })!;
  const i = w.cellIndexAt(p.x, p.z);
  const near = () => placed(o).filter((v) => w.cellIndexAt(v.x, v.z) === i).length;
  assert.ok(near() > 0);
  w.occ[i] = 5;
  o.refresh(false);
  assert.equal(near(), 0, 'rock left under a building');
  w.occ[i] = 0;
  o.refresh(false);
  assert.ok(near() > 0);
  // Flatten the whole neighbourhood to one layer: the cliffs (and their crags) go.
  const crags = o.counts.crag;
  const [cx, cz] = w.cellOf(p.x, p.z);
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (w.inBounds(cx + dx, cz + dz)) w.layer[w.idx(cx + dx, cz + dz)] = w.layer[i];
  w.computeSmooth(cx - 8, cz - 8, cx + 8, cz + 8);
  w.version++;
  o.refresh(false);
  assert.ok(o.counts.crag < crags);
  for (const v of placed(o, 'crag')) assert.ok(Math.hypot(v.x - p.x, v.z - p.z) > 3, 'crag left on flattened ground');
});

test('boulders: closed faceted stone sitting within its footprint', () => {
  const g = boulderGeometry(7, { height: 0.8 });
  g.computeBoundingBox();
  const b = g.boundingBox!;
  assert.ok(b.max.y <= 0.81 && b.min.y >= -0.19 && b.max.x <= 1.15 && b.min.x >= -1.15);
  // A convex hull: every face points away from the middle.
  const pos = g.getAttribute('position');
  const c = new THREE.Vector3(0, 0.3, 0), a = new THREE.Vector3(), bb = new THREE.Vector3(), cc = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); bb.fromBufferAttribute(pos, i + 1); cc.fromBufferAttribute(pos, i + 2);
    n.crossVectors(bb.clone().sub(a), cc.clone().sub(a));
    assert.ok(n.dot(a.clone().sub(c)) >= -1e-6, 'face turned inward');
  }
  // Each land rock shape keeps to about the ground its stone blocks off.
  for (const alt of [false, true]) for (let v = 0; v < 3; v++) {
    const r = rockGeometry(v, 61 + v, false, alt);
    r.computeBoundingBox();
    const rb = r.boundingBox!;
    assert.ok(Math.max(-rb.min.x, rb.max.x, -rb.min.z, rb.max.z) < 1.25, `rock ${v}${alt ? 'b' : ''} sprawls`);
    assert.ok(rb.max.y < 1.2 && rb.max.y > 0.3, `rock ${v}${alt ? 'b' : ''} height ${rb.max.y}`);
  }
});
