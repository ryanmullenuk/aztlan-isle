import * as THREE from 'three';
import { stylisedMaterial } from '../render/materials';
import { boulderGeometry } from '../render/rocks';
import { bushGeometry } from '../vegetation/models';
import { World } from '../world/World';
import { RNG } from '../world/rng';
import { Particles } from '../render/Particles';

/** Small deterministic generator for textures (keeps the game's random stream untouched). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

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
  const dark = new THREE.Color(0x343730), ash = new THREE.Color(0x99958a);
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
    const strata = 0.26 + THREE.MathUtils.smoothstep(point.y, 3.5, 10.5) * 0.36;
    const weathering = Math.sin(angle * 3 + point.y * .48) * .08 + Math.cos(angle * 7 - point.y * .7) * .04;
    const c = dark.clone().lerp(ash, THREE.MathUtils.clamp(strata + weathering, 0, 1));
    if (j > rings) c.multiplyScalar(0.65);
    colours.push(c.r, c.g, c.b);
    if (j < rings + 5 && i < sides) {
      const a = j * (sides + 1) + i, b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Chiselled, not smooth: nudge each vertex of the flanks a little (never the crater lip, the
  // crater floor or the foot, so the mountain keeps its size and shape), then give every triangle
  // its own flat face and a slightly different tone, like the game's low-poly rock.
  const rand = lcg(4513);
  for (let j = 1; j < rings; j++) for (let i = 0; i <= sides; i++) {
    const k = (j * (sides + 1) + (i === sides ? 0 : i)) * 3;
    if (i === sides) {
      const k0 = j * (sides + 1) * 3;
      positions[k0 + sides * 3] = positions[k0]; positions[k0 + sides * 3 + 1] = positions[k0 + 1]; positions[k0 + sides * 3 + 2] = positions[k0 + 2];
      continue;
    }
    const x = positions[k] - 0.38, z = positions[k + 2], r = Math.hypot(x, z) || 1;
    const push = (rand() - 0.5) * 0.7, lift = (rand() - 0.5) * 0.45;
    positions[k] += x / r * push; positions[k + 2] += z / r * push; positions[k + 1] += lift;
  }
  const smooth = new THREE.BufferGeometry();
  smooth.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  smooth.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  smooth.setIndex(indices);
  const g = smooth.toNonIndexed();
  smooth.dispose();
  const C = g.getAttribute('color');
  for (let t = 0; t < C.count; t += 3) {
    const tone = 0.84 + rand() * 0.26;
    for (let v = t; v < t + 3; v++) C.setXYZ(v, Math.min(1, C.getX(v) * tone), Math.min(1, C.getY(v) * tone), Math.min(1, C.getZ(v) * tone));
  }
  g.computeVertexNormals();
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
export function texturedRock(material: THREE.MeshStandardMaterial, lava?: { heat: { value: number }; time: { value: number } }): THREE.MeshStandardMaterial {
  material.onBeforeCompile = shader => {
    if (lava) { shader.uniforms.uLavaHeat = lava.heat; shader.uniforms.uLavaTime = lava.time; }
    shader.vertexShader = 'varying vec3 vRockPoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvRockPoint = position;');
    shader.fragmentShader = 'varying vec3 vRockPoint;\n' + SURFACE_NOISE + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float footprint = length(fwidth(vRockPoint));
      float fineFade = 1.0 - smoothstep(0.008, 0.04, footprint);
      float coarseFade = 1.0 - smoothstep(0.04, 0.18, footprint);
      float weathered = surfaceNoise(vRockPoint * 0.8);
      float soil = surfaceNoise(vRockPoint * 3.8);
      float aggregate = surfaceNoise(vRockPoint * 17.0);
      float grit = surfaceNoise(vRockPoint * 85.0);
      // Broad ash deposits and darker exposed basalt remain readable from the village.
      float ashPatch = smoothstep(0.38, 0.70, weathered + (soil - 0.5) * 0.16);
      vec3 rockTint = mix(vec3(0.65, 0.68, 0.66), vec3(1.15, 1.10, 1.00), ashPatch);
      // Broken drainage grooves follow the slopes, rather than repeated horizontal rings.
      float angle = atan(vRockPoint.z, vRockPoint.x - 0.38);
      float groove = pow(max(0.0, sin(angle * 23.0 + weathered * 4.0 + vRockPoint.y * 0.16)), 12.0);
      float slopeBand = smoothstep(1.0, 4.0, vRockPoint.y) * (1.0 - smoothstep(9.0, 11.0, vRockPoint.y));
      float fissure = groove * slopeBand * (0.35 + 0.65 * coarseFade);
      diffuseColor.rgb *= rockTint * (0.89 + soil * 0.22 - fissure * 0.18
        + (aggregate - 0.5) * 0.32 * coarseFade + (grit - 0.5) * 0.40 * fineFade);
      float rockRelief = ((soil - 0.5) * 0.07 + (aggregate - 0.5) * 0.025 * coarseFade - fissure * 0.04) * coarseFade;
    `);
    if (lava) {
      shader.fragmentShader = 'uniform float uLavaHeat; uniform float uLavaTime;\n' + shader.fragmentShader;
      // While it erupts, hairline cracks glow round the crater and down the breached face beside
      // the flows, pulsing as the heat comes and goes.
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        {
          float ang = atan(vRockPoint.z, vRockPoint.x - 0.38);
          float front = smoothstep(0.35, 0.85, cos(ang - 0.35));
          float crown = smoothstep(7.4, 9.6, vRockPoint.y);
          float band = max(crown, front * smoothstep(0.6, 2.5, vRockPoint.y) * (0.45 + 0.55 * smoothstep(3.0, 8.0, vRockPoint.y)));
          float n = surfaceNoise(vRockPoint * vec3(1.6, 0.7, 1.6)) * 0.7 + surfaceNoise(vRockPoint * 4.1) * 0.3;
          float crack = (1.0 - smoothstep(0.0, 0.016, abs(n - 0.5))) * smoothstep(0.45, 0.75, surfaceNoise(vRockPoint * 0.45 + 3.0));
          float pulse = 0.75 + 0.25 * sin(uLavaTime * 2.2 + vRockPoint.y * 0.9 + ang * 3.0);
          totalEmissiveRadiance += vec3(1.0, 0.3, 0.04) * crack * band * uLavaHeat * pulse * 0.9;
        }
      `);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec3 rockDx = dFdx(-vViewPosition), rockDy = dFdy(-vViewPosition);
      vec3 rockR1 = cross(rockDy, normal), rockR2 = cross(normal, rockDx);
      float rockDet = dot(rockDx, rockR1);
      vec3 rockGradient = sign(rockDet) * (dFdx(rockRelief) * rockR1 + dFdy(rockRelief) * rockR2);
      normal = normalize(max(abs(rockDet), 0.000001) * normal - rockGradient);
    `);
  };
  material.customProgramCacheKey = () => lava ? 'volcanic-rock-lava-v3' : 'volcanic-rock-v2';
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
  const positions: number[] = [], flow: number[] = [], indices: number[] = [];
  for (let n = 0; n <= 64; n++) {
    const f = n / 64 * reach, angle = volcanoChannel(f, branch), width = halfWidth(f);
    for (let j = 0; j < across; j++) {
      const s = across === 1 ? 0 : j / (across - 1) * 2 - 1;
      const point = volcanoSurface(f, angle + width * s);
      positions.push(point.x, point.y + lift(s), point.z);
      flow.push(f, s);
      if (n < 64 && j < across - 1) {
        const a = n * across + j, b = a + across;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLava', new THREE.Float32BufferAttribute(flow, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Tag a lava mesh for the shader: -1 the crater lake, -2 lobes, bubbles and bombs. */
