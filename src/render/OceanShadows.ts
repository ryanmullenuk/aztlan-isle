import * as THREE from 'three';
import { SEA_SURFACE } from '../water/Water';

const patched = new WeakSet<THREE.Material>();
/** Projected shadows keep their land contrast, soften in the shallows and vanish below 1.5 units. */
export function oceanShadowStrength(y: number): number {
  const depth = Math.max(0, SEA_SURFACE - y);
  return (1 - THREE.MathUtils.smoothstep(depth, 0, .3) * .55) * (1 - THREE.MathUtils.smoothstep(depth, .25, 1.5));
}

export function patchOceanShadows(mat: THREE.MeshStandardMaterial): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  const previous = mat.onBeforeCompile, cacheKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vOceanShadowY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 oceanShadowWorld = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          oceanShadowWorld = batchingMatrix * oceanShadowWorld;
        #endif
        #ifdef USE_INSTANCING
          oceanShadowWorld = instanceMatrix * oceanShadowWorld;
        #endif
        vOceanShadowY = (modelMatrix * oceanShadowWorld).y;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float vOceanShadowY;
      float oceanShadowStrength() {
        float depth = max(0.0, ${SEA_SURFACE} - vOceanShadowY);
        return (1.0 - smoothstep(0.0, 0.3, depth) * 0.55) * (1.0 - smoothstep(0.25, 1.5, depth));
      }`);
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace(/directLight\.color \*= ([^;]+);/g,
      (_match, factor: string) => `directLight.color *= mix(1.0, (${factor}), oceanShadowStrength());`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lights);
  };
  mat.customProgramCacheKey = () => `${cacheKey}-ocean-shadow-fade-v1`;
  mat.needsUpdate = true;
}

export function fadeOceanShadows(scene: THREE.Object3D): void {
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.receiveShadow) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (mat instanceof THREE.MeshStandardMaterial) patchOceanShadows(mat);
    }
  });
}
