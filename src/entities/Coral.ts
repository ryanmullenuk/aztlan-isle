import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, lumpy, M, outward, P } from '../render/GeoBuilder';
import { habitatMaterial, HabitatInstances, habitatFit } from './Habitat';
import { PresetName } from '../config';
import { habitatPreset } from './Habitat';
import { angularRockGeometry } from '../render/rocks';
import { RNG, hash2 } from '../world/rng';
import { Simplex2 } from '../world/noise';
import { habitatCreature, reefField } from './Seabed';
import { StarfishCrawl } from './StarfishCrawl';
import { FX } from '../render/materials';
import { branchingCoral, coralBase, coralBaseGeometry, BASE_PALETTE, limb, LIT, SHADE, soup as triSoup, tableCoral } from './coralModels';
import { AnemoneHost, Clownfish } from './Clownfish';
import { ReefBubbles } from './ReefBubbles';
import { World } from '../world/World';

type CoralKind = 'branch' | 'brain' | 'table' | 'tube' | 'anemone' | 'weed' | 'rock' | 'star' | 'base';

/*
 * Chunky low-poly reef pieces, flat shaded facet by facet: the geometry carries only light and
 * shade (near white), each instance its own bright colour.
 */
/** Lighter towards the top: a little height-based shade on every piece. */
const ramp = (top: number) => (p: THREE.Vector3) => SHADE.clone().lerp(LIT, Math.min(1, Math.max(0, p.y / top)));

/** Stiff coral only nods in the current: nothing at the root, a little at the tips. */
const NOD = (p: THREE.Vector3) => Math.max(0, p.y) * 0.45;

/** A triangle soup (flat normals once built), from a list of corner triples. */
function soup(tris: THREE.Vector3[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flatMap((v) => [v.x, v.y, v.z]), 3));
  g.computeVertexNormals();
  return g;
}

/** Tube coral: a cluster of fat hexagonal tubes, each with a flat rim round a dark hollow. */
function tubeCoral(seed = 5): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  // The hollow: the tube's own colour a little shaded (never a black hole).
  const dark = SHADE.clone().multiplyScalar(0.84);
  const n = rng.int(4, 6);
  for (let k = 0; k < n; k++) {
    const h = k === 0 ? 0.42 : rng.range(0.18, 0.36), r = rng.range(0.045, 0.065);
    const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3), d = k === 0 ? 0 : rng.range(0.07, 0.12);
    const m = M.t(Math.cos(a) * d, -0.02, Math.sin(a) * d, Math.sin(a) * d * 1.6, 0, -Math.cos(a) * d * 1.6);
    b.add(P.cyl(r, r * 1.12, h, 6, true), { color: ramp(0.42), facet: true, sway: NOD }, m.clone().multiply(M.t(0, h / 2, 0)));
    // Flat rim, then the hollow: an inward-facing wall down to a dark floor.
    b.add(new THREE.RingGeometry(r * 0.6, r, 6, 1, -Math.PI / 2), { color: LIT, facet: true, sway: NOD }, m.clone().multiply(M.t(0, h, 0, -Math.PI / 2, 0, 0)));
    b.add(outward(P.cyl(r * 0.6, r * 0.6, h * 0.35, 6, true)), { color: SHADE, facet: true, sway: NOD }, m.clone().multiply(M.t(0, h - h * 0.175, 0)));
    b.add(P.cyl(r * 0.6, r * 0.6, 0.004, 6), { color: dark, facet: true, sway: NOD }, m.clone().multiply(M.t(0, h * 0.65, 0)));
  }
  return b.build();
}

/** Brain coral: a squat faceted boulder, ridged by alternating light and shaded facets. */
function brainCoral(seed = 9): THREE.BufferGeometry {
  const g = lumpy(new THREE.IcosahedronGeometry(0.2, 1), 0.025, seed, 0.62);
  const b = new GeoBuilder();
  b.add(g, { color: (p) => (Math.sin(p.x * 34 + Math.sin(p.z * 28) * 2) > 0 ? LIT : SHADE.clone().lerp(LIT, 0.5)), facet: true }, M.t(0, 0.04, 0));
  return b.build();
}

