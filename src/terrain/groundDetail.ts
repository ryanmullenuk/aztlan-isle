import * as THREE from 'three';
import { RNG } from '../world/rng';

/**
 * The ground's hand-painted detail, made once at load (nothing to download): one small tiling
 * texture with a pattern in each channel, each a brightness around mid-grey that the terrain
 * shader multiplies into its colours.
 *  - R grass: short brush strokes of blades, lighter and darker, over soft clumps,
 *  - G sand: fine grain with the odd dark or bright fleck,
 *  - B rock: chiselled facets (each a flat plane catching the light its own way), dark cracks
 *    between them,
 *  - A earth: soft clods and small pebbles.
 * Every pattern wraps at the edges, so the tiles join without seams.
 */
export function groundDetailTexture(size = 256, seed = 4242): THREE.DataTexture {
  const rng = new RNG(seed);
  const N = size, px = N * N;
  const wrap = (v: number) => ((v % N) + N) % N;

  /** Smooth value noise that tiles every N pixels (`cells` lattice cells across). */
  const tileNoise = (cells: number, salt: number) => {
    const lat = Array.from({ length: cells * cells }, () => rng.next());
    void salt;
    const out = new Float32Array(px);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells, fy = (y / N) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => lat[((j % cells) * cells) + (i % cells)];
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      out[y * N + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
    return out;
  };

  // ---- Grass: soft clumps, then painterly brush strokes of blades (wide enough to survive
  // filtering at a distance), wrapping round the edges. ----
  const grass = new Float32Array(px);
  const clumps = tileNoise(6, 1), fine = tileNoise(24, 2);
  for (let i = 0; i < px; i++) grass[i] = (clumps[i] - 0.5) * 0.22 + (fine[i] - 0.5) * 0.12;
  const dab = (cx: number, cy: number, r: number, v: number) => {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d < 1) grass[wrap(Math.round(cy) + dy) * N + wrap(Math.round(cx) + dx)] += v * (1 - d * d);
    }
  };
  for (let k = 0; k < 520; k++) {
    const x0 = rng.next() * N, y0 = rng.next() * N;
    // Blades lean mostly one way (as if combed by the wind), a few across.
    const a = -Math.PI / 2 + rng.range(-0.55, 0.55), len = rng.range(10, 22), w = rng.range(1.6, 2.6);
    const tone = rng.next() < 0.55 ? rng.range(0.22, 0.4) : -rng.range(0.2, 0.36);
    for (let s2 = 0; s2 <= len; s2 += 1) {
      const t = s2 / len;
      // Wide at the root, tapering to the tip, curving a little.
      dab(x0 + Math.cos(a + t * 0.25) * s2, y0 + Math.sin(a + t * 0.25) * s2, w * (1 - t * 0.7), tone * 0.35);
    }
  }

  // ---- Sand: grain, a soft swell, and scattered flecks. ----
  const sand = new Float32Array(px);
  const swell = tileNoise(6, 3), grainN = tileNoise(64, 4);
  for (let i = 0; i < px; i++) sand[i] = (rng.next() - 0.5) * 0.28 + (grainN[i] - 0.5) * 0.22 + (swell[i] - 0.5) * 0.16;
  for (let k = 0; k < 900; k++) {
    const i = Math.floor(rng.next() * px);
    sand[i] += rng.next() < 0.6 ? -rng.range(0.35, 0.6) : rng.range(0.3, 0.5);
  }

  // ---- Rock: Voronoi facets with a tilt each, dark seams at the edges. ----
  const rock = new Float32Array(px);
  const pts = Array.from({ length: 14 }, () => ({ x: rng.next() * N, y: rng.next() * N, gx: rng.range(-1, 1), gy: rng.range(-1, 1), b: rng.range(-0.25, 0.25) }));
  const rockFine = tileNoise(24, 5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let d1 = 1e9, d2 = 1e9, best = pts[0], bdx = 0, bdy = 0;
    for (const p of pts) {
      let dx = x - p.x, dy = y - p.y;
      dx -= Math.round(dx / N) * N; dy -= Math.round(dy / N) * N;
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; best = p; bdx = dx; bdy = dy; } else if (d < d2) d2 = d;
    }
    const plane = (bdx * best.gx + bdy * best.gy) / (N * 0.12);
    const seam = 1 - Math.min(1, (d2 - d1) / 4.5);
    rock[y * N + x] = best.b + plane * 0.22 - seam * seam * seam * 0.4 + (rockFine[y * N + x] - 0.5) * 0.18;
  }

  // ---- Earth: clods and pebbles. ----
  const earth = new Float32Array(px);
  const clods = tileNoise(12, 6), crumbs = tileNoise(48, 7);
  for (let i = 0; i < px; i++) earth[i] = (clods[i] - 0.5) * 0.35 + (crumbs[i] - 0.5) * 0.25;
  for (let k = 0; k < 160; k++) {
    const cx = rng.next() * N, cy = rng.next() * N, r = rng.range(1.2, 3.2), tone = rng.range(0.2, 0.45) * (rng.next() < 0.5 ? 1 : -0.8);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d < 1) earth[wrap(Math.round(cy) + dy) * N + wrap(Math.round(cx) + dx)] += tone * (1 - d * d);
    }
  }

  const data = new Uint8Array(px * 4);
  const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(128 + v * 110)));
  for (let i = 0; i < px; i++) {
    data[i * 4] = to8(grass[i]);
    data[i * 4 + 1] = to8(sand[i]);
    data[i * 4 + 2] = to8(rock[i]);
    data[i * 4 + 3] = to8(earth[i]);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
