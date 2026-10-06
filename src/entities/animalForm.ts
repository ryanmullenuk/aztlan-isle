import * as THREE from 'three';

/** Nose-forward silhouette sections: z, centre height, half-width, top and bottom radii.
 * Broad flat facets join cleanly, without intersecting primitive seams across the torso.
 * Caps and winding are explicit so these remain solid in shadows and either camera mode.
 */
export type AnimalSection = readonly [number, number, number, number, number];
export function animalForm(sections: readonly AnimalSection[], sides = 12): THREE.BufferGeometry {
  const p: number[] = [], ids: number[] = [];
  for (const [z, y, w, top, bottom] of sections) {
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2, sy = Math.sin(a);
      p.push(Math.cos(a) * w, y + sy * (sy >= 0 ? top : bottom), z);
    }
  }
  for (let k = 0; k < sections.length - 1; k++) for (let j = 0; j < sides; j++) {
    const a = k * sides + j, b = k * sides + (j + 1) % sides;
    ids.push(a, b, a + sides, b, b + sides, a + sides);
  }
  for (const k of [0, sections.length - 1]) {
    const centre = p.length / 3;
    p.push(0, sections[k][1], sections[k][0]);
    for (let j = 0; j < sides; j++) {
      const a = k * sides + j, b = k * sides + (j + 1) % sides;
      ids.push(centre, k === 0 ? b : a, k === 0 ? a : b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(ids);
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}
