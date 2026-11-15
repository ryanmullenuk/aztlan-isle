import * as THREE from 'three';

interface Cloud { puffs: THREE.Mesh[]; mat: THREE.MeshBasicMaterial; t: number; drift: THREE.Vector3[] }

/** Seconds a cloud spreads and fades. */
export const BLOOD = { secs: 14, puffs: 9 };

/**
 * Where a shark has taken someone: a cloud of red spreading through the water at the surface,
 * swirling outward and thinning until it is gone. Nothing else is left.
 */
export class BloodClouds {
  readonly group = new THREE.Group();
  private clouds: Cloud[] = [];
  private geo = new THREE.IcosahedronGeometry(0.5, 1);

  constructor() {
    this.group.name = 'Blood in the water';
  }

  get count(): number {
    return this.clouds.length;
  }

  /** How many clouds have been spawned, and where the latest was (for the sound of the taking). */
  spawned = 0;
  lastAt = { x: 0, z: 0 };

  spawn(x: number, y: number, z: number): void {
    this.spawned++;
    this.lastAt = { x, z };
    const mat = new THREE.MeshBasicMaterial({ color: 0x8e0f12, transparent: true, opacity: 0, depthWrite: false });
    const puffs: THREE.Mesh[] = [], drift: THREE.Vector3[] = [];
    for (let k = 0; k < BLOOD.puffs; k++) {
      const a = (k / BLOOD.puffs) * Math.PI * 2 + Math.random() * 0.6, r = k === 0 ? 0 : 0.15 + Math.random() * 0.25;
      const m = new THREE.Mesh(this.geo, mat);
      m.position.set(x + Math.cos(a) * r, y - 0.05 - Math.random() * 0.12, z + Math.sin(a) * r);
      m.scale.set(0.2, 0.08, 0.2);
      m.rotation.y = Math.random() * 6;
      m.renderOrder = 11;
      this.group.add(m);
      puffs.push(m);
      drift.push(new THREE.Vector3(Math.cos(a) * (0.08 + Math.random() * 0.1), 0, Math.sin(a) * (0.08 + Math.random() * 0.1)));
    }
    this.clouds.push({ puffs, mat, t: 0, drift });
  }

  /** Real seconds. */
  update(dt: number): void {
    for (const c of [...this.clouds]) {
      c.t += dt;
      const u = c.t / BLOOD.secs;
      // Blooms in fast, then spreads and thins.
      c.mat.opacity = Math.min(1, c.t / 0.6) * Math.max(0, 1 - u) * 0.72;
      const grow = 0.35 + Math.sqrt(Math.min(1, u * 1.6)) * 1.9;
      c.puffs.forEach((m, k) => {
        m.position.addScaledVector(c.drift[k], dt * (1 - u * 0.7));
        m.scale.set(grow * (0.8 + (k % 3) * 0.15), 0.12 + grow * 0.06, grow * (0.75 + (k % 2) * 0.2));
        m.rotation.y += dt * 0.08 * (k % 2 ? 1 : -1);
      });
      if (u >= 1) {
        for (const m of c.puffs) this.group.remove(m);
        c.mat.dispose();
        this.clouds = this.clouds.filter((x) => x !== c);
      }
    }
  }
}
