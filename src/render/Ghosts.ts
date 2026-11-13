import * as THREE from 'three';
import { bakePose, type BoneName, type GlbModel } from '../entities/glbPeople';
import { loadIslanderModels } from '../entities/islanderModels';

type Pose = Partial<Record<BoneName, [number, number, number]>>;

/** Standing easy, hands a little forward as if talking; then the same with the hands moved. */
const TALK_A: Pose = { spine: [0.03, 0, 0], upper_armL: [-0.25, 0, 0.12], upper_armR: [-0.3, 0, -0.12], forearmL: [-0.7, 0, 0], forearmR: [-0.85, 0, 0], head: [0.04, 0.12, 0] };
const TALK_B: Pose = { spine: [0.05, 0.06, 0], upper_armL: [-0.45, 0, 0.2], upper_armR: [-0.2, 0, -0.1], forearmL: [-1.15, 0, 0], forearmR: [-0.55, 0, 0], head: [-0.03, -0.14, 0.05] };
/** One arm up and waving: the forearm swings from side to side. */
const WAVE_A: Pose = { spine: [0.02, 0, -0.03], upper_armL: [-0.1, 0, 0.1], forearmL: [-0.25, 0, 0], upper_armR: [0, 0, -2.2], forearmR: [0, 0, -0.25], head: [0, 0, -0.05] };
const WAVE_B: Pose = { spine: [0.02, 0, -0.03], upper_armL: [-0.1, 0, 0.1], forearmL: [-0.25, 0, 0], upper_armR: [0, 0, -2.2], forearmR: [0, 0, -1.05], head: [0, 0, -0.05] };

/** Islander height over the models' own (metres). */
const SCALE = 0.62 / 1.8;

