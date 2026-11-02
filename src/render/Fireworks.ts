import * as THREE from 'three';

/** Spark colours (linear, a little over 1 so the bloom catches them). */
const PALETTE: [number, number, number][] = [
  [1.6, 0.16, 0.1], // red
  [1.6, 0.85, 0.18], // gold
  [0.22, 1.5, 0.3], // green
  [0.25, 0.5, 1.8], // blue
  [1.2, 0.3, 1.6], // violet
  [1.5, 1.4, 1.2], // white
  [0.2, 1.4, 1.25], // turquoise
  [1.7, 0.35, 0.7], // pink
];
const GOLD: [number, number, number] = [1.6, 0.8, 0.22];
/** Spark size in world units (a point's size on screen follows its distance). */
const SPARK = 0.36;

type Burst = 'peony' | 'ring' | 'willow' | 'palm';
const BURSTS: Burst[] = ['peony', 'peony', 'ring', 'willow', 'palm'];

interface Rocket { x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; trail: number; scale: number }
interface Launch { at: number; x: number; y: number; z: number }

/** Most sparks alive at once (the oldest are recycled past this). */
const MAX = 1500;
const GRAVITY = 5.5;
const _dir = new THREE.Vector3();

/**
 * Firework displays: rockets climb on sparkling trails and burst into peonies, rings, golden
 * willows and palms, each with a bright flash. All sparks share one point cloud, drawn additively
 * (so they blaze at night and are faint by day); everything is simulated on the CPU in a fixed
 * pool, so a display costs one draw call. They are only light: nothing is set alight.
 */
