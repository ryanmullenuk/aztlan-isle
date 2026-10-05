import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { SEA_SURFACE } from '../water/Water';

/** Model: nose at +z (0.51), tail fin tip at about -0.62; one unit long before scaling. */
const NOSE = 0.42;
const BODY_LEN = 0.95;
const GREY = new THREE.Color(0x667480), BELLY = new THREE.Color(0xe4dccb), DARK = new THREE.Color(0x3c4650), EYE = new THREE.Color(0x101418);

/** Countershaded: grey above, cream below, the line between them softly ragged. */
function shade(p: THREE.Vector3, n: THREE.Vector3): THREE.Color {
  const under = n.y < -0.15 + Math.sin(p.z * 40) * 0.05;
  return (under ? BELLY : GREY).clone().multiplyScalar(0.95 + ((Math.sin(p.x * 91 + p.z * 57) * 43758.5) % 1 + 1) % 1 * 0.08);
}

/** A thin fin: a triangle with a little thickness, so it shows from both sides. */
function fin(a: THREE.Vector3, b: THREE.Vector3, tip: THREE.Vector3, t = 0.008): THREE.BufferGeometry {
  // Thickness across the fin's plane.
  const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(tip, a)).normalize().multiplyScalar(t);
  const v = [a.clone().add(nrm), b.clone().add(nrm), tip.clone().add(nrm.clone().multiplyScalar(0.2)), a.clone().sub(nrm), b.clone().sub(nrm), tip.clone().sub(nrm.clone().multiplyScalar(0.2))];
  const tri = [[0, 1, 2], [3, 5, 4], [0, 3, 4], [0, 4, 1], [1, 4, 5], [1, 5, 2], [2, 5, 3], [2, 3, 0]];
  const pos: number[] = [];
  for (const [i, j, k] of tri) pos.push(v[i].x, v[i].y, v[i].z, v[j].x, v[j].y, v[j].z, v[k].x, v[k].y, v[k].z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A low-poly scalloped hammerhead: a faceted, tapering body lofted through octagonal sections,
 * the flat, broad cephalofoil with an eye at each end, a tall swept dorsal fin, long pectorals,
 * the small second dorsal, pelvic and anal fins, and the long upper lobe of the tail.
 */
export function hammerheadGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Body sections: z, half width, half height, centre height.
  const S: [number, number, number, number][] = [
    [0.43, 0.045, 0.035, 0.0], [0.34, 0.075, 0.07, 0.0], [0.2, 0.098, 0.095, 0.004], [0.06, 0.1, 0.1, 0.006],
    [-0.08, 0.085, 0.088, 0.004], [-0.2, 0.062, 0.068, 0.0], [-0.31, 0.038, 0.045, 0.0], [-0.4, 0.022, 0.028, 0.004], [-0.46, 0.014, 0.02, 0.008],
  ];
  const R = 8, pos: number[] = [];
  const ring = (k: number) => {
    const [z, w, h, y0] = S[k];
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < R; i++) {
      const a = (i / R) * Math.PI * 2 + Math.PI / R;
      // Flatter underneath, a ridge along the back.
      const sy = Math.sin(a);
      pts.push(new THREE.Vector3(Math.cos(a) * w, y0 + sy * h * (sy < 0 ? 0.8 : 1.05), z));
    }
    return pts;
  };
  for (let k = 0; k < S.length - 1; k++) {
    const A = ring(k), B = ring(k + 1);
    for (let i = 0; i < R; i++) {
      const i2 = (i + 1) % R;
      for (const [p, q, r] of [[A[i], B[i], B[i2]], [A[i], B[i2], A[i2]]]) pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    }
  }
  // Close the tail end.
  const T = ring(S.length - 1), tc = new THREE.Vector3(0, S[S.length - 1][3], S[S.length - 1][0] - 0.01);
  for (let i = 0; i < R; i++) { const p = T[i], q = T[(i + 1) % R]; pos.push(p.x, p.y, p.z, tc.x, tc.y, tc.z, q.x, q.y, q.z); }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.computeVertexNormals();
  b.add(body, { facet: true, color: shade });
  // The hammer: a flat, scalloped wing across the head.
  const sh = new THREE.Shape();
  const outline: [number, number][] = [[-0.2, 0.425], [-0.205, 0.465], [-0.17, 0.49], [-0.11, 0.5], [-0.05, 0.512], [0, 0.505], [0.05, 0.512], [0.11, 0.5], [0.17, 0.49], [0.205, 0.465], [0.2, 0.425], [0.12, 0.415], [0.05, 0.4], [0, 0.39], [-0.05, 0.4], [-0.12, 0.415]];
  sh.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) sh.lineTo(x, y);
  const hammer = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  hammer.rotateX(Math.PI / 2);
  hammer.translate(0, 0.014, 0);
  hammer.deleteAttribute('uv');
  b.add(hammer.toNonIndexed(), { facet: true, color: (p, n) => (n.y < -0.3 ? BELLY : GREY.clone().multiplyScalar(1.04)) });
  for (const s of [-1, 1]) b.add(P.sphere(0.017, 1), { facet: true, color: EYE }, M.t(s * 0.205, 0.006, 0.452));
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const finCol = (p: THREE.Vector3) => (p.y > 0.24 || p.y < -0.2 ? DARK : GREY.clone().multiplyScalar(0.92));
  // Tall first dorsal, swept back.
  b.add(fin(v(0, 0.09, 0.14), v(0, 0.08, -0.06), v(0, 0.33, -0.1), 0.01), { facet: true, color: finCol });
  b.add(fin(v(0, 0.05, -0.25), v(0, 0.04, -0.31), v(0, 0.11, -0.34)), { facet: true, color: finCol });
  // Long pectorals, angled down and back.
  for (const s of [-1, 1]) {
    b.add(fin(v(s * 0.07, -0.05, 0.16), v(s * 0.08, -0.05, 0.04), v(s * 0.3, -0.13, -0.06), 0.008), { facet: true, color: (p) => (Math.abs(p.x) > 0.24 ? DARK : GREY) });
    b.add(fin(v(s * 0.035, -0.05, -0.17), v(s * 0.03, -0.045, -0.22), v(s * 0.09, -0.11, -0.25), 0.006), { facet: true, color: GREY });
  }
  b.add(fin(v(0, -0.04, -0.27), v(0, -0.035, -0.32), v(0, -0.1, -0.34), 0.006), { facet: true, color: GREY });
  // The tail: a long upper lobe and a short lower one.
  b.add(fin(v(0, 0.012, -0.41), v(0, 0.02, -0.47), v(0, 0.3, -0.63), 0.009), { facet: true, color: finCol });
  b.add(fin(v(0, -0.004, -0.43), v(0, 0.006, -0.47), v(0, -0.14, -0.53), 0.008), { facet: true, color: finCol });
  // Gill slits.
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) b.add(P.box(0.004, 0.05, 0.006), { color: DARK }, M.t(s * 0.099, -0.005, 0.24 - k * 0.022, 0, 0, s * 0.1));
  return b.build();
}

