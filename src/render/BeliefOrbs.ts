import * as THREE from 'three';
import type { Building } from '../buildings/Buildings';
import { Particles } from './Particles';

/** A glossy purple bubble (rim, lighter heart, a window highlight), drawn once. */
function bubbleTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const body = g.createRadialGradient(64, 70, 8, 64, 64, 60);
    body.addColorStop(0, 'rgba(226, 190, 255, 0.55)');
    body.addColorStop(0.55, 'rgba(168, 96, 236, 0.62)');
    body.addColorStop(0.86, 'rgba(120, 52, 200, 0.85)');
    body.addColorStop(1, 'rgba(96, 30, 170, 0)');
    g.fillStyle = body;
    g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    // A thin bright rim, and the window highlight up to the left.
    g.strokeStyle = 'rgba(236, 210, 255, 0.85)'; g.lineWidth = 3;
    g.beginPath(); g.arc(64, 64, 55, 0, Math.PI * 2); g.stroke();
    const hi = g.createRadialGradient(46, 40, 2, 46, 40, 22);
    hi.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    hi.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = hi;
    g.beginPath(); g.ellipse(46, 40, 22, 15, -0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.5)';
    g.beginPath(); g.ellipse(84, 90, 7, 4, -0.6, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The belief bubbles drawn: a purple bubble over each building with belief waiting, growing as it
 * fills (no numbers), bobbing gently, pulsing a little when full; tapped, it pops in a puff of
 * violet sparkles.
 */
export class BeliefOrbs {
  readonly group = new THREE.Group();
  private readonly mat: THREE.SpriteMaterial;
  private readonly sprites = new Map<number, THREE.Sprite>();
  private readonly pops: { sp: THREE.Sprite; t: number; s: number }[] = [];
  private readonly sparkles = new Particles(120, 0xd2a4ff, 0.95);
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private time = 0;

  constructor() {
    this.mat = new THREE.SpriteMaterial({ map: bubbleTexture(), transparent: true, depthWrite: false });
    this.group.name = 'beliefOrbs';
    this.group.add(this.sparkles.points);
  }

  /** Where a building's bubble floats, and how big it is drawn (world units). */
  private place(b: Building, fill: number, camDist: number, out: THREE.Vector3): number {
    const base = Math.min(1.3, 0.55 + Math.max(b.w, b.d) * 0.14) * Math.max(1, Math.min(2.2, camDist / 40));
    const s = base * (0.4 + 0.6 * Math.sqrt(fill)) * (fill >= 1 ? 1 + 0.05 * Math.sin(this.time * 3 + b.id) : 1);
    out.set(b.x, b.y + b.modelHeight + 0.35 + s * 0.5 + Math.sin(this.time * 1.6 + b.id * 1.7) * 0.08, b.z);
    return s;
  }

  /** Each frame: a bubble over every building in `list` whose fill (0..1) is at least `showFrom`. */
  update(list: Building[], fill: (b: Building) => number, showFrom: number, shown: boolean, camDist: number, dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    if (shown) for (const b of list) {
      const f = fill(b);
      if (f < showFrom || !b.complete || b.ruined) continue;
      seen.add(b.id);
      let sp = this.sprites.get(b.id);
      if (!sp) {
        sp = new THREE.Sprite(this.mat);
        sp.renderOrder = 28;
        this.sprites.set(b.id, sp);
        this.group.add(sp);
      }
      const s = this.place(b, f, camDist, sp.position);
      sp.scale.set(s, s, 1);
      sp.userData.b = b;
    }
    for (const [id, sp] of this.sprites) if (!seen.has(id)) { this.group.remove(sp); this.sprites.delete(id); }
    // Popping: a quick swell and fade.
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const k = p.t / 0.2;
      if (k >= 1) { this.group.remove(p.sp); (p.sp.material as THREE.Material).dispose(); this.pops.splice(i, 1); continue; }
      p.sp.scale.setScalar(p.s * (1 + 0.5 * k));
      (p.sp.material as THREE.SpriteMaterial).opacity = 1 - k;
    }
    this.sparkles.update(dt, -0.4);
  }

  /** The bubble under a tap (screen pixels on the canvas), nearest first, or null. */
  pick(x: number, y: number, camera: THREE.Camera, rect: DOMRect): Building | null {
    let best: Building | null = null, bestD = Infinity;
    for (const sp of this.sprites.values()) {
      this.v.copy(sp.position).project(camera);
      if (this.v.z > 1) continue;
      const sx = rect.left + (this.v.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-this.v.y * 0.5 + 0.5) * rect.height;
      // The bubble's radius on screen, and a generous margin for a finger.
      this.v2.copy(sp.position).add(new THREE.Vector3(0, sp.scale.y * 0.5, 0)).project(camera);
      const r = Math.max(22, Math.abs(this.v2.y - this.v.y) * 0.5 * rect.height * 1.25);
      const d = Math.hypot(x - sx, y - sy);
      if (d < r && d < bestD) { bestD = d; best = sp.userData.b as Building; }
    }
    return best;
  }

  /** Burst a building's bubble: it swells and fades, and violet sparkles scatter. */
  pop(b: Building): void {
    const sp = this.sprites.get(b.id);
    if (!sp) return;
    this.sprites.delete(b.id);
    sp.material = this.mat.clone();
    this.pops.push({ sp, t: 0, s: sp.scale.x });
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, up = Math.random();
      this.sparkles.spawn(sp.position.x, sp.position.y, sp.position.z, Math.cos(a) * (0.8 + up), 0.6 + up * 1.4, Math.sin(a) * (0.8 + up), 0.5 + Math.random() * 0.4, 0.07 + Math.random() * 0.06);
    }
  }
}
