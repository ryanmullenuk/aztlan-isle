import * as THREE from 'three';
import { GeoBuilder, M, P } from './GeoBuilder';
import { stylisedMaterial } from './materials';
import { SoftShadows } from './SoftShadows';

/** A resting place: who lies there, where, and the day they passed. */
export interface Grave { name: string; x: number; z: number; y: number; yaw: number; day: number }

/** Most graves drawn (the oldest give way to the newest beyond this). */
const MAX = 64;

/**
 * One grave: a low earth mound with a carved stone at its head and a few marigolds (the flowers
 * of the dead), in the faceted style of the island. Model units, about a body's length.
 */
function graveGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const earth = 0x6b4a32, stone = 0x9a958a, dark = 0x7d786e, petal = 0xf0a020, leaf = 0x4f7a32;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) =>
    b.add(P.box(w, h, d), { color, facet: true }, M.t(x, y, z));
  // The mound: a long, low rounded heap.
  b.add(P.sphere(0.5, 1), { color: earth, facet: true }, M.t(0, 0, -0.04, 0, 0, 0, 0.26, 0.12, 0.42));
  // The headstone: a slab with a stepped top, and its carved face.
  box(0.34, 0.34, 0.12, 0, 0.17, 0.3, stone);
  box(0.24, 0.07, 0.12, 0, 0.37, 0.3, stone);
  box(0.18, 0.13, 0.012, 0, 0.19, 0.239, dark);
  // Marigolds on the mound.
  for (const [x, z] of [[-0.08, 0.06], [0.07, -0.05], [0.0, -0.18], [0.09, 0.12]] as const) {
    box(0.02, 0.07, 0.02, x, 0.12, z, leaf);
    box(0.06, 0.03, 0.06, x, 0.17, z, petal);
  }
  return b.build();
}

/**
 * The dead carried to the graveyard: a body wrapped in a white shroud bound with red cords, on a
 * litter of two poles (along +z, centred, poles at hand height for two bearers).
 */
function bierGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(0.34, 0.03, 0.9), { color: 0x8a6040 }, M.t(0, 0, 0));
  for (const x of [-0.19, 0.19]) b.add(P.cyl(0.02, 0.02, 1.6, 6), { color: 0x6e4a2e }, M.t(x, 0.0, 0, Math.PI / 2, 0, 0));
  b.add(P.sphere(0.5, 1), { color: 0xf1ebdd }, M.t(0, 0.09, 0, 0, 0, 0, 0.26, 0.15, 0.82));
  b.add(P.sphere(0.12, 1), { color: 0xf1ebdd }, M.t(0, 0.1, 0.36, 0, 0, 0, 1, 0.8, 1));
  for (const z of [-0.2, 0.05, 0.28]) b.add(P.box(0.27, 0.025, 0.03), { color: 0xb23a2c }, M.t(0, 0.17, z));
  return b.build();
}

/** The village's graves, drawn as one instanced mesh, each with a soft shadow. */
export class Graves {
  readonly group = new THREE.Group();
  list: Grave[] = [];
  private mesh: THREE.InstancedMesh;
  /** The body on its litter, lying where they passed or carried to the graveyard (hidden otherwise). */
  readonly bier = new THREE.Mesh(bierGeometry(), stylisedMaterial());
  /** Their soft shadows, one draw for all. */
  private shadows = new SoftShadows(MAX);

  constructor() {
    this.mesh = new THREE.InstancedMesh(graveGeometry(), stylisedMaterial(), MAX);
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'graves';
    this.bier.visible = false;
    this.bier.castShadow = true;
    this.bier.scale.setScalar(0.8);
    this.group.add(this.mesh, this.shadows.mesh, this.bier);
  }

  /** Show the bier at (x, y, z), its length along `yaw`; or hide it (null). */
  showBier(at: { x: number; y: number; z: number; yaw: number } | null): void {
    this.bier.visible = !!at;
    if (!at) return;
    this.bier.position.set(at.x, at.y, at.z);
    this.bier.rotation.set(0, at.yaw, 0);
  }

  add(g: Grave): void {
    this.list.push(g);
    if (this.list.length > MAX) this.list.shift();
    this.draw();
  }

  restore(d: unknown): void {
    if (!Array.isArray(d)) return;
    this.list = d.filter((g): g is Grave => !!g && typeof g.name === 'string' && [g.x, g.z, g.y, g.yaw, g.day].every(Number.isFinite)).slice(-MAX);
    this.draw();
  }

  /** The grave nearest (x, z) within `r`, for tapping. */
  near(x: number, z: number, r = 0.5): Grave | null {
    let best: Grave | null = null, bd = r * r;
    for (const g of this.list) {
      const d = (g.x - x) ** 2 + (g.z - z) ** 2;
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  private draw(): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(0.85, 0.85, 0.85), p = new THREE.Vector3();
    this.list.forEach((g, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw);
      this.mesh.setMatrixAt(i, m.compose(p.set(g.x, g.y, g.z), q, s));
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Bounds round all the graves now (kept from the first draw, new ones far off would be culled).
    this.mesh.computeBoundingSphere();
    // A soft shadow under each.
    this.shadows.begin();
    for (const g of this.list) this.shadows.add(g.x, g.y, g.z, 0.55, 0.8, g.yaw);
    this.shadows.end();
  }
}
