import * as THREE from 'three';
import { patchStylised } from '../render/materials';
import { SEA_SURFACE, type Water } from '../water/Water';
import type { World } from '../world/World';
import { createWhale, type WhaleRig } from './WhaleModel';
import { softShadowMesh } from '../render/SoftShadows';
import { poseWhale, WHALE_GIRTH, type WhaleDrive } from './WhaleMotion';

/** Whale length (it is smaller than the great whales out at sea: a young one that lost its way). */
const L = 7;
/** Helper-seconds of pushing to free it (four islanders take about half a minute). */
export const PUSH_NEEDED = 120;

export interface StrandSite {
  x: number;
  z: number;
  /** Up the beach (unit vector): the whale lies head first that way, its tail in the shallows. */
  ux: number;
  uz: number;
}

/**
 * A good beach for a stranding near the village: sand at the water's edge, with dry sand up the
 * beach for the head and shallow water behind for the tail, nothing built in the way. The one
 * nearest a comfortable walk from `cx, cz`, or null if the island has no such beach.
 */
export function findStrandSite(w: World, cx: number, cz: number): StrandSite | null {
  let best: StrandSite | null = null, bestScore = Infinity;
  for (let gz = 2; gz < w.N - 2; gz += 2) {
    for (let gx = 2; gx < w.N - 2; gx += 2) {
      const i = w.idx(gx, gz);
      if (!w.isLandCell(i) || w.layer[i] !== 1 || w.sandy[i] < 0.45 || w.distWater[i] > 1.5 || w.occ[i] || w.blocked(i)) continue;
      const x = w.centerX(gx), z = w.centerZ(gz);
      const d = Math.hypot(x - cx, z - cz);
      if (d < 14 || d > 80) continue;
      // Seaward: toward the open sea cells round about (a lake shore never strands a whale).
      let sx = 0, sz = 0;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        if (!w.inBounds(gx + dx, gz + dz) || !w.isSea(w.idx(gx + dx, gz + dz))) continue;
        sx += dx;
        sz += dz;
      }
      const sl = Math.hypot(sx, sz);
      if (sl < 3) continue;
      const ux = -sx / sl, uz = -sz / sl;
      // Head on dry, open sand; tail in shallow water.
      let ok = true;
      for (const t of [0.15, 0.3]) {
        const hx = x + ux * L * t, hz = z + uz * L * t, j = w.cellIndexAt(hx, hz);
        if (j < 0 || !w.isLandCell(j) || w.occ[j] || w.blocked(j)) ok = false;
      }
      const tb = w.heightAt(x - ux * L * 0.5, z - uz * L * 0.5);
      if (!ok || tb > SEA_SURFACE - 0.1 || tb < -1.6) continue;
      const score = Math.abs(d - 28) + (1 - w.sandy[i]) * 10;
      if (score < bestScore) {
        bestScore = score;
        best = { x, z, ux, uz };
      }
    }
  }
  return best;
}

const _drive: WhaleDrive = { phase: 0, stroke: 0, turn: 0, turnLag: 0, arch: 0, fin: 0, flap: 0, flapPhase: 0, twist: 0 };

/**
 * A whale stranded on the beach: lying over on its side, head on the sand and tail in the
 * shallows, now and then lifting its flukes and slapping a flipper. Islanders push from the dry
 * side; once they have pushed enough (or the evening tide comes in) it slides back into the sea,
 * rolls upright and swims away, sinking out of sight.
 */
export class Stranding {
  readonly group = new THREE.Group();
  readonly x: number;
  readonly z: number;
  phase: 'stranded' | 'refloat' | 'swim' | 'done' = 'stranded';
  /** 0..1 how near it is to being free. */
  progress = 0;
  /** Places to push from, along its dry flank and round its head. */
  readonly slots: { x: number; z: number }[] = [];
  private rig: WhaleRig;
  private root = new THREE.Group();
  /** A soft shadow on the sand beneath it, in place of a sun shadow. */
  private shadow = softShadowMesh(WHALE_GIRTH * L * 2.6, L * 0.95);
  private t = 0;
  private phaseT = 0;
  private ground: number;
  private yaw: number;

