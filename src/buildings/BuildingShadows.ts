import * as THREE from 'three';
import { SHADOW_LAYER } from '../render/ShadowLayer';

/** What the shadow batch needs from a building. */
export interface ShadowSource {
  id: number;
  finished: THREE.Mesh;
  /** The full model (the finished mesh may be showing its simpler far copy). */
  finishedHi?: THREE.BufferGeometry | null;
}

/**
 * Batched drawing misplaces everything on Apple's WebKit (iPhone, iPad and the Mac app: every
 * building in a batch was drawn in the same spot, so zoomed out they all vanished). There the
 * buildings are drawn one by one as before; other browsers batch them.
 */
export function batchingWorks(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  const appleWebKit = /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua));
  return !appleWebKit;
}

/** Layer a building's own finished mesh moves to while the far batch draws it (picking still sees it). */
export const BATCHED_LAYER = 6;

const COMPACT = new Map<string, WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>>();

/** Just the named attributes, and only the vertices the triangles use. */
function compact(src: THREE.BufferGeometry, names: string[]): THREE.BufferGeometry {
  const key = names.join();
  let cache = COMPACT.get(key);
  if (!cache) COMPACT.set(key, (cache = new WeakMap()));
  let g = cache.get(src);
  if (g) return g;
  const I = src.index, n = I ? I.count : src.getAttribute('position').count;
  const attrs = names.map((name) => src.getAttribute(name) ?? null);
  const out = names.map(() => [] as number[]);
  const remap = new Map<number, number>(), idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const v = I ? I.getX(k) : k;
    let j = remap.get(v);
    if (j === undefined) {
      j = remap.size;
      remap.set(v, j);
      attrs.forEach((a, m) => {
        // A missing attribute (a model without vertex colours) is filled with white.
        if (!a) out[m].push(1, 1, 1);
        else for (let c = 0; c < a.itemSize; c++) out[m].push(a.getComponent(v, c));
      });
    }
    idx.push(j);
  }
  g = new THREE.BufferGeometry();
  names.forEach((name, m) => g!.setAttribute(name, new THREE.Float32BufferAttribute(out[m], attrs[m]?.itemSize ?? 3)));
  g.setIndex(idx);
  cache.set(src, g);
  return g;
}

/**
 * Many buildings in one draw, each from its simpler far model. Used twice: every settled
 * building casts its shadow from one shadow-only batch (one draw in the shadow pass instead of one
 * per building), and buildings far from the camera are drawn from another. Buildings that are
 * going up, being upgraded, ruined, burning or still dropping into place keep their own mesh, so
 * nothing about how they look changes.
 */
export class BuildingShadows {
  readonly mesh: THREE.BatchedMesh;
  private entries = new Map<number, { src: THREE.BufferGeometry; geo: number; inst: number; key: string }>();
  private vertices = 0;
  private indices = 0;
  private maxVertices = 400_000;
  private maxIndices = 1_200_000;
  private maxInstances = 512;
  private deleted = 0;

  private names: string[];

  /**
   * `apply` is told whether a building is in the batch (to hide what the batch replaces).
   * Without a material it is the shadow-only batch.
   */
  constructor(private lo: (hi: THREE.BufferGeometry) => THREE.BufferGeometry, private apply: (b: ShadowSource, used: boolean) => void, material?: THREE.Material) {
    this.names = material ? ['position', 'normal', 'color'] : ['position'];
    this.mesh = new THREE.BatchedMesh(this.maxInstances, this.maxVertices, this.maxIndices, material ?? new THREE.MeshBasicMaterial());
    if (material) {
      this.mesh.castShadow = false;
      this.mesh.receiveShadow = true;
      this.mesh.name = 'Far buildings';
    } else {
      this.mesh.layers.set(SHADOW_LAYER);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = false;
      this.mesh.name = 'Building shadows';
    }
  }

  /** Bring the batch in line with the buildings: `settled` says whether each one belongs in it. */
  sync<T extends ShadowSource>(list: T[], settled: (b: T) => boolean): void {
    const seen = new Set<number>();
    for (const b of list) {
      const use = settled(b);
      this.apply(b, use);
      if (!use) continue;
      seen.add(b.id);
      const src = b.finishedHi ?? b.finished.geometry;
      b.finished.updateWorldMatrix(true, false);
      const e = b.finished.matrixWorld.elements;
      const key = `${e[12]},${e[13]},${e[14]},${e[0]},${e[2]},${e[5]}`;
      let entry = this.entries.get(b.id);
      if (entry && entry.src !== src) {
        this.remove(b.id);
        entry = undefined;
      }
      if (!entry) {
        const geo = compact(this.lo(src), this.names);
        const id = this.add(geo);
        if (id < 0) {
          this.apply(b, false);
          continue;
        }
        entry = { src, geo: id, inst: this.mesh.addInstance(id), key: '' };
        this.entries.set(b.id, entry);
      }
      if (entry.key !== key) {
        entry.key = key;
        this.mesh.setMatrixAt(entry.inst, b.finished.matrixWorld);
      }
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
    this.mesh.visible = this.entries.size > 0;
  }

  private add(geo: THREE.BufferGeometry): number {
    const v = geo.getAttribute('position').count, i = geo.index!.count;
    if (this.entries.size + 1 > this.maxInstances) this.mesh.setInstanceCount(this.maxInstances *= 2);
    if (this.vertices + v > this.maxVertices || this.indices + i > this.maxIndices) {
      // Space left by removed buildings first; then room to grow.
      if (this.deleted) { this.mesh.optimize(); this.deleted = 0; this.recount(); }
      while (this.vertices + v > this.maxVertices || this.indices + i > this.maxIndices) {
        this.maxVertices *= 2;
        this.maxIndices *= 2;
      }
      try {
        this.mesh.setGeometrySize(this.maxVertices, this.maxIndices);
      } catch {
        return -1;
      }
    }
    this.vertices += v;
    this.indices += i;
    return this.mesh.addGeometry(geo);
  }

  private remove(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.mesh.deleteInstance(e.inst);
    this.mesh.deleteGeometry(e.geo);
    this.entries.delete(id);
    this.deleted++;
  }

  private recount(): void {
    let v = 0, i = 0;
    for (const e of this.entries.values()) {
      const g = compact(this.lo(e.src), this.names);
      v += g.getAttribute('position').count;
      i += g.index!.count;
    }
    this.vertices = v;
    this.indices = i;
  }
}
