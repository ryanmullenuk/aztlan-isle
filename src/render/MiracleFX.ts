import * as THREE from 'three';
import { Particles } from './Particles';
import type { MiracleId, Swarm } from '../economy/Miracles';
import { POWERS } from '../config';

/** Ground height at (x, z). */
type Ground = (x: number, z: number) => number;

const GRID = 24;

/** A soft disc of light laid over the ground (it follows the terrain), fading in and out. */
class GroundGlow {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private uv: Float32Array;
  readonly mat: THREE.ShaderMaterial;
  constructor(color: number, ring = false) {
    const n = (GRID + 1) * (GRID + 1);
    this.pos = new Float32Array(n * 3);
    this.uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
      const k = j * (GRID + 1) + i;
      this.uv[k * 2] = (i / GRID) * 2 - 1;
      this.uv[k * 2 + 1] = (j / GRID) * 2 - 1;
      if (i < GRID && j < GRID) idx.push(k, k + GRID + 1, k + 1, k + 1, k + GRID + 1, k + GRID + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aUv', new THREE.BufferAttribute(this.uv, 2));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAmt: { value: 0 }, uFront: { value: 1 } },
      vertexShader: `attribute vec2 aUv; varying vec2 vUv; void main(){ vUv = aUv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: ring
        // A bright band at the wave front (uFront, 0..1 of the radius), a faint wash behind it.
        ? `uniform vec3 uColor; uniform float uAmt; uniform float uFront; varying vec2 vUv;
           void main(){ float d = length(vUv); if (d > 1.0) discard;
             float band = exp(-pow((d - uFront) * 9.0, 2.0)); float wash = step(d, uFront) * 0.25;
             float a = (band + wash) * uAmt * smoothstep(1.0, 0.85, d); if (a < 0.01) discard; gl_FragColor = vec4(uColor * a, a); }`
        : `uniform vec3 uColor; uniform float uAmt; varying vec2 vUv;
           void main(){ float d = length(vUv); if (d > 1.0) discard;
             float a = pow(smoothstep(1.0, 0.0, d), 1.4) * uAmt; if (a < 0.01) discard; gl_FragColor = vec4(uColor * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 13;
  }
  /** Lay it over the ground round (x, z). */
  place(x: number, z: number, r: number, ground: Ground): void {
    for (let k = 0; k < this.uv.length / 2; k++) {
      const px = x + this.uv[k * 2] * r, pz = z + this.uv[k * 2 + 1] * r;
      this.pos[k * 3] = px; this.pos[k * 3 + 1] = Math.max(-0.2, ground(px, pz)) + 0.12; this.pos[k * 3 + 2] = pz;
    }
    const a = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    a.needsUpdate = true;
  }
  set(amt: number): void {
    this.mat.uniforms.uAmt.value = amt;
    this.mesh.visible = amt > 0.005;
  }
}

/** A swarm of locusts: dark specks billowing round a drifting centre, visiting each field in turn. */
class LocustCloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private seed: Float32Array;
  private mat: THREE.ShaderMaterial;
  private cx = 0;
  private cz = 0;
  private cy = 0;
  private t = 0;
  /** 0 gone … 1 settled on the fields; it rises away when the swarm leaves. */
  private amt = 0;
  private swarm: Swarm | null = null;
  private lastSpots: number[] = [];
  constructor(private n: number) {
    this.pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) this.seed[i * 4 + k] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 4));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uTime: { value: 0 }, uAmt: { value: 0 } },
      vertexShader: `attribute vec4 aSeed; uniform float uScale; uniform float uTime; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Wings catch the light: each speck flickers at its own beat.
          vA = 0.75 + 0.25 * sin(uTime * (30.0 + aSeed.w * 25.0) + aSeed.z * 40.0);
          gl_PointSize = max(2.0, (0.2 + aSeed.y * 0.12) * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAmt; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.38, d) * uAmt;
          if (a < 0.02) discard; gl_FragColor = vec4(vec3(0.09, 0.075, 0.04) * vA, a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
  }
  get active(): boolean { return this.amt > 0.01 || !!this.swarm; }
  update(dt: number, swarm: Swarm | null, ground: Ground, scale: number): void {
    if (swarm && swarm !== this.swarm) {
      // A new swarm comes down out of the sky over its middle.
      if (!this.swarm) { this.cx = swarm.x; this.cz = swarm.z; this.cy = 14; this.amt = 0; }
      this.lastSpots = swarm.spots.slice();
    }
    this.swarm = swarm;
    const want = swarm ? 1 : 0;
    this.amt += (want - this.amt) * Math.min(1, dt * (swarm ? 1.2 : 0.6));
    if (!this.active) { this.points.geometry.setDrawRange(0, 0); return; }
    this.t += dt;
    const t = this.t, spots = this.lastSpots, nSpots = spots.length / 2;
    // Field to field every few seconds, wandering on the way.
    if (nSpots) {
      const k = Math.floor(t / 3.5) % nSpots;
      const tx = spots[k * 2] + Math.sin(t * 0.7) * 2.5, tz = spots[k * 2 + 1] + Math.cos(t * 0.53) * 2.5;
      const e = Math.min(1, dt * 0.8);
      this.cx += (tx - this.cx) * e;
      this.cz += (tz - this.cz) * e;
    }
    const gy = ground(this.cx, this.cz);
    // Settled low over the crops; rising away as it goes.
    const fly = swarm ? gy + 1.6 : this.cy + dt * 4;
    this.cy += (fly - this.cy) * Math.min(1, dt * (swarm ? 0.9 : 3));
    const spread = 3.6 + Math.sin(t * 0.9) * 0.8;
    const p = this.pos, s = this.seed;
    for (let i = 0; i < this.n; i++) {
      const a = s[i * 4] * 6.283 + t * (0.6 + s[i * 4 + 1] * 1.6) * (i % 2 ? 1 : -1);
      const rr = spread * Math.sqrt(s[i * 4 + 2]) * (1 + 0.35 * Math.sin(t * 1.7 + s[i * 4 + 3] * 9));
      // A few in five crawl and hop on the crops beneath; the rest billow above.
      const low = i % 5 === 0;
      p[i * 3] = this.cx + Math.cos(a) * rr * (low ? 1.4 : 1);
      p[i * 3 + 2] = this.cz + Math.sin(a) * rr * (low ? 1.4 : 1);
      p[i * 3 + 1] = low && swarm ? gy + 0.25 + Math.abs(Math.sin(t * 3 + s[i * 4 + 3] * 20)) * 0.4
        : this.cy + (s[i * 4 + 3] - 0.5) * 2.4 + Math.sin(t * 2.3 + s[i * 4] * 12) * 0.6;
    }
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uAmt.value = Math.min(1, this.amt * 1.3);
    this.mat.uniforms.uScale.value = scale;
  }
  /** Where the swarm is now (for its sound to follow). */
  get centre(): { x: number; z: number } { return { x: this.cx, z: this.cz }; }
}

/**
 * How miracles look: Healing Rain's golden shower, the green-gold wave of a Bountiful Harvest,
 * the dust thrown up by an Earthquake and the locusts on the fields. (The rainbow, and the
 * volcano, have their own.) Everything is pooled; nothing is allocated per frame. Real time.
 */
export class MiracleFX {
  readonly group = new THREE.Group();
  private gold = new Particles(1400, 0xffd36a);
  private green = new Particles(900, 0xcff27a);
  private dust = new Particles(700, 0x8a7356, 1);
  private healGlow = new GroundGlow(0xffc85a);
  private harvestGlow = new GroundGlow(0xb8f06a, true);
  private locusts = new LocustCloud(900);
  private heal = { x: 0, z: 0, r: 0, t: 0, len: 1 };
  private harvest = { x: 0, z: 0, r: 0, t: 0, len: 2.2 };
  private quake = { x: 0, z: 0, r: 0, t: 0, len: 1 };
  private shower = { x: 0, z: 0, r: 0, t: 0 };
  private acc = { heal: 0, dust: 0, shower: 0 };

  constructor(private ground: Ground, private rnd: () => number = Math.random) {
    for (const p of [this.gold, this.green]) (p.points.material as THREE.ShaderMaterial).blending = THREE.AdditiveBlending;
    this.group.add(this.gold.points, this.green.points, this.dust.points, this.healGlow.mesh, this.harvestGlow.mesh, this.locusts.points);
    this.group.name = 'miracles';
  }

  /** The locusts are on the fields now: where (for their drone to follow), or null. */
  get swarmAt(): { x: number; z: number } | null {
    return this.locusts.active ? this.locusts.centre : null;
  }

  /** Earthquake shaking near (x, z), 0..1 (the camera shakes with it). */
  get shaking(): number {
    const q = this.quake;
    if (q.t <= 0) return 0;
    const u = 1 - q.t / q.len;
    // A quick build, a long hard middle and a dying tremble.
    return 0.9 * Math.min(1, u / 0.08) * (u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35);
  }
  get quakeAt(): { x: number; z: number } { return this.quake; }

  start(id: MiracleId, x: number, z: number, r: number): void {
    const C = POWERS.miracles;
    if (id === 'healrain') {
      Object.assign(this.heal, { x, z, r, t: C.healrain.seconds, len: C.healrain.seconds });
      this.healGlow.place(x, z, r, this.ground);
    } else if (id === 'harvest') {
      Object.assign(this.harvest, { x, z, r, t: this.harvest.len });
      this.harvestGlow.place(x, z, r, this.ground);
    } else if (id === 'quake') {
      Object.assign(this.quake, { x, z, r, t: C.quake.seconds, len: C.quake.seconds });
      // A first great heave of dust all over the circle.
      for (let k = 0; k < 70; k++) this.puff(x, z, r, 1.4);
    } else if (id === 'rainbow') {
      Object.assign(this.shower, { x, z, r: Math.max(20, r), t: 5 });
    }
  }

  private puff(x: number, z: number, r: number, big = 1): void {
    const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * r;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, y = this.ground(px, pz);
    if (y < -0.1) return;
    this.dust.spawn(px, y + 0.1, pz, (this.rnd() - 0.5) * 0.8, 0.5 + this.rnd() * 1.2 * big, (this.rnd() - 0.5) * 0.8, 1.8 + this.rnd() * 1.4, 1.3 * big, 1.6 * big);
  }

  update(realDt: number, swarm: Swarm | null, camera: THREE.PerspectiveCamera, pixelHeight: number): void {
    const dt = Math.min(0.1, realDt);
    const scale = pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (const p of [this.gold, this.green, this.dust]) (p.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    // Healing Rain: golden drops falling through a column of light, sparkles rising off the ground.
    const h = this.heal;
    if (h.t > 0) {
      h.t -= dt;
      const life = Math.min(1, (h.len - h.t) / 0.8) * Math.min(1, h.t / 1.5);
      this.healGlow.set(0.85 * life);
      this.acc.heal += dt * 520 * life;
      while (this.acc.heal >= 1) {
        this.acc.heal -= 1;
        const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * h.r;
        const px = h.x + Math.cos(a) * d, pz = h.z + Math.sin(a) * d, gy = Math.max(0, this.ground(px, pz));
        if (this.rnd() < 0.8) this.gold.spawn(px, gy + 8 + this.rnd() * 4, pz, 0, -11 - this.rnd() * 3, 0, 0.75 + this.rnd() * 0.25, 0.16);
        else this.gold.spawn(px, gy + 0.2, pz, (this.rnd() - 0.5) * 0.3, 0.7 + this.rnd() * 0.9, (this.rnd() - 0.5) * 0.3, 1.2 + this.rnd(), 0.32, -0.1);
      }
    } else this.healGlow.set(0);
    // Bountiful Harvest: a green-gold wave rolling out across the fields, sparkles springing up behind it.
    const v = this.harvest;
    if (v.t > 0) {
      v.t -= dt;
      const u = 1 - Math.max(0, v.t) / v.len;
      this.harvestGlow.mat.uniforms.uFront.value = Math.min(1, u * 1.25);
      this.harvestGlow.set(0.8 * Math.min(1, (1 - u) * 3));
      const front = Math.min(1, u * 1.25) * v.r;
      const n = Math.floor(dt * 260);
      for (let k = 0; k < n; k++) {
        const a = this.rnd() * Math.PI * 2, d = Math.max(0, front - this.rnd() * 1.5);
        const px = v.x + Math.cos(a) * d, pz = v.z + Math.sin(a) * d, gy = this.ground(px, pz);
        if (gy < -0.1) continue;
        this.green.spawn(px, gy + 0.15, pz, (this.rnd() - 0.5) * 0.4, 1.2 + this.rnd() * 1.8, (this.rnd() - 0.5) * 0.4, 1.1 + this.rnd() * 0.8, 0.2, -0.05);
      }
    } else this.harvestGlow.set(0);
    // Earthquake: dust bursting from the ground while it shakes.
    const q = this.quake;
    if (q.t > 0) {
      q.t -= dt;
      this.acc.dust += dt * 45;
      while (this.acc.dust >= 1) { this.acc.dust -= 1; this.puff(q.x, q.z, q.r); }
    }
    // The Rainbow Blessing: a soft fall of golden motes over the village.
    const s = this.shower;
    if (s.t > 0) {
      s.t -= dt;
      this.acc.shower += dt * 160;
      while (this.acc.shower >= 1) {
        this.acc.shower -= 1;
        const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * s.r;
        const px = s.x + Math.cos(a) * d, pz = s.z + Math.sin(a) * d;
        this.gold.spawn(px, Math.max(0, this.ground(px, pz)) + 6 + this.rnd() * 6, pz, (this.rnd() - 0.5) * 0.3, -1.2 - this.rnd(), (this.rnd() - 0.5) * 0.3, 3 + this.rnd() * 2, 0.22);
      }
    }
    this.gold.update(dt);
    this.green.update(dt, 1.2);
    this.dust.update(dt, -0.15);
    this.locusts.update(dt, swarm, this.ground, scale);
  }
}