  constructor(private world: World, private water: Water, private site: StrandSite) {
    this.x = site.x;
    this.z = site.z;
    this.rig = createWhale(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 }), 0.3));
    this.rig.mesh.frustumCulled = false;
    this.root.add(this.rig.mesh);
    this.group.add(this.shadow);
    this.root.scale.setScalar(L);
    this.group.add(this.root);
    this.group.name = 'strandedWhale';
    this.yaw = Math.atan2(site.ux, site.uz);
    this.ground = Math.max(SEA_SURFACE - 0.05, world.heightAt(site.x, site.z));
    // Along both flanks and round the head, on dry land.
    const rx = site.uz, rz = -site.ux, R = WHALE_GIRTH * L + 0.9;
    for (const along of [-0.05, 0.12, 0.28]) for (const side of [1, -1]) {
      const px = site.x + site.ux * L * along + rx * R * side, pz = site.z + site.uz * L * along + rz * R * side;
      if (world.heightAt(px, pz) > SEA_SURFACE + 0.02) this.slots.push({ x: px, z: pz });
    }
    for (const side of [0.6, -0.6, 0]) {
      const px = site.x + site.ux * (L * 0.38 + 0.8) + rx * side * 1.2, pz = site.z + site.uz * (L * 0.38 + 0.8) + rz * side * 1.2;
      if (world.heightAt(px, pz) > SEA_SURFACE + 0.02) this.slots.push({ x: px, z: pz });
    }
    this.place(0, 0.42, 0);
  }

  /** Free now: it slides back into the water. */
  refloat(): void {
    if (this.phase !== 'stranded') return;
    this.phase = 'refloat';
    this.phaseT = 0;
  }

  /**
   * `pushers` islanders are pushing it this frame. Returns true the moment it is freed by them.
   */
  update(dt: number, pushers: number): boolean {
    if (dt <= 0 || this.phase === 'done') return false;
    this.t += dt;
    this.phaseT += dt;
    const d = _drive;
    let freed = false;
    if (this.phase === 'stranded') {
      if (pushers > 0) {
        this.progress = Math.min(1, this.progress + (dt * pushers) / PUSH_NEEDED);
        if (this.progress >= 1) {
          this.refloat();
          freed = true;
        }
      }
      // Lying still, breathing; every few seconds the flukes lift and a flipper slaps the sand.
      const beat = Math.max(0, Math.sin(this.t * 0.9)) ** 6;
      d.stroke = 0.15 + beat * (pushers ? 1.4 : 0.9);
      d.phase = this.t * 1.4;
      d.arch = -0.5 * beat;
      d.fin = 0.35;
      d.flap = 0.5 * beat;
      d.flapPhase = this.t * 3;
      d.twist = 0;
      // Rocked a little by the pushing.
      const rock = pushers ? Math.sin(this.t * 2.6) * 0.04 * Math.min(1, pushers / 3) : 0;
      this.place(this.progress * 0.06, 0.42 - this.progress * 0.12 + rock, 0);
      if (beat > 0.9 && Math.random() < dt * 6) this.splash(-0.45, 0.2);
    } else if (this.phase === 'refloat') {
      // Sliding back, rolling upright.
      const u = Math.min(1, this.phaseT / 6);
      const e = u * u * (3 - 2 * u);
      d.stroke = 1 + e;
      d.phase += dt * 4;
      d.arch = 0;
      d.fin = 0.3;
      d.flap = 0.3;
      d.flapPhase = this.t * 2;
      this.place(0.06 + e * 0.45, 0.3 * (1 - e), e * 0.4);
      if (Math.random() < dt * 5) this.splash(-0.2 + Math.random() * 0.4, 0.35);
      if (u >= 1) {
        this.phase = 'swim';
        this.phaseT = 0;
      }
    } else {
      // Out to sea, diving out of sight.
      d.stroke = 1.8;
      d.phase += dt * 5;
      d.arch = 0.1;
      d.fin = 0.1;
      d.flap = 0;
      const u = this.phaseT / 12;
      this.place(0.51 + this.phaseT * 0.35, 0, 0.4 + u * 3.5);
      if (this.phaseT < 4 && Math.random() < dt * 3) this.splash(-0.4, 0.3);
      if (u >= 1) {
        this.phase = 'done';
        this.group.visible = false;
      }
    }
    poseWhale(this.rig, d);
    return freed;
  }

  /**
   * Along the beach line: `back` whale lengths seaward from where it stranded, rolled over by
   * `roll` radians, and sunk `sink` below where it lay.
   */
  private place(back: number, roll: number, sink: number): void {
    const s = this.site;
    const x = s.x - s.ux * L * back, z = s.z - s.uz * L * back;
    const g = Math.max(SEA_SURFACE - 0.3, Math.min(this.ground, this.world.heightAt(x, z)));
    this.root.position.set(x, g + WHALE_GIRTH * L * 0.62 - sink, z);
    this.root.rotation.set(0, this.yaw, roll, 'YXZ');
    this.shadow.position.set(x, g + 0.012, z);
    this.shadow.rotation.y = this.yaw;
  }

  /** Spray where part of it meets the water: `along` whale lengths from the middle (toward the head). */
  private splash(along: number, strength: number): void {
    const p = this.root.position, s = this.site;
    const x = p.x + s.ux * L * along, z = p.z + s.uz * L * along;
    if (this.world.heightAt(x, z) < SEA_SURFACE) this.water.disturb(x, z, strength);
  }

  dispose(): void {
    // (The whale geometry is shared with the whales out at sea: only the material is this one's own.)
    this.group.removeFromParent();
    (this.rig.mesh.material as THREE.Material).dispose();
  }
}
