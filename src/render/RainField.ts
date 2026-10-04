import * as THREE from 'three';
import { WORLD } from '../config';
import { RNG } from '../world/rng';

/** Where and how many drops: the whole map (seen from above), or a box that follows the view. */
export interface RainOptions {
  count: number;
  /** Width of the square the drops cover, and the height they fall through. */
  span: number;
  height: number;
  /** Follows the camera (the box is centred on the point looked at each frame). */
  local: boolean;
  seed: number;
}

const MAP_RAIN: RainOptions = { count: 16000, span: WORLD.size + 24, height: 56, local: false, seed: 882391 };

/**
 * Rain, animated on the GPU in a single draw call. Ordinary rain is light and fine: a sparse
 * scatter of short, faint streaks falling gently. In a storm it pours: every drop falls, streaks
 * lengthen and slant in the wind, and it comes down hard and fast. One field covers the whole map
 * (for the view from above); a denser one fills a box round the point the camera looks at, so the
 * rain is there close up too.
 */
export class RainField {
  readonly lines: THREE.LineSegments;
  private motion = { value: new THREE.Vector2() };
  private center = { value: new THREE.Vector3() };
  /** Share of the drops falling (light rain shows a sparse subset), streak stretch and wind slant. */
  private density = { value: 0.3 };
  private stretch = { value: 1 };
  private slant = { value: 0.12 };
  private opts: RainOptions;

  constructor(opts: Partial<RainOptions> = {}) {
    const o = (this.opts = { ...MAP_RAIN, ...opts });
    const rng = new RNG(o.seed), count = o.count, span = o.span;
    const positions = new Float32Array(count * 6), tails = new Float32Array(count * 2);
    const lengths = new Float32Array(count * 2), seeds = new Float32Array(count * 2);
    // Stratified coverage prevents random holes in the weather when viewed from above.
    const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
    for (let i = 0; i < count; i++) {
      const x = ((i % columns + rng.next()) / columns - 0.5) * span;
      const z = ((Math.floor(i / columns) + rng.next()) / rows - 0.5) * span;
      const y = rng.range(0, o.height), length = rng.range(0.20, 0.42), seed = rng.next();
      positions.set([x, y, z, x, y, z], i * 6);
      tails[i * 2 + 1] = 1;
      lengths[i * 2] = lengths[i * 2 + 1] = length;
      seeds[i * 2] = seeds[i * 2 + 1] = seed;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aTail', new THREE.BufferAttribute(tails, 1));
    geometry.setAttribute('aLength', new THREE.BufferAttribute(lengths, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.LineBasicMaterial({ color: 0xc9d8e1, transparent: true, opacity: 0, depthWrite: false, fog: true });
    const half = (span / 2).toFixed(1), S = span.toFixed(1), Hh = o.height.toFixed(1);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRainMotion = this.motion;
      shader.uniforms.uRainCenter = this.center;
      shader.uniforms.uDensity = this.density;
      shader.uniforms.uStretch = this.stretch;
      shader.uniforms.uSlant = this.slant;
      shader.vertexShader = 'uniform vec2 uRainMotion; uniform vec3 uRainCenter; uniform float uDensity; uniform float uStretch; uniform float uSlant; attribute float aTail; attribute float aLength; attribute float aSeed;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        // Wrapped round the centre (the map's middle, or the point the camera looks at).
        transformed.x = uRainCenter.x + mod(position.x + uRainMotion.x - uRainCenter.x + ${half}, ${S}) - ${half};
        transformed.z = uRainCenter.z + mod(position.z - uRainCenter.z + ${half}, ${S}) - ${half};
        transformed.y = uRainCenter.y + mod(position.y - uRainMotion.y, ${Hh}) - 2.0;
        float len = aLength * uStretch;
        transformed += aTail * vec3(len * uSlant, len, len * 0.035);
        // Drops beyond today's density aren't falling: drop them far below the island.
        if (aSeed > uDensity) transformed.y -= 1000.0;
      `);
    };
    material.customProgramCacheKey = () => `rain-${o.local ? 'near' : 'map'}-${span}-${o.height}`;
    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 16;
  }

  /** `intensity` 0..1 (0.6 for ordinary rain), `storm` 0..1 how much of a storm it is; `view` the point looked at. */
  update(realDt: number, intensity: number, storm: number, view?: THREE.Vector3): void {
    this.lines.visible = intensity > 0.02;
    const mat = this.lines.material as THREE.LineBasicMaterial;
    const near = this.opts.local;
    // Light rain: faint, sparse and fine; a storm: dense, long, hard, slanting streaks.
    mat.opacity = intensity * (near ? 0.42 + 0.14 * storm : 0.36 + 0.22 * storm);
    mat.color.setRGB(0.79 - 0.12 * storm, 0.85 - 0.1 * storm, 0.88 - 0.06 * storm);
    this.density.value = Math.min(1, near ? intensity * 0.55 + storm * 0.67 : intensity * 0.5 + storm * 0.72);
    this.stretch.value = (near ? 0.55 : 0.75) + 1.15 * storm;
    this.slant.value = 0.12 + 0.5 * storm;
    if (!this.lines.visible) return;
    if (near && view) this.center.value.set(view.x, Math.max(0, view.y), view.z);
    this.motion.value.x = (this.motion.value.x + (0.8 + storm * 5) * realDt) % this.opts.span;
    this.motion.value.y = (this.motion.value.y + (11 + storm * 19) * realDt) % this.opts.height;
  }
}
