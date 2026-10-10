import { Demolition } from './Demolition';
import { villageFire, fireEmbers } from './VillageFire';
import * as THREE from 'three';
import { processMedicine } from './Herbalist';
import { needsStonemason, masonryCost, STONEMASON, BOAT_WORKSHOP } from '../config';
import { BUILDINGS, BuildingDef, BuildingKey, ECONOMY, FARM, HOMES, JETTY, TEMPLE, FARM_TYPES, isFarm } from '../config';
import { Economy, Cost } from '../economy/Economy';
import { buildingMaterial, canopyMaterial, fireMaterial, flameMaterial, FX } from '../render/materials';
import { Terrain } from '../terrain/Terrain';
import { Vegetation } from '../vegetation/Vegetation';
import { World } from '../world/World';
import { RNG } from '../world/rng';
import * as models from './models';

/** Flame size per building; fires are visible only from dusk until dawn. */
/** Triangles smaller than this (m²) are left out of a building's far-away model. */
const LOD_MIN_AREA = 0.002;
const FLAME_SCALE: Partial<Record<BuildingKey, number>> = { campfire: 0.85, bonfire: 1, firepit: 0.9, torch: 1.25, greathall: 3.0, watchtower: 1.1, greattemple: 1.5 };
import { Particles } from '../render/Particles';
import { GeoBuilder } from '../render/GeoBuilder';
import { FireLights, FireSpot } from './FireLights';

/** Door direction per rotation (door faces +z at rot 0). */
export const ROT_DIR: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export interface Torch {
  pos: THREE.Vector3;
  flame: THREE.Mesh;
  phase: number;
}

export class Building {
  id: number;
  key: BuildingKey;
  def: BuildingDef;
  cx: number;
  cz: number;
  /** Footprint in world cells after rotation. */
  w: number;
  d: number;
  rot: number;
  layer: number;
  x: number;
  z: number;
  y: number;
  complete = false;
  /** Construction (or upgrade) progress 0..1. */
  progress = 0;
  tier = 1;
  upgrading = false;
  builders = new Set<number>();
  workers = new Set<number>();
  residents: number[] = [];
  group = new THREE.Group();
  foundation!: THREE.Mesh;
  scaffold!: THREE.Mesh;
  finished!: THREE.Mesh;
  torches: Torch[] = [];
  /** Door / access point in world space (where islanders walk to). */
  door = { x: 0, z: 0 };
  // Farm
  growth = 0;
  stock = 0;
  /** Paid monument phases; undefined means a legacy site paid its full cost up front. */
  monumentPaid?: number;
  /** Goods displayed for exchange; included in the village stockpile, not extra resources. */
  marketStock: Partial<Record<import('../config').ResourceKey, number>> = {};
  tendTimer = 0;
  blessTimer = 0;
  crops: THREE.Mesh | null = null;
  /** The finished model at full detail (the mesh shows a simpler copy when far away). */
  finishedHi: THREE.BufferGeometry | null = null;
  /** Far from the camera: drawn with the simpler model and crops. */
  lodFar = false;
  // Stores
  fills: THREE.Mesh[] = [];
  // Jetty
  dockX = 0;
  dockZ = 0;
  boatBuild = 0;
  boatSail = false;
  boatsWanted = 0;
  boats: number[] = [];
  /** Trade boats moored at a Trade Dock. */
  tradeBoats = 0;
  // Kennel: a litter on the way (seconds), rest before the next, and how its dogs behave.
  breedT = 0;
  breedCool = 0;
  dogRole: 'roam' | 'guard' = 'roam';
  // War room: queued trainees
  training: { id: number; t: number; type: 'jaguar' | 'eagle' }[] = [];
  // Great Hall: the bell (swings while ringing, seconds left).
  bell: THREE.Object3D | null = null;
  ring = 0;
  // Butcher
  penX = 0;
  penZ = 0;
  meatStock = 0;

  constructor(id: number, key: BuildingKey, cx: number, cz: number, rot: number, layer: number, world: World) {
    this.id = id;
    this.key = key;
    this.def = BUILDINGS[key];
    this.cx = cx;
    this.cz = cz;
    this.rot = rot;
    const [sw, sd] = this.def.size;
    this.w = rot % 2 ? sd : sw;
    this.d = rot % 2 ? sw : sd;
    this.layer = layer;
    this.x = cx + this.w / 2 - world.half;
    this.z = cz + this.d / 2 - world.half;
    this.y = world.layerY(layer);
    const [dx, dz] = ROT_DIR[rot];
    const depth = sd / 2 + 0.55;
    this.door = { x: this.x + dx * depth, z: this.z + dz * depth };
  }

  get dir(): [number, number] {
    return ROT_DIR[this.rot];
  }

  /** Model-local (x, z) to world (x, z), matching the group's rotation. */
  local(lx: number, lz: number): [number, number] {
    const t = (this.rot * Math.PI) / 2;
    const c = Math.cos(t), s = Math.sin(t);
    return [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
  }

  /** World (x, z) to model-local (x, z): the inverse of local(). */
  toLocal(wx: number, wz: number): [number, number] {
    const t = (this.rot * Math.PI) / 2;
    const c = Math.cos(t), s = Math.sin(t);
    const dx = wx - this.x, dz = wz - this.z;
    return [dx * c - dz * s, dx * s + dz * c];
  }

  /** Builders still wanted on the construction site. */
  get needsBuilders(): number {
    if (this.complete && !this.upgrading) return 0;
    return Math.max(0, this.def.builders - this.builders.size);
  }

  get housing(): number {
    if (!this.complete) return 0;
    if (this.key === 'home') return HOMES.housing[Math.min(HOMES.housing.length, this.tier) - 1];
    return this.def.housing ?? 0;
  }

  /** House level shown to the player (hut = 1, home tiers = 2–5). */
  get houseLevel(): number {
    return this.key === 'hut' ? 1 : this.key === 'home' ? this.tier + 1 : 0;
  }

  get label(): string {
    if (this.key === 'temple') return this.tier === 3 ? 'Great Pyramid' : `Temple (tier ${this.tier})`;
    if (this.key === 'home') return `Home (level ${this.tier + 1})`;
    if (this.key === 'hut') return 'Hut (level 1)';
    return this.def.name;
  }
}

/**
 * Placement rules, ghost previews, staged construction visuals (foundation → scaffolding → finished),
 * temple tiers, farm growth, storage fill visuals and night-time torches.
 */
/** Simpler copies of models and crops for buildings far from the camera. */
const LO_GEOS = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** Far-away crops are shared between farms like their full crops. */
const CROP_LOS = new Set<THREE.BufferGeometry>();

/**
 * A building model for far away: the same vertices without its smallest triangles (pots, trim,
 * pegs and other details too small to see from there), so it costs no extra memory.
 */
export function modelLo(hi: THREE.BufferGeometry): THREE.BufferGeometry {
  let lo = LO_GEOS.get(hi);
  if (lo) return lo;
  const P = hi.getAttribute('position');
  const I = hi.index;
  const n = I ? I.count / 3 : P.count / 3;
  const keep: number[] = [];
  const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const i0 = I ? I.getX(t * 3) : t * 3, i1 = I ? I.getX(t * 3 + 1) : t * 3 + 1, i2 = I ? I.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(P, i0);
    b2.fromBufferAttribute(P, i1).sub(a);
    c.fromBufferAttribute(P, i2).sub(a);
    if (b2.cross(c).length() * 0.5 >= LOD_MIN_AREA) keep.push(i0, i1, i2);
  }
  lo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(hi.attributes)) lo.setAttribute(name, attr);
  lo.setIndex(keep);
  lo.boundingSphere = hi.boundingSphere;
  lo.boundingBox = hi.boundingBox;
  LO_GEOS.set(hi, lo);
  return lo;
}