/** Hammerhead material: the body bends in a travelling wave and curves into turns (per shark). */
function sharkMaterial(): THREE.MeshStandardMaterial {
  const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.86 }), 0.4);
  mat.depthWrite = false;
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base.call(mat, shader, r);
    shader.uniforms.uSurfaceY = { value: SEA_SURFACE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 iSwim;
        uniform float uSurfaceY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // 0 at the head, 1 at the tail: each slice of the body follows the one ahead of it.
          float s = clamp((${NOSE.toFixed(2)} - position.z) / ${BODY_LEN.toFixed(2)}, 0.0, 1.2);
          float wave = sin(iSwim.x - s * 4.2);
          float sideways = iSwim.y * pow(s, 1.5) * wave - iSwim.y * 0.12 * (1.0 - s) * sin(iSwim.x + 0.8);
          // Turning: the body curves round the turn, more toward the tail.
          sideways += iSwim.z * s * s;
          transformed.x += sideways;
          // Each slice also turns to follow the wave, so fins and tail sweep with it.
          float slope = iSwim.y * (1.5 * pow(max(s, 0.001), 0.5) * wave - pow(s, 1.5) * 4.2 * cos(iSwim.x - s * 4.2)) / ${BODY_LEN.toFixed(2)} + 2.0 * iSwim.z * s / ${BODY_LEN.toFixed(2)};
          transformed.z += position.x * slope * 0.5;
        }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          // Depth taken where the view ray enters the water, so the surface doesn't hide them
          // (land and rocks in front still do).
          vec4 fw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vec3 ray = fw.xyz - cameraPosition;
          float tS = ray.y < -1e-4 ? clamp((uSurfaceY - cameraPosition.y) / ray.y, 0.0, 1.0) : 1.0;
          if (fw.y < uSurfaceY) {
            vec4 sc = projectionMatrix * viewMatrix * vec4(cameraPosition + ray * tS, 1.0);
            gl_Position.z = (sc.z / sc.w - 0.0002) * gl_Position.w;
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'hammerhead-v1';
  return mat;
}

