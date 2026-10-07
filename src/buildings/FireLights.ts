import * as THREE from 'three';
import { View } from '../render/View';

/** A lit fire or torch that can glow and light its surroundings. */
export interface FireSpot {
  /** Stable while the fire exists (building id and torch). */
  key: string;
  pos: THREE.Vector3;
  /** Ground height under it (the glow is laid there). */
  ground: number;
  /** Campfires, bonfires, fire pits and the hall's hearth: brighter and wider than a torch. */
  big: boolean;
}

/** How many fires get a real (lighting) point light. */
export const FIRE_LIGHTS = 8;
const MAX_GLOWS = 256;
/** Seconds for a real light to fade fully in or out. */
const FADE = 0.35;

/**
 * Firelight at night that holds steady however the camera moves:
 *  - every lit fire lays a soft warm pool of light on the ground beneath it (one cheap instanced
 *    draw), so no fire ever goes dark when zooming or panning;
 *  - a small pool of real point lights lights walls and villagers round the fires that matter
 *    most: on screen, near the middle of the view, big fires first. A light stays with its fire
 *    while that fire is still among the best, and fades rather than popping when it moves on;
 *  - both flicker gently together (slow, overlapping waves, no strobing).
 */
export class FireLights {
  readonly group = new THREE.Group();
  readonly lights: { light: THREE.PointLight; key: string | null; level: number; want: boolean; big: boolean; phase: number }[] = [];
  readonly glow: THREE.InstancedMesh;
  private glowMat: THREE.ShaderMaterial;
  private timer = 0;
  private m4 = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor() {
    this.group.name = 'Fire lights';
    for (let i = 0; i < FIRE_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffa04a, 0, 8, 1.6);
      light.castShadow = false;
      this.group.add(light);
      this.lights.push({ light, key: null, level: 0, want: false, big: false, phase: 0 });
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uNight: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vUv = uv;
          vec3 o = instanceMatrix[3].xyz;
          float ph = o.x * 1.7 + o.z * 2.3;
          float f = 1.0 + 0.07 * sin(uTime * 2.1 + ph) + 0.05 * sin(uTime * 3.3 + ph * 1.3) + 0.03 * sin(uTime * 5.9 + ph * 0.7);
          vCol = instanceColor * f;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - r), 2.2);
          gl_FragColor = vec4(vCol * a * uNight, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.glow = new THREE.InstancedMesh(geo, this.glowMat, MAX_GLOWS);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 3), 3);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 11;
    this.glow.name = 'Fire ground glow';
    this.group.add(this.glow);
  }

  /**
   * @param fires every lit fire this frame (empty by day)
   * @param night 0 (day) .. 1 (night)
   */
  update(dt: number, time: number, night: number, fires: FireSpot[], camTarget: THREE.Vector3): void {
    const dusk = THREE.MathUtils.smoothstep(night, 0.12, 0.35);
    this.glowMat.uniforms.uNight.value = dusk;
    this.glowMat.uniforms.uTime.value = time;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.25;
      this.layGlows(fires);
      this.choose(fires, camTarget);
    }
    const step = dt / FADE;
    for (const l of this.lights) {
      l.level = THREE.MathUtils.clamp(l.level + (l.want ? step : -step), 0, 1);
      if (l.level === 0 && !l.want) l.key = null;
      const ph = l.phase;
      const f = 1 + 0.07 * Math.sin(time * 2.1 + ph) + 0.05 * Math.sin(time * 3.3 + ph * 1.3) + 0.03 * Math.sin(time * 5.9 + ph * 0.7);
      // Only ever dimmed, never hidden: changing how many lights are visible makes every lit
      // material recompile its shader (a visible hitch at dusk and dawn).
      l.light.intensity = dusk * l.level * (l.big ? 3.2 : 1.9) * f;
    }
  }

  /** One warm pool on the ground under each fire. */
  private layGlows(fires: FireSpot[]): void {
    let n = 0;
    for (const f of fires) {
      if (n >= MAX_GLOWS) break;
      // Torches high on a roof or tower light the ground below less.
      const lift = Math.max(0, f.pos.y - f.ground);
      const k = THREE.MathUtils.clamp(1 - lift / 4, 0.25, 1);
      const r = (f.big ? 3.4 : 1.7) * (1 + lift * 0.15);
      this.m4.makeScale(r * 2, 1, r * 2).setPosition(f.pos.x, f.ground + 0.04, f.pos.z);
      this.glow.setMatrixAt(n, this.m4);
      this.col.setRGB(1.0, 0.52, 0.18).multiplyScalar((f.big ? 0.32 : 0.28) * k);
      this.glow.setColorAt(n, this.col);
      n++;
    }
    this.glow.count = n;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  /** Give the real lights to the best fires, keeping each where it is while its fire still qualifies. */
  private choose(fires: FireSpot[], camTarget: THREE.Vector3): void {
    const score = (f: FireSpot) =>
      f.pos.distanceTo(camTarget) / (f.big ? 2.2 : 1) + (View.sees(f.pos.x, f.pos.y, f.pos.z, f.big ? 4 : 2) ? 0 : 1000);
    // Fires already lit get a head start, so a light near the cut-off does not flip back and forth.
    const held = new Set(this.lights.filter((l) => l.want).map((l) => l.key));
    const best = fires.map((f) => ({ f, s: score(f) * (held.has(f.key) ? 0.8 : 1) })).sort((a, b) => a.s - b.s).slice(0, FIRE_LIGHTS);
    const keep = new Map(best.map((b) => [b.f.key, b.f]));
    for (const l of this.lights) l.want = l.key !== null && keep.has(l.key);
    for (const { f } of best) {
      if (this.lights.some((l) => l.key === f.key)) continue;
      // A light that has finished fading out (or was never used) moves to the new fire.
      const free = this.lights.find((l) => !l.want && l.level === 0);
      if (!free) break;
      free.key = f.key;
      free.want = true;
      free.big = f.big;
      free.phase = f.pos.x * 1.7 + f.pos.z * 2.3;
      free.light.position.set(f.pos.x, f.pos.y + (f.big ? 0.45 : 0.25), f.pos.z);
      free.light.distance = f.big ? 11 : 7;
    }
  }
}
