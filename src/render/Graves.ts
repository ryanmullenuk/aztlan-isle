import * as THREE from 'three';
import { flowerOnStem } from '../vegetation/flowerParts';
import { RNG } from '../world/rng';
import { GeoBuilder, M, P } from './GeoBuilder';
import { stylisedMaterial } from './materials';
import { SoftShadows } from './SoftShadows';
import { villageFire } from '../buildings/VillageFire';

/** A resting place: who lies there, where, and the day they passed. */
export interface Grave { name: string; x: number; z: number; y: number; yaw: number; day: number; /** An urn of ashes from the pyre (a grave with a headstone otherwise: those from before the pyres). */ urn?: boolean }

/** Most graves drawn (the oldest give way to the newest beyond this). */
const MAX = 64;

/**
 * One grave: a raised mound of earth filling its plot, a pale headstone at its head carved with a
 * square spiral, and flowers (marigolds and the odd red and pink bloom) along its sides, in the
 * faceted style of the island. Model units, about a body's length.
 */
function graveGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const earth = 0x6b4a32, earthTop = 0x7d5838, stone = 0xc9c2b2, carve = 0x8e877a, leaf = 0x4f7a32;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) =>
    b.add(P.box(w, h, d), { color, facet: true }, M.t(x, y, z));
  // The mound: a heap squared off by the kerb, rounded on top.
  box(0.56, 0.08, 0.74, 0, 0.04, -0.06, earth);
  b.add(P.sphere(0.5, 1), { color: earthTop, facet: true }, M.t(0, 0.07, -0.06, 0, 0, 0, 0.27, 0.09, 0.36));
  // The headstone: a slab with a stepped top, a square spiral cut in its face.
  box(0.32, 0.36, 0.1, 0, 0.18, 0.3, stone);
  box(0.22, 0.07, 0.1, 0, 0.39, 0.3, stone);
  box(0.36, 0.05, 0.14, 0, 0.025, 0.3, 0xb3ac9c);
  const fz = 0.244;
  for (const [w, h, x, y] of [[0.2, 0.02, 0, 0.29], [0.02, 0.2, -0.09, 0.2], [0.18, 0.02, -0.01, 0.11], [0.02, 0.14, 0.08, 0.17], [0.12, 0.02, 0.03, 0.23], [0.02, 0.07, -0.02, 0.2]] as const) {
    box(w, h, 0.012, x, y, fz, carve);
  }
  // Flowers along both sides of the mound.
  // (Marigolds, with a red and a pink bloom, as the island's own flowers.)
  const petals = ['marigold', 'red', 'pink', 'gold', 'marigold'] as const, fr = new RNG(77);
  [[-0.24, 0.12], [0.24, -0.02], [-0.22, -0.22], [0.23, 0.16], [0.0, -0.36]].forEach(([x, z], k) => {
    flowerOnStem(b, x, 0.06, z, 0.09, 0.05, petals[k], fr);
  });
  void leaf;
  return b.build();
}

/**
 * An urn of ashes in its plot: a low stone slab, a lidded clay urn painted with a red band and a
 * cream key, a carved name stone behind it, and marigolds laid round. Model units, a plot's size.
 */
function urnGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const stone = 0xc9c2b2, clay = 0xb8623a, clayDark = 0x8e4526, red = 0xa64032, cream = 0xefdfb8, leaf = 0x4f7a32;
  b.add(P.box(0.52, 0.06, 0.62), { color: 0xb3ac9c, facet: true }, M.t(0, 0.03, -0.02));
  b.add(P.box(0.44, 0.04, 0.5), { color: stone, facet: true }, M.t(0, 0.08, -0.02));
  // The urn: foot, round belly, neck, lid and knob.
  b.add(P.cyl(0.07, 0.085, 0.04, 8), { color: clayDark, facet: true }, M.t(0, 0.12, -0.04));
  b.add(P.sphere(0.5, 1), { color: clay, facet: true }, M.t(0, 0.25, -0.04, 0, 0, 0, 0.3, 0.26, 0.3));
  b.add(P.cyl(0.152, 0.152, 0.035, 10), { color: red, facet: true }, M.t(0, 0.26, -0.04));
  b.add(P.cyl(0.154, 0.154, 0.012, 10), { color: cream, facet: true }, M.t(0, 0.285, -0.04));
  b.add(P.cyl(0.075, 0.1, 0.05, 8), { color: clay, facet: true }, M.t(0, 0.385, -0.04));
  b.add(P.cyl(0.095, 0.085, 0.025, 8), { color: clayDark, facet: true }, M.t(0, 0.42, -0.04));
  b.add(P.sphere(0.03, 0), { color: cream, facet: true }, M.t(0, 0.455, -0.04));
  // The name stone behind it.
  b.add(P.box(0.26, 0.2, 0.07), { color: stone, facet: true }, M.t(0, 0.2, 0.25));
  b.add(P.box(0.16, 0.02, 0.012), { color: 0x8e877a, facet: true }, M.t(0, 0.24, 0.212));
  b.add(P.box(0.1, 0.02, 0.012), { color: 0x8e877a, facet: true }, M.t(0, 0.19, 0.212));
  const petals = ['marigold', 'red', 'gold', 'pink', 'marigold'] as const, fr = new RNG(78);
  [[-0.19, -0.2], [0.19, -0.16], [-0.17, 0.08], [0.18, 0.1], [0.0, -0.27]].forEach(([x, z], k) => {
    flowerOnStem(b, x, 0.1, z, 0.07, 0.048, petals[k], fr);
  });
  void leaf;
  return b.build();
}

