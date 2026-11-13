import * as THREE from 'three';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { CreatureAsset, CreatureRig, loadCreature } from './creatureAssets';

type EelState = 'lurk' | 'swim' | 'hide';

export interface Eel {
  /** The crevice it lives in, and the sea floor there. */
  hx: number;
  hz: number;
  bed: number;
  /** Which way it faces out of the crevice, and which way round its swim loop goes. */
  facing: number;
  side: number;
  /** Nose to tail (world units), and the radius of its swim loop. */
  length: number;
  loopR: number;
  state: EelState;
  timer: number;
  /** How far round its loop (0..2π) while swimming. */
  loop: number;
  /** How far its nose is out of the crevice, along its body (world units; ≤ 0 hidden). */
  out: number;
  /** Where it is and which way it points (for posing; also handy for a wildlife camera). */
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  /** Head sway while lurking. */
  seed: number;
}

export const MORAY = {
  /** Eels per island (fewer if there aren't enough suitable crevices). */
  count: [8, 14] as [number, number],
  /** Crevices must be at least this far apart, and on a sea floor between these heights. */
  spacing: 3,
  bed: [-3.2, -0.45] as [number, number],
  length: [0.45, 0.65] as [number, number],
  /** Fraction of its length shown while lurking, and the tilt of the body rising out of the crevice. */
  lurkOut: 0.42,
  lurkPitch: 0.55,
  /** Cruising and bolting speeds (world units / s). */
  swimSpeed: 0.32,
  hideSpeed: 1.6,
  /** A disturbance this close sends it back into its crevice. */
  scareRadius: 3,
  /** Rigs are posed only on screen and within this distance of the camera. */
  rigRange: 50,
};

/** Distance the eel model travels per Swim / Swim fast cycle, in body lengths (to match its wave to its speed). */
const SWIM_STRIDE = 0.6;
const SWIM_SECS = 2.8, FAST_SECS = 1.45;

/**
 * Moray eels living in crevices among the reef boulders: most of the time just the head and front
 * of the body show, rising out of the hole, swaying and gaping (Idle); now and then one slides out
 * and swims a short loop over the reef and back in (Swim); anything disturbing nearby — a boat
 * passing over, the pointer — sends it shooting back into its hole (Swim fast), to edge out again
 * a while later.
 *
 * The eels simulate everywhere (it's cheap); the artist's model is drawn as a skinned rig only for
 * the ones on screen and near the camera. Same seed and homes → the same eels.
 */
export class MorayEels {
  readonly group = new THREE.Group();
  readonly list: Eel[] = [];
  /** Optional: points that scare eels this frame (e.g. boats); set by the owner. */
  threats: (() => { x: number; z: number }[]) | null = null;
  private model: CreatureAsset | null = null;
  private rigs: (CreatureRig | undefined)[] = [];
  private rng: RNG;
  private time = 0;

  constructor(private world: World, homes: { x: number; z: number }[]) {
    this.group.name = 'moray-eels';
    this.rng = new RNG(world.seed * 311 + 7);
    this.place(homes);
    // No models where there's no page to load them into (tests): the stand-in stays.
    if (typeof document !== 'undefined') try { loadCreature('moray-eel').then((a) => (this.model = a)).catch(() => undefined); } catch { /* stand-in stays */ }
  }

  /** Pick well-spaced crevices under water from the candidate homes (in a seeded order). */
  private place(homes: { x: number; z: number }[]): void {
    const w = this.world, r = this.rng, C = MORAY;
    const cand = homes.filter((h) => {
      const b = w.heightAt(h.x, h.z);
      return b >= C.bed[0] && b <= C.bed[1] && Math.abs(h.x) < w.half && Math.abs(h.z) < w.half;
    });
    for (let k = cand.length - 1; k > 0; k--) {
      const j = r.int(0, k);
      [cand[k], cand[j]] = [cand[j], cand[k]];
    }
    const want = r.int(C.count[0], C.count[1]);
    for (const h of cand) {
      if (this.list.length >= want) break;
      if (this.list.some((e) => Math.hypot(e.hx - h.x, e.hz - h.z) < C.spacing)) continue;
      const length = r.range(C.length[0], C.length[1]);
      const bed = w.heightAt(h.x, h.z);
      const facing = r.range(0, Math.PI * 2);
      this.list.push({
        hx: h.x, hz: h.z, bed, facing, side: r.chance(0.5) ? 1 : -1, length, loopR: r.range(0.6, 1.1),
        state: 'lurk', timer: r.range(15, 60), loop: 0, out: length * C.lurkOut,
        x: h.x, y: bed, z: h.z, heading: facing, pitch: -C.lurkPitch, seed: r.range(0, 100),
      });
    }
  }

