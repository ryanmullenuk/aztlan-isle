import * as THREE from 'three';
import { FX } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { SEA_SURFACE } from '../water/Water';
import { habitatFit } from './Habitat';

/**
 * Strings of little bubbles rising from vents in the reefs: each vent breathes out a burst every
 * so often, the bubbles wobbling as they climb and vanishing at the surface. One draw call for
 * the whole sea; every bubble's path is worked out in the vertex shader from the clock.
 */
export class ReefBubbles {
  readonly points: THREE.Points;
  /** Vents (for tests and debugging). */
  readonly vents: { x: number; y: number; z: number }[] = [];

  constructor(world: World, reefs: { x: number; z: number; r: number }[]) {
    const origin: number[] = [], seed: number[] = [];
    for (const reef of reefs) {
      const rng = new RNG(world.seed * 53 + Math.round(reef.x * 41) + Math.round(reef.z * 211));
      for (let v = 0, n = rng.int(2, 3); v < n; v++) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * reef.r;
        const x = reef.x + Math.cos(a) * d, z = reef.z + Math.sin(a) * d;
        if (habitatFit(world, x, z, 0.2) <= 0) continue;
        const y = world.heightAt(x, z) + 0.05, vent = rng.next();
        this.vents.push({ x, y, z });
        for (let k = 0, m = rng.int(5, 8); k < m; k++) {
          origin.push(x + rng.range(-0.06, 0.06), y, z + rng.range(-0.06, 0.06));
          // (place in the string 0..1, the vent's own timing, size, wobble phase)
          seed.push(k / m + rng.range(-0.04, 0.04), vent, rng.range(0.6, 1.4), rng.next());
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(origin, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: FX.uTime, uNight: FX.uNight, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uScale;
        varying float vAlpha;
        void main() {
          float rise = ${(SEA_SURFACE - 0.03).toFixed(3)} - position.y;
          // Each vent breathes: a burst roughly every nine seconds, on its own timing.
          float breath = uTime * 0.11 + aSeed.y * 7.0;
          float burst = smoothstep(0.0, 0.08, fract(breath)) * (1.0 - smoothstep(0.45, 0.6, fract(breath)));
          float u = fract(uTime * (0.34 + aSeed.w * 0.12) / max(rise, 0.3) + aSeed.x);
          vec3 p = position;
          p.y += u * rise;
          float wob = uTime * (2.1 + aSeed.w) + aSeed.w * 40.0;
          p.x += sin(wob) * 0.035 * u + sin(uTime * 1.05 - (position.x * 0.31 + position.z * 0.22)) * 0.05 * u;
          p.z += cos(wob * 0.8) * 0.035 * u;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // Bubbles swell a little as they climb.
          gl_PointSize = aSeed.z * (0.7 + 0.6 * u) * uScale / max(-mv.z, 0.1);
          vAlpha = burst * smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.9, 1.0, u)) * (1.0 - smoothstep(22.0, 34.0, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          if (r > 1.0 || vAlpha < 0.01) discard;
          // A glassy bead: a bright rim, a faint body and a highlight up and to the left.
          float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
          float glint = 1.0 - smoothstep(0.0, 0.28, length(c - vec2(-0.14, -0.16)) * 2.0);
          float a = (rim * 0.75 + 0.14 + glint * 0.8) * vAlpha;
          gl_FragColor = vec4(vec3(0.86, 0.97, 1.0) * mix(1.0, 0.35, uNight), a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'reef-bubbles';
    this.points.renderOrder = 9;
    this.points.frustumCulled = false;
    // Point size follows the drawing buffer's height (set each frame: it changes with the window).
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
      const f = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
      mat.uniforms.uScale.value = 0.05 * h * f * 0.5;
    };
  }
}
