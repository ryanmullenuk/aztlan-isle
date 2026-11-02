import type * as THREE from 'three';

/**
 * Things made only later in play (an octopus's ink, a raiders' canoe), lent to the shader warm-up
 * so their shaders are compiled behind the splash too, not on the frame they first appear (a
 * hitch on iPhones). Each is added to the scene just for the warm-up, then taken away.
 */
export const warmShelf: THREE.Object3D[] = [];

/** Lend a sample object (a mesh with the material and kind of geometry it will use) to the warm-up. */
export function warmWith(sample: THREE.Object3D): void {
  warmShelf.push(sample);
}

/** Loads the warm-up waits for (character models and the like), so their shaders are warmed too. */
export const warmLoads: Promise<unknown>[] = [];
