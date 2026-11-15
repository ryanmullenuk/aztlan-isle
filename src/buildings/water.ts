import * as THREE from 'three';
import { HANDMADE_LEAN_GLSL, HANDMADE_NOISE_GLSL } from '../render/materials';

/**
 * Moving water in buildings: pools, basins and troughs whose surface ripples and glitters, and
 * fountains whose water rises, arcs and falls in flowing strands, with droplets and rings spreading
 * where it lands. A model describes its water (model-local, door facing +z) and the building draws
 * it as one small mesh riding on its finished model, all of it animated on the GPU from one shared
 * time uniform (see BuildingSystem.update), so standing water costs no work per frame.
 */

/** A still water surface: a basin, pond, trough or dish (rectangular, or round when `round`). */
export interface WaterPool {
  x: number; y: number; z: number;
  /** Size inside the rim (a round pool's diameter is `w`). */
  w: number; d: number;
  round?: boolean;
  /** Turn about y (radians). */
  ry?: number;
  /** How deep it looks in the middle (0 a shallow dish … 1 a deep pond). */
  depth?: number;
}

/**
 * A fountain's moving water. `jet`: strands thrown up from (x, y, z) to about `h` above it, arcing
 * out to land `r` away at height `land`. `bowl`: a bowl of radius `r` brimming at y, its water
 * spilling over the lip all round in a falling curtain to `land`, with a little bubbling jet `h` tall
 * in the middle. `spout`: one stream out of a spout at (x, y, z) heading `ry` (0 = +z), reaching `r`
 * out and falling to `land`.
 */
export interface WaterJet {
  kind: 'jet' | 'bowl' | 'spout';
  x: number; y: number; z: number;
  h: number; r: number; land: number;
  ry?: number;
  /** How many strands a jet throws (default 6). */
  strands?: number;
  /** Strand thickness (default 0.012). */
  t?: number;
}

export interface BuildingWater { pools: WaterPool[]; jets: WaterJet[] }

let sink: BuildingWater | null = null;
/** Record a water surface in the model (or look) being built. */
export function addPool(p: WaterPool): void { sink?.pools.push(p); }
/** Record a fountain's moving water in the model (or look) being built. */
export function addJet(j: WaterJet): void { sink?.jets.push(j); }

/** Build something, collecting the water it records (nesting safely). */
export function collectWater<T>(make: () => T): { result: T; water: BuildingWater } {
  const prev = sink, water: BuildingWater = { pools: [], jets: [] };
  sink = water;
  try {
    return { result: make(), water };
  } finally {
    sink = prev;
  }
}

/** Water shifted (a worn building's lean: x += lx·y, z += lz·y). */
export function leanWater(w: BuildingWater, lx: number, lz: number): BuildingWater {
  return {
    pools: w.pools.map((p) => ({ ...p, x: p.x + lx * p.y, z: p.z + lz * p.y })),
    jets: w.jets.map((j) => ({ ...j, x: j.x + lx * j.y, z: j.z + lz * j.y })),
  };
}

export const hasWater = (w?: BuildingWater): w is BuildingWater => !!w && (w.pools.length > 0 || w.jets.length > 0);

// ---------------- Geometry ----------------

/**
 * Kinds (aW.x): 0 pool surface, 1 flowing strand, 2 landing rings, 3 droplet, 4 falling curtain.
 * aW: pool (0, seed, distance from the rim in metres, depth 0..1 toward the middle);
 * strand / curtain (kind, phase, thickness, 0); ring (2, phase, 0, 0); droplet (3, phase, cycles a
 * second, size). aP: a droplet's flight (landing offset x, y, z from its source, arc height).
 */
class WaterGeo {
  pos: number[] = [];
  uv: number[] = [];
  w: number[] = [];
  p: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, u: number, v: number, w: [number, number, number, number], p: [number, number, number, number] = [0, 0, 0, 0]): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.w.push(...w);
    this.p.push(...p);
    return this.pos.length / 3 - 1;
  }
  get count(): number { return this.idx.length; }
}

