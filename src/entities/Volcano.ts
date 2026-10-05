import * as THREE from 'three';
import { stylisedMaterial } from '../render/materials';
import { boulderGeometry } from '../render/rocks';
import { bushGeometry } from '../vegetation/models';
import { World } from '../world/World';
import { RNG } from '../world/rng';

export type VolcanoPhase = 'dormant' | 'smoking' | 'erupting' | 'cooling';
export interface VolcanoSave { x: number; z: number; phase: VolcanoPhase; remaining: number; cycle: number; coolingHot?: boolean; warningVersion?: number }
export const VOLCANO_SMOKE_SECONDS = 300;
export const VOLCANO_COST = 50;
export const VOLCANO_HAPPINESS = 0.15;

/** Simulation timer is persisted; decorative animation never consumes the game's random stream. */
export class VolcanoCycle {
  phase: VolcanoPhase = 'dormant';
  remaining = 150;
  cycle = 0;
  coolingHot = false;
  constructor(private seed: number, saved?: VolcanoSave) {
    if (saved && ['dormant', 'smoking', 'erupting', 'cooling'].includes(saved.phase)
      && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= 900) {
      this.phase = saved.phase; this.remaining = saved.remaining;
      // Preserve time already spent smoking when loading the old 35-second warning.
      if (saved.phase === 'smoking' && saved.warningVersion !== 2)
        this.remaining = Math.max(0, VOLCANO_SMOKE_SECONDS - (35 - Math.min(35, saved.remaining)));
      this.coolingHot = saved.coolingHot === true;
      this.cycle = Number.isSafeInteger(saved.cycle) && saved.cycle >= 0 ? saved.cycle : 0;
    }
  }
  get active(): boolean { return this.phase === 'smoking' || this.phase === 'erupting'; }
  onErupt: () => void = () => {};
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.remaining -= dt;
    while (this.remaining <= 0) {
      if (this.phase === 'dormant') { this.phase = 'smoking'; this.remaining += VOLCANO_SMOKE_SECONDS; }
      else if (this.phase === 'smoking') { this.phase = 'erupting'; this.remaining += 65; this.onErupt(); }
      else if (this.phase === 'erupting') { this.coolingHot = true; this.phase = 'cooling'; this.remaining += 25; }
      else {
        this.phase = 'dormant'; this.cycle++;
        this.remaining += new RNG(this.seed + this.cycle * 7919).range(240, 480);
      }
    }
  }
  calm(pay: (cost: number) => boolean): boolean {
    if (!this.active || !pay(VOLCANO_COST)) return false;
    this.coolingHot = this.phase === 'erupting';
    this.phase = 'cooling'; this.remaining = 25;
    return true;
  }
}

/** Uneven slopes and a broken crater lip shared by the rock and lava geometry. */
export function volcanoSurface(f: number, angle: number): THREE.Vector3 {
  const ridge = Math.sin(angle * 5 + 0.7) * 0.24 + Math.sin(angle * 9 - 0.8) * 0.10;
  const radius = 3.3 + 6.0 * Math.pow(f, 1.48);
  const shoulder = 1 + f * (0.10 * Math.sin(angle * 3 + 0.6) + 0.06 * Math.cos(angle * 5));
  // A long rocky spur makes space for a joined secondary peak on one side.
  const spur = Math.pow(Math.max(0, Math.cos(angle - 2.3)), 10);
  const rimShape = (0.30 * Math.sin(angle * 3 + 0.4) + 0.16 * Math.cos(angle * 2)) * (1 - f);
  const r = rimShape + radius * shoulder + ridge * Math.sin(Math.PI * f) + spur * 1.8 * f * f;
  // Steep fluted walls open onto a broad, asymmetric apron.
  const notch = Math.pow(Math.max(0, Math.cos(angle - 0.35)), 40) * 1.0;
  const lip = Math.sin(angle * 2) * 0.30 + Math.sin(angle * 5) * 0.14 - notch;
  const ridgeLobes = Math.pow(Math.max(0, Math.cos(angle - 4.35)), 10) * 2.5
    + Math.pow(Math.max(0, Math.cos(angle - 5.4)), 8) * 1.6;
  const foothills = ridgeLobes * Math.exp(-(((f - 0.62) / 0.26) ** 2)) * Math.sin(Math.PI * f);
  // One continuous surface: summit, low connecting saddle, then a craggy side peak.
  const secondaryPeak = spur * 8.4 * Math.exp(-(((f - 0.73) / 0.16) ** 2)) * Math.sin(Math.PI * f);
  const saddle = spur * 1.1 * Math.sin(Math.PI * f);
  const height = foothills + secondaryPeak + saddle + 10.2 * Math.pow(1 - f, 1.25) + lip * (1 - f)
    + ridge * Math.sin(Math.PI * f) * 0.8;
  return new THREE.Vector3(Math.cos(angle) * r * (1 + 0.10 * (1 - f)) + 0.38 * (1 - f), height, Math.sin(angle) * r * (1 - 0.12 * (1 - f)));
}

