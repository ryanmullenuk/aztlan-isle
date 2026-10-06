import * as THREE from 'three';
import { RNG } from '../world/rng';
import type { Building } from './Buildings';

/** Temporary debris: keeps the original footprint occupied until the last stones sink. */
export class Demolition {
  readonly group = new THREE.Group();
  private age = 0;
  private rubble: THREE.InstancedMesh;
  private fragments: { x: number; z: number; size: number; fall: number; rotation: number }[] = [];
  private shells: THREE.Mesh[] = [];
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private scale = new THREE.Vector3();

  constructor(b: Building, private clear: () => void) {
    this.group.position.set(b.x, b.y, b.z);
    const rng = new RNG(b.id * 179 + 31);
    // Retain a private copy of the walls while the live building is removed from the simulation.
    for (const source of [b.foundation, b.complete ? b.finished : b.scaffold]) {
      if (!source?.visible) continue;
      const mesh = new THREE.Mesh(source.geometry.clone(), source.material);
      mesh.position.copy(source.position);
      mesh.rotation.copy(source.rotation);
      const shell = new THREE.Group();
      shell.rotation.y = b.group.rotation.y;
      shell.add(mesh); this.group.add(shell); this.shells.push(mesh);
    }
    const count = Math.min(100, Math.max(12, b.w * b.d * 4));
    this.rubble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), count);
    this.rubble.castShadow = this.rubble.receiveShadow = true;
    this.rubble.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colours = [0xa5967f, 0xc0a17a, 0x827365, 0x75533a];
    for (let i = 0; i < count; i++) {
      const size = Math.min(b.w, b.d, 1.6) * rng.range(0.12, 0.25);
      this.fragments.push({ x: rng.range(-b.w/2+size, b.w/2-size), z: rng.range(-b.d/2+size, b.d/2-size), size, fall: rng.range(0.4, 2), rotation: rng.range(0, Math.PI*2) });
      this.rubble.setColorAt(i, new THREE.Color(colours[i % colours.length]));
    }
    this.group.add(this.rubble);
    this.update(0);
  }

  update(dt: number): boolean {
    this.age += Math.max(0, dt);
    if (this.age >= 10) { this.dispose(); this.clear(); return true; }
    const collapse = Math.min(1, this.age / 1.2);
    for (const mesh of this.shells) {
      mesh.scale.y = Math.max(0.01, 1-collapse*collapse);
      mesh.position.x = Math.sin(this.age*35)*0.025*(1-collapse);
      mesh.visible = collapse < 1;
    }
    const sink = Math.max(0, (this.age-7)/3);
    this.fragments.forEach((f, i) => {
      this.position.set(f.x, f.size*0.45 + f.fall*(1-collapse)*(1-collapse) - sink*1.2, f.z);
      this.rotation.setFromEuler(new THREE.Euler(f.rotation*(1-collapse), f.rotation, f.rotation*collapse*0.4));
      this.scale.set(f.size, f.size*0.65, f.size);
      this.rubble.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    });
    this.rubble.instanceMatrix.needsUpdate = true;
    return false;
  }

  private dispose(): void {
    this.group.removeFromParent();
    for (const mesh of this.shells) mesh.geometry.dispose();
    this.rubble.geometry.dispose();
    (this.rubble.material as THREE.Material).dispose();
  }
}