/** A strand: a thin tube along `path`, tapering from t to t·0.55, uv.y along it (0 at the source). */
function strand(g: WaterGeo, path: (s: number) => THREE.Vector3, t: number, phase: number, kind = 1): void {
  const SEG = 10, SIDES = 4, base = g.pos.length / 3;
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), nor = new THREE.Vector3(), tan = new THREE.Vector3();
  for (let i = 0; i <= SEG; i++) {
    const s = i / SEG, c = path(s);
    tan.subVectors(path(Math.min(1, s + 0.02)), path(Math.max(0, s - 0.02))).normalize();
    side.crossVectors(tan, Math.abs(tan.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    nor.crossVectors(side, tan).normalize();
    const r = t * (1 - 0.45 * s);
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      g.vert(c.x + side.x * ca + nor.x * sa, c.y + side.y * ca + nor.y * sa, c.z + side.z * ca + nor.z * sa, k / SIDES, s, [kind, phase, t, 0]);
    }
  }
  for (let i = 0; i < SEG; i++) for (let k = 0; k < SIDES; k++) {
    const a = base + i * (SIDES + 1) + k, b = a + SIDES + 1;
    g.idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
}

/** A flat quad on the water for spreading rings (uv 0..1 across it). */
function rings(g: WaterGeo, x: number, y: number, z: number, r: number, phase: number): void {
  const v = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => g.vert(x + u * r, y, z + w * r, (u + 1) / 2, (w + 1) / 2, [2, phase, 0, 0]));
  g.idx.push(v[0], v[2], v[1], v[0], v[3], v[2]);
}

/** Droplets flying from (x, y, z) to (x, y, z) + d, arcing `h` high: one quad each, spread out to face the camera in the shader. */
function droplets(g: WaterGeo, x: number, y: number, z: number, d: THREE.Vector3, h: number, n: number, size: number, seed: number): void {
  for (let k = 0; k < n; k++) {
    const ph = fract(seed * 0.618 + k / n), spd = 0.7 + fract(seed * 0.37 + k * 0.29) * 0.5;
    const jx = (fract(seed * 1.3 + k * 0.71) - 0.5) * 0.25, jz = (fract(seed * 2.1 + k * 0.53) - 0.5) * 0.25;
    const fl: [number, number, number, number] = [d.x * (1 + jx), d.y, d.z * (1 + jz), h * (0.8 + fract(k * 0.43) * 0.4)];
    const v = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, w]) => g.vert(x, y, z, u, w, [3, ph, spd, size], fl));
    g.idx.push(v[0], v[1], v[2], v[0], v[2], v[3]);
  }
}
const fract = (v: number) => v - Math.floor(v);

/** A parabola from a to b rising `h` above the straight line between them. */
const arc = (a: THREE.Vector3, b: THREE.Vector3, h: number) => (s: number) =>
  new THREE.Vector3(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s + 4 * h * s * (1 - s), a.z + (b.z - a.z) * s);

function pool(g: WaterGeo, p: WaterPool, seed: number): void {
  const depth = p.depth ?? 0.7, ry = p.ry ?? 0, cr = Math.cos(ry), sr = Math.sin(ry);
  const put = (lx: number, lz: number, edge: number, rel: number, u: number, v: number) =>
    g.vert(p.x + lx * cr + lz * sr, p.y, p.z - lx * sr + lz * cr, u, v, [0, seed, edge, rel * depth]);
  const base = g.pos.length / 3;
  // A little past the rim all round, so the edge tucks under the kerb.
  const over = 0.025;
  if (p.round) {
    const R = p.w / 2, RINGS = Math.max(2, Math.min(8, Math.ceil(R / 0.12))), SEG = Math.max(10, Math.min(40, Math.ceil((R * Math.PI * 2) / 0.12)));
    put(0, 0, R, 1, 0.5, 0.5);
    for (let j = 1; j <= RINGS; j++) {
      const r = ((R + over) * j) / RINGS;
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        put(Math.cos(a) * r, Math.sin(a) * r, R - r, Math.max(0, 1 - r / R), 0.5 + Math.cos(a) * 0.5 * (r / R), 0.5 + Math.sin(a) * 0.5 * (r / R));
      }
    }
    for (let k = 0; k < SEG; k++) g.idx.push(base, base + 1 + ((k + 1) % SEG), base + 1 + k);
    for (let j = 1; j < RINGS; j++) for (let k = 0; k < SEG; k++) {
      const a = base + 1 + (j - 1) * SEG + k, b = base + 1 + (j - 1) * SEG + ((k + 1) % SEG), c = a + SEG, d = b + SEG;
      g.idx.push(a, b, d, a, d, c);
    }
    return;
  }
  const hw = p.w / 2, hd = p.d / 2;
  const nx = Math.max(1, Math.min(24, Math.ceil(p.w / 0.16))), nz = Math.max(1, Math.min(24, Math.ceil(p.d / 0.16)));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const lx = -hw - over + ((p.w + 2 * over) * i) / nx, lz = -hd - over + ((p.d + 2 * over) * j) / nz;
    const edge = Math.min(hw - Math.abs(lx), hd - Math.abs(lz));
    put(lx, lz, edge, Math.max(0, Math.min(1, edge / Math.max(0.05, Math.min(hw, hd)))), i / nx, j / nz);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    g.idx.push(a, c, b, b, c, d);
  }
}

