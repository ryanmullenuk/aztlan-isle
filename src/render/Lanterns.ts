import * as THREE from 'three';

/** Most lanterns aloft at once. */
const MAX = 400;
/** Seconds a lantern drifts before it burns out, far out over the sea. */
const LIFE = [70, 110] as const;

/**
 * Paper sky lanterns: warm glowing squares that lift from the islanders' hands, rise slowly,
 * sway, and drift out to sea on the evening breeze, flickering, until they fade into the dark.
 * One point cloud for all of them, drawn additively (brightest at night); a few hundred points
 * moved on the CPU each frame, so it costs next to nothing on a phone.
 */
export class Lanterns {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private glow = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private seed = new Float32Array(MAX);
  private count = 0;
  private clock = 0;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aGlow', new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uViewH: { value: 800 }, uNight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aGlow; varying float vG; uniform float uViewH;
        void main() {
          vG = aGlow;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(0.3 * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z, 2.0, uViewH * 0.03);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vG; uniform float uNight;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          // A paper lantern: a soft-edged, slightly tall square body with a bright flame low inside,
          // in a halo of warm light.
          float body = smoothstep(0.2, 0.15, abs(c.x)) * smoothstep(0.26, 0.2, abs(c.y + 0.02));
          float flame = smoothstep(0.12, 0.0, length(c - vec2(0.0, 0.08)));
          float halo = smoothstep(0.5, 0.0, length(c)) * 0.35;
          vec3 col = vec3(1.0, 0.42, 0.1) * body * 0.85 + vec3(1.0, 0.72, 0.3) * flame * 0.8 + vec3(1.0, 0.4, 0.08) * halo;
          float a = max(body, halo) * vG;
          if (a < 0.01) discard;
          gl_FragColor = vec4(col * vG * (0.45 + 0.75 * uNight), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.name = 'lanterns';
    this.points.frustumCulled = false;
    this.points.renderOrder = 17;
    this.points.visible = false;
  }

  /** Lanterns still aloft. */
  get active(): boolean {
    return this.count > 0;
  }

  /** Let one go from (x, y, z), to drift toward the sea along (sx, sz). */
  release(x: number, y: number, z: number, sx: number, sz: number): void {
    if (this.count >= MAX) return;
    const i = this.count++, j = i * 3, s = 0.14 + Math.random() * 0.08;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = sx * s + (Math.random() - 0.5) * 0.03;
    this.vel[j + 1] = 0.16 + Math.random() * 0.06;
    this.vel[j + 2] = sz * s + (Math.random() - 0.5) * 0.03;
    this.age[i] = 0;
    this.life[i] = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
    this.seed[i] = Math.random() * 100;
  }

  clear(): void {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  /** `night` 0 by day to 1 at night; `viewH` the drawing height in pixels. */
  update(dt: number, viewH: number, night: number): void {
    this.clock += dt;
    if (!this.count) { this.points.visible = false; return; }
    this.points.visible = true;
    this.mat.uniforms.uViewH.value = viewH;
    this.mat.uniforms.uNight.value = night;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // Burnt out: move the last one into its place.
        n--;
        const a = i * 3, b = n * 3;
        for (let k = 0; k < 3; k++) { this.pos[a + k] = this.pos[b + k]; this.vel[a + k] = this.vel[b + k]; }
        this.age[i] = this.age[n]; this.life[i] = this.life[n]; this.seed[i] = this.seed[n];
        i--;
        continue;
      }
      const j = i * 3, t = this.age[i], sd = this.seed[i];
      // Rising fast at first, then floating: the climb eases off, the breeze carries it out.
      const lift = Math.exp(-t / 25);
      const sway = Math.sin(this.clock * 0.7 + sd) * 0.02;
      this.pos[j] += (this.vel[j] * (1.4 - lift) + sway) * dt;
      this.pos[j + 1] += (this.vel[j + 1] * (0.25 + lift)) * dt;
      this.pos[j + 2] += (this.vel[j + 2] * (1.4 - lift) + Math.cos(this.clock * 0.6 + sd) * 0.02) * dt;
      const k = t / this.life[i];
      // Fade in as it leaves the hands, flicker, and dim away at the end.
      this.glow[i] = Math.min(1, t * 1.5) * (1 - k * k) * (0.82 + 0.18 * Math.sin(this.clock * 9 + sd * 3));
    }
    this.count = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const name of ['position', 'aGlow']) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}
