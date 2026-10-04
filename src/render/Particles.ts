import * as THREE from 'three';

/** Particle pool with per-particle alpha, used for wakes and splashes. */
export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private grow: Float32Array;
  private next = 0;
  private count = 0;
  constructor(private n: number, color: number, opacity = 1) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.grow = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setDrawRange(0, 0);
    for (const name of ['position', 'aAlpha', 'aSize']) (g.getAttribute(name) as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 600 }, uOpacity: { value: opacity } },
      vertexShader: `attribute float aAlpha; attribute float aSize; varying float vA; uniform float uScale;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = pow(smoothstep(0.5, 0.0, d), 1.6) * vA * 1.25 * uOpacity; if (a < 0.01) discard; gl_FragColor = vec4(uColor, min(a, 1.0)); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 14;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow = 0): void {
    if (life <= 0) return;
    const i = this.count < this.n ? this.count++ : this.next;
    this.next = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
  }
  /** Fill a dead slot from the end so only live particles are uploaded and drawn. */
  private copyParticle(last: number, i: number): void {
    if (i === last) return;
    for (let axis = 0; axis < 3; axis++) {
      this.pos[i * 3 + axis] = this.pos[last * 3 + axis];
      this.vel[i * 3 + axis] = this.vel[last * 3 + axis];
    }
    this.life[i] = this.life[last]; this.max[i] = this.max[last];
    this.size[i] = this.size[last]; this.grow[i] = this.grow[last];
  }
  update(dt: number, gravity = 0): void {
    if (this.count === 0) return;
    let count = this.count;
    const gravityStep = gravity * dt;
    for (let i = 0; i < count; i++) {
      if (this.life[i] <= dt) {
        this.copyParticle(--count, i);
        i--;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= gravityStep;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.max[i];
      this.alpha[i] = Math.max(0, t) * 0.7;
    }
    this.count = count;
    this.points.geometry.setDrawRange(0, count);
    if (this.count === 0) return;
    for (const name of ['position', 'aAlpha', 'aSize']) {
      const attr = this.points.geometry.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}
