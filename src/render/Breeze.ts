import * as THREE from 'three';
import { World } from '../world/World';
import { RNG } from '../world/rng';

/** Occasional gentle gusts that stir the trees and grass (nothing blows across the ground). */
export class Breeze {
  readonly group = new THREE.Group();
  strength = 0;
  /** Island movement off: no gusts. */
  still = false;
  private rng: RNG;
  private wait: number;
  private age = 0;
  private duration = 0;
  private peak = 0;

  constructor(_world: World, seed: number) {
    // Decorative randomness never consumes the simulation's RNG.
    this.rng = new RNG(seed ^ 0x4c454146);
    this.wait = this.rng.range(3, 7);
    this.group.name = 'Breeze';
  }

  update(dt: number, _target: THREE.Vector3, _radius: number): void {
    // Real time keeps the breeze gentle at every simulation speed.
    dt = Math.min(0.1, Math.max(0, dt));
    if (this.still) {
      this.strength = 0;
      this.duration = 0;
      return;
    }
    if (this.duration > 0) {
      this.age += dt;
      const progress = Math.min(1, this.age / this.duration);
      this.strength = this.peak * Math.sin(Math.PI * progress) ** 2;
      if (progress === 1) {
        this.duration = 0;
        this.strength = 0;
        this.wait = this.rng.range(10, 24);
      }
    } else {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.age = 0;
        this.duration = this.rng.range(7, 12);
        this.peak = this.rng.range(0.35, 0.8);
      }
    }
  }
}