function lavaKind<T extends THREE.BufferGeometry>(geometry: T, kind: number): T {
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('aLava', new THREE.Float32BufferAttribute(new Float32Array(n * 2).map((_, i) => i % 2 ? 0 : kind), 2));
  return geometry;
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
  /** Sparks: rising from the lake, thrown off bursting bubbles and the flows. */
  private embers = new Particles(360, 0xffa646);
  private emberClock = 0;
  private flowBlobs!: THREE.InstancedMesh;
  private bombs!: THREE.InstancedMesh;
  private craterGlow!: THREE.Sprite;
  private lavaFrame = { value: new THREE.Matrix4() };
  private blobTransform = new THREE.Object3D();
  private blobUp = new THREE.Vector3(0, 1, 0);
  private readonly glow = new THREE.MeshStandardMaterial({ color: 0xff6b13, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.55 });
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
    const stone = texturedRock(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), { heat: this.lavaHeat, time: this.lavaTime });
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
    // Angular basalt crags stand out of the flanks: tall columns with slanted, broken tops, some
    // with a tuft of jungle on top, kept clear of the lava channels.
    const prism = new THREE.CylinderGeometry(0.55, 0.7, 1, 6, 1).translate(0, 0.5, 0);
    const pp = prism.getAttribute('position');
    for (let i = 0; i < pp.count; i++) if (pp.getY(i) > 0.9) pp.setY(i, 1 + pp.getX(i) * 0.32 + pp.getZ(i) * 0.12);
    prism.computeVertexNormals();
    const crags = new THREE.InstancedMesh(prism,
      texturedRock(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })), 70);
    const tops = new THREE.InstancedMesh(shrubs.geometry, stylisedMaterial(), 70);
    let placedCrags = 0, placedTops = 0;
    for (let tries = 0; tries < 400 && placedCrags < crags.count; tries++) {
      const f = rng.range(0.12, 0.9), angle = rng.range(0, Math.PI * 2);
      let clear = true;
      for (let k = 0; k < 3; k++) {
        if (k === 1 && f > 0.62) continue;
        const d = Math.abs(Math.atan2(Math.sin(angle - volcanoChannel(f, k)), Math.cos(angle - volcanoChannel(f, k))));
        if (d < 0.3 + 0.12 * f) clear = false;
      }
      if (!clear) continue;
      const point = volcanoSurface(f, angle);
      const terrain = (w.heightAt(this.x + point.x * 1.5, this.z + point.z * 1.4) - y) / 2.15;
      const width = rng.range(0.35, 0.95) * (1.1 - f * 0.4), height = rng.range(0.6, 1.6) * (1.2 - f * 0.5);
      dummy.position.set(point.x, Math.max(point.y, terrain) - height * 0.45, point.z);
      dummy.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
      dummy.scale.set(width, height, width * rng.range(0.7, 1.1));
      dummy.updateMatrix(); crags.setMatrixAt(placedCrags, dummy.matrix);
      crags.setColorAt(placedCrags++, new THREE.Color(0x6e6a64).multiplyScalar(rng.range(0.6, 1.1)));
      if (rng.next() < 0.55 && placedTops < tops.count) {
        dummy.position.y += height * 1.0 + 0.02;
        dummy.rotation.set(0, rng.range(0, 6.28), 0);
        dummy.scale.set(width * 0.9, width * 0.55, width * 0.9);
        dummy.updateMatrix(); tops.setMatrixAt(placedTops, dummy.matrix);
        tops.setColorAt(placedTops++, new THREE.Color().setScalar(rng.range(0.85, 1.1)));
      }
    }
    crags.count = placedCrags; tops.count = placedTops;
    crags.castShadow = crags.receiveShadow = true; tops.castShadow = true;
    crags.name = 'Basalt crags';
    this.group.add(crags, tops);
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
      shader.vertexShader = 'varying vec3 vLavaPosition; varying vec2 vLava; attribute vec2 aLava; uniform mat4 uLavaFrame;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vLava = aLava;
        vec4 lavaPoint = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lavaPoint = instanceMatrix * lavaPoint;
        #endif
        vLavaPosition = (uLavaFrame * modelMatrix * lavaPoint).xyz;`);
      shader.fragmentShader = 'varying vec3 vLavaPosition; varying vec2 vLava; uniform float uLavaTime; uniform float uLavaHeat;\n' + SURFACE_NOISE + `
        // Temperature to colour: black crust, dull red, orange, yellow, a white-hot core.
        vec3 lavaRamp(float T) {
          vec3 c = mix(vec3(0.035, 0.018, 0.012), vec3(0.42, 0.035, 0.008), smoothstep(0.06, 0.3, T));
          c = mix(c, vec3(0.95, 0.22, 0.015), smoothstep(0.3, 0.58, T));
          c = mix(c, vec3(1.0, 0.55, 0.05), smoothstep(0.58, 0.82, T));
          return mix(c, vec3(1.0, 0.86, 0.36), smoothstep(0.84, 1.02, T));
        }
        // Bubbles welling up through the lake: each cell's bubble swells, its rim brightening, then pops.
        float lavaBubbles(vec2 p, float t) {
          vec2 gi = floor(p), gf = fract(p);
          float b = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y));
            vec3 id = vec3(gi + o, 0.0);
            vec2 h = vec2(surfaceHash(id + 1.3), surfaceHash(id + 7.1));
            float ph = surfaceHash(id + 3.7);
            float life = fract(t * (0.32 + 0.35 * ph) + ph);
            float r = 0.08 + life * 0.34, d = length(o + h * 0.8 + 0.1 - gf);
            float dome = 1.0 - smoothstep(0.0, r, d);
            float rim = 1.0 - smoothstep(0.0, 0.045, abs(d - r));
            b = max(b, (dome * 0.55 + rim) * smoothstep(1.0, 0.82, life) * step(0.25, ph));
          }
          return b;
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec3 lp = vLavaPosition;
        vec2 rel = lp.xz - vec2(0.38, 0.0);
        float radius = length(rel), t = uLavaTime, T;
        if (vLava.x > -0.5) {
          // A flow: hot down its middle, crusting at its edges and further down. Long ripples and
          // rafts of crust slide downhill, slowing as the lava cools.
          float f = vLava.x, s = vLava.y, edge = abs(s);
          float along = f * 30.0 - t * (1.9 - 0.9 * f);
          float ripple = surfaceNoise(vec3(s * 2.0, along * 0.32, 1.0)) * 0.6 + surfaceNoise(vec3(s * 5.0, along * 0.9, 4.0)) * 0.4;
          float crust = surfaceNoise(vec3(s * 1.7 + 9.0, along * 0.42, 7.0)) * 0.7 + surfaceNoise(vec3(s * 4.3, along * 1.1, 2.0)) * 0.3;
          float core = 1.0 - smoothstep(0.1, 1.0, edge);
          T = mix(0.42, 0.98, core) * (0.84 + 0.34 * (ripple - 0.5)) - f * 0.14;
          float crusted = smoothstep(0.66 - 0.2 * f - 0.22 * edge, 0.74 - 0.16 * f - 0.18 * edge, crust);
          T = mix(T, 0.07, crusted * 0.92);
          // A glowing seam round every raft of crust.
          T = max(T, 0.5 * (1.0 - smoothstep(0.0, 0.035, abs(crust - (0.7 - 0.18 * f - 0.2 * edge)))));
        } else if (vLava.x > -1.5) {
          // The crater lake turns slowly (faster near the middle), skinned with drifting crust and
          // broken by bubbles that swell and burst.
          float ang = atan(rel.y, rel.x) + t * 0.22 / (0.5 + radius);
          vec2 sw = vec2(cos(ang), sin(ang)) * radius;
          float n = surfaceNoise(vec3(sw * 1.7, t * 0.12)) * 0.65 + surfaceNoise(vec3(sw * 4.0, t * 0.2 + 5.0)) * 0.35;
          float bub = lavaBubbles(sw * 2.1, t);
          T = 0.6 + 0.3 * (n - 0.5) + 0.38 * bub - 0.2 * smoothstep(1.4, 2.9, radius);
          float crusted = smoothstep(0.54, 0.66, n) * smoothstep(0.3, 1.8, radius) * (1.0 - bub);
          T = mix(T, 0.09, crusted);
          T = max(T, 0.55 * (1.0 - smoothstep(0.0, 0.03, abs(n - 0.64))) * smoothstep(0.5, 2.0, radius));
        } else {
          // Rolling lobes and flung bombs: molten, with a little crust tumbling over them.
          float n = surfaceNoise(lp * 3.2 + vec3(0.0, -t * 0.8, t * 0.3));
          T = 0.6 + 0.3 * (n - 0.5);
          T = mix(T, 0.1, smoothstep(0.58, 0.72, n) * 0.85);
        }
        // Cooling once calmed: the whole surface darkens to crust.
        T *= mix(0.35, 1.0, uLavaHeat);
        float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        vec3 lavaCol = lavaRamp(T);
        float glowing = smoothstep(0.1, 0.32, T) * uLavaHeat;
        diffuseColor.rgb = mix(vec3(0.05, 0.035, 0.03), lavaCol * 0.25, glowing);
        totalEmissiveRadiance = lavaCol * glowing * (0.8 + 0.3 * facing) * 1.05;
      `);
    };
    this.glow.customProgramCacheKey = () => 'volcano-lava-3';
    this.lava = new THREE.Group(); this.lava.name = 'Active lava'; this.group.add(this.lava);
    const emberMat = this.embers.points.material as THREE.ShaderMaterial;
    emberMat.blending = THREE.AdditiveBlending;
    // Points scale with the mountain's own scale: keep sparks small.
    emberMat.uniforms.uScale.value = 260;
    this.embers.points.name = 'Embers'; this.lava.add(this.embers.points);
    this.pool = new THREE.Mesh(lavaKind(new THREE.CircleGeometry(2.5, 48).rotateX(-Math.PI / 2), -1), this.glow);
    // The lake wells up from deep in the crater until it brims at the breached lip.
    this.pool.scale.set(1.1, 1, 0.88);
    this.pool.position.set(0.38, 8.8, 0); this.lava.add(this.pool);
    const bubbleGeo = lavaKind(new THREE.IcosahedronGeometry(0.22, 2), -2);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(bubbleGeo, this.glow); this.bubbles.push(b); this.lava.add(b);
    }
    for (let k = 0; k < 3; k++) {
      const reach = k === 1 ? 0.60 : 1;
      // Molten flows are raised and rounded across their width, spreading a little downhill.
      const flow = channelRibbon(k, reach, LAVA_ACROSS,
        f => (0.42 + 0.2 * f + 0.1 * Math.sin(f * 7) ** 2) / (3.3 + 6.0 * f ** 1.48),
        s => 0.05 + 0.22 * Math.sqrt(Math.max(0, 1 - s * s)));
      // Cooled basalt beds remain visible throughout dormancy.
      const bed = new THREE.Mesh(channelRibbon(k, reach, 2, f => 0.72 / (3.3 + 6.0 * f ** 1.48), () => 0.055),
        new THREE.MeshStandardMaterial({ color: 0x282824, roughness: 1 }));
      bed.name = 'Cooled lava channel'; bed.receiveShadow = true; this.group.add(bed);
      const stream = new THREE.Mesh(flow, this.glow);
      this.streams.push(stream); this.lava.add(stream);
    }
    // Rounded molten lobes: rolling down the flows, pushing at each flow's front and brimming
    // over the breached lip; and glowing bombs thrown up from the lake while it erupts.
    this.flowBlobs = new THREE.InstancedMesh(lavaKind(new THREE.IcosahedronGeometry(1, 2), -2), this.glow, BLOBS + 3 + SPILL);
    this.flowBlobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flowBlobs.frustumCulled = false;
    this.flowBlobs.name = 'Downhill molten lobes'; this.lava.add(this.flowBlobs);
    this.bombs = new THREE.InstancedMesh(lavaKind(new THREE.IcosahedronGeometry(1, 1), -2), this.glow, BOMBS);
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
  private animate(dt: number): void {
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
    // Big bubbles: each domes up out of the lake, swells, and bursts in a spray of sparks, then
    // comes up again somewhere else.
    this.bubbles.forEach((b, i) => {
      const period = 2.2 + (i % 4) * 0.45, u = (t / period + i * 0.37) % 1, round = Math.floor(t / period + i * 0.37);
      const a = i * 2.4 + round * 1.7, r = 0.35 + ((i + round) % 4) * 0.5;
      const grow = u < 0.85 ? u / 0.85 : 0, size = (0.35 + grow * 1.35) * strength;
      b.position.set(0.38 + Math.cos(a) * r, lake - 0.12 + grow * 0.2, Math.sin(a) * r * 0.85);
      b.scale.set(size, size * (0.45 + grow * 0.35), size);
      b.visible = u < 0.85 && strength > 0;
      if (dt > 0 && strength > 0.3 && u >= 0.85 && u - dt / period < 0.85) {
        for (let k = 0; k < 9; k++) {
          const s = k * 0.698 + i, v = 1.2 + (k % 3) * 0.6;
          this.embers.spawn(b.position.x, lake + 0.1, b.position.z, Math.cos(s) * v * 0.6, 2.2 + (k % 4) * 0.7, Math.sin(s) * v * 0.6, 0.7 + (k % 3) * 0.25, 0.16 + (k % 2) * 0.06);
        }
      }
    });
    // A steady drift of sparks off the lake, and a few off the flows.
    if (dt > 0 && strength > 0) {
      this.emberClock += dt * (phase === 'erupting' ? 70 : 25) * strength;
      while (this.emberClock >= 1) {
        this.emberClock--;
        const r = Math.sqrt(Math.random()) * 2.2, a = Math.random() * Math.PI * 2;
        if (Math.random() < 0.8) this.embers.spawn(0.38 + Math.cos(a) * r, lake + 0.15, Math.sin(a) * r * 0.85, (Math.random() - 0.5) * 0.8 + 0.4, 1.5 + Math.random() * 3.2, (Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 1.6, 0.1 + Math.random() * 0.12, -0.02);
        else {
          const k = Math.floor(Math.random() * 3), f = Math.random() * (k === 1 ? 0.6 : 1) * (phase === 'erupting' ? Math.min(1, Math.max(0, (since - 4 - k * 5) / 24)) : 1);
          const p = volcanoSurface(f, volcanoChannel(f, k));
          this.embers.spawn(p.x, p.y + 0.25, p.z, (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.8, 0.08 + Math.random() * 0.08);
        }
      }
    }
    this.embers.update(dt, 2.2);
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
        const size = f < fronts[branch] * reach ? (0.13 + (i % 4) * 0.03 + 0.08 * f) * Math.min(1, f * 12) * strength : 0;
        place(i, f, branch, size, 0.55, 0.2);
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
    glowMat.opacity = strength * (0.2 + Math.sin(t * 2.7) * 0.03);
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