export class Fireworks {
  readonly points: THREE.Points;
  /** Plays a sound at (x, z): 'fwlaunch' as a rocket goes up, 'fwbang' as it bursts. */
  onSound?: (name: string, x: number, z: number) => void;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private base = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private max = new Float32Array(MAX);
  private size0 = new Float32Array(MAX);
  /** Air drag, share of gravity felt, and whether it twinkles. */
  private drag = new Float32Array(MAX);
  private fall = new Float32Array(MAX);
  private twinkle = new Uint8Array(MAX);
  private count = 0;
  private next = 0;
  private rockets: Rocket[] = [];
  private queue: Launch[] = [];
  private clock = 0;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uViewH: { value: 800 }, uGlow: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute vec3 color; varying vec3 vC; uniform float uViewH; uniform float uGlow;
        void main() {
          vC = color * uGlow;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z, 2.0, uViewH * 0.02);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          // A hot white core inside a coloured glow.
          vec3 c = vC * a * a + vec3(smoothstep(0.1, 0.0, d)) * 0.35 * min(1.0, dot(vC, vec3(0.33)));
          if (a < 0.01) discard;
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.name = 'fireworks';
    this.points.frustumCulled = false;
    this.points.renderOrder = 18;
    this.points.visible = false;
  }

  /** Anything still in the sky or waiting to go up. */
  get active(): boolean {
    return this.count > 0 || this.rockets.length > 0 || this.queue.length > 0;
  }

  /**
   * A display of `rockets` launched from around (x, y, z) over several seconds, ending in a finale
   * of several at once.
   */
  show(x: number, y: number, z: number, rockets: number): void {
    let t = Math.max(this.clock, this.queue.length ? this.queue[this.queue.length - 1].at : 0) + 0.2;
    const finale = Math.max(2, Math.round(rockets * 0.3));
    for (let k = 0; k < rockets; k++) {
      const inFinale = k >= rockets - finale;
      t += inFinale ? 0.12 + Math.random() * 0.15 : 0.55 + Math.random() * 0.6;
      this.queue.push({ at: t, x: x + (Math.random() - 0.5) * 2.4, y, z: z + (Math.random() - 0.5) * 2.4 });
    }
  }

  /** Clear the sky at once (a new island, or leaving the game). */
  clear(): void {
    this.queue.length = 0;
    this.rockets.length = 0;
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  /**
   * `night` is 0 by day to 1 at night; `viewH` the drawing height in pixels. Rockets burst well
   * below the camera (however far in it is), so a display always opens out in front of the view.
   */
  update(dt: number, camera: THREE.Camera, viewH: number, night: number): void {
    this.clock += dt;
    if (!this.active) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    this.mat.uniforms.uViewH.value = viewH;
    this.mat.uniforms.uGlow.value = 0.5 + 0.95 * night;
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const l = this.queue.shift()!;
      // Burst height: up to ~24 above the ground, or about half the camera's height above it.
      const h = THREE.MathUtils.clamp((camera.position.y - l.y) * 0.5, 5, 24) * (0.8 + Math.random() * 0.35);
      const fuse = 1.05 + Math.random() * 0.35, a = Math.random() * Math.PI * 2, s = Math.random() * 0.12 * h;
      // Lean toward the camera so the burst lands over the middle of the view, not off its top
      // (a looking-down camera sees things high above the launch site near the top of the screen).
      camera.getWorldDirection(_dir);
      const flat = Math.hypot(_dir.x, _dir.z), lean = flat > 1e-3 ? (h * 0.7) / Math.max(0.35, -_dir.y / flat) / flat : 0;
      const lift = GRAVITY * 0.6;
      this.rockets.push({ x: l.x, y: l.y + 0.4, z: l.z, vx: Math.cos(a) * s - _dir.x * lean / fuse, vy: h / fuse + 0.5 * lift * fuse, vz: Math.sin(a) * s - _dir.z * lean / fuse, fuse, trail: 0, scale: h / 24 });
      this.onSound?.('fwlaunch', l.x, l.z);
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy -= GRAVITY * 0.6 * dt;
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      r.fuse -= dt;
      // A sparkling trail: a couple of warm sparks a frame, falling away behind.
      r.trail += dt * 60;
      for (; r.trail >= 1; r.trail--) {
        this.spark(r.x, r.y, r.z, (Math.random() - 0.5) * 0.8, -1 - Math.random() * 2, (Math.random() - 0.5) * 0.8, 0.35 + Math.random() * 0.3, SPARK * 0.55, GOLD, 2, 0.6, 1);
      }
      if (r.fuse <= 0) {
        this.burst(r.x, r.y, r.z, r.vx * 0.3, r.vz * 0.3, r.scale);
        this.rockets.splice(i, 1);
      }
    }
    this.step(dt);
  }

  /** `scale` shrinks a low burst (seen close up) to fit the view. */
  private burst(x: number, y: number, z: number, vx: number, vz: number, scale: number): void {
    const kind = BURSTS[Math.floor(Math.random() * BURSTS.length)];
    const a = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const b = Math.random() < 0.5 ? a : PALETTE[Math.floor(Math.random() * PALETTE.length)];
    this.onSound?.('fwbang', x, z);
    // The flash: one big, short-lived white bloom.
    this.spark(x, y, z, 0, 0, 0, 0.2, SPARK * 6 * Math.max(0.5, scale), [0.9, 0.8, 0.65], 0, 0, 0);
    const speed = (13 + Math.random() * 4) * Math.max(0.35, scale);
    if (kind === 'ring') {
      // A flat ring, tipped at a random angle.
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 1.2 - 0.6 + Math.PI / 2, 0, Math.random() * 1.2 - 0.6));
      const v = new THREE.Vector3();
      const n = 56;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2;
        v.set(Math.cos(t), 0, Math.sin(t)).applyQuaternion(tilt).multiplyScalar(speed);
        this.spark(x, y, z, v.x + vx, v.y, v.z + vz, 1.3 + Math.random() * 0.4, SPARK, k % 2 ? a : b, 1.6, 0.5, 0);
      }
      // A small bright heart in the middle.
      for (let k = 0; k < 14; k++) this.sphereSpark(x, y, z, vx, vz, speed * 0.25, 0.9, SPARK * 0.8, [1.5, 1.4, 1.2], 1.6, 0.5, 1);
    } else if (kind === 'willow') {
      // Long-lived golden strands that drift down and glitter.
      for (let k = 0; k < 90; k++) this.sphereSpark(x, y, z, vx, vz, speed * (0.75 + Math.random() * 0.3), 2.6 + Math.random() * 0.8, SPARK * 0.85, GOLD, 2.4, 0.55, 1);
    } else if (kind === 'palm') {
      // A few thick fronds, each a string of sparks, arching over.
      const v = new THREE.Vector3();
      for (let f = 0; f < 8; f++) {
        v.set(Math.random() - 0.5, 0.35 + Math.random() * 0.5, Math.random() - 0.5).normalize();
        for (let k = 0; k < 8; k++) {
          const s = speed * (0.55 + k * 0.07);
          this.spark(x, y, z, v.x * s + vx, v.y * s, v.z * s + vz, 1.5 + k * 0.08, SPARK * (1.2 - k * 0.06), k < 2 ? [1.5, 1.4, 1.2] : a, 1.5, 0.7, 0);
        }
      }
    } else {
      // Peony: a full sphere in one or two colours, with a twinkling core.
      for (let k = 0; k < 100; k++) this.sphereSpark(x, y, z, vx, vz, speed * (0.88 + Math.random() * 0.2), 1.4 + Math.random() * 0.5, SPARK, k % 2 ? a : b, 1.7, 0.5, k % 5 === 0 ? 1 : 0);
    }
  }

  private sphereSpark(x: number, y: number, z: number, vx: number, vz: number, s: number, life: number, size: number, c: [number, number, number], drag: number, fall: number, tw: number): void {
    // An even direction on the sphere.
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    this.spark(x, y, z, r * Math.cos(t) * s + vx, u * s, r * Math.sin(t) * s + vz, life, size, c, drag, fall, tw);
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: [number, number, number], drag: number, fall: number, tw: number): void {
    const i = this.count < MAX ? this.count++ : this.next;
    this.next = (i + 1) % MAX;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = c[0]; this.base[j + 1] = c[1]; this.base[j + 2] = c[2];
    this.life[i] = this.max[i] = life;
    this.size0[i] = size;
    this.drag[i] = drag;
    this.fall[i] = fall;
    this.twinkle[i] = tw;
  }

  /** Move a live spark from slot `from` into slot `to` (keeping the live ones packed at the front). */
  private move(from: number, to: number): void {
    if (from === to) return;
    for (let a = 0; a < 3; a++) {
      this.pos[to * 3 + a] = this.pos[from * 3 + a];
      this.vel[to * 3 + a] = this.vel[from * 3 + a];
      this.base[to * 3 + a] = this.base[from * 3 + a];
    }
    this.life[to] = this.life[from]; this.max[to] = this.max[from]; this.size0[to] = this.size0[from];
    this.drag[to] = this.drag[from]; this.fall[to] = this.fall[from]; this.twinkle[to] = this.twinkle[from];
  }

  private step(dt: number): void {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= dt) {
        this.move(--n, i);
        i--;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3, k = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - GRAVITY * this.fall[i] * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = this.life[i] / this.max[i];
      // Bright at first, fading out (and cooling toward orange) at the end.
      let f = Math.min(1, t * 2.2) * (0.35 + 0.65 * t);
      if (this.twinkle[i]) f *= 0.45 + 0.55 * Math.abs(Math.sin(this.clock * 31 + i * 1.7));
      const warm = 1 - Math.min(1, t * 3);
      this.col[j] = this.base[j] * f;
      this.col[j + 1] = this.base[j + 1] * f * (1 - warm * 0.4);
      this.col[j + 2] = this.base[j + 2] * f * (1 - warm * 0.7);
      this.size[i] = this.size0[i] * (0.6 + 0.4 * t);
    }
    if (n > this.count) n = this.count;
    this.count = n;
    if (this.next > n) this.next = n % MAX;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const name of ['position', 'color', 'aSize']) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}
