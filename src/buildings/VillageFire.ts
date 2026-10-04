import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { flameGeometry } from './models';
import { flameMaterial, FX } from '../render/materials';

let emberMaterial: THREE.MeshBasicMaterial | undefined;
/** The torch's own flame, enlarged, with a separate mesh of randomly drifting embers. */
export function villageFire(): THREE.Mesh {
  const flame = flameGeometry();
  flame.scale(8, 15, 8);
  const fire = new THREE.Mesh(flame, flameMaterial());
  const b = new GeoBuilder();
  for (let k = 0; k < 24; k++) {
    b.add(P.sphere(0.012 + Math.random() * 0.012, 0),
      { color: new THREE.Color(3.0, 0.4 + Math.random() * 0.7, 0.025), sway: Math.random() * 100 },
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
        float spread = 0.12 + life * (0.25 + emberHash(seed + 1.0) * 0.65);
        transformed *= sin(life * 3.14159);
        transformed += vec3(cos(angle) * spread,
          1.8 + life * (2.0 + emberHash(seed + 2.0) * 1.6), sin(angle) * spread);`);
    };
    emberMaterial.customProgramCacheKey = () => 'random-village-embers-v1';
  }
  const geo = b.build();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.0, 0), 3);
  fire.add(new THREE.Mesh(geo, emberMaterial));
  return fire;
}