/** A spirit's look: sea-green light, brighter at the edges, the model's own features showing faintly through. */
function ghostMaterial(map: THREE.Texture, fade: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uFade = fade;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        float gRim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 1.6);
        vec3 gCol = mix(vec3(0.0, 0.2, 0.24), vec3(0.16, 0.62, 0.58), smoothstep(0.05, 0.8, gLum));
        gl_FragColor = vec4(gCol + gRim * vec3(0.2, 0.62, 0.58), uFade * clamp(0.42 + 0.5 * gRim, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'ancestor-ghost-2';
  return m;
}

/** A flat disc of light on the ground, bright in the middle and fading to nothing at its edge. */
function softDisc(r: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position'), col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.fill(Math.hypot(pos.getX(i), pos.getZ(i)) < r * 0.5 ? 1 : 0, i * 3, i * 3 + 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

interface Ghost {
  root: THREE.Group;
  meshes: THREE.Mesh[];
  glow: THREE.Mesh;
  y: number;
  phase: number;
  /** Seconds until they next change between waving and talking. */
  next: number;
  waving: number;
  target: number;
}

/**
 * The spirits of the dead on the night the ancestors are honoured: sea-green, glowing figures of
 * the island's men and women, who stand by the altar waving to the living and talking with them.
 * They are the islanders' own models in a few fixed poses, blended between (no skeleton).
 */
export class Ghosts {
  readonly group = new THREE.Group();
  private fade = { value: 0 };
  private want = 0;
  private list: Ghost[] = [];
  private geo: Partial<Record<'m' | 'f', THREE.BufferGeometry>> = {};
  private mats: Partial<Record<'m' | 'f', THREE.Material[]>> = {};
  private hips: Partial<Record<'m' | 'f', number>> = {};
  private glowGeo = softDisc(0.42);
  private glowMat = new THREE.MeshBasicMaterial({ color: 0x3fd8c8, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private pending: { gender: 'm' | 'f'; x: number; y: number; z: number; heading: number }[] = [];

  constructor() {
    this.group.name = 'Ancestor ghosts';
    this.group.visible = false;
  }

  /** How many stand there now (or are about to). */
  get count(): number {
    return this.list.length + this.pending.length;
  }

  /** How solid they are, 0 to 1. */
  get shown(): number {
    return this.fade.value;
  }

  /** Bring the spirits out at these places (they fade in). */
  appear(at: { gender: 'm' | 'f'; x: number; y: number; z: number; heading: number }[]): void {
    this.clear();
    this.want = 1;
    this.pending = at.map((a) => ({ ...a }));
    if (typeof document === 'undefined') return;
    loadIslanderModels().then((models) => {
      for (const g of ['m', 'f'] as const) this.prepare(g, models[g]);
      for (const p of this.pending) this.stand(p);
      this.pending = [];
    }).catch((err) => console.error('The ancestors could not be drawn.', err));
  }

  /** Send them away (they fade out, then are removed). */
  vanish(): void {
    this.want = 0;
    this.pending = [];
  }

  /** Turn a spirit to face a point (the nearest of the living). */
  face(k: number, x: number, z: number): void {
    const g = this.list[k];
    if (!g) return;
    const want = Math.atan2(x - g.root.position.x, z - g.root.position.z);
    let d = want - g.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.root.rotation.y += d * 0.04;
  }

  /** Where each spirit stands. */
  spots(): { x: number; z: number }[] {
    return this.list.map((g) => ({ x: g.root.position.x, z: g.root.position.z }));
  }

  private prepare(g: 'm' | 'f', model: GlbModel): void {
    if (this.geo[g]) return;
    const base = bakePose(model, TALK_A);
    const targets = [TALK_B, WAVE_A, WAVE_B].map((p) => {
      const baked = bakePose(model, p), pos = baked.getAttribute('position') as THREE.BufferAttribute;
      baked.dispose();
      return pos;
    });
    base.morphAttributes.position = targets;
    base.morphTargetsRelative = false;
    this.geo[g] = base;
    this.hips[g] = model.joint.hips.y;
    // Drawn twice: first only into the depth buffer, so the far side of the body doesn't show through the near.
    const depth = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.mats[g] = [depth, ghostMaterial(model.map, this.fade)];
  }

  private stand(p: { gender: 'm' | 'f'; x: number; y: number; z: number; heading: number }): void {
    const geo = this.geo[p.gender], mats = this.mats[p.gender];
    if (!geo || !mats) return;
    const root = new THREE.Group(), body = new THREE.Group();
    root.position.set(p.x, p.y, p.z);
    root.rotation.y = p.heading;
    body.scale.setScalar(SCALE * (p.gender === 'f' ? 0.98 : 1));
    body.position.y = (this.hips[p.gender] ?? 1) * SCALE;
    const meshes = mats.map((m, k) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = 14 + k;
      mesh.frustumCulled = false;
      mesh.morphTargetInfluences = [0, 0, 0];
      body.add(mesh);
      return mesh;
    });
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    glow.position.y = 0.03;
    glow.renderOrder = 13;
    root.add(body, glow);
    this.group.add(root);
    const n = this.list.length;
    this.list.push({ root, meshes, glow, y: p.y, phase: n * 1.7, next: 1 + (n % 3) * 2.5, waving: 0, target: n % 2 ? 0 : 1 });
  }

  /** Real seconds. */
  update(dt: number, time: number): void {
    const f = this.fade;
    f.value += Math.sign(this.want - f.value) * Math.min(Math.abs(this.want - f.value), dt / 2.5);
    this.group.visible = f.value > 0.002;
    this.glowMat.opacity = f.value * 0.3;
    if (!this.group.visible) {
      if (!this.want && this.list.length) this.clear();
      return;
    }
    for (const g of this.list) {
      g.next -= dt;
      if (g.next <= 0) {
        g.target = g.target ? 0 : 1;
        g.next = g.target ? 3.5 + Math.random() * 2.5 : 5 + Math.random() * 6;
      }
      g.waving += (g.target - g.waving) * Math.min(1, dt * 3);
      const w = g.waving, swing = 0.5 + 0.5 * Math.sin(time * 7 + g.phase), talk = 0.5 + 0.5 * Math.sin(time * 2.1 + g.phase);
      // Targets are whole poses (not offsets): the weights, with the base pose's share, sum to one.
      const inf = [(1 - w) * talk, w * (1 - swing), w * swing];
      for (const m of g.meshes) m.morphTargetInfluences = inf;
      // Hovering a finger's width off the ground, rising and settling.
      g.root.position.y = g.y + 0.035 + Math.sin(time * 1.3 + g.phase) * 0.018;
    }
  }

  private clear(): void {
    for (const g of this.list) this.group.remove(g.root);
    this.list = [];
  }
}