interface Shark {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  turn: number;
  phase: number;
  scale: number;
  pod: number;
  slot: number;
}

type PodState = 'cruise' | 'circle' | 'chase' | 'leave';
interface Pod {
  home: { x: number; z: number };
  state: PodState;
  timer: number;
  /** Where the pod is heading (cruise / leave), the circle it rings (centre, radius, way round, angle). */
  tx: number;
  tz: number;
  cx: number;
  cz: number;
  cr: number;
  dir: number;
  ang: number;
  /** The fish school it is after while chasing. */
  prey: { x: number; z: number } | null;
  scareT: number;
}

/** What the sharks need from the reef fish: where the schools are, and a way to scatter them. */
export interface SharkPrey {
  schools: { x: number; z: number }[];
  scatter(x: number, z: number, r: number): void;
}

/**
 * Scalloped hammerheads cruising over the reefs in small groups: patrolling between reefs, now and
 * then circling slowly over one, darting after a school of reef fish (which scatter before them) and
 * swimming off into open water before coming back. Their bodies bend in a wave from the head to the
 * tail and curve into each turn. Off screen they keep swimming but aren't drawn.
 */
export class Sharks {
  readonly group = new THREE.Group();
  readonly sharks: Shark[] = [];
  readonly pods: Pod[] = [];
  private mesh: THREE.InstancedMesh;
  private swim: THREE.InstancedBufferAttribute;
  private rng: RNG;