/** The pyre: a square stack of crossed logs on a ring of stones, a bed of brushwood on top (about 0.45 high). */
function pyreGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const log = [0x7a5230, 0x6a4628, 0x8a5e38];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    b.add(P.sphere(0.11, 0), { color: k % 2 ? 0x8a8478 : 0x767064, facet: true }, M.t(Math.cos(a) * 0.72, 0.05, Math.sin(a) * 0.72, 0, a, 0, 1, 0.7, 1.2));
  }
  for (let tier = 0; tier < 4; tier++) {
    const y = 0.07 + tier * 0.1, along = tier % 2 === 0, n = 4 - (tier > 2 ? 1 : 0), len = 1.25 - tier * 0.06;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 0.27;
      b.add(P.cyl(0.05, 0.055, len, 6), { color: log[(k + tier) % 3], facet: true }, along ? M.t(off, y, 0, Math.PI / 2, 0, 0) : M.t(0, y, off, 0, 0, Math.PI / 2));
    }
  }
  for (let k = 0; k < 7; k++) b.add(P.box(0.9, 0.02, 0.05), { color: 0x9a7a4a, facet: true }, M.t(0, 0.455, -0.3 + k * 0.1, 0, (k % 3 - 1) * 0.12, 0));
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
  private urns!: THREE.InstancedMesh;
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
    // Urns of ashes (the dead since the pyres), drawn like the graves.
    this.urns = new THREE.InstancedMesh(urnGeometry(), stylisedMaterial(), MAX);
    this.urns.count = 0;
    this.urns.receiveShadow = true;
    this.urns.name = 'urns';
    // The pyre, its fire (made when first lit) and the ash it leaves; the body has a material of
    // its own so it can blacken and pale as it burns.
    this.bierMat = (this.bier.material as THREE.MeshStandardMaterial).clone();
    this.bier.material = this.bierMat;
    this.pyre = new THREE.Mesh(pyreGeometry(), (stylisedMaterial() as THREE.MeshStandardMaterial).clone());
    this.pyre.castShadow = true;
    this.pyre.visible = false;
    this.pyre.name = 'pyre';
    this.ash = new THREE.Mesh(new THREE.CircleGeometry(0.95, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a2623, transparent: true, opacity: 0, depthWrite: false }));
    this.ash.visible = false;
    this.ash.renderOrder = 3;
    this.group.add(this.urns, this.pyre, this.ash);
    // The ghost: a see-through grave shown where one being moved would go (green if it can, red if not).
    this.ghost = new THREE.Mesh(this.mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x8cf08c, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ghost.scale.setScalar(0.85);
    this.ghost.visible = false;
    this.ghost.renderOrder = 20;
    this.ghost.name = 'grave ghost';
    this.group.add(this.ghost);
  }

  // ---------------- The funeral pyre ----------------

  private pyre!: THREE.Mesh;
  private ash!: THREE.Mesh;
  private fire: THREE.Object3D | null = null;
  private bierMat!: THREE.MeshStandardMaterial;
  /** Where the pyre stands (null: none), and how the scorched ground it leaves is fading. */
  pyreAt: { x: number; y: number; z: number } | null = null;
  /** How big the pyre's fire is just now, 0 (unlit or out) to 1 (roaring): for its sound. */
  flame = 0;
  private ashLeft = 0;

  /** Raise the pyre at a place (its logs stacked ready), or take it away (null). */
  showPyre(at: { x: number; y: number; z: number; yaw?: number } | null): void {
    this.pyreAt = at ? { x: at.x, y: at.y, z: at.z } : null;
    this.flame = 0;
    this.pyre.visible = !!at;
    if (this.fire) this.fire.visible = false;
    if (!at) return;
    this.pyre.position.set(at.x, at.y, at.z);
    this.pyre.rotation.set(0, at.yaw ?? 0, 0);
    this.pyre.scale.setScalar(1);
    this.setBody(0);
  }

  /** Height of the pyre's top, where the body is laid. */
  static readonly PYRE_TOP = 0.5;

  /**
   * The burning, `u` from 0 (the fire is lit) to 1 (out): the same fire as the village bonfire
   * takes hold, the body darkens to black, pales to grey ash and crumbles to dust; the logs burn
   * down with it, and the fire sinks and goes out over a bed of ash.
   */
  burn(u: number): void {
    const at = this.pyreAt;
    if (!at) return;
    if (!this.fire && typeof document !== 'undefined') {
      this.fire = villageFire();
      this.group.add(this.fire);
    }
    const ss = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
    // The fire: up fast, roaring through the middle, sinking at the end.
    const flame = ss(0, 0.08, u) * (1 - ss(0.78, 1, u));
    this.flame = flame;
    if (this.fire) {
      this.fire.visible = flame > 0.02;
      this.fire.position.set(at.x, at.y + 0.3 * (1 - ss(0.3, 0.9, u)) + 0.04, at.z);
      this.fire.scale.setScalar(0.25 + 0.75 * flame);
    }
    this.setBody(u);
    // The logs char and settle into the ash.
    const down = ss(0.35, 0.95, u);
    this.pyre.scale.set(1, 1 - 0.8 * down, 1);
    (this.pyre.material as THREE.MeshStandardMaterial).color.setScalar(1 - 0.8 * ss(0.1, 0.6, u));
    this.bier.position.y = at.y + Graves.PYRE_TOP * (1 - 0.8 * down) + 0.03;
    this.ash.visible = u > 0.2;
    this.ash.position.set(at.x, at.y + 0.025, at.z);
    (this.ash.material as THREE.MeshBasicMaterial).opacity = 0.75 * ss(0.2, 0.7, u);
    this.ashLeft = 1;
  }

  /** The body on the pyre: white shroud, then black, then grey, then dust (gone). */
  private setBody(u: number): void {
    const ss = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
    const black = ss(0.08, 0.38, u), grey = ss(0.42, 0.68, u), dust = ss(0.66, 0.88, u);
    // White → black → ash grey.
    const v = (1 - black) * 1 + black * 0.06;
    this.bierMat.color.setScalar(v + grey * 0.42);
    this.bier.scale.set(0.8 * (1 - 0.25 * dust), 0.8 * (1 - 0.92 * dust), 0.8 * (1 - 0.2 * dust));
    if (u > 0) this.bier.visible = dust < 0.995;
  }

  /** The burning is over: the pyre is gone, leaving scorched ground that fades over the day (call each frame with dt). */
  endPyre(): void {
    this.pyre.visible = false;
    if (this.fire) this.fire.visible = false;
    this.bier.visible = false;
    this.bier.scale.setScalar(0.8);
    this.bierMat.color.setScalar(1);
    (this.pyre.material as THREE.MeshStandardMaterial).color.setScalar(1);
    this.pyreAt = null;
    this.flame = 0;
  }

  /** The ash bed left by a pyre fades away (about a game day). */
  fadeAsh(dt: number, dayLength: number): void {
    if (!this.ash.visible || this.pyreAt) return;
    this.ashLeft -= dt / dayLength;
    (this.ash.material as THREE.MeshBasicMaterial).opacity = 0.75 * Math.max(0, this.ashLeft);
    if (this.ashLeft <= 0) this.ash.visible = false;
  }

  private ghost: THREE.Mesh;
  /** Where the ghost is showing (null when hidden). */
  ghostAt: { x: number; z: number } | null = null;
  /** Show the ghost of a grave at a place (green if it may go there, red if not), or hide it (null). */
  showGhost(at: { x: number; y: number; z: number; yaw: number } | null, ok = true): void {
    this.ghost.visible = !!at;
    this.ghostAt = at ? { x: at.x, z: at.z } : null;
    if (!at) return;
    this.ghost.position.set(at.x, at.y + 0.02, at.z);
    this.ghost.rotation.set(0, at.yaw, 0);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x8cf08c : 0xf06a5a);
  }

  /** Another shrouded body, lying where it fell until its turn at the pyre (see takeBody). */
  layBody(at: { x: number; y: number; z: number; yaw: number }): THREE.Object3D {
    const m = new THREE.Mesh(this.bier.geometry, stylisedMaterial());
    m.position.set(at.x, at.y, at.z);
    m.rotation.set(0, at.yaw, 0);
    m.scale.setScalar(0.8);
    m.castShadow = true;
    this.group.add(m);
    return m;
  }

  /** A waiting body is taken up (its funeral begins, and the bier itself takes its place). */
  takeBody(m: THREE.Object3D): void {
    this.group.remove(m);
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

  /** A grave was moved: draw them all where they now lie. */
  redraw(): void {
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
    let ng = 0, nu = 0;
    for (const g of this.list) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw);
      m.compose(p.set(g.x, g.y, g.z), q, s);
      if (g.urn) this.urns.setMatrixAt(nu++, m);
      else this.mesh.setMatrixAt(ng++, m);
    }
    this.mesh.count = ng;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.urns.count = nu;
    this.urns.instanceMatrix.needsUpdate = true;
    this.urns.computeBoundingSphere();
    // Bounds round all the graves now (kept from the first draw, new ones far off would be culled).
    this.mesh.computeBoundingSphere();
    // A soft shadow under each.
    this.shadows.begin();
    for (const g of this.list) this.shadows.add(g.x, g.y, g.z, 0.55, 0.8, g.yaw);
    this.shadows.end();
  }
}