  /** Send any eel within `r` of (x, z) back into its crevice. */
  scare(x: number, z: number, r = MORAY.scareRadius): void {
    for (const e of this.list) {
      if (e.state === 'hide' || Math.hypot(e.x - x, e.z - z) > r) continue;
      e.state = 'hide';
      e.timer = this.rng.range(8, 20);
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const ts = this.threats?.();
    if (ts) for (const t of ts) this.scare(t.x, t.z);
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      this.think(e, dt);
      this.pose(i, e, dt);
    }
  }

  private think(e: Eel, dt: number): void {
    const C = MORAY, lurkOut = e.length * C.lurkOut;
    e.timer -= dt;
    switch (e.state) {
      case 'lurk':
        // Edge out to the lurking depth (slowly, after hiding), then wait.
        e.out = Math.min(lurkOut, e.out + dt * 0.12);
        if (e.timer <= 0 && e.out >= lurkOut) {
          e.state = 'swim';
          e.loop = 0;
        }
        break;
      case 'swim': {
        // Slide the rest of the way out along the loop's start, round, and back in.
        e.loop += (dt * C.swimSpeed) / e.loopR;
        e.out = Math.min(e.length * 1.2, e.out + dt * C.swimSpeed);
        if (e.loop >= Math.PI * 2) {
          e.state = 'lurk';
          e.loop = 0;
          e.out = lurkOut;
          e.timer = this.rng.range(20, 70);
        }
        break;
      }
      case 'hide':
        e.loop = 0;
        e.out = Math.max(-0.05, e.out - dt * C.hideSpeed);
        if (e.timer <= 0) {
          e.state = 'lurk';
          e.timer = this.rng.range(15, 40);
        }
        break;
    }
    // Where it is: rising from the crevice, or out on its loop (tangent to the facing at the hole).
    const fx = Math.sin(e.facing), fz = Math.cos(e.facing);
    if (e.state === 'swim' && e.out >= e.length) {
      const th = e.loop, R = e.loopR, rx = fz * e.side, rz = -fx * e.side;
      const cx = e.hx + rx * R, cz = e.hz + rz * R;
      e.x = cx - rx * R * Math.cos(th) + fx * R * Math.sin(th);
      e.z = cz - rz * R * Math.cos(th) + fz * R * Math.sin(th);
      e.heading = Math.atan2(rx * Math.sin(th) + fx * Math.cos(th), rz * Math.sin(th) + fz * Math.cos(th));
      const bed = this.world.heightAt(e.x, e.z);
      e.y = Math.max(bed, e.bed) + 0.1 + 0.15 * Math.sin(th / 2);
      // Level off once clear of the hole; nose down again as it comes home.
      const k = Math.min(1, th / 0.6, (Math.PI * 2 - th) / 0.6);
      e.pitch = -C.lurkPitch * (1 - k);
    } else {
      // Along its tilted body axis: the nose is `out` beyond the crevice mouth.
      const c = Math.cos(C.lurkPitch), s = Math.sin(C.lurkPitch);
      e.heading = e.facing + (e.state === 'lurk' ? Math.sin(this.time * 0.4 + e.seed) * 0.35 : 0);
      e.pitch = -C.lurkPitch;
      e.x = e.hx + Math.sin(e.heading) * e.out * c;
      e.z = e.hz + Math.cos(e.heading) * e.out * c;
      e.y = e.bed + e.out * s;
    }
  }

  /** Pose the eel's rig (made on first sight) or hide it. The rig's origin is its nose. */
  private pose(i: number, e: Eel, dt: number): void {
    let rig = this.rigs[i];
    const show = !!this.model && e.out > 0 && View.sees(e.x, e.y, e.z, e.length) && View.dist2(e.x, e.y, e.z) < MORAY.rigRange * MORAY.rigRange;
    if (!show) {
      if (rig) rig.root.visible = false;
      return;
    }
    if (!rig) {
      const a = this.model!, k = e.length / a.length;
      rig = this.rigs[i] = new CreatureRig(a, e.length);
      rig.body.position.set(-(a.box.min.x + a.box.max.x) / 2 * k, -(a.box.min.y + a.box.max.y) / 2 * k, -a.box.max.z * k);
      rig.root.rotation.order = 'YXZ';
      this.group.add(rig.root);
    }
    rig.root.visible = true;
    rig.root.position.set(e.x, e.y, e.z);
    rig.root.rotation.set(e.pitch, e.heading, 0);
    if (e.state === 'hide') rig.play('Swim fast', 0.15, -(MORAY.hideSpeed * FAST_SECS) / (SWIM_STRIDE * e.length));
    else if (e.state === 'swim') rig.play('Swim', 0.6, (MORAY.swimSpeed * SWIM_SECS) / (SWIM_STRIDE * e.length));
    else rig.play('Idle', 0.8, 1);
    rig.update(dt);
  }

  dispose(): void {
    for (const r of this.rigs) r?.dispose();
    this.rigs = [];
  }
}