/** How far out from a bowl's middle its spilling curtain reaches the water below (it flares a little as it falls). */
export function curtainFoot(j: WaterJet): number {
  return j.r + 0.012 + Math.min((j.y - j.land) * 0.22, j.r * 0.5);
}

function fountain(g: WaterGeo, j: WaterJet, seed: number): void {
  const o = new THREE.Vector3(j.x, j.y, j.z), t = j.t ?? 0.012;
  if (j.kind === 'spout') {
    const ry = j.ry ?? 0, end = new THREE.Vector3(j.x + Math.sin(ry) * j.r, j.land, j.z + Math.cos(ry) * j.r);
    strand(g, arc(o, end, j.h), t, seed);
    strand(g, arc(o.clone().add(new THREE.Vector3(0, -t * 0.4, 0)), end.clone().add(new THREE.Vector3(Math.cos(ry) * t, 0, -Math.sin(ry) * t)), j.h * 0.9), t * 0.6, seed + 0.37);
    rings(g, end.x, j.land + 0.004, end.z, Math.max(0.08, t * 9), seed);
    droplets(g, o.x, o.y, o.z, end.clone().sub(o), j.h, 3, t * 1.6, seed);
    return;
  }
  if (j.kind === 'bowl') {
    // The curtain: a skirt of water from the lip, flaring a little as it falls.
    const SEG = 18, ROWS = 6, base = g.pos.length / 3, drop = j.y - j.land, flare = curtainFoot(j) - j.r - 0.012;
    for (let r = 0; r <= ROWS; r++) {
      const v = r / ROWS, rad = j.r + 0.012 + flare * Math.sqrt(v), y = j.y + 0.004 - drop * v;
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        g.vert(j.x + Math.cos(a) * rad, y, j.z + Math.sin(a) * rad, k / SEG, v, [4, seed, t, 0]);
      }
    }
    for (let r = 0; r < ROWS; r++) for (let k = 0; k < SEG; k++) {
      const a = base + r * (SEG + 1) + k, b = a + SEG + 1;
      g.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    // (Within the curtain's foot: the basin it falls into may be little wider.)
    rings(g, j.x, j.land + 0.004, j.z, (j.r + 0.012 + flare) * 1.02, seed);
    if (j.h > 0) {
      // A little bubbling jet in the middle of the bowl.
      const n = 4;
      strand(g, (s) => new THREE.Vector3(j.x, j.y + j.h * s, j.z), t * 1.1, seed + 0.5);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + seed, top = new THREE.Vector3(j.x, j.y + j.h * 0.92, j.z);
        const end = new THREE.Vector3(j.x + Math.cos(a) * j.r * 0.55, j.y, j.z + Math.sin(a) * j.r * 0.55);
        strand(g, arc(top, end, j.h * 0.25), t * 0.6, seed + k * 0.31);
        droplets(g, top.x, top.y, top.z, end.clone().sub(top), j.h * 0.3, 2, t * 1.4, seed + k);
      }
      rings(g, j.x, j.y + 0.004, j.z, j.r * 0.7, seed + 0.4);
    }
    return;
  }
  // An upward jet: a rising column, and strands thrown out and down all round from near its top.
  const n = j.strands ?? 6;
  strand(g, (s) => new THREE.Vector3(j.x, j.y + j.h * s, j.z), t * 1.3, seed);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + seed * 0.7, start = new THREE.Vector3(j.x, j.y + j.h * 0.55, j.z);
    const end = new THREE.Vector3(j.x + Math.cos(a) * j.r, j.land, j.z + Math.sin(a) * j.r);
    strand(g, arc(start, end, j.h * 0.5), t, seed + k * 0.23);
    rings(g, end.x, j.land + 0.004, end.z, Math.max(0.07, j.r * 0.3), seed + k * 0.41);
    droplets(g, start.x, start.y, start.z, end.clone().sub(start), j.h * 0.5, 2, t * 1.5, seed + k);
  }
  droplets(g, j.x, j.y, j.z, new THREE.Vector3(0, j.h * 0.6, 0), j.h * 0.3, 3, t * 1.6, seed + 9);
}