export function volcanoRockGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], colours: number[] = [], indices: number[] = [];
  const sides = 64, rings = 24;
  const dark = new THREE.Color(0x303740), ash = new THREE.Color(0x879098);
  // Lower flank -> lip -> deep inner crater -> closed rocky floor.
  for (let j = 0; j <= rings + 5; j++) for (let i = 0; i <= sides; i++) {
    const angle = i / sides * Math.PI * 2;
    let point: THREE.Vector3;
    if (j <= rings) point = volcanoSurface(1 - j / rings, angle);
    else {
      const t = (j - rings) / 5;
      point = volcanoSurface(0, angle);
      const innerRadius = t < 1 ? 1 - t * 0.48 : 0;
      point.x = 0.38 + (point.x - 0.38) * innerRadius;
      point.z *= innerRadius;
      point.y = point.y * (1 - t) + 7.2 * t;
    }
    positions.push(point.x, point.y, point.z);
    const strata = 0.52 + Math.sin(point.y * 3.5 + Math.sin(angle * 6) * 0.8) * 0.09;
    const c = dark.clone().lerp(ash, Math.max(0, strata + Math.sin(angle * 17 + j * 8) * 0.12));
    if (j > rings) c.multiplyScalar(0.65);
    colours.push(c.r, c.g, c.b);
    if (j < rings + 5 && i < sides) {
      const a = j * (sides + 1) + i, b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

/** One breached outlet splits into three channels across the lower apron. */
export function volcanoChannel(f: number, branch: number): number {
  const fork = Math.max(0, (f - 0.30) / 0.70);
  return 0.35 + (branch - 1) * 0.68 * fork * fork + Math.sin(f * 10) * 0.045 * f;
}

// Smooth seeded value noise avoids repeating stripes in dirt and molten surfaces.
const SURFACE_NOISE = `
float surfaceHash(vec3 p) {
  p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float surfaceNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(surfaceHash(i), surfaceHash(i+vec3(1,0,0)), f.x),
    mix(surfaceHash(i+vec3(0,1,0)), surfaceHash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(surfaceHash(i+vec3(0,0,1)), surfaceHash(i+vec3(1,0,1)), f.x),
    mix(surfaceHash(i+vec3(0,1,1)), surfaceHash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
`;

/** Fine stone grain fades with pixel footprint so distant cliffs do not sparkle. */
function texturedRock(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vRockPoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvRockPoint = position;');
    shader.fragmentShader = 'varying vec3 vRockPoint;\n' + SURFACE_NOISE + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float footprint = length(fwidth(vRockPoint));
      float fineFade = 1.0 - smoothstep(0.008, 0.04, footprint);
      float coarseFade = 1.0 - smoothstep(0.04, 0.18, footprint);
      float soil = surfaceNoise(vRockPoint * 3.8);
      float aggregate = surfaceNoise(vRockPoint * 17.0);
      float grit = surfaceNoise(vRockPoint * 85.0);
      vec3 dirtTint = mix(vec3(0.69, 0.66, 0.60), vec3(1.13, 1.10, 1.03), soil);
      diffuseColor.rgb *= dirtTint * (0.86 + aggregate * 0.28
        + (aggregate - 0.5) * 0.42 * coarseFade + (grit - 0.5) * 0.72 * fineFade);
    `);
  };
  return material;
}

/** Vertices across each molten flow, rolling lobes on the flows, lip lobes, fountain bombs, smoke puffs. */
const LAVA_ACROSS = 9, BLOBS = 30, SPILL = 4, BOMBS = 44, SMOKE = 54;
/** Height of the crater lake when quiet, and brimming at the breach. */
const LAKE_LOW = 8.8, LAKE_FULL = 9.42;

/**
 * A strip draped down one lava channel: `across` vertices side to side (row by row downhill, so a
 * draw range fills it from the top), `halfWidth(f)` in radians, raised by `lift(s)` across it.
 */
function channelRibbon(branch: number, reach: number, across: number,
  halfWidth: (f: number) => number, lift: (s: number) => number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  for (let n = 0; n <= 64; n++) {
    const f = n / 64 * reach, angle = volcanoChannel(f, branch), width = halfWidth(f);
    for (let j = 0; j < across; j++) {
      const s = across === 1 ? 0 : j / (across - 1) * 2 - 1;
      const point = volcanoSurface(f, angle + width * s);
      positions.push(point.x, point.y + lift(s), point.z);
      if (n < 64 && j < across - 1) {
        const a = n * across + j, b = a + across;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Small deterministic generator for textures (keeps the game's random stream untouched). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * A soft cauliflower puff: overlapping round lobes with a ragged edge, lit from above (its
 * underside shaded), so overlapping sprites read as a rolling, volumetric cloud.
 */
function smokeTexture(variant: number): THREE.DataTexture {
  const S = 96, rand = lcg(7919 + variant * 104729);
  const lobes = Array.from({ length: 9 }, (_, i) => {
    const a = rand() * Math.PI * 2, d = i === 0 ? 0 : 0.18 + rand() * 0.28;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, r: 0.26 + rand() * 0.2 };
  });
  const pixels = new Uint8Array(S * S * 4);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const x = (px + 0.5) / S * 2 - 1, y = (py + 0.5) / S * 2 - 1;
    let density = 0, top = 0;
    for (const l of lobes) {
      const d = Math.hypot(x - l.x, y - l.y) / l.r;
      const w = Math.max(0, 1 - d * d);
      density += w * w;
      // How far up this lobe the pixel sits: lobe tops catch the light.
      top += w * w * ((y - l.y) / l.r);
    }
    const grain = 0.82 + 0.18 * Math.sin(x * 23 + Math.sin(y * 17) * 2) * Math.sin(y * 19 + x * 7);
    const alpha = Math.min(1, density * 1.25) * grain * Math.max(0, 1 - Math.hypot(x, y) ** 6);
    const light = density > 0 ? top / density : 0;
    const shade = Math.max(0.5, Math.min(1, 0.78 + light * 0.3 + y * 0.08));
    const i = (py * S + px) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(shade * 255);
    pixels[i + 3] = Math.round(Math.max(0, alpha) * 255);
  }
  const texture = new THREE.DataTexture(pixels, S, S);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A soft radial glow for the light the crater throws up into its smoke. */
function glowTexture(): THREE.DataTexture {
  const S = 64, pixels = new Uint8Array(S * S * 4);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const d = Math.hypot((px + 0.5) / S * 2 - 1, (py + 0.5) / S * 2 - 1);
    const i = (py * S + px) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(Math.max(0, 1 - d) ** 2.2 * 255);
  }
  const texture = new THREE.DataTexture(pixels, S, S);
  texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

export class Volcano {
  readonly group = new THREE.Group();
  readonly state: VolcanoCycle;
  readonly x: number;
  readonly z: number;
  readonly radius = 18;
  private age = 0;
  private lava: THREE.Group;
  private pool: THREE.Mesh;
  private smoke: THREE.Sprite[] = [];
  private lavaTime = { value: 0 };
  private lavaHeat = { value: 0 };
  private streams: THREE.Mesh[] = [];
  private bubbles: THREE.Mesh[] = [];
  private craterLight = new THREE.PointLight(0xff6a12, 0, 16, 2);
  private flowBlobs!: THREE.InstancedMesh;
  private bombs!: THREE.InstancedMesh;
  private craterGlow!: THREE.Sprite;
  private lavaFrame = { value: new THREE.Matrix4() };
  private blobTransform = new THREE.Object3D();
  private blobUp = new THREE.Vector3(0, 1, 0);
  private readonly glow = new THREE.MeshStandardMaterial({ color: 0xff6b13, emissive: 0xff3800, emissiveIntensity: 2.7, roughness: 0.7 });
  /** 0 at night … 1 in daylight: the smoke is unlit, so it darkens with the sky (its glow from below does not). */
  daylight = 1;
  notify: (message: string) => void = () => {};

  constructor(w: World, saved?: VolcanoSave) {
    this.state = new VolcanoCycle(w.seed, saved);
    // Prefer the broad inland crown of island two, clear of existing buildings and landmarks.
    let best = -Infinity, site = -1;
    for (let i = 0; i < w.layer.length; i++) {
      if (w.isle[i] !== 2 || w.layer[i] < 2 || w.distWater[i] < 18) continue;
      const cx = i % w.N, cz = Math.floor(i / w.N);
      let clear = true;
      for (let dz = -18; dz <= 18 && clear; dz++) for (let dx = -18; dx <= 18; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) { clear = false; break; }
        const j = w.idx(cx + dx, cz + dz);
        if (w.occ[j] || w.blockFixed[j] || w.layer[j] < 1) { clear = false; break; }
      }
      const score = w.layer[i] * 2 + w.distWater[i];
      if (clear && score > best) { best = score; site = i; }
    }
    const savedSite = saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) ? w.cellIndexAt(saved.x, saved.z) : -1;
    if (savedSite >= 0 && w.isle[savedSite] === 2 && w.layer[savedSite] >= 1) site = savedSite;
    this.x = site >= 0 ? w.centerX(site % w.N) : 0;
    this.z = site >= 0 ? w.centerZ(Math.floor(site / w.N)) : 0;
    this.group.visible = site >= 0;
    this.group.name = 'Second island volcano';
    let y = site >= 0 ? w.heightAt(this.x, this.z) : 0;
    if (site >= 0) for (let n = 0; n < 24; n++) {
      const a = n * Math.PI / 12;
      y = Math.min(y, w.heightAt(this.x + Math.cos(a) * 8, this.z + Math.sin(a) * 8));
    }
    this.group.position.set(this.x, y, this.z);
    this.group.scale.set(1.5, 2.15, 1.4);
    if (site >= 0) w.blockCircle(this.x, this.z, this.radius + 0.8);
    const stone = texturedRock(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false }));
    const mountain = new THREE.Mesh(volcanoRockGeometry(), stone);
    mountain.castShadow = true; mountain.receiveShadow = true;
    this.group.add(mountain);
    this.craterLight.position.set(0.38, 9.7, 0); this.group.add(this.craterLight);
    // Batched angular outcrops and scrub nest the mountain into its jungle island.
    const rng = new RNG(w.seed + 9817), dummy = new THREE.Object3D();
    // Weathered, fractured boulders (centred like a unit ball, so they sit as the old blocks did).
    const rockGeo = boulderGeometry(w.seed * 3 + 77, { height: 1.3, sink: 0.35, points: 18 }).translate(0, -0.45, 0);
    const outcrops = new THREE.InstancedMesh(rockGeo,
      texturedRock(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })), 18);
    // The island's own leafy bushes (swaying in the wind), not green blocks.
    const shrubs = new THREE.InstancedMesh(bushGeometry(false, true, w.seed * 5 + 41), stylisedMaterial(), 240);
    for (const [mesh, vegetation] of [[outcrops, false], [shrubs, true]] as const) {
      for (let i = 0; i < mesh.count; i++) {
        const f = rng.range(vegetation ? 0.40 : 0.25, 0.98);
        // Leave the lava apron bare while the opposite flanks retain vegetation.
        const angle = rng.range(1.2, Math.PI * 2 - 0.5);
        const point = volcanoSurface(f, angle);
        const size = rng.range(vegetation ? 0.18 : 0.25, vegetation ? 0.72 : 0.95);
        dummy.position.copy(point);
        const ground = (w.heightAt(this.x + point.x * 1.5, this.z + point.z * 1.4) - y) / 2.15;
        dummy.position.y = Math.max(point.y, ground) + (vegetation ? -0.02 : size * 0.35);
        dummy.rotation.set(rng.range(-0.15, 0.15), angle, rng.range(-0.2, 0.2));
        // Bushes are squashed against the mountain's tall scale so they keep their shape.
        if (vegetation) dummy.scale.set(size * 1.8, size * 1.8 * 0.7, size * 1.8);
        else dummy.scale.set(size, size * rng.range(0.7, 1.4), size);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, vegetation ? new THREE.Color().setScalar(rng.range(0.82, 1.08)) : new THREE.Color(0x737d87).multiplyScalar(rng.range(0.65, 1.15)));
      }
      mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    }
    // A lower planted crag divides the two main lava arms, like the reference.
    const crag = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.2, 2.8, 6),
      texturedRock(new THREE.MeshStandardMaterial({ color: 0x727b77, roughness: 1, flatShading: true })));
    const cragPoint = volcanoSurface(0.79, 0.35);
    crag.position.copy(cragPoint); crag.position.y += 0.7;
    crag.rotation.y = 0.65; crag.scale.set(0.70, 1, 0.60);
    crag.castShadow = true; crag.receiveShadow = true; this.group.add(crag);
    const cragShrubs = new THREE.InstancedMesh(shrubs.geometry, stylisedMaterial(), 12);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, r = rng.range(0, 0.30);
      dummy.position.set(cragPoint.x + Math.cos(a) * r, cragPoint.y + 2.0, cragPoint.z + Math.sin(a) * r);
      dummy.rotation.set(0, a, 0); dummy.scale.set(0.4, 0.28, 0.4); dummy.updateMatrix();
      cragShrubs.setMatrixAt(i, dummy.matrix);
    }
    cragShrubs.castShadow = true; this.group.add(cragShrubs);
    // Irregular clusters at ground level soften the boundary into the forest.
    const rubble = new THREE.InstancedMesh(rockGeo,
      texturedRock(new THREE.MeshStandardMaterial({ color: 0x68727c, roughness: 1, flatShading: true })), 92);
    for (let i = 0; i < rubble.count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const point = volcanoSurface(1, angle).multiplyScalar(rng.range(0.84, 1.07));
      const size = rng.range(0.18, 0.8);
      const ground = (w.heightAt(this.x + point.x * 1.5, this.z + point.z * 1.4) - y) / 2.15;
      dummy.position.set(point.x, ground + size * 0.28, point.z);
      dummy.rotation.set(rng.range(-0.4, 0.4), angle, rng.range(-0.3, 0.3));
      dummy.scale.set(size * rng.range(0.8, 1.5), size * rng.range(0.6, 1.8), size);
      dummy.updateMatrix(); rubble.setMatrixAt(i, dummy.matrix);
    }
    rubble.castShadow = true; rubble.receiveShadow = true; this.group.add(rubble);
    // Scree fans: many small stones in one draw call, clustered between larger outcrops.
    const pebbles = new THREE.InstancedMesh(rockGeo,
      texturedRock(new THREE.MeshStandardMaterial({ color: 0x80878b, roughness: 1, flatShading: true })), 650);
    for (let i = 0; i < pebbles.count; i++) {
      const f = rng.range(0.50, 0.995), angle = rng.range(0, Math.PI * 2);
      const point = volcanoSurface(f, angle);
      const ground = (w.heightAt(this.x + point.x * 1.5, this.z + point.z * 1.4) - y) / 2.15;
      const size = rng.range(0.035, 0.16);
      dummy.position.set(point.x, Math.max(point.y, ground) + size * 0.3, point.z);
      dummy.rotation.set(rng.next(), angle, rng.next());
      dummy.scale.set(size * 1.4, size * 0.6, size);
      dummy.updateMatrix(); pebbles.setMatrixAt(i, dummy.matrix);
      pebbles.setColorAt(i, new THREE.Color().setScalar(rng.range(0.55, 1.1)));
    }
    pebbles.receiveShadow = true; this.group.add(pebbles);
    // Broad pointed leaves form recognisable tropical plants among the rock ledges.
    const leafGeometry = new THREE.BufferGeometry();
    leafGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, -0.22, 0.28, 0.46, 0, 0.42, 1.05,
      0, 0, 0, 0, 0.42, 1.05, 0.22, 0.28, 0.46,
    ], 3));
    leafGeometry.computeVertexNormals();
    const leaves = new THREE.InstancedMesh(leafGeometry,
      new THREE.MeshStandardMaterial({ color: 0x6d9637, roughness: 1, side: THREE.DoubleSide }), 420);
    for (let plant = 0; plant < 60; plant++) {
      const f = rng.range(0.48, 0.99), angle = rng.range(1.15, 5.8);
      const point = volcanoSurface(f, angle);
      const terrain = (w.heightAt(this.x + point.x * 1.5, this.z + point.z * 1.4) - y) / 2.15;
      point.y = Math.max(point.y, terrain) + 0.08;
      const size = rng.range(0.55, 1.05);
      for (let leaf = 0; leaf < 7; leaf++) {
        dummy.position.copy(point);
        dummy.rotation.set(rng.range(-0.25, 0.35), leaf * Math.PI * 2 / 7 + angle, 0);
        dummy.scale.setScalar(size); dummy.updateMatrix();
        leaves.setMatrixAt(plant * 7 + leaf, dummy.matrix);
      }
    }
    leaves.castShadow = true; leaves.receiveShadow = true; this.group.add(leaves);
    // Dark cooling crust breaks the molten surface into glowing plates and seams that creep
    // downhill; it thickens away from the vent. Sampled in the mountain's own frame (not each
    // mesh's), so the lake, flows and every rounded lobe share one continuous surface.
    const frame = this.lavaFrame;
    frame.value.compose(this.group.position, this.group.quaternion, this.group.scale).invert();
    this.glow.onBeforeCompile = shader => {
      shader.uniforms.uLavaTime = this.lavaTime;
      shader.uniforms.uLavaHeat = this.lavaHeat;
      shader.uniforms.uLavaFrame = frame;
      shader.vertexShader = 'varying vec3 vLavaPosition; uniform mat4 uLavaFrame;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec4 lavaPoint = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lavaPoint = instanceMatrix * lavaPoint;
        #endif
        vLavaPosition = (uLavaFrame * modelMatrix * lavaPoint).xyz;`);
      shader.fragmentShader = 'varying vec3 vLavaPosition; uniform float uLavaTime; uniform float uLavaHeat;\n' + SURFACE_NOISE + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec3 lp = vLavaPosition;
        float radius = length(lp.xz - vec2(0.38, 0.0));
        // Pattern advected outward from the vent, as if the whole flow were sliding downhill.
        vec2 outward = (lp.xz - vec2(0.38, 0.0)) / max(radius, 0.8);
        vec3 q = vec3(lp.x - outward.x * uLavaTime * 0.28, lp.y * 0.55 + uLavaTime * 0.04, lp.z - outward.y * uLavaTime * 0.28) * 1.6;
        vec3 warp = vec3(surfaceNoise(q * 0.7), surfaceNoise(q * 0.7 + 17.2), surfaceNoise(q * 0.7 + 31.7));
        float plates = surfaceNoise(q + warp * 1.7) * 0.68 + surfaceNoise(q * 2.9 + warp) * 0.32;
        // The lake carries a skin of floating crust; it thickens down the flows.
        float cool = 0.22 + 0.78 * smoothstep(2.0, 10.0, radius);
        float molten = smoothstep(0.3 + 0.12 * cool, 0.6 + 0.08 * cool, plates);
        float seams = 1.0 - smoothstep(0.0, 0.05, abs(plates - (0.32 + 0.12 * cool)));
        float heat = max(molten, seams * 0.75) * uLavaHeat;
        // Rounded lobes glow strongest face-on and darken towards their edges.
        float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        vec3 hot = mix(vec3(0.5, 0.08, 0.015), vec3(0.62, 0.2, 0.04), molten * (1.0 - 0.6 * cool));
        diffuseColor.rgb = mix(vec3(0.055, 0.03, 0.022), hot, heat);
        totalEmissiveRadiance = mix(vec3(0.95, 0.12, 0.012), vec3(1.25, 0.3, 0.035), molten * (1.0 - 0.5 * cool))
          * heat * uLavaHeat * (0.55 + 0.45 * facing);
      `);
    };
    this.glow.customProgramCacheKey = () => 'volcano-lava-2';
    this.lava = new THREE.Group(); this.lava.name = 'Active lava'; this.group.add(this.lava);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(2.5, 48).rotateX(-Math.PI / 2), this.glow);
    // The lake wells up from deep in the crater until it brims at the breached lip.
    this.pool.scale.set(1.1, 1, 0.88);
    this.pool.position.set(0.38, 8.8, 0); this.lava.add(this.pool);
    const bubbleGeo = new THREE.IcosahedronGeometry(0.22, 2);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(bubbleGeo, this.glow); this.bubbles.push(b); this.lava.add(b);
    }
    for (let k = 0; k < 3; k++) {
      const reach = k === 1 ? 0.60 : 1;
      // Molten flows are raised and rounded across their width, spreading a little downhill.
      const flow = channelRibbon(k, reach, LAVA_ACROSS,
        f => (0.26 + 0.12 * f + 0.08 * Math.sin(f * 7) ** 2) / (3.3 + 6.0 * f ** 1.48),
        s => 0.04 + 0.2 * Math.sqrt(Math.max(0, 1 - s * s)));
      // Cooled basalt beds remain visible throughout dormancy.
      const bed = new THREE.Mesh(channelRibbon(k, reach, 2, f => 0.5 / (3.3 + 6.0 * f ** 1.48), () => 0.055),
        new THREE.MeshStandardMaterial({ color: 0x282824, roughness: 1 }));
      bed.name = 'Cooled lava channel'; bed.receiveShadow = true; this.group.add(bed);
      const stream = new THREE.Mesh(flow, this.glow);
      this.streams.push(stream); this.lava.add(stream);
    }
    // Rounded molten lobes: rolling down the flows, pushing at each flow's front and brimming
    // over the breached lip; and glowing bombs thrown up from the lake while it erupts.
    this.flowBlobs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), this.glow, BLOBS + 3 + SPILL);
    this.flowBlobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flowBlobs.frustumCulled = false;
    this.flowBlobs.name = 'Downhill molten lobes'; this.lava.add(this.flowBlobs);
    this.bombs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.glow, BOMBS);
    this.bombs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bombs.frustumCulled = false;
    this.bombs.name = 'Lava fountain'; this.lava.add(this.bombs);
    // The lake's glow lights the underside of the plume.
    this.craterGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff7a26, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
    }));
    this.craterGlow.renderOrder = 17;
    this.craterGlow.name = 'Crater glow'; this.craterGlow.position.set(0.38, 10.6, 0);
    this.craterGlow.scale.set(9 / 1.5, 7 / 2.15, 1); this.lava.add(this.craterGlow);
    // Billowing puffs (three shaded variants) overlap into a rising, wind-bent column.
    const puffs = [0, 1, 2].map(smokeTexture);
    for (let i = 0; i < SMOKE; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({
        map: puffs[i % 3], color: 0x777675, transparent: true, opacity: 0, depthWrite: false, fog: true,
      }));
      // After the sea, which writes depth and would otherwise cut the plume off at the horizon.
      m.renderOrder = 17;
      m.name = 'Volcanic smoke';
      this.smoke.push(m); this.group.add(m);
    }
    this.animate(0);
  }
  save(): VolcanoSave | undefined {
    return this.group.visible ? { x: this.x, z: this.z, phase: this.state.phase, remaining: this.state.remaining, cycle: this.state.cycle, coolingHot: this.state.coolingHot, warningVersion: 2 } : undefined;
  }
  update(dt: number): void {
    if (!this.group.visible) return;
    const previous = this.state.phase;
    this.state.update(dt); this.age += dt;
    if (previous !== this.state.phase && this.state.phase === 'smoking')
      this.notify('The volcano will smoke for five minutes before lava appears. Use Calm for 50 Belief before it erupts, or lose 75 Belief.');
    if (previous !== this.state.phase && this.state.phase === 'erupting')
      this.notify('The volcano is erupting! 75 Belief lost. Use Calm for 50 Belief to stop the lava.');
    this.animate(dt);
  }
  private animate(_dt: number): void {
    const phase = this.state.phase, t = this.age;
    const cooling = phase === 'cooling' ? Math.min(1, this.state.remaining / 25) : 0;
    const strength = phase === 'erupting' ? 1 : this.state.coolingHot ? cooling : 0;
    // Seconds into the eruption (the lake wells up, then the flows advance downhill).
    const since = phase === 'erupting' ? 65 - this.state.remaining : 65;
    this.lava.visible = strength > 0;
    this.craterLight.intensity = strength * (24 + Math.sin(t * 2.7) * 3 + Math.sin(t * 7.3) * 1.5);
    this.lavaTime.value = t; this.lavaHeat.value = strength;
    const lake = LAKE_LOW + (LAKE_FULL - LAKE_LOW) * (phase === 'erupting' ? Math.min(1, since / 6) : cooling);
    this.pool.position.y = lake + Math.sin(t * 1.7) * 0.04 * strength;
    const widen = 1 + (lake - LAKE_LOW) * 0.16;
    this.pool.scale.set(1.1 * widen, 1, 0.88 * widen);
    this.bubbles.forEach((b, i) => {
      const a = i * 2.4, r = 0.4 + (i % 3) * 0.55, swell = Math.max(0, Math.sin(t * 2.3 + i * 1.7));
      b.position.set(0.38 + Math.cos(a) * r, lake - 0.05 + swell * 0.16 * strength, Math.sin(a) * r);
      b.scale.set(0.7 + swell * 0.8, (0.7 + swell * 0.8) * 0.75, 0.7 + swell * 0.8);
    });
    const fronts = [0, 1, 2].map(i => phase === 'erupting' ? Math.max(0, Math.min(1, (since - 4 - i * 5) / 24)) : 1);
    this.streams.forEach((m, i) => {
      // Fill each flow downhill as the overflow begins.
      m.geometry.setDrawRange(0, Math.floor(fronts[i] * 64) * (LAVA_ACROSS - 1) * 6);
      m.visible = fronts[i] > 0 && (i === 0 || strength > 0.3);
    });
    const blob = this.blobTransform;
    const place = (index: number, f: number, branch: number, size: number, flat: number, lift: number) => {
      const angle = volcanoChannel(f, branch);
      const point = volcanoSurface(f, angle);
      const across = volcanoSurface(f, angle + 0.001).sub(point);
      const downhill = volcanoSurface(Math.min(1, f + 0.001), angle).sub(point);
      const normal = across.clone().cross(downhill).normalize();
      blob.position.copy(point).addScaledVector(normal, lift * size + 0.08);
      // Long axis down the slope, short axis out of it: a rounded, slumping tongue.
      const z = downhill.normalize(), y = normal, x = y.clone().cross(z).normalize();
      blob.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      blob.scale.set(size, size * flat, size * 1.45);
      blob.updateMatrix(); this.flowBlobs.setMatrixAt(index, blob.matrix);
    };
    if (strength > 0) {
      for (let i = 0; i < BLOBS; i++) {
        const branch = i % 3, reach = branch === 1 ? 0.60 : 1;
        // Viscous: lobes slow as they cool on the way down.
        const run = (t * (0.018 + (i % 5) * 0.0016) + i * 0.381966) % 1;
        const f = (1 - (1 - run) ** 1.35) * reach;
        const size = f < fronts[branch] * reach ? (0.16 + (i % 4) * 0.035 + 0.1 * f) * Math.min(1, f * 12) * strength : 0;
        place(i, f, branch, size, 0.72, 0.35);
      }
      // A bulging snout at the head of each flow; a broad spreading toe once it reaches the foot.
      for (let k = 0; k < 3; k++) {
        const reach = k === 1 ? 0.60 : 1, f = Math.max(0.02, fronts[k] * reach - 0.006);
        const pulse = 1 + Math.sin(t * 1.3 + k * 2) * 0.05;
        place(BLOBS + k, f, k, fronts[k] > 0 ? (fronts[k] < 1 ? 0.42 : 0.5) * pulse * strength : 0, 0.62, 0.2);
      }
      // Lava brimming over the breached lip, rolling down into the flows.
      for (let k = 0; k < SPILL; k++) {
        const f = 0.004 + k * 0.016, swell = 1 + Math.sin(t * 2.1 - k * 0.9) * 0.08;
        const brim = phase === 'erupting' ? Math.min(1, Math.max(0, (since - 3) / 3)) : strength;
        place(BLOBS + 3 + k, f, 0, (0.5 - k * 0.05) * swell * brim, 0.55, 0.25);
      }
      this.flowBlobs.instanceMatrix.needsUpdate = true;
      // Fountain: molten bombs flung up from the lake in bursts, arcing out and falling back.
      const fountain = phase === 'erupting' ? Math.min(1, since / 4) * (0.55 + 0.45 * Math.max(0, Math.sin(t * 0.8))) : 0;
      for (let i = 0; i < BOMBS; i++) {
        const period = 1.5 + (i % 7) * 0.17, u = ((t / period + i * 0.618034) % 1), s = u * period;
        const a = i * 2.39996, up = 4.2 + (i % 5) * 0.75 + (i % 3) * 0.4, out = 0.35 + (i % 4) * 0.32;
        const y = lake + up * s - 4.6 * s * s;
        const size = i / BOMBS < fountain && y > lake ? (0.07 + (i % 3) * 0.035) * (1 - u * 0.4) : 0;
        blob.position.set(0.38 + Math.cos(a) * out * s, y, Math.sin(a) * out * s);
        blob.quaternion.identity();
        // Stretched along their flight while fast, rounding off at the top of the arc.
        const speed = Math.abs(up - 9.2 * s);
        blob.scale.set(size, size * (1 + speed * 0.09), size);
        blob.updateMatrix(); this.bombs.setMatrixAt(i, blob.matrix);
      }
      this.bombs.instanceMatrix.needsUpdate = true;
    }
    const glowMat = this.craterGlow.material as THREE.SpriteMaterial;
    glowMat.opacity = strength * (0.3 + Math.sin(t * 2.7) * 0.04);
    // Smoke: a thin pale plume while it threatens; a dense, dark ash column, lit orange from below,
    // while it erupts. Puffs rise fast from the vent, slow, swell and drift downwind.
    const erupting = phase === 'erupting';
    const amount = this.state.active ? (erupting ? 1 : 0.7) : cooling * 0.5;
    this.smoke.forEach((m, i) => {
      const life = 15 + (i % 5) * 1.6;
      const f = ((t / life + i / SMOKE) % 1);
      const rise = 1 - (1 - f) ** 1.7;
      const swirl = i * 2.39996 + t * 0.15;
      const spread = 0.5 + f * 3.2;
      const drift = f * f * 9;
      const size = (erupting ? 4 : 2.6) + f * (erupting ? 17 : 11) + (i % 4) * 0.8;
      m.position.set(0.38 + drift + Math.cos(swirl) * spread, 9.6 + rise * (erupting ? 17 : 13), Math.sin(swirl) * spread * 1.2 + f * f * 2.5);
      // Undo the mountain's uneven scale so puffs stay round.
      m.scale.set(size / 1.5, size / 2.15, 1);
      const material = m.material as THREE.SpriteMaterial;
      const fade = Math.min(1, f / 0.06) * (1 - f) ** 1.3;
      material.opacity = amount * fade * (erupting ? 0.95 : 0.8) * (i % 2 || !this.state.active || erupting ? 1 : 0.6);
      const ember = strength * Math.max(0, 1 - f * 3.2);
      const grey = erupting ? 0.2 + f * 0.2 : 0.46 + f * 0.16;
      const lit = grey * (0.25 + 0.75 * this.daylight);
      material.color.setRGB(lit + ember * 0.55, lit * 0.97 + ember * 0.18, lit * 0.95 + ember * 0.02);
      material.rotation = Math.sin(i * 1.7) * 0.3 + f * (i % 2 ? 0.25 : -0.25);
      m.visible = material.opacity > 0.01;
    });
  }
}
