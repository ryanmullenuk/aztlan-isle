// Find coplanar (or nearly so) overlapping triangles of different colours in a building model:
// the surfaces that flicker (z-fight) as the camera moves.
// Usage: npx tsx scripts/zfight.ts palace [gap=0.004]
import * as models from '../src/buildings/models';
import { GeoBuilder } from '../src/render/GeoBuilder';

// Tag every triangle with the model code that added it (the two nearest models.ts lines).
const tags: string[] = [];
const add0 = GeoBuilder.prototype.add;
GeoBuilder.prototype.add = function (this: GeoBuilder, ...args: Parameters<typeof add0>) {
  const before = this.indexCount;
  const r = add0.apply(this, args);
  const lines = (new Error().stack ?? '').split('\n').filter((l) => l.includes('models.ts')).slice(0, 2).map((l) => l.match(/models\.ts:(\d+)/)?.[1]).join('<');
  for (let t = before / 3; t < this.indexCount / 3; t++) tags[t] = lines;
  return r;
};

const key = process.argv[2] ?? 'palace', gap = Number(process.argv[3] ?? 0.004);
const make: Record<string, () => models.BuildingModel> = {
  ceremony: () => models.ceremonyModel(6, 6), graveyard: () => models.graveyardModel(8, 8), well: models.wellModel, palace: models.palaceModel, olmechead: models.colossalHeadModel, greathall: models.greatHallModel, market: models.marketSquareModel,
  temple3: () => models.templeModel(3), greattemple: models.greatTempleModel, observatory: models.observatoryModel, healer: () => models.healingCentreModel(4),
};
const m = make[key]();
const geos = [m.finished, ...(m.canopy ? [m.canopy] : [])];
type Tri = { n: number[]; d: number; p: number[][]; c: number[]; g: number; tag: string; area: number };
const tris: Tri[] = [];
geos.forEach((g, gi) => {
  const P = g.getAttribute('position'), C = g.getAttribute('color'), I = g.index;
  const n = I ? I.count / 3 : P.count / 3;
  for (let t = 0; t < n; t++) {
    const ids = [0, 1, 2].map((k) => (I ? I.getX(t * 3 + k) : t * 3 + k));
    const p = ids.map((i) => [P.getX(i), P.getY(i), P.getZ(i)]);
    const u = [0, 1, 2].map((k) => p[1][k] - p[0][k]), v = [0, 1, 2].map((k) => p[2][k] - p[0][k]);
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...cr);
    if (len < 1e-7) continue;
    const nn = cr.map((x) => x / len);
    const c = C ? [C.getX(ids[0]), C.getY(ids[0]), C.getZ(ids[0])] : [1, 1, 1];
    tris.push({ n: nn, d: nn[0] * p[0][0] + nn[1] * p[0][1] + nn[2] * p[0][2], p, c, g: gi, tag: gi === 0 ? tags[t] ?? '?' : 'canopy', area: len / 2 });
  }
});
// Bucket by axis-ish normal and plane offset (both faces of a plane share a bucket).
const buckets = new Map<string, Tri[]>();
for (const t of tris) {
  const s = t.n[0] < -1e-6 || (Math.abs(t.n[0]) < 1e-6 && (t.n[1] < -1e-6 || (Math.abs(t.n[1]) < 1e-6 && t.n[2] < 0))) ? -1 : 1;
  const key = t.n.map((x) => Math.round(x * s * 50)).join(',') + '|' + Math.round((t.d * s) / gap);
  for (const k of [key]) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t);
}
const proj = (t: Tri): number[][] => {
  const a = Math.abs(t.n[0]) > Math.abs(t.n[1]) ? (Math.abs(t.n[0]) > Math.abs(t.n[2]) ? 0 : 2) : Math.abs(t.n[1]) > Math.abs(t.n[2]) ? 1 : 2;
  const [i, j] = [0, 1, 2].filter((k) => k !== a);
  return t.p.map((q) => [q[i], q[j]]);
};
const sepAxis = (A: number[][], B: number[][]): boolean => {
  for (const T of [A, B]) for (let k = 0; k < 3; k++) {
    const a = T[k], b = T[(k + 1) % 3], ax = [-(b[1] - a[1]), b[0] - a[0]];
    const pa = A.map((q) => q[0] * ax[0] + q[1] * ax[1]), pb = B.map((q) => q[0] * ax[0] + q[1] * ax[1]);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-4 || Math.max(...pb) <= Math.min(...pa) + 1e-4) return true;
  }
  return false;
};
const hits: string[] = [];
const pairs = new Map<string, number>();
for (const list of buckets.values()) {
  if (list.length < 2 || list.length > 4000) continue;
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b];
    if (Math.abs(A.c[0] - B.c[0]) + Math.abs(A.c[1] - B.c[1]) + Math.abs(A.c[2] - B.c[2]) < 0.04) continue;
    // Same facing only (opposite faces of a thin slab don't fight).
    if (A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] < 0.99) continue;
    // Undersides at or below the base are never seen from above.
    if (A.n[1] < -0.9 && Math.min(...A.p.map((q) => q[1])) < Number(process.env.FLOOR ?? 0.3)) continue;
    if (sepAxis(proj(A), proj(B))) continue;
    const cx = (A.p[0][0] + A.p[1][0] + A.p[2][0]) / 3, cy = (A.p[0][1] + A.p[1][1] + A.p[2][1]) / 3, cz = (A.p[0][2] + A.p[1][2] + A.p[2][2]) / 3;
    const pk = [A.tag, B.tag].sort().join('  vs  ');
    pairs.set(pk, (pairs.get(pk) ?? 0) + Math.min(A.area, B.area));
    hits.push(`(${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) n=${A.n.map((x) => x.toFixed(2))} dGap=${Math.abs(A.d - B.d).toFixed(4)} ${A.tag} vs ${B.tag}`);
  }
}
console.log(`${key}: ${tris.length} triangles, ${hits.length} overlapping coplanar pairs of different colour`);
for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1])) console.log(`  ${(n as number).toFixed(4)}\t${k}`);
if (process.argv[4] !== 'list') process.exit(0);
const seen = new Set<string>();
for (const h of hits) { const k = h.split(' n=')[0].replace(/\d(?=[,)])/g, ''); if (seen.has(k)) continue; seen.add(k); console.log('  ' + h); if (seen.size > 40) break; }
