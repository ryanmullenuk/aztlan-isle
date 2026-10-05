import * as THREE from 'three';

/**
 * A layer only the shadow pass draws: cheap stand-ins that cast shadows for detailed meshes
 * (which then cast none themselves). The main view, the SSAO and depth passes never see it.
 */
export const SHADOW_LAYER = 7;

/**
 * Shadows once a frame, with the shadow-only layer. three.js re-renders every shadow map on each
 * scene render it is asked for (the post-processing passes ask many times a frame), so updates
 * are taken off automatic and `frameShadows` asks for one per frame. The shadow pass tests
 * objects against the main camera's layers, so that camera sees the shadow layer just while
 * the shadow map is drawn (the frame's render list is already built by then).
 */
export function setupShadows(renderer: THREE.WebGLRenderer): void {
  const sm = renderer.shadowMap as THREE.WebGLShadowMap & { render: (lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera) => void };
  sm.autoUpdate = false;
  const draw = sm.render;
  sm.render = function (lights, scene, camera) {
    const had = camera.layers.isEnabled(SHADOW_LAYER);
    camera.layers.enable(SHADOW_LAYER);
    try {
      draw.call(this, lights, scene, camera);
    } finally {
      if (!had) camera.layers.disable(SHADOW_LAYER);
    }
  };
}

/** Ask for the shadow map to be drawn (once) with this frame's first scene render. */
export function frameShadows(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.needsUpdate = true;
}

/**
 * A shadow stand-in for an instanced mesh: the same instances (sharing its matrix buffer and
 * bounds) drawn with a lighter shape, on the shadow-only layer. Keep its `count` in step with the
 * source's, and make a new one if the source's instance buffer is replaced.
 */
export function shadowProxy(src: THREE.InstancedMesh, geometry: THREE.BufferGeometry): THREE.InstancedMesh {
  const proxy = new THREE.InstancedMesh(geometry, src.material, 1);
  proxy.instanceMatrix = src.instanceMatrix;
  proxy.count = src.count;
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  proxy.layers.set(SHADOW_LAYER);
  proxy.frustumCulled = src.frustumCulled;
  if (!src.boundingSphere) src.computeBoundingSphere();
  proxy.boundingSphere = src.boundingSphere;
  proxy.name = `${src.name || 'mesh'} shadow`;
  return proxy;
}