/**
 * Anemone: a fat column with a wide mouth, crowded with soft round-tipped tentacles in three
 * rings (the outer ones splayed, the inner ones upright), each curling up towards its tip and
 * paler there, always waving.
 */
function anemone(seed = 23): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(seed), tris: THREE.Vector3[] = [];
  b.add(P.cyl(0.115, 0.095, 0.08, 8), { color: SHADE, facet: true }, M.t(0, 0.04, 0));
  const up = new THREE.Vector3(0, 1, 0);
  const rings: [number, number, number, number][] = [[10, 0.095, 0.95, 0.2], [7, 0.058, 0.55, 0.23], [4, 0.025, 0.2, 0.25]];
  rings.forEach(([n, R, lean, len], ring) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.37 + rng.range(-0.12, 0.12), h = len * rng.range(0.85, 1.15);
      const dir = new THREE.Vector3(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a));
      const p0 = new THREE.Vector3(Math.cos(a) * R, 0.065, Math.sin(a) * R), p1 = p0.clone().addScaledVector(dir, h * 0.55);
      const p2 = p1.clone().addScaledVector(dir.clone().lerp(up, 0.55).normalize(), h * 0.5);
      // Fat at the root, a slim waist, and a rounded bulb of a tip.
      limb(tris, p0, p1, p2, 0.03, 0.022, 0.027, 6);
    }
  });
  const pale = SHADE.clone().lerp(LIT, 0.45);
  // Soft bodies: smooth shaded (corners shared), unlike the stony corals' flat facets.
  const smooth = mergeVertices(triSoup(tris), 1e-4);
  smooth.computeVertexNormals();
  b.add(smooth, { color: (p) => pale.clone().lerp(LIT, THREE.MathUtils.smoothstep(p.y, 0.1, 0.3)), sway: (p) => Math.max(0, p.y - 0.07) * 4 });
  return b.build();
}

/** Kelp: a few tall creased blades, pointed at the tip, leaning and swaying. */
function kelp(seed = 19): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(seed);
  for (let k = 0; k < 4; k++) {
    const H = rng.range(0.38, 0.62), W = rng.range(0.035, 0.05), lean = rng.range(-0.12, 0.12), crease = W * 0.6, S = 4;
    const t: THREE.Vector3[] = [];
    const lvl = (j: number) => {
      const u = j / S, w = W * (1 - u) * (0.75 + 0.5 * Math.sin(u * Math.PI)), x = lean * u * u, y = H * u;
      return [new THREE.Vector3(x - w, y, 0), new THREE.Vector3(x, y, crease * (1 - u)), new THREE.Vector3(x + w, y, 0)];
    };
    for (let j = 0; j < S; j++) {
      const [l0, c0, r0] = lvl(j), [l1, c1, r1] = lvl(j + 1);
      t.push(l0, c0, l1, c0, c1, l1, c0, r0, c1, r0, r1, c1);
    }
    const a = (k / 4) * Math.PI * 2 + rng.range(-0.4, 0.4);
    b.add(soup(t), { color: ramp(0.55), facet: true, sway: (p) => Math.max(0, p.y) * 2.4 }, M.t(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05, 0, -a + Math.PI / 2, 0));
  }
  return b.build();
}

/** Starfish: five faceted arms rising to a low ridge, lying on the sand. */
function starfish(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.045 : 0.13;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0.006, Math.sin(a) * r));
  }
  const c = new THREE.Vector3(0, 0.035, 0), t: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) t.push(c, pts[(i + 1) % 10], pts[i]);
  const b = new GeoBuilder();
  b.add(soup(t), { color: LIT, facet: true });
  return b.build();
}

/** A mossy boulder: faceted stone, its upward faces greener and lighter than its flanks. */
function mossyRock(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(angularRockGeometry(913), { color: (_p, nn) => (nn.y > 0.55 ? LIT : SHADE.clone().multiplyScalar(0.8)), facet: true });
  return b.build();
}

