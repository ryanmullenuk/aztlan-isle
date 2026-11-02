import * as THREE from 'three';
import { PEARLS } from '../config';
import { stylisedMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { hullShadow } from '../render/SoftShadows';
import { warmWith } from '../render/WarmUp';
import type { Islander } from './Islander';

interface Shell {
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Seconds since it washed up. */
  age: number;
  mesh: THREE.Group;
  glint: THREE.Sprite;
}

/** Shell size: radius from hinge to lip, bowl depth, lip thickness, and how many ribs fan out. */
const CLAM = { r: 0.1, depth: 0.034, lip: 0.006, ribs: 12, spread: 1.2, nu: 12, nv: 48 };

/** One valve's surface at (u from hinge to lip, a across the fan): position and the rib wave. */
function valvePoint(u: number, a: number, inner: boolean, out: THREE.Vector3): number {
  const reach = CLAM.r * (0.8 + 0.2 * Math.cos(a * 1.1));
  const rr = 0.012 + u * (reach - 0.012);
  // The hinge is a short straight edge rather than a point.
  const hx = (a / CLAM.spread) * 0.028 * (1 - u);
  const rib = Math.sin(a * CLAM.ribs);
  const ribA = CLAM.depth * 0.16 * u ** 1.5;
  const bowl = CLAM.depth * Math.sin(Math.PI * (0.1 + 0.9 * u)) * (1 - 0.4 * (a / CLAM.spread) ** 2);
  // The inside is a shallower bowl; the two meet at the wavy lip, a little apart (its thickness).
  const y = inner ? -bowl * 0.78 + CLAM.lip * (1 - 0.5 * u) - ribA * rib * 0.85 : -bowl - ribA * rib;
  out.set(hx + Math.sin(a) * rr, y, Math.cos(a) * rr - CLAM.r * 0.42);
  return rib;
}

/** A grid surface over the valve (u, a), its triangles wound to face `up` (or down). */
function surface(inner: boolean, color: (u: number, a: number, rib: number) => THREE.Color, up: boolean, lid: THREE.Matrix4 | null): THREE.BufferGeometry {
  const { nu, nv, spread } = CLAM;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, a = (j / nv - 0.5) * 2 * spread;
    const rib = valvePoint(u, a, inner, v);
    if (lid) v.y = -v.y, v.applyMatrix4(lid);
    pos.push(v.x, v.y, v.z);
    const c = color(u, a, rib);
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const k = i * (nv + 1) + j, k2 = k + nv + 1;
    idx.push(k, k2, k + 1, k + 1, k2, k2 + 1);
  }
  return finish(pos, col, idx, up === !!lid);
}

/** The lip: a thin strip joining the outside to the inside all along the wavy edge. */
function lip(color: THREE.Color, lid: THREE.Matrix4 | null): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  for (let j = 0; j <= CLAM.nv; j++) {
    const a = (j / CLAM.nv - 0.5) * 2 * CLAM.spread;
    for (const inner of [false, true]) {
      valvePoint(1, a, inner, v);
      if (lid) v.y = -v.y, v.applyMatrix4(lid);
      pos.push(v.x, v.y, v.z);
      col.push(color.r, color.g, color.b);
    }
    if (j < CLAM.nv) idx.push(j * 2, j * 2 + 2, j * 2 + 1, j * 2 + 1, j * 2 + 2, j * 2 + 3);
  }
  return finish(pos, col, idx, !lid);
}

