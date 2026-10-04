import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { flameGeometry } from './models';
import { FX, fireMaterial } from '../render/materials';

let emberMaterial: THREE.MeshBasicMaterial | undefined;
/**
 * The torch's own flame, enlarged, with a brighter core flame burning inside it (seen through the
 * outer flame's translucent edges) and a separate mesh of randomly drifting embers.
 */
export function villageFire(): THREE.Mesh {
  // A tall middle tongue among smaller ones leaning out round it, each swaying on its own
  // rhythm (the shader times each flame by where it stands), a hot core low in the middle.
  const flame = flameGeometry();
  flame.scale(6.5, 13, 6.5);
  const fire = new THREE.Mesh(flame, fireMaterial());
  // Translucent tongues draw after the sea (which writes depth), core last.
  fire.renderOrder = 12;
  const tongues: [number, number, number, number, number][] = [
    // angle, distance out, width, height, lean
    [0.3, 0.17, 4.6, 9.5, 0.22],
    [2.1, 0.19, 4.2, 8, 0.28],
    [3.9, 0.16, 4.8, 10, 0.2],
    [5.2, 0.2, 3.8, 6.8, 0.32],
  ];
  for (const [a, d, wd, ht, lean] of tongues) {
    const g = flameGeometry();
    g.scale(wd, ht, wd);
    const t = new THREE.Mesh(g, fireMaterial());
    t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    t.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
    t.renderOrder = 12;
    fire.add(t);
  }
  const coreGeo = flameGeometry();
  coreGeo.scale(4.2, 6.5, 4.2);
  const core = new THREE.Mesh(coreGeo, fireMaterial());
  core.position.set(0.02, 0, -0.02);
  core.renderOrder = 13;
  fire.add(core, fireEmbers(true));
  return fire;
}

/** Small sparks for torch/brazier flames; larger clouds for the communal fire. */
export function fireEmbers(large = false): THREE.Mesh {
  const b = new GeoBuilder();
  for (let k = 0; k < (large ? 24 : 7); k++) {
    b.add(P.sphere(large ? 0.012 + Math.random() * 0.012 : 0.004 + Math.random() * 0.003, 0),
      { color: new THREE.Color(3.0, 0.4 + Math.random() * 0.7, 0.025), sway: Math.random() * 100, leaf: large ? 1 : 0 },
      M.t(0, 0, 0, 0, Math.random() * 6.28, 0, 0.65, 1.5, 0.65));
  }
  if (!emberMaterial) {
    emberMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, fog: true });
    emberMaterial.onBeforeCompile = shader => {
      shader.uniforms.uTime = FX.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute vec2 aVeg;
        float emberHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }`);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float clock = uTime * (0.15 + emberHash(aVeg.x) * 0.1) + aVeg.x;
        float cycle = floor(clock);
        float life = fract(clock);
        float seed = aVeg.x + cycle * 19.7;
        float angle = emberHash(seed) * 6.28318 + life * (emberHash(seed + 3.0) - 0.5) * 2.0;
        float scale = mix(0.18, 1.0, aVeg.y);
        float spread = (0.12 + life * (0.25 + emberHash(seed + 1.0) * 0.65)) * scale;
        transformed *= sin(life * 3.14159);
        transformed += vec3(cos(angle) * spread,
          mix(0.14, 1.8, aVeg.y) + life * (2.0 + emberHash(seed + 2.0) * 1.6) * scale, sin(angle) * spread);`);
    };
    emberMaterial.customProgramCacheKey = () => 'random-fire-embers-v2';
  }
  const geo = b.build();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.0, 0), 3);
  return new THREE.Mesh(geo, emberMaterial);
}
