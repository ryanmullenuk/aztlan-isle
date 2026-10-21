/** Cached shoreline properties, rebuilt with the existing distance field when terrain changes. */
export function buildShoreField(height: Float32Array, distance: Float32Array, size: number, out: Uint8Array, bounds: readonly number[] = [0, 0, size - 1, size - 1]): void {
  const sample = (field: Float32Array, x: number, z: number, outside: number) => {
    const ix = Math.round(x), iz = Math.round(z);
    return ix < 0 || iz < 0 || ix >= size || iz >= size ? outside : field[iz * size + ix];
  };
  const angles = [-1.2, -.72, -.24, .24, .72, 1.2];
  const cosine = angles.map(Math.cos), sine = angles.map(Math.sin);
  const [x0, z0, x1, z1] = bounds;
  for (let z = Math.max(0, z0); z <= Math.min(size - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(size - 1, x1); x++) {
    const i = z * size + x, k = i * 4;
    out[k] = out[k + 1] = 128; out[k + 2] = 0; out[k + 3] = 255;
    if (distance[i] > 24 || height[i] > .16) continue;
    const dx = sample(distance, x + 2, z, distance[i]) - sample(distance, x - 2, z, distance[i]);
    const dz = sample(distance, x, z + 2, distance[i]) - sample(distance, x, z - 2, distance[i]);
    const length = Math.hypot(dx, dz);
    const nx = length > .01 ? dx / length : 0, nz = length > .01 ? dz / length : 0;
    let open = 0;
    if (length > .01) for (let ray = 0; ray < angles.length; ray++) {
      const ax = nx * cosine[ray] - nz * sine[ray], az = nx * sine[ray] + nz * cosine[ray];
      let clear = true;
      for (let d = 2; d <= 16; d += 2) {
        if (sample(height, x + ax * d * 2, z + az * d * 2, -7) > -.15) { clear = false; break; }
      }
      if (clear) open++;
    }
    const slope = Math.hypot(sample(height, x + 2, z, height[i]) - sample(height, x - 2, z, height[i]),
      sample(height, x, z + 2, height[i]) - sample(height, x, z - 2, height[i])) / 2;
    out[k] = Math.round((nx * .5 + .5) * 255); out[k + 1] = Math.round((nz * .5 + .5) * 255);
    out[k + 2] = Math.round((.12 + .88 * (open / angles.length) ** 2) * 255);
    out[k + 3] = Math.round(Math.min(1, slope) * 255);
  }
  // The first strip of beach above the waterline takes the field of the water beside it, so the
  // swash can carry on up the sand (the terrain reads this too).
  for (let z = Math.max(0, z0); z <= Math.min(size - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(size - 1, x1); x++) {
    const i = z * size + x, k = i * 4;
    if (height[i] <= .16 || height[i] > .9) continue;
    let best = -1, bz = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, zz = z + dz;
      if ((!dx && !dz) || xx < 0 || zz < 0 || xx >= size || zz >= size) continue;
      const j = zz * size + xx;
      if (height[j] > .16 || distance[j] > 24) continue;
      const e = out[j * 4 + 2];
      if (e > bz) { bz = e; best = j; }
    }
    if (best >= 0) for (let c = 0; c < 4; c++) out[k + c] = out[best * 4 + c];
  }
}

/** Shared shader code; no per-frame CPU work or extra surf geometry. */
export const SHORE_SURF_GLSL = /* glsl */ `
  float shorePulse(float phase) {
    // A short advancing crest followed by a longer retreat.
    float f = fract(phase);
    return smoothstep(0.0, 0.18, f) * (1.0 - smoothstep(0.28, 0.94, f));
  }
`;