  constructor(private world: World, reefs: { x: number; z: number; r: number }[], private prey: SharkPrey) {
    this.rng = new RNG(world.seed * 71 + 5);
    const rng = this.rng;
    // Homes: reefs in water deep enough to swim over, well apart.
    const homes = reefs.filter((r) => this.deep(r.x, r.z, -1.1)).sort(() => rng.next() - 0.5);
    for (const h of homes) {
      if (this.pods.length >= 3) break;
      if (this.pods.some((p) => Math.hypot(p.home.x - h.x, p.home.z - h.z) < 25)) continue;
      this.pods.push({ home: { x: h.x, z: h.z }, state: 'cruise', timer: rng.range(4, 10), tx: h.x, tz: h.z, cx: h.x, cz: h.z, cr: 2.5, dir: 1, ang: 0, prey: null, scareT: 0 });
      const n = rng.int(3, 4);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const x = h.x + Math.cos(a) * 1.5, z = h.z + Math.sin(a) * 1.5;
        this.sharks.push({ x, y: this.swimY(x, z), z, heading: rng.range(0, Math.PI * 2), speed: 0.8, turn: 0, phase: rng.range(0, 6), scale: rng.range(1.15, 1.5), pod: this.pods.length - 1, slot: k });
      }
    }
    const geo = hammerheadGeometry();
    const n = Math.max(1, this.sharks.length);
    this.swim = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.swim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iSwim', this.swim);
    this.mesh = new THREE.InstancedMesh(geo, sharkMaterial(), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.castShadow = true;
    this.mesh.name = 'hammerheads';
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  /** Sea deep enough to swim in (open water, floor below `y`). */
  private deep(x: number, z: number, y = -0.95): boolean {
    const w = this.world, i = w.cellIndexAt(x, z);
    return i >= 0 && w.layer[i] <= 0 && Number.isNaN(w.riverY[i]) && !w.canal[i] && !w.blockFixed[i] && w.heightAt(x, z) < y;
  }

  /** Cruising depth: a little off the floor, the dorsal fin's tip about at the surface. */
  private swimY(x: number, z: number): number {
    return THREE.MathUtils.clamp(this.world.heightAt(x, z) + 0.45, -1.5, -0.42);
  }

  /** A point in deep water near (x, z), within r. */
  private spot(x: number, z: number, r0: number, r1: number): { x: number; z: number } | null {
    for (let k = 0; k < 24; k++) {
      const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(r0, r1);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (this.deep(px, pz, -1.1)) return { x: px, z: pz };
    }
    return null;
  }

  private podCentre(k: number): { x: number; z: number } {
    let x = 0, z = 0, n = 0;
    for (const s of this.sharks) if (s.pod === k) { x += s.x; z += s.z; n++; }
    return { x: x / Math.max(1, n), z: z / Math.max(1, n) };
  }

  private think(p: Pod, k: number, dt: number): void {
    p.timer -= dt;
    const c = this.podCentre(k);
    if (p.state === 'chase' && p.prey) {
      // Keep after the school as it scatters.
      const school = this.prey.schools.reduce((best, s) => (Math.hypot(s.x - c.x, s.z - c.z) < Math.hypot(best.x - c.x, best.z - c.z) ? s : best), p.prey);
      p.prey = school;
      p.tx = school.x;
      p.tz = school.z;
      p.scareT -= dt;
      if (p.scareT <= 0 && Math.hypot(school.x - c.x, school.z - c.z) < 4) {
        this.prey.scatter(c.x, c.z, 3.2);
        p.scareT = 0.4;
      }
    }
    if (p.state === 'circle') p.ang += (p.dir * 0.45 * dt) / Math.max(1.5, p.cr) * 2.2;
    const arrived = Math.hypot(p.tx - c.x, p.tz - c.z) < 2;
    if (p.timer > 0 && !(arrived && (p.state === 'cruise' || p.state === 'leave'))) return;
    // Next thing to do.
    const fromHome = Math.hypot(c.x - p.home.x, c.z - p.home.z);
    const near = this.prey.schools.filter((s) => Math.hypot(s.x - c.x, s.z - c.z) < 16 && this.deep(s.x, s.z, -0.8));
    const r = this.rng.next();
    if (p.state === 'chase') {
      // After the chase they swim off out into open water.
      const away = this.spot(c.x, c.z, 14, 26) ?? this.spot(p.home.x, p.home.z, 6, 14);
      p.state = 'leave';
      if (away) { p.tx = away.x; p.tz = away.z; }
      p.timer = 25;
    } else if (near.length && r < 0.35 && fromHome < 30) {
      p.state = 'chase';
      p.prey = near[Math.floor(this.rng.next() * near.length)];
      p.timer = this.rng.range(5, 8);
      p.scareT = 0;
    } else if (r < 0.7 && this.deep(c.x, c.z, -1.0)) {
      p.state = 'circle';
      p.cx = c.x;
      p.cz = c.z;
      p.cr = this.rng.range(2.2, 3.6);
      p.dir = this.rng.chance(0.5) ? 1 : -1;
      p.ang = this.rng.range(0, Math.PI * 2);
      p.timer = this.rng.range(12, 22);
    } else {
      // Patrol to another spot round home (head back there if they've wandered off).
      const t = this.spot(p.home.x, p.home.z, fromHome > 30 ? 0 : 4, fromHome > 30 ? 6 : 16);
      p.state = 'cruise';
      if (t) { p.tx = t.x; p.tz = t.z; }
      p.timer = this.rng.range(10, 18);
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.pods.forEach((p, k) => this.think(p, k, dt));
    const counts = this.pods.map((_, k) => this.sharks.filter((s) => s.pod === k).length);
    for (const s of this.sharks) {
      const p = this.pods[s.pod];
      const n = counts[s.pod];
      // Where this one wants to be.
      let tx: number, tz: number, want: number;
      if (p.state === 'circle') {
        const a = p.ang + (s.slot / n) * Math.PI * 2;
        // Aim a little ahead round the ring, so it swims the circle rather than cutting across.
        const ahead = a + p.dir * 0.5;
        tx = p.cx + Math.cos(ahead) * p.cr;
        tz = p.cz + Math.sin(ahead) * p.cr;
        want = 0.85;
      } else {
        // In a loose, staggered file behind the leader.
        const lead = s.slot === 0;
        const side = (s.slot % 2 ? 1 : -1) * Math.ceil(s.slot / 2) * 0.9, back = s.slot * 1.1;
        const h = Math.atan2(p.tx - s.x, p.tz - s.z);
        tx = p.tx + (lead ? 0 : Math.cos(h) * side - Math.sin(h) * back);
        tz = p.tz + (lead ? 0 : -Math.sin(h) * side - Math.cos(h) * back);
        want = p.state === 'chase' ? 2.6 : p.state === 'leave' ? 1.5 : 0.95;
      }
      // Keep apart from the others.
      for (const o of this.sharks) {
        if (o === s) continue;
        const dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz);
        if (d < 1.1 && d > 1e-3) { tx += (dx / d) * 1.5; tz += (dz / d) * 1.5; }
      }
      let dh = Math.atan2(tx - s.x, tz - s.z) - s.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      // Ahead into the shallows: turn hard away.
      const lx = s.x + Math.sin(s.heading) * 2, lz = s.z + Math.cos(s.heading) * 2;
      if (!this.deep(lx, lz)) dh = (dh >= 0 ? 1 : -1) * 2;
      const maxTurn = p.state === 'chase' ? 1.6 : 1.0;
      const turn = THREE.MathUtils.clamp(dh * 1.4, -maxTurn, maxTurn);
      s.turn += (turn - s.turn) * Math.min(1, dt * 3);
      s.heading += s.turn * dt;
      s.speed += (want * (0.55 + 0.45 * Math.cos(Math.min(Math.abs(dh), Math.PI / 2))) - s.speed) * Math.min(1, dt * 1.5);
      const nx = s.x + Math.sin(s.heading) * s.speed * dt, nz = s.z + Math.cos(s.heading) * s.speed * dt;
      if (this.deep(nx, nz)) { s.x = nx; s.z = nz; }
      s.y += (this.swimY(s.x, s.z) - s.y) * Math.min(1, dt * 0.8);
      // Tail beats faster the harder it swims.
      s.phase += dt * (2.2 + s.speed * 2.6);
    }
    this.draw();
  }

  private draw(): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const arr = this.swim.array as Float32Array;
    let n = 0;
    for (const s of this.sharks) {
      if (!View.sees(s.x, s.y, s.z, s.scale)) continue;
      q.setFromAxisAngle(up, s.heading);
      this.mesh.setMatrixAt(n, m.compose(p.set(s.x, s.y, s.z), q, sc.setScalar(s.scale)));
      arr[n * 3] = s.phase;
      arr[n * 3 + 1] = 0.075 + 0.035 * Math.min(1, s.speed / 2);
      // Bend into the turn (the tail swings out the other way).
      arr[n * 3 + 2] = THREE.MathUtils.clamp(-s.turn * 0.09, -0.12, 0.12);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.swim.needsUpdate = true;
  }
}