/**
 * Crops for far away: the field cut into small squares, each one lump the height and colour of
 * the plants in it (a few hundred triangles instead of thousands of leaves).
 */
export function cropLo(hi: THREE.BufferGeometry): THREE.BufferGeometry {
  let lo = LO_GEOS.get(hi);
  if (lo) return lo;
  const P = hi.getAttribute('position'), C = hi.getAttribute('color'), V = hi.getAttribute('aVeg');
  const cell = 0.32;
  const cells = new Map<string, { x: number; z: number; xx: number; zz: number; top: number; r: number; g: number; b: number; w: number; n: number }>();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let e = cells.get(k);
    if (!e) cells.set(k, (e = { x: 0, z: 0, xx: 0, zz: 0, top: 0, r: 0, g: 0, b: 0, w: 0, n: 0 }));
    e.x += x; e.z += z; e.xx += x * x; e.zz += z * z; e.top = Math.max(e.top, y); e.n++;
    // Leaves make up most of what is seen from afar: they count for more than cobs and stems.
    const wgt = V && V.getY(i) > 0.5 ? 4 : 1;
    if (C) { e.r += C.getX(i) * wgt; e.g += C.getY(i) * wgt; e.b += C.getZ(i) * wgt; e.w += wgt; }
  }
  const gb = new GeoBuilder();
  const lump = new THREE.IcosahedronGeometry(0.5, 0);
  for (const e of cells.values()) {
    if (e.n < 6 || e.top < 0.03) continue;
    const h = e.top * 0.85;
    const mx = e.x / e.n, mz = e.z / e.n;
    // As wide as the plants in this square actually spread (soil shows between thin rows).
    const sx = Math.min(cell, 2.2 * Math.sqrt(Math.max(0, e.xx / e.n - mx * mx)));
    const sz = Math.min(cell, 2.2 * Math.sqrt(Math.max(0, e.zz / e.n - mz * mz)));
    const w = Math.max(1e-6, e.w);
    // A solid lump catches more sun than thin leaves seen edge-on: a shade darker to match.
    gb.add(lump, { color: new THREE.Color(e.r / w, e.g / w, e.b / w).multiplyScalar(0.72), leaf: 1 }, new THREE.Matrix4().compose(
      new THREE.Vector3(mx, h / 2, mz), new THREE.Quaternion(), new THREE.Vector3(Math.max(0.05, sx), h, Math.max(0.05, sz))));
  }
  lo = gb.build();
  LO_GEOS.set(hi, lo);
  CROP_LOS.add(lo);
  return lo;
}

/** Swap in a building's new finished model (an upgrade), freeing the old one and its simple copy. */
function replaceFinished(b: Building, geo: THREE.BufferGeometry): void {
  const old = b.finishedHi ?? b.finished.geometry;
  const lo = LO_GEOS.get(old);
  old.dispose();
  lo?.dispose();
  LO_GEOS.delete(old);
  b.finishedHi = geo;
  b.finished.geometry = b.lodFar ? modelLo(geo) : geo;
}

