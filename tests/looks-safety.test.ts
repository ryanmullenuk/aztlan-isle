import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SAFETY_LOOKS } from '../src/buildings/looks/safety';
import * as models from '../src/buildings/models';
import { GeoBuilder } from '../src/render/GeoBuilder';
import { BUILDINGS, type BuildingKey } from '../src/config';

/** The buildings with safety looks, and their models once all three upgrades are done. */
const MODELS: Partial<Record<BuildingKey, () => models.BuildingModel>> = {
  watchtower: models.watchtowerModel,
  kennel: models.kennelModel,
  warroom: models.warroomModel,
  healer: () => models.healingCentreModel(4),
  herbalist: models.herbalistModel,
  herbalgarden: models.herbalGardenModel,
};
const KEYS = Object.keys(MODELS) as BuildingKey[];

function draw(key: BuildingKey, upto: number, only?: number): { geo: THREE.BufferGeometry | null; torches: THREE.Vector3[] } {
  const [w, d] = BUILDINGS[key].size, b = new GeoBuilder(), torches: THREE.Vector3[] = [];
  SAFETY_LOOKS[key]!.forEach((look, k) => { if (only === undefined ? k < upto : k === only) look(b, w, d, torches); });
  return { geo: b.vertexCount ? b.build() : null, torches };
}

test('each safety building has a look for each of its three upgrades, and each adds geometry', () => {
  assert.deepEqual(Object.keys(SAFETY_LOOKS).sort(), [...KEYS].sort());
  for (const key of KEYS) {
    assert.equal(SAFETY_LOOKS[key]!.length, 3, key);
    for (let k = 0; k < 3; k++) assert.ok(draw(key, 0, k).geo, `${key} look ${k + 1} draws nothing`);
  }
});

test('safety looks stay within the footprint and above the ground', () => {
  const bad: string[] = [];
  for (const key of KEYS) {
    const [w, d] = BUILDINGS[key].size;
    const { geo, torches } = draw(key, 3);
    const box = geo!.boundingBox!;
    const where = `${key}: ${box.min.toArray().map((n) => n.toFixed(3))} .. ${box.max.toArray().map((n) => n.toFixed(3))}`;
    if (box.min.x < -w / 2 || box.max.x > w / 2 || box.min.z < -d / 2 || box.max.z > d / 2 || box.min.y < -0.01) bad.push(where);
    for (const t of torches) if (Math.abs(t.x) > w / 2 || Math.abs(t.z) > d / 2) bad.push(`${key} flame at ${t.toArray()}`);
  }
  assert.deepEqual(bad, []);
});

test('safety looks are rigid where they are timber, stone and cloth (only plants and herbs sway)', () => {
  // Anything swaying is foliage (leaf = 1); building material and cloth keep still.
  for (const key of KEYS) {
    const veg = draw(key, 3).geo!.getAttribute('aVeg');
    for (let i = 0; i < veg.count; i++) if (veg.getX(i) > 0) assert.equal(veg.getY(i), 1, `${key} vertex ${i} sways but is not foliage`);
  }
});

type Tri = { n: THREE.Vector3; d: number; p: THREE.Vector3[]; c: THREE.Color; look: boolean };

function triangles(geo: THREE.BufferGeometry, look: boolean, out: Tri[]): void {
  const P = geo.getAttribute('position'), C = geo.getAttribute('color'), I = geo.index;
  const n = I ? I.count / 3 : P.count / 3;
  for (let t = 0; t < n; t++) {
    const ids = [0, 1, 2].map((k) => (I ? I.getX(t * 3 + k) : t * 3 + k));
    const p = ids.map((i) => new THREE.Vector3().fromBufferAttribute(P, i));
    const nn = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    if (nn.length() < 1e-7) continue;
    nn.normalize();
    out.push({ n: nn, d: nn.dot(p[0]), p, c: new THREE.Color().fromBufferAttribute(C, ids[0]), look });
  }
}

/** Do two coplanar triangles overlap (separating axis test in the plane they share)? */
function overlap(A: Tri, B: Tri): boolean {
  const a = Math.abs(A.n.x) > Math.abs(A.n.y) ? (Math.abs(A.n.x) > Math.abs(A.n.z) ? 'x' : 'z') : Math.abs(A.n.y) > Math.abs(A.n.z) ? 'y' : 'z';
  const [i, j] = (['x', 'y', 'z'] as const).filter((k) => k !== a);
  const pa = A.p.map((q) => [q[i], q[j]]), pb = B.p.map((q) => [q[i], q[j]]);
  for (const T of [pa, pb]) for (let k = 0; k < 3; k++) {
    const s = T[k], e = T[(k + 1) % 3], ax = [-(e[1] - s[1]), e[0] - s[0]];
    const ra = pa.map((q) => q[0] * ax[0] + q[1] * ax[1]), rb = pb.map((q) => q[0] * ax[0] + q[1] * ax[1]);
    if (Math.max(...ra) <= Math.min(...rb) + 1e-4 || Math.max(...rb) <= Math.min(...ra) + 1e-4) return false;
  }
  return true;
}

test('safety looks lay no face of another colour flush on another face (no flicker)', () => {
  const GAP = 0.009, bad: string[] = [];
  for (const key of KEYS) {
    const m = MODELS[key]!(), tris: Tri[] = [];
    for (const g of [m.finished, ...(m.canopy ? [m.canopy] : [])]) triangles(g, false, tris);
    triangles(draw(key, 3).geo!, true, tris);
    // Bucket by facing and plane offset; compare each look triangle with its own and the neighbouring buckets.
    const keyOf = (t: Tri, off = 0) => `${Math.round(t.n.x * 40)},${Math.round(t.n.y * 40)},${Math.round(t.n.z * 40)}|${Math.round(t.d / GAP) + off}`;
    const buckets = new Map<string, Tri[]>();
    for (const t of tris) (buckets.get(keyOf(t)) ?? buckets.set(keyOf(t), []).get(keyOf(t))!).push(t);
    const hits: string[] = [];
    for (const A of tris) {
      if (!A.look) continue;
      // Undersides on the ground or a floor are never seen (as scripts/zfight.ts).
      if (A.n.y < -0.9 && Math.min(...A.p.map((q) => q.y)) < 0.3) continue;
      for (const off of [-1, 0, 1]) for (const B of buckets.get(keyOf(A, off)) ?? []) {
        if (B === A || (B.look && B.p[0].x < A.p[0].x)) continue;
        if (Math.abs(A.c.r - B.c.r) + Math.abs(A.c.g - B.c.g) + Math.abs(A.c.b - B.c.b) < 0.04) continue;
        if (A.n.dot(B.n) < 0.99 || Math.abs(A.d - B.d) >= GAP) continue;
        if (!overlap(A, B)) continue;
        const cx = (A.p[0].x + A.p[1].x + A.p[2].x) / 3, cy = (A.p[0].y + A.p[1].y + A.p[2].y) / 3, cz = (A.p[0].z + A.p[1].z + A.p[2].z) / 3;
        hits.push(`${key} (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) n=${A.n.toArray().map((x) => x.toFixed(2))} gap ${Math.abs(A.d - B.d).toFixed(4)} vs ${B.look ? '' : 'model '}${B.p.map((q) => q.toArray().map((x) => x.toFixed(2)).join(',')).join(' ')}`);
      }
    }
    bad.push(...hits.filter((h, i) => hits.indexOf(h) === i).slice(0, 10));
  }
  assert.deepEqual(bad, []);
});
