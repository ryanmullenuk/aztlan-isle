import * as THREE from 'three';

/**
 * Break a model's big flat faces into smaller ones, so the building shader's hand-made lean, sag
 * and wander (see patchBuilding in render/materials.ts) can bow a wall or dip a roofline instead of
 * only tilting a perfect box: a face with four corners can only shear, however it is pushed.
 *
 * Every edge longer than `maxEdge` is split at its middle, `passes` times over. Whether an edge is
 * split depends on its length alone, so two faces that meet along it always split it at the same
 * point and nothing opens up between them when the shader moves the new corners. All attributes
 * are carried across (normals re-normalised). Plants and cloth (anything with sway) are left alone.
 */
export function finerFaces(src: THREE.BufferGeometry, maxEdge = 0.42, passes = 2): THREE.BufferGeometry {
  if (!src.index) return src;
  const names = Object.keys(src.attributes);
  const sizes = names.map((n) => src.attributes[n].itemSize);
  const data = names.map((n) => Array.from(src.attributes[n].array as ArrayLike<number>));
  const pi = names.indexOf('position'), ni = names.indexOf('normal'), vi = names.indexOf('aVeg');
  if (pi < 0) return src;
  let index = Array.from(src.index.array as ArrayLike<number>);
  const P = data[pi];
  const len2 = (a: number, b: number) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  const sways = (a: number) => vi >= 0 && (data[vi][a * 2] !== 0 || data[vi][a * 2 + 1] >= 0.5);
  const max2 = maxEdge * maxEdge;
  for (let pass = 0; pass < passes; pass++) {
    const mids = new Map<number, number>();
    let count = P.length / 3;
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 2097152 + b : b * 2097152 + a;
      let m = mids.get(key);
      if (m !== undefined) return m;
      m = count++;
      for (let k = 0; k < data.length; k++) {
        const s = sizes[k], d = data[k];
        for (let c = 0; c < s; c++) d.push((d[a * s + c] + d[b * s + c]) / 2);
      }
      if (ni >= 0) {
        const N = data[ni], o = m * 3, l = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1;
        N[o] /= l; N[o + 1] /= l; N[o + 2] /= l;
      }
      mids.set(key, m);
      return m;
    };
    const out: number[] = [];
    let any = false;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      if (sways(a) || sways(b) || sways(c)) { out.push(a, b, c); continue; }
      const sab = len2(a, b) > max2, sbc = len2(b, c) > max2, sca = len2(c, a) > max2;
      const n = +sab + +sbc + +sca;
      if (n === 0) { out.push(a, b, c); continue; }
      any = true;
      if (n === 3) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      } else if (n === 1) {
        // Rotate so the split edge is (x, y), z opposite.
        const [x, y, z] = sab ? [a, b, c] : sbc ? [b, c, a] : [c, a, b];
        const m = mid(x, y);
        out.push(x, m, z, m, y, z);
      } else {
        // Two split edges: rotate so (x, y) is the whole one.
        const [x, y, z] = !sab ? [a, b, c] : !sbc ? [b, c, a] : [c, a, b];
        const yz = mid(y, z), zx = mid(z, x);
        out.push(z, zx, yz, x, y, yz, x, yz, zx);
      }
    }
    index = out;
    if (!any) break;
  }
  const g = new THREE.BufferGeometry();
  names.forEach((n, k) => {
    const srcArr = src.attributes[n].array as unknown as { constructor: new (a: number[]) => THREE.TypedArray };
    g.setAttribute(n, new THREE.BufferAttribute(new srcArr.constructor(data[k]), sizes[k], src.attributes[n].normalized));
  });
  g.setIndex(index);
  g.userData = src.userData;
  return g;
}
