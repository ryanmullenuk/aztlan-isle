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

/** Shared by every spirit's material: how solid they are, and the clock for the drift of their lower bodies. */
interface GhostUniforms { fade: { value: number }; time: { value: number } }

/**
 * A spirit's look: pale sea-green light with the model's own face and clothing showing through,
 * a soft glow within, brighter at the edges, and the body thinning to wisps below the knees.
 */
function ghostMaterial(map: THREE.Texture, u: GhostUniforms, hips: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uFade = u.fade;
    s.uniforms.uTime = u.time;
    s.uniforms.uHips = { value: hips };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGhostP;')
      .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\nvGhostP = transformed;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFade;\nuniform float uTime;\nuniform float uHips;\nvarying vec3 vGhostP;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        float gFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
        float gRim = pow(1.0 - gFacing, 1.6);
        vec3 gTeal = mix(vec3(0.02, 0.17, 0.19), vec3(0.5, 0.92, 0.84), smoothstep(0.0, 0.85, gLum));
        // Keep some of the texture's own contrast and hue, so faces and cloth patterns read through the light.
        vec3 gCol = mix(gTeal, diffuseColor.rgb * vec3(0.6, 1.05, 0.95) + vec3(0.03, 0.14, 0.13), 0.38);
        gCol += pow(gFacing, 3.0) * vec3(0.07, 0.22, 0.2) + gRim * vec3(0.24, 0.68, 0.6);
        // 0 at the feet, 1 at the head; below the knees the body frays into drifting wisps.
        float gH = (vGhostP.y + uHips) / (2.0 * uHips);
        float gWisp = sin(vGhostP.x * 16.0 + uTime * 1.7) * sin(vGhostP.z * 13.0 - uTime * 1.3 + vGhostP.y * 6.0) * 0.07;
        float gBody = smoothstep(0.03, 0.48, gH + gWisp);
        gl_FragColor = vec4(gCol, uFade * gBody * clamp(0.5 + 0.45 * gRim, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'ancestor-ghost-3';
  return m;
}

/** A soft round spot of light for the motes (made in code, so it needs no canvas). */
function moteTexture(): THREE.DataTexture {
  const n = 32, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2), a = Math.max(0, 1 - r) ** 2;
    d.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(d, n, n);
  t.needsUpdate = true;
  return t;
}

/** A name in soft sea-green light, for over a spirit's head (null where there is no canvas). */
function nameLabel(name: string): THREE.Sprite | null {
  if (!name || typeof document === 'undefined') return null;
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  if (!ctx) return null;
  const font = '600 40px Trebuchet MS, sans-serif';
  ctx.font = font;
  const w = Math.min(480, Math.ceil(ctx.measureText(name).width) + 36);
  c.width = w; c.height = 64;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(60, 220, 200, 0.9)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#c8fff2';
  ctx.fillText(name, w / 2, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0, fog: false }));
  const h = 0.11;
  s.scale.set((h * w) / 64, h, 1);
  s.renderOrder = 30;
  return s;
}

/** Motes of light drifting up around each spirit. */
const MOTES = 7;