const PALETTE: Record<CoralKind, number[]> = {
  rock: [0x4c6e52, 0x5a7d4c, 0x4a6a62, 0x667f5a],
  weed: [0x3f9a4a, 0x56ad4c, 0x2f8a55, 0x6cbb5a],
  branch: [0xf2c14e, 0xf08a6a, 0xf4a259, 0xee7f8f, 0xe8b84a],
  brain: [0x8fb25a, 0xc9b25a, 0x9fc07a],
  table: [0xe58fb0, 0xb48ae6, 0xa9c95a, 0xd49ad8, 0xf0a0b8],
  tube: [0xa77ad6, 0xc79be8, 0xcfd86a, 0x8e6ac8],
  anemone: [0xff6fa5, 0xd85ac8, 0xa878f0, 0x4fc8a8, 0xff8f6a],
  star: [0xf07a40, 0xe86a8a, 0xb07ad8, 0xf0a040],
  base: BASE_PALETTE,
};
const WEIGHTS: [CoralKind, number][] = [['branch', 6], ['table', 4], ['tube', 4], ['brain', 2]];
/** How far each piece's foot reaches from its middle at scale 1 (the rocky base is a little wider). */
const FOOT: Partial<Record<CoralKind, number>> = { branch: 0.16, table: 0.15, tube: 0.15, brain: 0.21, anemone: 0.13 };
/** Reef pieces that may perch on top of a boulder. */
const PERCH: CoralKind[] = ['branch', 'table', 'tube', 'anemone', 'anemone'];

export interface ReefPatch {
  x: number;
  z: number;
  r: number;
}

/**
 * Coral reef patches in the shallow turquoise water around the island: branching, brain and table
 * corals, swaying sea fans, tube sponges and soft corals in bright colours, clustered into reefs.
 */
export class Coral {
  readonly group = new THREE.Group();
  private reefCandidates: ReefPatch[] = [];
  get patches():ReefPatch[]{return this.reefCandidates.filter(p=>habitatFit(this.world,p.x,p.z,.2)>0);}
  readonly grassPatches: ReefPatch[] = [];
  private instances: HabitatInstances;
  /** The pairs of clownfish living in the reefs' big anemones (drawn and moved by whoever owns the scene). */
  readonly clownfish: Clownfish;
  /** Bubbles rising from the reefs (drawn by whoever owns the scene: not one of this group's instanced meshes). */
  readonly bubbles: ReefBubbles;