/**
 * One building's water as one geometry: its pools first (`pools` indices), then its fountains (left
 * out far away, see BuildingSystem.updateLod). Null when it has none.
 */
export function waterGeometry(w: BuildingWater | undefined): { geo: THREE.BufferGeometry; pools: number } | null {
  if (!hasWater(w)) return null;
  const g = new WaterGeo();
  w.pools.forEach((p, k) => pool(g, p, k * 3.7 + 1));
  const pools = g.count;
  w.jets.forEach((j, k) => fountain(g, j, k * 1.93 + 0.4));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  geo.setAttribute('aW', new THREE.Float32BufferAttribute(g.w, 4));
  geo.setAttribute('aP', new THREE.Float32BufferAttribute(g.p, 4));
  geo.setIndex(g.idx);
  geo.computeBoundingSphere();
  // Droplets fly from where they are stored: leave room for them.
  if (geo.boundingSphere) geo.boundingSphere.radius += 0.3;
  return { geo, pools };
}

// ---------------- Material ----------------

/** Shared by every building's water: set once a frame. */
export const WATER_UNIFORMS = { uTime: { value: 0 }, uDay: { value: 1 } };

let material: THREE.ShaderMaterial | null = null;

/** The one material all building water is drawn with. */
export function waterMaterial(): THREE.ShaderMaterial {
  if (material) return material;
  material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...WATER_UNIFORMS },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aW;
      attribute vec4 aP;
      uniform float uTime;
      varying vec2 vUv;
      varying vec4 vW;
      varying vec3 vL;
      ${HANDMADE_NOISE_GLSL}
      void main() {
        vUv = uv;
        vW = aW;
        vec3 transformed = position;
        float kind = aW.x;
        float s = 0.0;
        if (kind > 0.5 && kind < 1.5) {
          // A strand quivers a little, more toward its end.
          float q = uTime * 9.0 + uv.y * 11.0 + aW.y * 5.0;
          transformed.xz += vec2(sin(q), cos(q * 1.3)) * 0.004 * uv.y;
        }
        // Lean and wander with the building it stands in (see patchBuilding).
        ${HANDMADE_LEAN_GLSL}
        if (kind > 2.5 && kind < 3.5) {
          // A droplet: along its arc, round and round.
          s = fract(uTime * aW.z + aW.y);
          transformed += vec3(aP.x * s, aP.y * s + 4.0 * aP.w * s * (1.0 - s), aP.z * s);
          vW.z = s;
        }
        vL = position;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        if (kind > 2.5 && kind < 3.5) mvPosition.xy += (uv - 0.5) * aW.w * (1.0 - 0.35 * s);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform float uDay;
      varying vec2 vUv;
      varying vec4 vW;
      varying vec3 vL;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float kind = vW.x, t = uTime;
        // Linear colours, as the island's pools and canals: pale turquoise at the edge, teal, deep teal.
        vec3 glass = vec3(0.16, 0.62, 0.66), white = vec3(0.9, 0.98, 1.0);
        vec3 col;
        float a;
        if (kind < 0.5) {
          vec2 q = vL.xz + vW.y * 3.1;
          float edge = vW.z, depth = vW.w;
          vec3 shallow = vec3(0.035, 0.22, 0.2), mid = vec3(0.008, 0.12, 0.15), deep = vec3(0.003, 0.05, 0.085);
          col = mix(shallow, mid, smoothstep(0.0, 0.22, edge));
          col = mix(col, deep, depth * 0.85);
          // Two swells of ripples drifting across each other; where both crest, the sun glitters.
          float r1 = vn(q * 5.0 + vec2(t * 0.42, t * 0.27));
          float r2 = vn(q * 8.0 + vec2(-t * 0.33, t * 0.38));
          float rip = r1 + r2;
          col *= 0.82 + 0.3 * rip;
          // Light caught in faceted cells on the surface (a cheap caustic net).
          vec2 cq = q * 6.5 + vec2(t * 0.15, -t * 0.11);
          float cell = abs(vn(cq) - vn(cq + 17.3 + t * 0.2));
          col += vec3(0.4, 0.75, 0.7) * (1.0 - smoothstep(0.0, 0.06, cell)) * 0.07 * (1.0 - depth * 0.5);
          float glint = smoothstep(1.62, 1.85, rip + 0.4 * vn(q * 21.0 + t * 1.3));
          col += vec3(1.0, 0.97, 0.88) * glint * 0.35 * uDay;
          // A paler water line where it meets the stone.
          float line = 1.0 - smoothstep(0.0, 0.05, edge);
          col = mix(col, vec3(0.3, 0.5, 0.46), line * 0.45);
          a = mix(0.82, 0.95, smoothstep(0.0, 0.3, edge));
        } else if (kind < 1.5) {
          // A strand: water streaming along it, glassy at the source, white and breaking up at its end.
          float flow = vUv.y * 12.0 - t * 6.0;
          float f = vn(vec2(vUv.x * 4.0 + vW.y * 7.0, flow)) * 0.65 + vn(vec2(vUv.x * 9.0, flow * 2.3 + 3.0)) * 0.35;
          col = mix(glass, white, clamp(0.35 + f * 0.55 + vUv.y * 0.2, 0.0, 1.0));
          a = mix(0.75, 0.95, f) * smoothstep(0.0, 0.04, vUv.y);
          a *= mix(1.0, smoothstep(0.3, 0.6, f), smoothstep(0.55, 1.0, vUv.y));
        } else if (kind < 2.5) {
          // Rings spreading from where the water lands, and froth at the middle.
          vec2 c = vUv * 2.0 - 1.0;
          float r = length(c);
          if (r > 1.0) discard;
          float p1 = fract(t * 0.9 + vW.y), p2 = fract(p1 + 0.5);
          float ring = (1.0 - smoothstep(0.0, 0.08, abs(r - p1))) * (1.0 - p1) + (1.0 - smoothstep(0.0, 0.08, abs(r - p2))) * (1.0 - p2);
          float froth = (1.0 - smoothstep(0.05, 0.38, r)) * (0.5 + 0.5 * vn(c * 6.0 + t * 3.0));
          col = white;
          a = clamp(ring * 0.55 + froth * 0.6, 0.0, 1.0);
        } else if (kind < 3.5) {
          vec2 c = vUv * 2.0 - 1.0;
          col = white;
          a = (1.0 - smoothstep(0.35, 1.0, length(c))) * smoothstep(0.0, 0.08, vW.z) * (1.0 - smoothstep(0.85, 1.0, vW.z)) * 0.9;
        } else {
          // A curtain spilling over a lip: ropes of water speeding up as they fall.
          float fall = pow(vUv.y, 0.7) * 3.0 - t * 2.4;
          float ropes = vn(vec2(vUv.x * 46.0, fall)) * 0.6 + vn(vec2(vUv.x * 97.0, fall * 2.0 + 3.0)) * 0.4;
          col = mix(glass, white, clamp(vUv.y * 0.35 + ropes * 0.4 - 0.05, 0.0, 1.0));
          a = mix(0.62, 0.4, vUv.y) * mix(0.55, 1.0, smoothstep(0.35, 0.6, ropes)) * mix(1.0, smoothstep(0.3, 0.55, ropes), smoothstep(0.15, 0.9, vUv.y));
          a *= 1.0 - smoothstep(0.92, 1.0, vUv.y);
        }
        if (a < 0.02) discard;
        gl_FragColor = vec4(col * mix(0.28, 1.0, uDay), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = 'Building water';
  return material;
}
