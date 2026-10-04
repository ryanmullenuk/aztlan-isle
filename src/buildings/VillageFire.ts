import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { FX } from '../render/materials';

let material: THREE.MeshBasicMaterial | undefined;
/** Slender, rounded glowing flame tongues and drifting embers in one animated draw call. */
export function villageFire(): THREE.Mesh {
  const b = new GeoBuilder();
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4, inner = k > 3;
    const h = inner ? 1.7 + (k % 3) * 0.3 : 2.3 + (k % 4) * 0.35;
    const radius = inner ? 0.09 : 0.14;
    const profile: THREE.Vector2[] = [];
    for (let ring = 0; ring <= 32; ring++) {
      const t = ring / 32;
      // Rounded ends and a narrow billowing body, rather than a straight cone and sharp point.
      const width = Math.sqrt(Math.max(0, Math.sin(t * Math.PI))) * (1 - t * 0.45);
      profile.push(new THREE.Vector2(radius * width, t * h));
    }
    const g = new THREE.LatheGeometry(profile, 12);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / h;
      p.setX(i, p.getX(i) + Math.sin(y * 3 + k) * y * 0.1);
      p.setZ(i, p.getZ(i) + Math.cos(y * 2 + k) * y * 0.06);
    }
    b.add(g, { color: new THREE.Color(inner ? 3.1 : 2.4, inner ? 0.85 : 0.25 + (k % 3) * 0.07, 0.012), sway: k * 0.7 },
      M.t(Math.cos(a) * (inner ? 0.06 : 0.16), 0, Math.sin(a) * (inner ? 0.06 : 0.16)));
    g.dispose();
  }
  for (let k = 0; k < 28; k++) {
    b.add(P.sphere(0.012 + (k % 4) * 0.004, 0), { color: new THREE.Color(3.0, 0.5 + (k % 3) * 0.12, 0.015), mat: 1, sway: k / 28 }, M.t(0, 0, 0, 0, k, 0, 0.65, 1.5, 0.65));
  }
  if (!material) {
    material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, fog: true });
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = FX.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute vec2 aVeg;
        attribute float aMat;`);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aMat > 0.5) {
          float life = fract(uTime * (0.12 + aVeg.x * 0.06) + aVeg.x);
          float angle = aVeg.x * 57.0 + life * 3.0;
          transformed *= sin(life * 3.14159);
          transformed += vec3(cos(angle) * (0.1 + life * 0.45) + life * life * 0.3,
            1.5 + life * 3.4, sin(angle) * (0.1 + life * 0.4));
        } else {
          float height = position.y;
          transformed.x += sin(uTime * 1.6 + height * 1.4 + aVeg.x) * height * 0.022;
          transformed.z += cos(uTime * 1.3 + height * 1.1 + aVeg.x) * height * 0.018;
          transformed.y *= 0.97 + sin(uTime * 2.0 + aVeg.x) * 0.035;
        }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <opaque_fragment>', `
          outgoingLight *= 0.96 + 0.035 * sin(uTime * 3.0) + 0.02 * sin(uTime * 4.7);
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'village-fire-v2';
  }
  const geo = b.build();
  // Include shader-displaced embers in culling bounds.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, 0), 3);
  return new THREE.Mesh(geo, material);
}