  constructor(private world: World, rocks: {x:number;z:number}[] = []) {
    this.instances=new HabitatInstances(world);
    const rng = new RNG(world.seed * 41 + 13);
    const w = world;
    // Stable candidates per tile: terrain edits never consume another tile's random stream.
    for(let z=0;z<w.N;z+=14)for(let x=0;x<w.N;x+=14){
      const tile=new RNG(w.seed*41+x*173+z*397+13);
      const px=w.centerX(x)+tile.range(2,11),pz=w.centerZ(z)+tile.range(2,11);
      if(tile.chance(.15))this.reefCandidates.push({x:px,z:pz,r:tile.range(2,3.2)});
      if(tile.chance(.32))this.grassPatches.push({x:px,z:pz,r:tile.range(1.5,2.8)});
    }
    // Small groups beside existing submerged rocks, with room left around most rocks.
    for(let k=0;k<rocks.length;k++){
      const rr=new RNG(w.seed*31+k*619+11);if(!rr.chance(.35))continue;
      const a=rr.range(0,Math.PI*2),d=rr.range(1.2,2.1);
      this.reefCandidates.push({x:rocks[k].x+Math.sin(a)*d,z:rocks[k].z+Math.cos(a)*d,r:1.2});
    }
    const geos: Record<CoralKind, THREE.BufferGeometry> = { branch: branchingCoral(7, { height: 0.5, depth: 2, sway: NOD }), brain: brainCoral(), table: tableCoral(3), tube: tubeCoral(), anemone: anemone(), weed: kelp(), rock: mossyRock(), star: starfish(), base: coralBaseGeometry() };
    const items: Record<CoralKind, { m: THREE.Matrix4; c: THREE.Color; lift?: number }[]> = { branch: [], brain: [], table: [], tube: [], anemone: [], weed: [], rock: [], star: [], base: [] };
    /** A piece's colour: one of its kind's, a touch lighter or darker. */
    const tint = (kind: CoralKind, rng: RNG) => {
      const pal = PALETTE[kind], c = new THREE.Color(pal[Math.floor(rng.next() * pal.length)]);
      return c.multiplyScalar(0.9 + rng.next() * 0.14);
    };
    const tot = WEIGHTS.reduce((s, [, n]) => s + n, 0);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const patch of this.reefCandidates) {
      const rng = new RNG(w.seed*43+Math.round(patch.x*31)+Math.round(patch.z*173));
      const n = rng.int(18, 30);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * patch.r;
        const x = patch.x + Math.cos(a) * d, z = patch.z + Math.sin(a) * d;
        const bed = w.heightAt(x, z);

        let r = rng.next() * tot, kind: CoralKind = 'branch';
        for (const [kk, wt] of WEIGHTS) if ((r -= wt) <= 0) {
          kind = kk;
          break;
        }
        // Bigger pieces toward the middle of the reef.
        const s = rng.range(0.7, 1.2) * (1.25 - (d / patch.r) * 0.5) * (kind === 'branch' ? 1.35 : kind === 'table' ? 1.1 : 1);
        e.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
        q.setFromEuler(e);
        const m = new THREE.Matrix4().compose(p.set(x, bed - 0.02, z), q, sc.setScalar(s));
        items[kind].push({ m, c: tint(kind, rng) });
      }
    }
    // One big anemone in each reef, standing upright in a clearing among the boulders: home to a pair of clownfish.
    const hosts: AnemoneHost[] = [], hostOf = new Map<ReefPatch, AnemoneHost>();
    for (const patch of this.reefCandidates) {
      const rng = new RNG(w.seed * 67 + Math.round(patch.x * 59) + Math.round(patch.z * 131));
      const a = rng.range(0, Math.PI * 2), d = patch.r * rng.range(0.25, 0.6), s = rng.range(1.7, 2.2);
      const x = patch.x + Math.cos(a) * d, z = patch.z + Math.sin(a) * d;
      const m = new THREE.Matrix4().compose(p.set(x, w.heightAt(x, z) - 0.02, z), q.setFromEuler(e.set(0, rng.range(0, Math.PI * 2), 0)), sc.setScalar(s));
      items.anemone.push({ m, c: tint('anemone', rng) });
      hosts.push({ x, z, s });
      hostOf.set(patch, hosts[hosts.length - 1]);
    }
    // And more through the big reef fields of the sea floor (Seabed.ts keeps a clearing round each).
    const field = new Simplex2(new RNG(w.seed * 7 + 3)), S = 6.5;
    for (let gz = Math.ceil(-w.half / S); gz < w.half / S; gz++) for (let gx = Math.ceil(-w.half / S); gx < w.half / S; gx++) {
      const rng = new RNG(Math.floor(hash2(gx, gz, w.seed * 13 + 71233) * 4294967296));
      const x = (gx + rng.range(-0.4, 0.4)) * S, z = (gz + rng.range(-0.4, 0.4)) * S;
      if (reefField(field, x, z) < 0.5 || !rng.chance(0.75)) continue;
      const s = rng.range(1.8, 2.3);
      const m = new THREE.Matrix4().compose(p.set(x, w.heightAt(x, z) - 0.02, z), q.setFromEuler(e.set(0, rng.range(0, Math.PI * 2), 0)), sc.setScalar(s));
      items.anemone.push({ m, c: tint('anemone', rng) });
      hosts.push({ x, z, s });
    }
    geos.anemone.computeBoundingBox();
    this.clownfish = new Clownfish(w, hosts, Math.max(0.05, geos.anemone.boundingBox!.max.y));
    // Irregular drifts: fewer and smaller clumps towards the edge, with deliberate gaps.
    for(const patch of this.grassPatches){
      const rr=new RNG(w.seed*47+Math.round(patch.x*83)+Math.round(patch.z*137));
      for(let k=0;k<20&&items.weed.length<1600;k++){
        const a=rr.range(0,Math.PI*2),d=Math.sqrt(rr.next())*patch.r;
        const x=patch.x+Math.cos(a)*d,z=patch.z+Math.sin(a)*d,scale=rr.range(.6,1.1)*(1-d/patch.r*.4);
        const heading=rr.range(0,Math.PI*2),color=new THREE.Color(PALETTE.weed[rr.int(0,PALETTE.weed.length-1)]).multiplyScalar(rr.range(.8,1));
        if(rr.next()>.8-d/patch.r*.35)continue;
        const m=new THREE.Matrix4().compose(p.set(x,w.heightAt(x,z)-.02,z),q.setFromEuler(e.set(0,heading,0)),sc.setScalar(scale));
        items.weed.push({m,c:color});
      }
    }
    // Low submerged boulder clusters give reefs a rocky base without blocking the surface.
    for (const patch of this.reefCandidates) {
      const rng=new RNG(w.seed*61+Math.round(patch.x*73)+Math.round(patch.z*257));
      for (let k = 0, n = rng.int(8, 14); k < n; k++) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (patch.r + 1);
        const x = patch.x + Math.cos(a) * d, z = patch.z + Math.sin(a) * d;
        const bed = w.heightAt(x, z);

        const size = rng.range(0.4, 0.95), tall = size * rng.range(0.42, 0.6), turn = rng.range(0, Math.PI * 2), wide = rng.range(0.7, 1.3);
        // No boulder on top of the reef's big anemone.
        const host = hostOf.get(patch);
        if (host && Math.hypot(x - host.x, z - host.z) < size * 1.15 + 0.25 * host.s) continue;
        q.setFromEuler(e.set(0, turn, 0));
        const m = new THREE.Matrix4().compose(p.set(x, bed - 0.08, z), q,
          sc.set(size, tall, size * wide));
        items.rock.push({ m, c: tint('rock', rng) });
        // The bigger boulders often carry a coral on their crown.
        if (size > 0.6 && rng.chance(0.55)) {
          const kind = PERCH[rng.int(0, PERCH.length - 1)];
          const lift = tall * 0.88;
          const pm = new THREE.Matrix4().compose(p.set(x, bed - 0.02 + lift, z), q.setFromEuler(e.set(0, rng.range(0, Math.PI * 2), 0)), sc.setScalar(size * rng.range(0.8, 1.1) * (kind === 'anemone' ? 1.5 : 1)));
          items[kind].push({ m: pm, c: tint(kind, rng), lift });
        }
      }
      // Starfish on the sand round the reef.
      for (let k = 0, n = rng.int(1, 4); k < n; k++) {
        const a = rng.range(0, Math.PI * 2), d = patch.r + rng.range(0.2, 1.8);
        const x = patch.x + Math.cos(a) * d, z = patch.z + Math.sin(a) * d;
        const m = new THREE.Matrix4().compose(p.set(x, w.heightAt(x, z) - 0.005, z), q.setFromEuler(e.set(0, rng.range(0, Math.PI * 2), 0)), sc.setScalar(rng.range(0.8, 1.3)));
        items.star.push({ m, c: tint('star', rng) });
      }
    }
    // Every coral standing on the sand grows from a low mound of old reef rock (not the ones
    // perched on boulders: they have rock under them already).
    const at = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3();
    for (const kind of Object.keys(FOOT) as CoralKind[]) {
      for (const it of items[kind]) {
        if (it.lift) continue;
        it.m.decompose(at, turn, size);
        items.base.push(coralBase(at.x, w.heightAt(at.x, at.z), at.z, FOOT[kind]! * size.x));
      }
    }
    // Clear water over each reef (the sea shader lets more of the floor's colour through), as over the tube coral.
    for (const patch of this.patches) {
      const [cx, cz] = w.cellOf(patch.x, patch.z), R = Math.ceil(patch.r + 2);
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const d = Math.hypot(w.centerX(cx + dx) - patch.x, w.centerZ(cz + dz) - patch.z);
        const i = w.idx(cx + dx, cz + dz);
        w.clearWater[i] = Math.max(w.clearWater[i], THREE.MathUtils.clamp(1.25 - (d - patch.r) / 2, 0, 1));
      }
    }
    this.bubbles = new ReefBubbles(w, this.patches);
    const mat = habitatMaterial(true),grassMat=habitatMaterial(),starMat=habitatMaterial(true,true);
    // The starfish creep about on the sand, keeping out from under the reefs.
    this.stars = new StarfishCrawl(w, (x, z) => this.patches.some((r) => Math.hypot(r.x - x, r.z - z) < r.r + 0.15), w.seed + 11);
    grassMat.side=THREE.DoubleSide;grassMat.forceSinglePass=true;
    // Split each kind into spatial chunks so reefs off screen are culled (one island-wide mesh
    // per kind would always be drawn).
    const CH = 24;
    const pos = new THREE.Vector3();
    for (const kind of Object.keys(items) as CoralKind[]) {
      const buckets = new Map<string, { m: THREE.Matrix4; c: THREE.Color; lift?: number }[]>();
      for (const it of items[kind]) {
        pos.setFromMatrixPosition(it.m);
        const k = `${Math.floor(pos.x / CH)},${Math.floor(pos.z / CH)}`;
        let b = buckets.get(k);
        if (!b) buckets.set(k, (b = []));
        b.push(it);
      }
      for (const list of buckets.values()) this.addChunk(geos[kind], kind==='weed'?grassMat:kind==='star'?starMat:mat, list,kind);
    }
    // The artist's starfish and anemone replace the stand-ins once they load. The anemone keeps
    // the stand-in's footprint and height, so the clownfish (sized off its top) still fit.
    const swap = (kind: CoralKind, m: THREE.BufferGeometry) => { for (const o of this.group.children) if (o.name === `habitat-${kind}`) (o as THREE.InstancedMesh).geometry = m; };
    habitatCreature('starfish', geos.star).then((m) => this.stars.setGeometry(m)).catch(() => undefined);
    habitatCreature('sea-anemone', geos.anemone, { fitHeight: true, sway: (p) => Math.max(0, p.y - 0.07) * 4 }).then((m) => swap('anemone', m)).catch(() => undefined);
  }

  private addChunk(geo: THREE.BufferGeometry, mat: THREE.Material, list: { m: THREE.Matrix4; c: THREE.Color; lift?: number }[],kind:CoralKind): void {
    {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, it.c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.renderOrder=8;mesh.name=`habitat-${kind}`;
      this.group.add(mesh);
      if (kind === 'star') this.stars.add(mesh);
      geo.computeBoundingBox();
      this.instances.add(mesh,list.map(it=>it.m.clone()),Math.max(.05,geo.boundingBox!.max.y),kind==='rock'?.4:.25,{lifts:list.map(it=>it.lift??0)});
    }
  }

  refresh(x0:number,z0:number,x1:number,z1:number):void{this.instances.refresh(x0,z0,x1,z1);this.clownfish.refresh();}
  setPreset(preset:PresetName):void{habitatPreset(this.group,preset);this.range={low:24,medium:36,high:48,ultra:60}[preset];}
  private range=36;
  /** Hide patches beyond the fade-out distance from the camera. */
  cull(cam:THREE.Vector3):void{this.instances.cull(cam,this.range);this.stars.update(FX.uTime.value);}
  /** The starfish creeping round the reefs. */
  stars!: StarfishCrawl;
  hotspots():ReefPatch[]{return [...this.patches,...this.grassPatches].filter(p=>habitatFit(this.world,p.x,p.z,.2)>0);}

  /** Grid cells covered by reefs (boats steer around them). */
  cells(): number[] {
    const out: number[] = [];
    for (const p of this.patches) {
      if(!habitatFit(this.world,p.x,p.z,.2))continue;
      for (let dz = -Math.ceil(p.r); dz <= Math.ceil(p.r); dz++) {
        for (let dx = -Math.ceil(p.r); dx <= Math.ceil(p.r); dx++) {
          if (dx * dx + dz * dz > p.r * p.r) continue;
          const i = this.world.cellIndexAt(p.x + dx, p.z + dz);
          if (i >= 0) out.push(i);
        }
      }
    }
    return out;
  }
}