export class BuildingSystem {
  readonly group = new THREE.Group();
  private demolitions: Demolition[] = [];
  list: Building[] = [];
  private nextId = 1;
  private ghost: THREE.Group | null = null;
  private ghostKey: BuildingKey | null = null;
  private ghostRot = -1;
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x9df08a, transparent: true, opacity: 0.45, depthWrite: false });
  private ghostOutlineGeo: THREE.BufferGeometry | null = null;
  private ghostOutlineMat = new THREE.LineBasicMaterial({ color: 0x9df08a, depthTest: false, transparent: true, opacity: 0.95 });
  private ringGeo = new THREE.RingGeometry(0.5, 0.56, 4, 1).rotateX(-Math.PI / 2);
  /** Footprint squares, the walkway ring and a hut's room to grow into a Home. */
  private spaceMesh = (() => {
    const geo = new THREE.PlaneGeometry(0.86, 0.86).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false });
    const m = new THREE.InstancedMesh(geo, mat, 128);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(128 * 3), 3);
    m.frustumCulled = false;
    m.renderOrder = 19;
    m.count = 0;
    m.visible = false;
    return m;
  })();
  private spaceCol = new THREE.Color();
  private spaceM4 = new THREE.Matrix4();
  /** God mode's "instant build": new buildings and upgrades finish the moment they are placed. */
  instantBuild: () => boolean = () => false;
  private flameGeo = models.flameGeometry();
  /** Firelight: a glow under every lit fire and real lights on the ones that matter most. */
  readonly fireLights = new FireLights();
  private fireSpots: FireSpot[] = [];
  private spotTimer = 0;
  private cropGeos = new Map<string, THREE.BufferGeometry>();
  private lodTimer = 0;
  /** Camera position and the preset's detail distance (set by the game each frame). */
  readonly camPos = new THREE.Vector3(0, 1e4, 0);
  lodDist = 60;
  /** Chimney and rack smoke from smokehouses. */
  private smoke = new Particles(360, 0xc9c2ba, 0.6);
  private smokeAcc = 0;
  private logGeos = [models.logPileGeometry(1), models.logPileGeometry(2), models.logPileGeometry(3)];
  private stoneGeos = [models.stonePileGeometry(4), models.stonePileGeometry(5)];
  private basketGeos = [models.basketGeometry(0), models.basketGeometry(1), models.basketGeometry(2)];
  private bellGeo = models.hallBellGeometry();
  /** Called when a building completes (for milestones, sounds, AI). */
  earnedWorkshopTier: () => number = () => 0;
  progressionRequirement: (key: BuildingKey) => string = () => '';
  progressionUpgrade: (b: Building) => string = () => '';
  recordProgress: (event:string) => void = () => {};
  recordPrayer: (seconds:number) => void = () => {};
  onComplete: (b: Building) => void = () => {};
  /** Called when a building is removed (pens release animals, etc.). */
  onRemove: (b: Building) => void = () => {};

  constructor(private world: World, private veg: Vegetation, private eco: Economy, private terrain: Terrain, private scene: THREE.Scene) {
    this.group.add(this.smoke.points);
    this.scene.add(this.spaceMesh);
    this.group.add(this.fireLights.group);
  }

  byId(id: number): Building | undefined {
    return this.list.find((b) => b.id === id);
  }

  at(cellIndex: number): Building | undefined {
    const o = this.world.occ[cellIndex];
    return o ? this.byId(o - 1) : undefined;
  }

  of(key: BuildingKey, completeOnly = true): Building[] {
    return this.list.filter((b) => b.key === key && (!completeOnly || b.complete));
  }

  // ------------- Placement -------------

  /** Best jetty rotation at a position: the one whose deck runs over the most water. */
  jettyRot(cx: number, cz: number): number {
    let best = 0, bestN = -1;
    for (let r = 0; r < 4; r++) {
      const n = this.jettyWater(cx, cz, r);
      if (n > bestN) {
        bestN = n;
        best = r;
      }
    }
    return best;
  }

  private jettyWater(cx: number, cz: number, rot: number): number {
    const w = this.world;
    const [dx, dz] = ROT_DIR[rot];
    const s = BUILDINGS.jetty.size[0];
    // Centre of the front edge.
    const fx = cx + s / 2 - 0.5 + dx * (s / 2 + 0.5), fz = cz + s / 2 - 0.5 + dz * (s / 2 + 0.5);
    let n = 0;
    for (let k = 1; k <= JETTY.length; k++) {
      const x = Math.round(fx + dx * k), z = Math.round(fz + dz * k);
      if (w.inBounds(x, z) && w.layer[w.idx(x, z)] <= 0) n++;
    }
    return n;
  }

  /** Water cells (sea, river or pool) in the two-cell ring around a footprint. */
  private waterAround(cx: number, cz: number, w: number, d: number): number {
    const W = this.world;
    let n = 0;
    for (let z = cz - 2; z < cz + d + 2; z++) {
      for (let x = cx - 2; x < cx + w + 2; x++) {
        const footprint = x >= cx && x < cx + w && z >= cz && z < cz + d;
        if (!W.inBounds(x, z)) continue;
        const i = W.idx(x, z);
        if (W.layer[i] <= 0 || !Number.isNaN(W.riverY[i])) n++;
      }
    }
    return n;
  }

  get hasCampfire(): boolean {
    return this.list.some((b) => b.key === 'campfire');
  }

  /** Free beds across all finished homes and huts. */
  get freeBeds(): number {
    return this.list.reduce((s, b) => s + (b.complete ? Math.max(0, b.housing - b.residents.length) : 0), 0);
  }

  /** Finish a building at once (the founding campfire). */
  completeNow(b: Building): void {
    if (!b.complete) this.finish(b);
  }

  /**
   * Can this building go here? `moving` is a building being moved or rotated: its own cells count
   * as free and it costs nothing.
   */
  boatRequirement(level: number): string {
    if(this.eco.godMode)return '';
    const tier=Math.max(0,...this.list.filter(b=>b.key==='boatworkshop'&&b.complete).map(b=>b.tier));
    return tier>=level?'':level===1?'Complete a coastal Boat Workshop first':level===2?'Research larger boats at the Boat Workshop (level 2)':'Research trade boats at the Boat Workshop (level 3)';
  }

  constructionRequirement(key: BuildingKey): string {
    if (!this.eco.godMode) { const reason=this.progressionRequirement?.(key); if(reason)return reason; }
    if (this.eco.godMode || !needsStonemason(key)) return '';
    const tier = Math.max(this.earnedWorkshopTier?.() ?? 0, ...this.list.filter(b => b.key === 'stonemason' && b.complete).map(b => b.tier));
    if (tier === 0) return 'Complete a Stonemason’s Workshop first';
    if (key === 'temple' && tier < 2) return 'Stonemason upgrade 1 required: unlock Temples';
    if (key === 'greattemple' && tier < 4) return 'Stonemason upgrade 3 required: unlock the Great Temple';
    return '';
  }

  canPlace(key: BuildingKey, cx: number, cz: number, rot: number, moving?: Building): { ok: boolean; reason: string } {
    if (!moving && this.constructionRequirement(key)) return { ok: false, reason: this.constructionRequirement(key) };
    if (!moving) return this.siteCheck(key, cx, cz, rot);
    const cells: number[] = [];
    for (let z = moving.cz; z < moving.cz + moving.d; z++) for (let x = moving.cx; x < moving.cx + moving.w; x++) cells.push(this.world.idx(x, z));
    for (const i of cells) this.world.occ[i] = 0;
    const res = this.siteCheck(key, cx, cz, rot, moving);
    for (const i of cells) this.world.occ[i] = moving.id + 1;
    return res;
  }

  /**
   * Torches, farms and docks need no walkway ring: people walk past or through them (and docks sit
   * on the shoreline). Everything else keeps a one-square path clear all round.
   */
  private static open(key: BuildingKey): boolean {
    return key === 'torch' || key === 'market' || isFarm(key) || key === 'jetty' || key === 'tradedock';
  }

  /**
   * The area a building keeps for itself: its footprint, or for a hut the 3×3 Home it grows into
   * (as [x0, z0, x1, z1), exclusive max), plus the walkway margin kept clear around that.
   */
  private space(key: BuildingKey, cx: number, cz: number, w: number, d: number): { x0: number; z0: number; x1: number; z1: number; m: number } {
    const big = key === 'hut' ? BUILDINGS.home.size[0] : 0;
    return { x0: cx, z0: cz, x1: cx + Math.max(w, big), z1: cz + Math.max(d, big), m: BuildingSystem.open(key) ? 0 : 1 };
  }

  /** Is (x, z) a cell a hut at (cx, cz) would need for its Home but can't have? */
  private growBlocked(x: number, z: number, layer: number): boolean {
    const W = this.world;
    if (!W.inBounds(x, z)) return true;
    const i = W.idx(x, z);
    return !!W.occ[i] || W.layer[i] !== layer || !Number.isNaN(W.riverY[i]);
  }

  nearSea(cx:number,cz:number,w:number,d:number):boolean {
    for(let z=cz-6;z<cz+d+6;z++)for(let x=cx-6;x<cx+w+6;x++) {
      if(!this.world.inBounds(x,z))continue;
      const dx=Math.max(cx-x,0,x-(cx+w-1)),dz=Math.max(cz-z,0,z-(cz+d-1));
      if(dx*dx+dz*dz<=36 && this.world.layer[this.world.idx(x,z)]<=0)return true;
    }
    return false;
  }

  private siteCheck(key: BuildingKey, cx: number, cz: number, rot: number, movingB?: Building): { ok: boolean; reason: string } {
    const moving = !!movingB;
    const def = BUILDINGS[key];
    if (key === 'campfire' && this.hasCampfire && !moving) return { ok: false, reason: 'The village already has its fire' };
    if (key !== 'campfire' && !this.hasCampfire) return { ok: false, reason: 'Found your village first: place the campfire' };
    const [sw, sd] = def.size;
    const w = rot % 2 ? sd : sw, d = rot % 2 ? sw : sd;
    const f = this.world.isFlatFree(cx, cz, w, d);
    let fixed = false;
    for (let z = cz; z < cz + d; z++) for (let x = cx; x < cx + w; x++) {
      if (this.world.inBounds(x, z) && this.world.blockFixed[this.world.idx(x, z)]) fixed = true;
    }
    if (!f.ok || fixed) {
      // Distinguish "not flat" from "occupied".
      for (let z = cz; z < cz + d; z++) for (let x = cx; x < cx + w; x++) {
        if (!this.world.inBounds(x, z)) return { ok: false, reason: 'The footprint extends beyond the island: move it inward' };
        const i = this.world.idx(x, z);
        if (this.world.blockFixed[i]) return { ok: false, reason: 'A natural landmark occupies this ground' };
        if (this.world.occ[i]) return { ok: false, reason: `Footprint overlaps ${this.byId(this.world.occ[i] - 1)?.label ?? 'an existing building'}: move it clear` };
        if (this.world.layer[i] < 1 || !Number.isNaN(this.world.riverY[i])) return { ok: false, reason: 'Water or a river crosses the footprint: choose dry ground' };
      }
      return { ok: false, reason: 'The footprint crosses different ground heights: sculpt it level first' };
    }
    if ((key === 'jetty' || key === 'tradedock') && this.jettyWater(cx, cz, rot) < JETTY.length - 2) return { ok: false, reason: `A ${key === 'jetty' ? 'jetty' : 'trade dock'} must face open water at the shore` };
    if (key === 'boatworkshop' && !this.nearSea(cx,cz,w,d)) return {ok:false,reason:'Build the Boat Workshop on dry land within 6 paces of the sea'};
    if (key === 'chinampa' && this.waterAround(cx, cz, w, d) < 4) return { ok: false, reason: 'A chinampa must be built right beside water (river, pool or shore)' };
    // Room to grow and walk: a hut keeps the flat 3×3 it will become a Home on, and buildings keep
    // a clear square all round so islanders and animals can always get past (and upgrades fit).
    const sp = this.space(key, cx, cz, w, d);
    const layer = this.world.layer[this.world.idx(cx, cz)];
    for (let z = sp.z0; z < sp.z1; z++) for (let x = sp.x0; x < sp.x1; x++) {
      if (x < cx + w && z < cz + d) continue;
      if (this.growBlocked(x, z, layer)) return { ok: false, reason: 'The gold expansion area must stay level, dry and clear so this hut can grow into a Home' };
    }
    const nOpen = sp.m === 0;
    for (const e of this.list) {
      if (e === movingB) continue;
      const es = this.space(e.key, e.cx, e.cz, e.w, e.d);
      const gap = nOpen || es.m === 0 ? 0 : 1;
      if (sp.x0 - gap < es.x1 && sp.x1 + gap > es.x0 && sp.z0 - gap < es.z1 && sp.z1 + gap > es.z0) {
        return { ok: false, reason: gap ? `Too close to ${e.label}: keep the pale walkway clear` : `The expansion area overlaps ${e.label}: leave room for it to grow` };
      }
    }
    if (!moving && !this.eco.canAfford(def.cost)) {
      const shortages: string[] = [];
      const need = (label: string, required: number, available: number) => {
        if (required > available) shortages.push(`${Math.ceil(required - available)} ${label}`);
      };
      need('wood', def.cost.wood, this.eco.res.wood);
      need('stone', def.cost.stone, this.eco.res.stone);
      need('belief', def.cost.belief, this.eco.res.belief);
      need('carved stone', def.cost.carvedStone ?? 0, this.eco.goods.carvedstone);
      return { ok: false, reason: `Need ${shortages.join(', ')} more to build` };
    }
    return { ok: true, reason: '' };
  }

  /** Buildings that can be turned or moved once placed (docks are tied to their shore). */
  canRelocate(b: Building): boolean {
    return b.key !== 'jetty' && b.key !== 'tradedock';
  }

  /** Called after a building is moved or rotated (pens, paths, grass). */
  onMoved: (b: Building) => void = () => {};

  /** Turn a building a quarter turn about its centre. */
  rotate(b: Building): { ok: boolean; reason: string } {
    if (!this.canRelocate(b)) return { ok: false, reason: 'Docks face the water and cannot be turned' };
    const rot = (b.rot + 1) % 4;
    const [sw, sd] = b.def.size;
    const w = rot % 2 ? sd : sw, d = rot % 2 ? sw : sd;
    const cx = Math.round(b.x + this.world.half - w / 2), cz = Math.round(b.z + this.world.half - d / 2);
    return this.relocate(b, cx, cz, rot);
  }

  /**
   * Move (and/or turn) an existing building, finished or not, keeping everything about it: its
   * residents, workers, progress, stock and animals.
   */
  relocate(b: Building, cx: number, cz: number, rot: number): { ok: boolean; reason: string } {
    if (!this.canRelocate(b)) return { ok: false, reason: 'Docks are tied to their shore and cannot be moved' };
    const chk = this.canPlace(b.key, cx, cz, rot, b);
    if (!chk.ok) return chk;
    const w = this.world;
    const farm = isFarm(b.key);
    for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) {
      const i = w.idx(x, z);
      w.occ[i] = 0;
      if (farm) w.soil[i] = 0;
    }
    const [sw, sd] = b.def.size;
    b.cx = cx;
    b.cz = cz;
    b.rot = rot;
    b.w = rot % 2 ? sd : sw;
    b.d = rot % 2 ? sw : sd;
    b.layer = w.layer[w.idx(cx, cz)];
    b.x = cx + b.w / 2 - w.half;
    b.z = cz + b.d / 2 - w.half;
    b.y = w.layerY(b.layer);
    const [dx, dz] = ROT_DIR[rot];
    const depth = sd / 2 + 0.55;
    b.door = { x: b.x + dx * depth, z: b.z + dz * depth };
    for (let z = cz; z < cz + b.d; z++) for (let x = cx; x < cx + b.w; x++) {
      const i = w.idx(x, z);
      w.occ[i] = b.id + 1;
      if (w.path[i] && b.key !== 'torch') w.path[i] = 0;
      if (farm) w.soil[i] = 1;
    }
    this.eco.add('wood', this.veg.clearArea(cx, cz, b.w, b.d));
    this.setPen(b);
    b.group.position.set(b.x, b.y, b.z);
    b.group.rotation.y = (rot * Math.PI) / 2;
    const e = new THREE.Euler(0, (rot * Math.PI) / 2, 0);
    for (const t of b.torches) t.pos.copy(t.flame.position).applyEuler(e).add(b.group.position);
    this.terrain.updateWear();
    this.onMoved(b);
    return { ok: true, reason: '' };
  }

  place(key: BuildingKey, cx: number, cz: number, rot: number, instant = false): Building {
    const def = BUILDINGS[key];
    if (!instant) {
      const reason = this.constructionRequirement(key);
      if (reason || !this.eco.canAfford(def.cost)) throw new Error(reason || 'Not enough resources');
    }
    const b = new Building(this.nextId++, key, cx, cz, rot, this.world.layer[this.world.idx(cx, cz)], this.world);
    if (!instant) this.eco.spend(def.cost);
    if (key === 'greattemple') b.monumentPaid = instant ? 4 : 1;
    let paved = false;
    for (let z = cz; z < cz + b.d; z++) for (let x = cx; x < cx + b.w; x++) {
      const i = this.world.idx(x, z);
      this.world.occ[i] = b.id + 1;
      // Buildings replace any stone path under them (torches stand beside the flagstones).
      if (this.world.path[i] && key !== 'torch') {
        this.world.path[i] = 0;
        paved = true;
      }
    }
    if (paved) this.terrain.updateWear();
    const wood = this.veg.clearArea(cx, cz, b.w, b.d);
    this.eco.add('wood', wood);
    if (key === 'torch' || key === 'market') this.world.passableBuildings.add(b.id);
    if (isFarm(key)) {
      this.world.passableBuildings.add(b.id);
      for (let z = cz; z < cz + b.d; z++) for (let x = cx; x < cx + b.w; x++) this.world.soil[this.world.idx(x, z)] = 1;
      this.terrain.updateWear();
    }
    if (key === 'jetty' || key === 'tradedock') {
      // Boats dock at the T-end of the deck; islanders reach the jetty from the ramp on land.
      [b.dockX, b.dockZ] = b.local(0.5, 1.2 + JETTY.length + 1.0);
      const [rx, rz] = b.local(0.5, 0.4);
      b.door = { x: rx, z: rz };
    }
    this.setPen(b);
    this.buildVisuals(b);
    this.list.push(b);
    this.group.add(b.group);
    if (instant || this.instantBuild()) this.finish(b);
    return b;
  }

  /** Upgrade a hut into a home, or a temple to the next tier. */
  canUpgrade(b: Building): { ok: boolean; reason: string; cost: Cost } {
    const progression = this.progressionUpgrade?.(b);
    if (progression) return {ok:false,reason:progression,cost:{wood:0,stone:0,belief:0}};
    if (!b.complete || b.upgrading) return { ok: false, reason: 'Busy', cost: { wood: 0, stone: 0, belief: 0 } };
    if (b.key === 'stonemason' || b.key === 'boatworkshop') {
      const next = (b.key==='boatworkshop'?BOAT_WORKSHOP:STONEMASON).upgrades[b.tier - 1];
      if (!next) return { ok: false, reason: 'Fully upgraded', cost: { wood: 0, stone: 0, belief: 0 } };
      return this.eco.canAfford(next.cost) ? { ok: true, reason: '', cost: next.cost } : { ok: false, reason: b.key==='boatworkshop'?'Not enough wood, stone, food or Belief':'Not enough wood, stone or food', cost: next.cost };
    }
    if (!this.eco.godMode && !(this.earnedWorkshopTier?.() || this.list.some(x => x.key === 'stonemason' && x.complete))) return { ok: false, reason: 'Complete a Stonemason’s Workshop first', cost: { wood: 0, stone: 0, belief: 0 } };
    if (b.key === 'temple') {
      if (b.tier >= (b.def.maxTier ?? 1)) return { ok: false, reason: 'Already the Great Pyramid', cost: { wood: 0, stone: 0, belief: 0 } };
      const cost = masonryCost(this.eco.templeUpgradeCost(b.tier + 1));
      if (!this.eco.godMode && !((this.earnedWorkshopTier?.() ?? 0) >= 3 || this.list.some(x => x.key === 'stonemason' && x.complete && x.tier >= 3))) return { ok: false, reason: 'Stonemason upgrade 2 required: unlock Great Pyramid upgrades', cost };
      return this.eco.canAfford(cost) ? { ok: true, reason: '', cost } : { ok: false, reason: 'Not enough resources', cost };
    }
    if (b.key === 'home') {
      if (b.tier >= (b.def.maxTier ?? 1)) return { ok: false, reason: 'Already the largest house', cost: { wood: 0, stone: 0, belief: 0 } };
      const cost = masonryCost(HOMES.upgradeCost[b.tier + 1]);
      return this.eco.canAfford(cost) ? { ok: true, reason: '', cost } : { ok: false, reason: 'Not enough resources', cost };
    }
    if (b.key === 'hut') {
      const cost = BUILDINGS.home.cost;
      // The home needs a 3x3 flat area including the hut's cells.
      for (let z = b.cz; z < b.cz + 3; z++) for (let x = b.cx; x < b.cx + 3; x++) {
        if (!this.world.inBounds(x, z)) return { ok: false, reason: 'No room', cost };
        const i = this.world.idx(x, z);
        const o = this.world.occ[i];
        if ((o && o - 1 !== b.id) || this.world.layer[i] !== b.layer || !Number.isNaN(this.world.riverY[i])) return { ok: false, reason: 'Needs a flat 3×3 area', cost };
      }
      return this.eco.canAfford(cost) ? { ok: true, reason: '', cost } : { ok: false, reason: 'Not enough resources', cost };
    }
    return { ok: false, reason: 'No upgrade', cost: { wood: 0, stone: 0, belief: 0 } };
  }

  /** Performs an upgrade; for huts, returns the new Home building. */
  upgrade(b: Building): Building | null {
    const chk = this.canUpgrade(b);
    if (!chk.ok) return null;
    if (b.key === 'temple' || b.key === 'home' || b.key === 'stonemason' || b.key === 'boatworkshop') {
      this.eco.spend(chk.cost);
      b.upgrading = true;
      b.progress = 0;
      b.scaffold.visible = true;
      if (this.instantBuild()) this.finish(b);
      return b;
    }
    const residents = b.residents.slice();
    this.remove(b, false);
    const home = this.place('home', b.cx, b.cz, 0);
    home.residents = residents;
    return home;
  }

  /** Recreate a building from a save without paying or re-running completion effects. */
  restore(key: BuildingKey, cx: number, cz: number, rot: number, d: { complete: boolean; progress: number; tier: number; upgrading: boolean; growth: number; stock: number; bless: number }): Building {
    const hook = this.onComplete;
    this.onComplete = () => {};
    const b = this.place(key, cx, cz, rot, true);
    this.onComplete = hook;
    if (d.tier > 1) {
      b.tier = d.tier;
      const model = this.modelFor(b);
      replaceFinished(b, model.finished);
      this.setTorches(b, model.torches);
    }
    b.growth = d.growth;
    b.stock = d.stock;
    b.blessTimer = d.bless;
    if (!d.complete || d.upgrading) {
      b.complete = !!d.upgrading;
      b.upgrading = d.upgrading;
      b.progress = d.progress;
      this.updateStageVisuals(b);
    }
    this.recomputeCaps();
    return b;
  }

  remove(b: Building, refund = true): void {
    if (!this.list.includes(b)) return;
    this.onRemove(b);
    const clear = () => {
      for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) {
        const i = this.world.idx(x, z);
        if (this.world.occ[i] === b.id) this.world.occ[i] = 0;
      }
      this.world.version++;
    };
    if (refund) {
      const demolition = new Demolition(b, clear);
      this.demolitions.push(demolition);
      this.group.add(demolition.group);
    } else clear();
    if (b.key === 'torch' || b.key === 'market') this.world.passableBuildings.delete(b.id);
    if (isFarm(b.key)) {
      this.world.passableBuildings.delete(b.id);
      for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) this.world.soil[this.world.idx(x, z)] = 0;
      this.terrain.updateWear();
    }
    if (refund) this.eco.refund(b.def.cost, 0.5 * (b.key==='greattemple' ? (b.monumentPaid??4) : 1));
    this.group.remove(b.group);
    // Free the full model too when the simple copy is showing (the copy goes with it).
    if (b.finishedHi && b.finished.geometry !== b.finishedHi) {
      const lo = b.finished.geometry;
      b.finished.geometry = b.finishedHi;
      lo.dispose();
      LO_GEOS.delete(b.finishedHi);
    }
    b.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry && !this.sharedGeo((o as THREE.Mesh).geometry)) (o as THREE.Mesh).geometry.dispose();
    });
    this.list = this.list.filter((x) => x !== b);
    this.recomputeCaps();
  }

  private sharedGeo(g: THREE.BufferGeometry): boolean {
    return g === this.flameGeo || g === this.bellGeo || CROP_LOS.has(g) || this.logGeos.includes(g) || this.stoneGeos.includes(g) || this.basketGeos.includes(g) || [...this.cropGeos.values()].includes(g);
  }

  /** Where a building's animal pen is: the butcher's on its +x half, the vegetable farm's chicken run in its front corner, the pig and chicken pens' open yards. */
  private setPen(b: Building): void {
    const [sw, sd] = b.def.size;
    if (b.key === 'butcher') [b.penX, b.penZ] = b.local(sw / 4 + 0.15, 0.1);
    else if (b.key === 'farm') [b.penX, b.penZ] = b.local(...models.FARM_PEN.centre(sw, sd));
    else if (b.key === 'pigpen') [b.penX, b.penZ] = b.local(...models.PIG_PEN.centre(sw, sd));
    else if (b.key === 'chickenpen') [b.penX, b.penZ] = b.local(...models.CHICKEN_PEN.centre(sw, sd));
  }

  private modelFor(b: Building): models.BuildingModel {
    const [sw, sd] = b.def.size;
    switch (b.key) {
      case 'campfire': return models.campfireModel();
      case 'hut': return models.hutModel();
      case 'home': return models.homeModel(b.tier);
      case 'temple': return models.templeModel(b.tier);
      case 'greattemple': return models.greatTempleModel();
      case 'farm': return models.farmModel(sw, sd, 'veg');
      case 'maizefarm': return models.farmModel(sw, sd, 'maize');
      case 'chinampa': return models.chinampaModel(sw, sd);
      case 'smokehouse': return models.smokehouseModel(sw, sd);
      case 'torch': return models.torchModel();
      case 'bonfire': return models.bonfireModel();
      case 'firepit': return models.firepitModel();
      case 'kennel': return models.kennelModel();
      case 'greathall': return models.greatHallModel();
      case 'market': return models.marketSquareModel();
      case 'boatworkshop': return models.boatWorkshopModel(b.tier);
      case 'stonemason': return models.stonemasonModel(b.tier);
      case 'herbalgarden': return models.herbalGardenModel();
      case 'herbalist': return models.herbalistModel();
      case 'healer': return models.healingCentreModel();
      case 'well': return models.wellModel();
      case 'butcher': return models.butcherModel(sw, sd);
      case 'pigpen': return models.pigpenModel(sw, sd);
      case 'chickenpen': return models.chickenpenModel(sw, sd);
      case 'woodstore': return models.woodstoreModel(sw, sd);
      case 'grainstore': return models.grainstoreModel();
      case 'warroom': return models.warroomModel();
      case 'jetty': return models.jettyModel(b.y, JETTY.length);
      case 'tradedock': return models.tradeDockModel(b.y, JETTY.length);
      case 'watchtower': return models.watchtowerModel();
    }
  }

  private buildVisuals(b: Building): void {
    const mat = buildingMaterial();
    const [sw, sd] = b.def.size;
    const model = this.modelFor(b);
    b.group.position.set(b.x, b.y, b.z);
    b.group.rotation.y = (b.rot * Math.PI) / 2;
    b.finished = new THREE.Mesh(model.finished, mat);
    b.finishedHi = model.finished;
    b.lodFar = false;
    b.finished.castShadow = true;
    b.finished.receiveShadow = true;
    b.foundation = new THREE.Mesh(models.foundationGeometry(sw, sd), mat);
    b.foundation.receiveShadow = true;
    b.scaffold = new THREE.Mesh(models.scaffoldGeometry(sw, sd, model.height), mat);
    b.scaffold.castShadow = true;
    b.group.add(b.foundation, b.scaffold, b.finished);
    if (model.canopy) {
      // Rides on the finished model (shown and raised with it).
      const roof = new THREE.Mesh(model.canopy, canopyMaterial());
      roof.castShadow = true;
      roof.receiveShadow = true;
      b.finished.add(roof);
    }
    this.setTorches(b, model.torches);

    if (isFarm(b.key)) {
      b.crops = new THREE.Mesh(this.cropGeo(sw, sd, false, FARM_TYPES[b.key]!.crop), mat);
      b.crops.castShadow = true;
      b.crops.receiveShadow = true;
      b.group.add(b.crops);
    }
    if (b.key === 'woodstore') {
      const rng = new RNG(b.id);
      for (let k = 0; k < 8; k++) {
        const stone = k >= 6;
        const m = new THREE.Mesh(stone ? this.stoneGeos[k % 2] : this.logGeos[k % 3], mat);
        const col = k % 3, row = Math.floor(k / 3);
        m.position.set(-0.85 + col * 0.85 + rng.range(-0.05, 0.05), row === 2 ? 0 : row * 0.36, -0.3 + (row === 2 ? 0.55 : 0));
        if (stone) m.position.set(-1.1 + (k - 6) * 2.2, 0, 0.55);
        m.rotation.y = rng.range(-0.1, 0.1);
        m.castShadow = true;
        m.visible = false;
        b.fills.push(m);
        b.group.add(m);
      }
    }
    if (b.key === 'grainstore' || b.key === 'campfire') {
      const rng = new RNG(b.id + 9);
      const n = b.key === 'campfire' ? 4 : 8;
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(this.basketGeos[k % 3], mat);
        const a = (k / n) * Math.PI * 2 + 0.3;
        const r = b.key === 'campfire' ? 1.25 : 0.82;
        m.position.set(Math.cos(a) * r + rng.range(-0.05, 0.05), 0, Math.sin(a) * r * 0.9);
        m.castShadow = true;
        m.visible = false;
        b.fills.push(m);
        b.group.add(m);
      }
    }
    if (b.key === 'greathall') {
      const pivot = new THREE.Group();
      pivot.position.copy(models.HALL.bell);
      const bell = new THREE.Mesh(this.bellGeo, mat);
      bell.castShadow = true;
      pivot.add(bell);
      b.bell = pivot;
      b.group.add(pivot);
    }
    this.updateStageVisuals(b);
  }

  /** Ring a Great Hall's bell (it swings for a few seconds). */
  ringBell(b: Building, seconds = 6): void {
    b.ring = Math.max(b.ring, seconds);
  }

  private setTorches(b: Building, points: THREE.Vector3[]): void {
    for (const t of b.torches) {
      b.group.remove(t.flame);
      t.flame.traverse(o => {
        if (o instanceof THREE.Mesh && o.geometry !== this.flameGeo) o.geometry.dispose();
      });
    }
    b.torches = [];
    for (const p of points) {
      const flame = b.key === 'campfire' || b.key === 'bonfire'
        ? villageFire() : new THREE.Mesh(this.flameGeo, fireMaterial());
      if (b.key !== 'campfire' && b.key !== 'bonfire') {
        // Translucent: drawn after the sea (which writes depth), or the sea would erase it.
        flame.renderOrder = 12;
        flame.add(fireEmbers());
      }
      if (b.key === 'greathall') {
        // A lit coal bed replaces the black disk beneath the rooftop flames.
        const coal = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 4), flameMaterial());
        coal.scale.y = 0.18;
        coal.position.y = -0.004;
        flame.add(coal);
      }
      flame.position.copy(p);
      flame.scale.setScalar(FLAME_SCALE[b.key] ?? 1);
      b.group.add(flame);
      const pos = p.clone().applyEuler(new THREE.Euler(0, (b.rot * Math.PI) / 2, 0)).add(b.group.position);
      b.torches.push({ pos, flame, phase: Math.random() * 10 });
    }
  }

  /** Every lit fire, a building's flames that burn close together (a bonfire's) counted as one. */
  private litFires(): FireSpot[] {
    const out: FireSpot[] = [];
    for (const b of this.list) {
      if (!b.complete || b.upgrading || !b.torches.length) continue;
      const big = b.key === 'campfire' || b.key === 'bonfire' || b.key === 'firepit' || b.key === 'greathall';
      const mine: FireSpot[] = [];
      b.torches.forEach((t, k) => {
        if (mine.some((m) => m.pos.distanceToSquared(t.pos) < 0.8 * 0.8)) return;
        mine.push({ key: `${b.id}:${k}`, pos: t.pos, ground: this.world.heightAt(t.pos.x, t.pos.z), big });
      });
      out.push(...mine);
    }
    return out;
  }

  /** Smoke curling from the smokehouse chimney and racks; thicker while someone is at work. */
  private smokeFrom(b: Building, dt: number): void {
    if (b.upgrading) return;
    const busy = b.tendTimer > 0;
    this.smokeAcc += dt * (busy ? 9 : 2.5);
    while (this.smokeAcc > 1) {
      this.smokeAcc -= 1;
      const rack = Math.random() < (busy ? 0.55 : 0.2);
      const [x, z] = rack ? b.local(0.8 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4) : b.local(-0.2, -0.45);
      const y = b.y + (rack ? 0.25 : 1.32);
      this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 0.12 + 0.08, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.12 + 0.05, 3 + Math.random() * 2, 0.34 + Math.random() * 0.16, 0.45);
    }
  }


  /** Buildings far from the camera switch to their simpler models (with some slack, so none flickers). */
  private updateLod(): void {
    const enter = this.lodDist * 0.75, leave = this.lodDist * 0.65;
    for (const b of this.list) {
      if (!b.finished || !b.finishedHi) continue;
      const d = this.camPos.distanceTo(b.group.position);
      const far = b.key==='greattemple' && !b.complete ? false : b.lodFar ? d > leave : d > enter;
      if (far === b.lodFar) continue;
      b.lodFar = far;
      b.finished.geometry = far ? modelLo(b.finishedHi) : b.finishedHi;
      // Crops follow on the next farm update (they also change as they grow and ripen).
    }
  }

  private cropGeo(w: number, d: number, ripe: boolean, crop: 'veg' | 'maize' | 'chinampa' | 'herbs'): THREE.BufferGeometry {
    const k = `${w}x${d}${ripe}${crop}`;
    let g = this.cropGeos.get(k);
    if (!g) {
      g = models.cropModel(w, d, ripe, crop);
      this.cropGeos.set(k, g);
    }
    return g;
  }

  private updateStageVisuals(b: Building): void {
    if (b.bell) b.bell.visible = b.complete;
    if (b.complete && !b.upgrading) {
      b.foundation.visible = false;
      b.scaffold.visible = false;
      b.finished.visible = true;
      b.finished.scale.y = 1;
      if(b.key==='greattemple') b.finished.geometry.setDrawRange(0,Infinity);
      for (const t of b.torches) t.flame.visible = true;
      return;
    }
    if (b.upgrading) {
      b.foundation.visible = false;
      b.scaffold.visible = true;
      b.finished.visible = true;
      return;
    }
    const p = b.progress;
    if (b.key==='greattemple' && b.finishedHi?.userData.constructionPhases) {
      const ranges=b.finishedHi.userData.constructionPhases as number[];
      const phase=Math.min(3,Math.floor(p*4)), fraction=p*4-phase;
      const start=phase===0?0:ranges[phase-1];
      b.finishedHi.setDrawRange(0,start+Math.floor((ranges[phase]-start)*fraction/3)*3);
      b.finished.geometry=b.finishedHi;b.lodFar=false;b.finished.visible=true;b.finished.scale.y=1;
      b.foundation.visible=p<0.25;b.scaffold.visible=p<1;
      for(const t of b.torches)t.flame.visible=false;
      return;
    }
    b.foundation.visible = p < 0.35;
    b.scaffold.visible = p >= 0.12 && p < 1;
    b.finished.visible = p >= 0.3;
    b.finished.scale.y = Math.max(0.01, (p - 0.3) / 0.7);
    for (const t of b.torches) t.flame.visible = false;
    if (b.crops) b.crops.visible = false;
    for (const f of b.fills) f.visible = false;
  }

  waitingForMaterials(b: Building): boolean {
    return b.key==='greattemple' && !b.complete && b.monumentPaid!==undefined && b.monumentPaid<4 && b.progress>=b.monumentPaid/4 && !this.eco.canAfford(b.def.cost);
  }

  /** Called by builders every frame they work. */
  addProgress(b: Building, dt: number): void {
    const time = b.upgrading ? (b.key === 'boatworkshop' ? (BOAT_WORKSHOP.upgrades[b.tier-1]?.time ?? b.def.buildTime) : b.key === 'stonemason' ? (STONEMASON.upgrades[b.tier - 1]?.time ?? b.def.buildTime) : b.key === 'home' ? HOMES.upgradeTime[b.tier + 1] : TEMPLE.upgradeTime[b.tier + 1]) : b.def.buildTime;
    let next = Math.min(1, b.progress + dt / time);
    if(b.key==='greattemple' && !b.complete && b.monumentPaid!==undefined) {
      while(next>b.monumentPaid/4 && b.monumentPaid<4) {
        if(!this.eco.spend(b.def.cost)){next=b.monumentPaid/4;break;}
        b.monumentPaid++;
      }
    }
    b.progress = next;
    if (b.progress >= 1) this.finish(b);
    else this.updateStageVisuals(b);
  }

  private finish(b: Building): void {
    if (b.upgrading) {
      b.upgrading = false;
      b.tier++;
      const model = this.modelFor(b);
      replaceFinished(b, model.finished);
      this.setTorches(b, model.torches);
      b.scaffold.geometry.dispose();
      b.scaffold.geometry = models.scaffoldGeometry(b.def.size[0], b.def.size[1], model.height + 1);
    }
    b.complete = true;
    b.progress = 1;
    b.builders.clear();
    this.updateStageVisuals(b);
    if (b.crops) b.crops.visible = true;
    this.recomputeCaps();
    this.onComplete(b);
  }

  recomputeCaps(): void {
    let wood = 0, food = 0, tiers = 0;
    for (const b of this.list) {
      if (!b.complete) continue;
      if (b.key === 'campfire') {
        wood += ECONOMY.baseWoodCap;
        food += ECONOMY.baseFoodCap;
      }
      wood += b.def.woodCap ?? 0;
      food += b.def.foodCap ?? 0;
      if (b.key === 'temple') tiers += b.tier;
      if (b.key === 'greattemple') tiers += TEMPLE.greatBeliefCapTiers;
    }
    this.eco.recomputeCaps(wood, food, tiers);
  }

  // ------------- Ghost preview -------------

  showGhost(key: BuildingKey | null, cx = 0, cz = 0, rot = 0, moving?: Building): { ok: boolean; reason: string } {
    if (!key) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostOutlineGeo?.dispose(); this.ghostOutlineGeo = null;
      this.ghostKey = null;
      this.spaceMesh.visible = false;
      return { ok: false, reason: '' };
    }
    if (key === 'jetty' || key === 'tradedock') rot = this.jettyRot(cx, cz);
    if (this.ghostKey !== key || this.ghostRot !== rot) {
      if (this.ghost) this.scene.remove(this.ghost);
      const tmp = new Building(0, key, 0, 0, rot, 1, this.world);
      const model = this.modelFor(tmp);
      this.ghost = new THREE.Group();
      const m = new THREE.Mesh(model.finished, this.ghostMat);
      m.renderOrder = 20;
      this.ghost.add(m);
      const [sw, sd] = BUILDINGS[key].size;
      this.ghostOutlineGeo?.dispose();
      this.ghostOutlineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-sw / 2, 0.08, -sd / 2), new THREE.Vector3(sw / 2, 0.08, -sd / 2),
        new THREE.Vector3(sw / 2, 0.08, sd / 2), new THREE.Vector3(-sw / 2, 0.08, sd / 2),
      ]);
      const outline = new THREE.LineLoop(this.ghostOutlineGeo, this.ghostOutlineMat);
      outline.renderOrder = 22;
      this.ghost.add(outline);
      this.scene.add(this.ghost);
      this.ghostKey = key;
      this.ghostRot = rot;
    }
    const def = BUILDINGS[key];
    const [sw, sd] = def.size;
    const w = rot % 2 ? sd : sw, d = rot % 2 ? sw : sd;
    const res = this.canPlace(key, cx, cz, rot, moving);
    const layer = this.world.layerAt(cx, cz);
    const y = key === 'jetty' ? this.world.layerY(Math.max(1, layer)) : this.world.layerY(Math.max(1, layer));
    this.ghost!.position.set(cx + w / 2 - this.world.half, y + 0.02, cz + d / 2 - this.world.half);
    this.ghost!.rotation.y = (rot * Math.PI) / 2;
    this.ghostMat.color.setHex(res.ok ? 0x9df08a : 0xff7a5a);
    this.ghostOutlineMat.color.copy(this.ghostMat.color);
    this.showSpace(key, cx, cz, w, d, moving);
    return res;
  }

  /**
   * Show green footprint squares, gold expansion space and pale walkway clearance.
   * Red squares identify water, uneven ground, landmarks or occupied space.
   */
  private showSpace(key: BuildingKey, cx: number, cz: number, w: number, d: number, moving?: Building): void {
    const W = this.world, m = this.spaceMesh;
    const sp = this.space(key, cx, cz, w, d);
    const layer = W.inBounds(cx, cz) ? W.layer[W.idx(cx, cz)] : 1;
    let n = 0;
    for (let z = sp.z0 - sp.m; z < sp.z1 + sp.m; z++) for (let x = sp.x0 - sp.m; x < sp.x1 + sp.m; x++) {
      const footprint = x >= cx && x < cx + w && z >= cz && z < cz + d;
      if (!W.inBounds(x, z) || n >= 128) continue;
      const i = W.idx(x, z);
      if (W.layer[i] <= 0 && !footprint) continue;
      const grow = x < sp.x1 && z < sp.z1 && x >= sp.x0 && z >= sp.z0;
      const o = W.occ[i];
      const other = o && (!moving || o - 1 !== moving.id) ? this.byId(o - 1) : undefined;
      let bad = grow ? !!other || !!W.blockFixed[i] || W.layer[i] < 1 || W.layer[i] !== layer || !Number.isNaN(W.riverY[i]) : !!other && !BuildingSystem.open(other.key);
      if (!grow && !bad) {
        // A walkway square may not cut into a neighbouring hut's room to grow either.
        for (const e of this.list) {
          if (e === moving || e.key !== 'hut') continue;
          if (x >= e.cx && x < e.cx + 3 && z >= e.cz && z < e.cz + 3) bad = true;
        }
      }
      const wx = x + 0.5 - W.half, wz = z + 0.5 - W.half;
      this.spaceM4.makeTranslation(wx, Math.max(0, W.heightAt(wx, wz)) + 0.06, wz);
      m.setMatrixAt(n, this.spaceM4);
      m.setColorAt(n, this.spaceCol.setHex(bad ? 0xff6a4a : footprint ? 0x9df08a : grow ? 0xf2c14e : 0xdff7e8));
      n++;
    }
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  get ghostRotation(): number {
    return this.ghostRot;
  }

  // ------------- Per-frame -------------

  update(dt: number, time: number, night: number, seasonIndex: number, raining: boolean, camTarget: THREE.Vector3): void {
    this.demolitions = this.demolitions.filter(effect => !effect.update(dt));
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.25;
      this.updateLod();
    }
    for (const b of this.list) {
      if (!b.complete) continue;
      if (b.key === 'herbalist') processMedicine(b, this.eco, dt);
      if (b.bell) {
        // Swinging hard while it rings, settling as it stops.
        b.ring = Math.max(0, b.ring - dt);
        b.bell.rotation.x = Math.sin(time * 7.5) * 0.55 * Math.min(1, b.ring / 1.5);
      }
      if (b.key === 'smokehouse') {
        b.tendTimer = Math.max(0, b.tendTimer - dt);
        this.smokeFrom(b, dt);
      }
      const ft = FARM_TYPES[b.key];
      if (ft) {
        b.blessTimer = Math.max(0, b.blessTimer - dt);
        b.tendTimer = Math.max(0, b.tendTimer - dt);
        if (b.growth < 1 && b.stock <= 0) {
          const season = Math.max(ft.seasonFloor, FARM.seasonGrowth[seasonIndex]);
          let rate = ((season * ft.grow) / FARM.growSeconds) * (b.tendTimer > 0 ? FARM.tendBoost : 0.5);
          if (b.blessTimer > 0) rate *= FARM.blessMultiplier;
          if (raining) rate *= 1.3;
          b.growth = Math.min(1, b.growth + rate * dt);
        }
        if (b.crops) {
          const ripe = b.growth >= 0.85;
          const full = this.cropGeo(b.def.size[0], b.def.size[1], ripe, ft.crop);
          const g = b.lodFar ? cropLo(full) : full;
          if (b.crops.geometry !== g) b.crops.geometry = g;
          b.crops.visible = b.growth > 0.02;
          b.crops.scale.y = 0.12 + 0.88 * b.growth;
        }
      }
    }
    this.updateFills();
    this.smoke.update(dt, -0.02);
    const day = 0.4 + 0.6 * (1 - night);
    ((this.smoke.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.79 * day, 0.76 * day, 0.73 * day);
    // Torches: flicker, visible from dusk (FireLights lights the ground and the nearest walls).
    const lit = night > 0.12;
    for (const b of this.list) {
      for (const t of b.torches) {
        const on = (b.complete && !b.upgrading && lit) as boolean;
        t.flame.visible = on;
        if (on) {
          const village = b.key === 'campfire' || b.key === 'bonfire';
          const f = village
            ? 0.94 + Math.sin(time * 2.2 + t.phase) * 0.025 + Math.sin(time * 3.8 + t.phase * 2) * 0.015
            : 0.93 + Math.sin(time * 5.5 + t.phase) * 0.035 + Math.sin(time * 9.7 + t.phase * 2) * 0.025;
          const base = FLAME_SCALE[b.key] ?? 1;
          t.flame.scale.set(base * f, base * (0.9 + (1 - f) * 1.5), base * f);
        }
      }
    }
    this.spotTimer -= dt;
    if (this.spotTimer <= 0) {
      this.spotTimer = 0.25;
      this.fireSpots = lit ? this.litFires() : [];
    }
    this.fireLights.update(dt, time, night, this.fireSpots, camTarget);
    void FX;
  }

  private fillTimer = 0;
  private updateFills(): void {
    if (--this.fillTimer > 0) return;
    this.fillTimer = 20;
    const woodFrac = this.eco.woodCap > 0 ? this.eco.res.wood / this.eco.woodCap : 0;
    const stoneFrac = this.eco.woodCap > 0 ? this.eco.res.stone / this.eco.woodCap : 0;
    const foodFrac = this.eco.foodCap > 0 ? this.eco.food / this.eco.foodCap : 0;
    for (const b of this.list) {
      if (!b.complete || !b.fills.length) continue;
      if (b.key === 'woodstore') {
        b.fills.forEach((m, k) => {
          m.visible = k < 6 ? k < Math.ceil(woodFrac * 6) : k - 6 < Math.ceil(stoneFrac * 2);
        });
      } else {
        const n = b.fills.length;
        b.fills.forEach((m, k) => (m.visible = k < Math.ceil(foodFrac * n)));
      }
    }
  }

  /** Nearest completed store that accepts a resource. */
  nearestStore(x: number, z: number, food: boolean): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.list) {
      if (!b.complete) continue;
      const ok = b.key === 'campfire' || (food ? b.key === 'grainstore' || b.key === 'smokehouse' : b.key === 'woodstore');
      if (!ok) continue;
      const d = (b.door.x - x) ** 2 + (b.door.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }
}