function finish(pos: number[], col: number[], idx: number[], flip: boolean): THREE.BufferGeometry {
  if (flip) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _c = new THREE.Color();
/** Outside: banded growth rings, brown to sandy cream, with paler rays along the rib crests. */
const outside = (u: number, a: number, rib: number) => {
  const band = 0.5 + 0.5 * Math.sin(u * 34 + Math.sin(a * 5) * 0.8);
  _c.set(0x5f4a39).lerp(new THREE.Color(0xb59c7c), band * 0.75);
  if (rib > 0.55) _c.lerp(new THREE.Color(0xd8c4a2), (rib - 0.55) * 0.9);
  return _c.multiplyScalar(0.85 + 0.15 * u);
};
/** Inside: mother-of-pearl, silvery pink with blue and green tints that shift across it, and a golden lip at the edge. */
const nacre = (u: number, a: number) => {
  const shimmer = 0.5 + 0.5 * Math.sin(u * 17 + a * 5.5);
  _c.set(0xe6d0e2).lerp(new THREE.Color(0x9fc0e8), shimmer * 0.7).lerp(new THREE.Color(0xa8e2c4), Math.max(0, Math.sin(u * 9 - a * 4)) * 0.5);
  if (u > 0.72) _c.lerp(new THREE.Color(0xc58d26), Math.min(1, (u - 0.72) / 0.22));
  return _c;
};

/** The hinge's opening: the lid lifted back nearly upright. */
const LID = new THREE.Matrix4().makeTranslation(0, 0.004, -CLAM.r * 0.42).multiply(new THREE.Matrix4().makeRotationX(-1.4)).multiply(new THREE.Matrix4().makeTranslation(0, 0, CLAM.r * 0.42));

/**
 * A gold-lipped pearl oyster lying open on the sand: ribbed, banded valves with a wavy lip,
 * iridescent mother-of-pearl inside, and a lustrous pearl. Two parts: the rough outside (the
 * game's usual shading) and the nacre and pearl (glossy, with a rainbow sheen).
 */
function clamGeometry(): { shell: THREE.BufferGeometry; nacre: THREE.BufferGeometry; pearl: THREE.BufferGeometry; pearlAt: THREE.Vector3 } {
  const lipColor = new THREE.Color(0xa77a2c);
  const shell = mergeParts([surface(false, outside, false, null), lip(lipColor, null), surface(false, outside, false, LID), lip(lipColor, LID)]);
  const inner = mergeParts([surface(true, nacre, true, null), surface(true, nacre, true, LID)]);
  // Bedded in the bowl a little towards the hinge.
  const pearlAt = new THREE.Vector3();
  valvePoint(0.42, 0, true, pearlAt);
  const pr = 0.024;
  pearlAt.y += pr * 0.85;
  return { shell, nacre: inner, pearl: new THREE.SphereGeometry(pr, 24, 16), pearlAt };
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    col.push(...(g.getAttribute('color').array as Float32Array));
    for (const k of g.index!.array) idx.push(base + k);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // The game's stylised shading reads these (no sway, plain material).
  out.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  out.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  out.setIndex(idx);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

let env: THREE.CubeTexture | null = null;
/**
 * What the glossy nacre and pearl reflect: bright sky above, the horizon, warm sand below. A tiny
 * painted cube (the renderer blurs it for rough reflections) is enough for their lustre.
 */
function beachSky(): THREE.CubeTexture {
  if (env) return env;
  const face = (top: string, bottom: string) => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d')!, grd = g.createLinearGradient(0, 0, 0, 16);
    grd.addColorStop(0, top);
    grd.addColorStop(1, bottom);
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 16);
    return c;
  };
  const side = face('#cfe6f5', '#e6d4b0'), up = face('#f4f8ff', '#f4f8ff'), down = face('#d9c39a', '#d9c39a');
  env = new THREE.CubeTexture([side, side, up, down, side, side]);
  env.colorSpace = THREE.SRGBColorSpace;
  env.needsUpdate = true;
  return env;
}

let nacreMat: THREE.MeshPhysicalMaterial | null = null;
let pearlMat: THREE.MeshPhysicalMaterial | null = null;
/** Mother-of-pearl: glossy, with a thin-film rainbow in its highlights. */
function nacreMaterial(): THREE.MeshPhysicalMaterial {
  return nacreMat ??= new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.34, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.12, envMap: beachSky(), envMapIntensity: 0.45,
    iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessRange: [220, 620],
    sheen: 0.3, sheenColor: new THREE.Color(0xffc9e6), sheenRoughness: 0.35, side: THREE.DoubleSide,
  });
}
/** The pearl: a warm white with a deep lustre, a soft pink-gold sheen at its edge and a faint glow so it shows from afar. */
function pearlMaterial(): THREE.MeshPhysicalMaterial {
  return pearlMat ??= new THREE.MeshPhysicalMaterial({
    color: 0xf3e6da, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMap: beachSky(), envMapIntensity: 0.7,
    iridescence: 0.8, iridescenceIOR: 1.45, iridescenceThicknessRange: [300, 700],
    sheen: 1, sheenColor: new THREE.Color(0xffd2c0), sheenRoughness: 0.3,
    emissive: 0xfff1e0, emissiveIntensity: 0.08,
  });
}

function glintTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,250,240,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  // A four-pointed sparkle.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(31, 4, 2, 56);
  g.fillRect(4, 31, 56, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Pearl oysters washed up on the beaches: now and then one lies open on the sand, a pearl glinting
 * in it, until a villager walking past picks it up (or the player taps it) or the tide takes it
 * back. Pearls are kept with the precious goods, for trading on voyages.
 */
export class BeachPearls {
  readonly group = new THREE.Group();
  shells: Shell[] = [];
  private spots: { x: number; z: number }[] = [];
  private rng: RNG;
  private next: number;
  private check = 0;
  private clam = clamGeometry();
  private tex = glintTexture();
  /** A pearl found: by a villager, or by the player tapping the shell (who = null). */
  onFound: ((who: Islander | null, x: number, z: number) => void) | null = null;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 41 + 3);
    this.next = this.rng.range(PEARLS.every[0] * 0.3, PEARLS.every[1] * 0.5);
    this.findSpots();
    this.group.name = 'pearls';
    // The glossy nacre and pearl have shaders of their own: ready them behind the splash.
    warmWith(new THREE.Mesh(this.clam.nacre, nacreMaterial()));
    warmWith(new THREE.Mesh(this.clam.pearl, pearlMaterial()));
  }

  /** Sand just above the waterline, all round the coasts. */
  private findSpots(): void {
    const w = this.world;
    for (let cz = 1; cz < w.N - 1; cz++) {
      for (let cx = 1; cx < w.N - 1; cx++) {
        const i = w.idx(cx, cz);
        if (!w.isLandCell(i) || w.sandy[i] < 0.5 || w.distWater[i] > 2 || w.occ[i] || w.blocked(i)) continue;
        const x = w.centerX(cx), z = w.centerZ(cz), y = w.heightAt(x, z);
        if (y < 0.03 || y > 0.9) continue;
        this.spots.push({ x, z });
      }
    }
  }

  get count(): number {
    return this.shells.length;
  }

  /** Wash a shell up somewhere along the beaches (true if one was placed). */
  washUp(): boolean {
    const w = this.world;
    for (let tries = 0; tries < 30 && this.spots.length; tries++) {
      const s = this.rng.pick(this.spots);
      const x = s.x + this.rng.range(-0.4, 0.4), z = s.z + this.rng.range(-0.4, 0.4);
      const i = w.cellIndexAt(x, z);
      if (i < 0 || !w.isLandCell(i) || w.occ[i] || w.path[i]) continue;
      if (this.shells.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) continue;
      const mesh = new THREE.Group();
      const m = new THREE.Mesh(this.clam.shell, stylisedMaterial());
      m.scale.setScalar(1.7);
      m.add(new THREE.Mesh(this.clam.nacre, nacreMaterial()));
      const pearl = new THREE.Mesh(this.clam.pearl, pearlMaterial());
      pearl.position.copy(this.clam.pearlAt);
      m.add(pearl);
      m.add(hullShadow(this.clam.shell));
      mesh.add(m);
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0xfff6e8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glint.scale.setScalar(0.3);
      mesh.add(glint);
      const y = w.heightAt(x, z);
      // The bowl's underside sits bedded just into the sand.
      mesh.position.set(x, y + CLAM.depth * 0.8 * 1.7, z);
      mesh.rotation.y = this.rng.range(0, Math.PI * 2);
      this.group.add(mesh);
      this.shells.push({ x, y, z, rot: mesh.rotation.y, age: 0, mesh, glint });
      return true;
    }
    return false;
  }

  private take(k: number, who: Islander | null): void {
    const s = this.shells[k];
    this.group.remove(s.mesh);
    (s.glint.material as THREE.Material).dispose();
    this.shells.splice(k, 1);
    this.onFound?.(who, s.x, s.z);
  }

  /** The player taps a shell: they find the pearl. True if one was there. */
  tap(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect): boolean {
    const v = new THREE.Vector3();
    for (let k = 0; k < this.shells.length; k++) {
      const s = this.shells[k];
      v.set(s.x, s.y + 0.05, s.z).project(camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      if ((px - sx) ** 2 + (py - sy) ** 2 < 26 * 26) {
        this.take(k, null);
        return true;
      }
    }
    return false;
  }

  update(dt: number, time: number, people: SpatialHash<Islander> | null): void {
    this.next -= dt;
    if (this.next <= 0) {
      if (this.shells.length < PEARLS.maxShells) this.washUp();
      this.next = this.rng.range(PEARLS.every[0], PEARLS.every[1]);
    }
    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k];
      s.age += dt;
      // The tide takes it back.
      if (s.age > PEARLS.shellLife) {
        this.group.remove(s.mesh);
        this.shells.splice(k, 1);
        continue;
      }
      // A twinkle every second or so, so it catches the eye.
      const tw = Math.max(0, Math.sin(time * 2.4 + k * 2.1)) ** 6;
      s.glint.position.copy(this.clam.pearlAt).multiplyScalar(1.7).setY(this.clam.pearlAt.y * 1.7 + 0.03);
      s.glint.scale.setScalar(0.12 + 0.3 * tw);
      (s.glint.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * tw;
    }
    // Villagers walking past pick them up.
    this.check -= dt;
    if (this.check <= 0 && people) {
      this.check = 0.3;
      for (let k = this.shells.length - 1; k >= 0; k--) {
        const s = this.shells[k];
        let who: Islander | null = null;
        people.query(s.x, s.z, PEARLS.pickRadius, (p) => {
          if (!who && !p.hidden && Math.hypot(p.x - s.x, p.z - s.z) < PEARLS.pickRadius) who = p;
        });
        if (who) this.take(k, who);
      }
    }
  }
}