/** A flat disc of light on the ground, bright in the middle and fading to nothing at its edge. */
function softDisc(r: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position'), col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.fill(Math.hypot(pos.getX(i), pos.getZ(i)) < r * 0.5 ? 1 : 0, i * 3, i * 3 + 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export interface GhostSpot { gender: 'm' | 'f'; name: string; x: number; y: number; z: number; heading: number }

interface Ghost {
  root: THREE.Group;
  label: THREE.Sprite | null;
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
  private time = { value: 0 };
  private want = 0;
  private list: Ghost[] = [];
  private geo: Partial<Record<'m' | 'f', THREE.BufferGeometry>> = {};
  private mats: Partial<Record<'m' | 'f', THREE.Material[]>> = {};
  private hips: Partial<Record<'m' | 'f', number>> = {};
  private glowGeo = softDisc(0.42);
  private glowMat = new THREE.MeshBasicMaterial({ color: 0x3fd8c8, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private pending: GhostSpot[] = [];
  /** Every spirit's motes in one draw: positions and brightness rewritten each frame. */
  private motes: THREE.Points;
  private moteMat = new THREE.PointsMaterial({ size: 0.045, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

  constructor() {
    this.group.name = 'Ancestor ghosts';
    this.group.visible = false;
    if (typeof document !== 'undefined') this.moteMat.map = moteTexture();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 8 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 8 * 3), 3));
    geo.setDrawRange(0, 0);
    this.motes = new THREE.Points(geo, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 16;
    this.group.add(this.motes);
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
  appear(at: GhostSpot[]): void {
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

  /** The spirit standing within reach (~0.6 m) of a point on the ground, nearest first; -1 if none. */
  ghostAt(x: number, z: number): number {
    let best = -1, bd = 0.6 * 0.6;
    this.list.forEach((g, k) => {
      const d = (g.root.position.x - x) ** 2 + (g.root.position.z - z) ** 2;
      if (d <= bd) { bd = d; best = k; }
    });
    return best;
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
    // One translucent pass (no depth pre-pass: it would leave the faded feet as dark stumps over the grass).
    this.mats[g] = [ghostMaterial(model.map, { fade: this.fade, time: this.time }, model.joint.hips.y)];
  }

  private stand(p: GhostSpot): void {
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
    const label = nameLabel(p.name);
    if (label) {
      label.position.y = 0.86;
      root.add(label);
    }
    this.group.add(root);
    const n = this.list.length;
    this.list.push({ root, label, meshes, glow, y: p.y, phase: n * 1.7, next: 1 + (n % 3) * 2.5, waving: 0, target: n % 2 ? 0 : 1 });
  }

  /** Real seconds. */
  update(dt: number, time: number): void {
    const f = this.fade;
    f.value += Math.sign(this.want - f.value) * Math.min(Math.abs(this.want - f.value), dt / 2.5);
    this.group.visible = f.value > 0.002;
    this.glowMat.opacity = f.value * 0.3;
    this.time.value = time;
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
      // The name shows only over the spirit the player has tapped (it eases in and out).
      if (g.label) {
        const m = g.label.material as THREE.SpriteMaterial, want = this.list.indexOf(g) === this.selected ? f.value * 0.85 : 0;
        m.opacity += (want - m.opacity) * Math.min(1, dt * 6);
        g.label.visible = m.opacity > 0.01;
      }
    }
    this.drift(time);
  }

  /** Each spirit's motes rise from about the knees to over the head, swaying, brightening, and going out. */
  private drift(time: number): void {
    const geo = this.motes.geometry, pos = geo.getAttribute('position') as THREE.BufferAttribute, col = geo.getAttribute('color') as THREE.BufferAttribute;
    const n = Math.min(this.list.length * MOTES, pos.count);
    for (let i = 0; i < n; i++) {
      const g = this.list[Math.floor(i / MOTES)], s = i * 2.39996 + g.phase;
      const life = (time / (2.6 + (i % 3) * 0.7) + (s % 1)) % 1;
      const ang = s * 3.1 + time * 0.4, r = 0.12 + 0.1 * Math.sin(s * 5.7) + life * 0.06;
      pos.setXYZ(i, g.root.position.x + Math.cos(ang) * r + Math.sin(time * 1.8 + s) * 0.03, g.root.position.y + 0.12 + life * 0.8, g.root.position.z + Math.sin(ang) * r);
      const b = this.fade.value * Math.sin(life * Math.PI) * 0.9;
      col.setXYZ(i, b * 0.55, b, b * 0.9);
    }
    geo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** The spirit whose name is shown (tapped), or -1 for none. */
  selected = -1;

  /** Show one spirit's name (-1 hides them all). */
  select(k: number): void {
    this.selected = k >= 0 && k < this.list.length ? k : -1;
  }

  private clear(): void {
    this.selected = -1;
    for (const g of this.list) {
      this.group.remove(g.root);
      if (g.label) {
        const m = g.label.material as THREE.SpriteMaterial;
        m.map?.dispose();
        m.dispose();
      }
    }
    this.motes.geometry.setDrawRange(0, 0);
    this.list = [];
  }
}
