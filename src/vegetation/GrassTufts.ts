import * as THREE from 'three';
import { COLORS, VEG } from '../config';
import { GeoBuilder } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { GROUND_FX, TRAMPLERS } from '../terrain/groundFx';
import { RNG } from '../world/rng';
import { World } from '../world/World';

/**
 * A clump of thin blades, pivoting at the ground and swaying at the tips: tall ones standing in the
 * middle, shorter ones splayed round them, each a different height, width and lean, and every other
 * blade bent over at the tip. (Blades alternate plain and bent, so doubling `n` doubles the vertices.)
 */
function tuftGeometry(n = 6): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const base = new THREE.Color(COLORS.grassOlive), tip = new THREE.Color(COLORS.grassBright), dry = new THREE.Color(0xc9c56a);
  const hash = (k: number, s: number) => {
    const v = Math.sin(k * 127.1 + s * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  // Normals point up so blades light like the meadow under them (seen from above, not edge-on).
  for (let k = 0; k < n; k++) {
    const bent = k % 2 === 1;
    // Round the clump by the golden angle, so no two blades line up however many there are.
    const a = k * 2.39996 + (hash(k, 1) - 0.5) * 0.6;
    const out = 0.25 + 0.75 * hash(k, 2);
    // Inner blades stand tall and straight; outer ones are shorter and lean right out.
    const lean = 0.12 + out * 0.5, h = (0.27 - out * 0.09) * (0.85 + hash(k, 3) * 0.3), w = 0.02 + hash(k, 4) * 0.014;
    const ca = Math.cos(a), sa = Math.sin(a), twist = a + Math.PI / 2 + (hash(k, 5) - 0.5) * 1.2;
    const wx = Math.cos(twist) * w, wz = Math.sin(twist) * w;
    const fx = ca * 0.025 * out, fz = sa * 0.025 * out;
    const at = (d: number, l: number): [number, number, number] => [fx + ca * Math.sin(l) * d, Math.cos(l) * d, fz + sa * Math.sin(l) * d];
    // Normals lean out with the blade (as the old clumps'), so the grass is shaded a little darker than the meadow, not paler.
    const up = [ca * Math.sin(0.55), Math.cos(0.55), sa * Math.sin(0.55)];
    const blade = new THREE.BufferGeometry();
    let top = h;
    if (bent) {
      // A knee two thirds of the way up, the tip folding outward past it.
      const knee = at(h * 0.62, lean), end = at(h * 0.42, lean + 0.8);
      top = knee[1] + end[1];
      blade.setAttribute('position', new THREE.Float32BufferAttribute([fx - wx, 0, fz - wz, fx + wx, 0, fz + wz, knee[0] - wx * 0.55, knee[1], knee[2] - wz * 0.55, knee[0] + end[0] - fx, top, knee[2] + end[2] - fz], 3));
      blade.setAttribute('normal', new THREE.Float32BufferAttribute([...up, ...up, ...up, ...up], 3));
      // Both windings share the upward normals, so either side lights the same (no back-face flip).
      blade.setIndex([0, 1, 2, 2, 1, 0, 1, 3, 2, 2, 3, 1]);
    } else {
      blade.setAttribute('position', new THREE.Float32BufferAttribute([fx - wx, 0, fz - wz, fx + wx, 0, fz + wz, ...at(h, lean)], 3));
      top = Math.cos(lean) * h;
      blade.setAttribute('normal', new THREE.Float32BufferAttribute([...up, ...up, ...up], 3));
      blade.setIndex([0, 1, 2, 2, 1, 0]);
    }
    // The odd blade drier and yellower than the rest.
    const tipCol = tip.clone().lerp(dry, hash(k, 6) > 0.7 ? 0.45 : hash(k, 6) * 0.15);
    b.add(blade, { color: (p) => base.clone().lerp(tipCol, Math.min(0.85, 0.2 + 0.7 * p.y / top)), sway: (p) => Math.min(1, p.y / top) * 0.9 });
  }
  return b.build();
}

let grassMat: THREE.MeshStandardMaterial | null = null;
/**
 * The grass clumps' own material: the shared plant look (wind sway, sun through the blades) plus
 *  - feet: clumps near a walker lean away from it and lie lower, quiver as it passes and stand up
 *    again behind it (the walkers come from setTramplers in groundFx),
 *  - paths: clumps shrink away to nothing as the ground under them is trodden, each at its own
 *    point, so the meadow thins towards a path instead of stopping at a cell's edge,
 *  - seasons: taller and fresh in spring, golden in autumn, short, pale and dry in winter.
 * All in the vertex shader bar one tint, so it costs phones next to nothing.
 */
export function grassMaterial(): THREE.MeshStandardMaterial {
  if (grassMat) return grassMat;
  const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, GROUND_FX);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec4 uTramplers[${TRAMPLERS}];
        uniform sampler2D uGroundWear;
        uniform float uGroundSize;
        uniform vec4 uSeasonK;`
      )
      .replace(
        '#include <project_vertex>',
        `#ifdef USE_INSTANCING
        {
          vec3 gOrg = instanceMatrix[3].xyz;
          float gS2 = max(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz), 1e-4);
          float gHash = fract(sin(dot(gOrg.xz, vec2(12.9898, 78.233))) * 43758.5453);
          // Trodden ground: each clump gives up at its own point.
          float gWear = texture2D(uGroundWear, (gOrg.xz + uGroundSize * 0.5) / uGroundSize).r;
          transformed *= 1.0 - smoothstep(0.06 + gHash * 0.2, 0.14 + gHash * 0.26, gWear);
          transformed.y *= uSeasonK.w;
          // Feet: pushed away from each walker in reach, hardest right beside it.
          vec2 gPush = vec2(0.0);
          for (int k = 0; k < ${TRAMPLERS}; k++) {
            vec4 tr = uTramplers[k];
            vec2 gd = gOrg.xz - tr.xz;
            float gl = length(gd);
            gPush += gd / max(gl, 0.05) * (1.0 - smoothstep(tr.w * 0.25, tr.w + 1e-4, gl)) * step(0.001, tr.w);
          }
          float gLen = length(gPush);
          float gA = min(gLen, 1.0);
          if (gA > 0.001) {
            // A quiver while it is half pushed over (as the walker arrives and leaves).
            float gQ = 1.0 + sin(uTime * 11.0 + gHash * 6.28) * 0.2 * (1.0 - gA);
            vec3 gW = vec3(gPush.x, 0.0, gPush.y) / max(gLen, 1e-4) * (gA * aVeg.x * 0.17 * gQ);
            // World-space push carried back into the clump's own (turned, scaled) space.
            transformed += (gW * mat3(instanceMatrix)) / gS2;
            transformed.y *= 1.0 - gA * 0.5;
          }
        }
        #endif
        #include <project_vertex>`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSeasonTint;
        uniform vec4 uSeasonK;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // The season's colour, as on the meadow under the blades.
          vec3 gsc = diffuseColor.rgb * uSeasonTint;
          diffuseColor.rgb = mix(gsc, dot(gsc, vec3(0.3, 0.6, 0.1)) * vec3(1.3, 1.1, 0.68), clamp(uSeasonK.x, 0.0, 1.0) * 0.8);
        }`
      );
  };
  mat.customProgramCacheKey = () => 'grass-tufts-ground-v1';
  grassMat = mat;
  return mat;
}

interface Tuft {
  x: number;
  y: number;
  z: number;
  cell: number;
  rot: number;
  s: number;
  chunk: number;
}

/**
 * Decorative grass clumps over open meadows (not plants: nothing harvests them). Split into chunks
 * for frustum culling; clumps on buildings, fields and worn paths are hidden automatically.
 */
export class GrassTufts {
  readonly group = new THREE.Group();
  private tufts: Tuft[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private timer = 0;
  private ultra = false;
  private C = VEG.chunks;

  constructor(private world: World, density: number) {
    const w = world;
    const rng = new RNG(w.seed * 311 + 7);
    const N = w.N;
    for (let cz = 1; cz < N - 1; cz++) {
      for (let cx = 1; cx < N - 1; cx++) {
        const i = cz * N + cx;
        if (!w.isLandCell(i) || w.sandy[i] > 0.4 || w.rocky[i] > 0.35 || w.swamp[i] > 0.35) continue;
        // Thick in open meadows, sparser on the shaded jungle floor.
        const want = VEG.tuftsPerCell * density * (1 - w.forest[i] * 0.7);
        const n = Math.floor(want + rng.next());
        for (let k = 0; k < n; k++) {
          const x = w.centerX(cx) + rng.range(-0.5, 0.5), z = w.centerZ(cz) + rng.range(-0.5, 0.5);
          // Only on flat ground (not terrace faces).
          const y = w.heightAt(x, z);
          if (Math.abs(w.heightAt(x + 0.25, z) - y) > 0.05 || Math.abs(w.heightAt(x, z + 0.25) - y) > 0.05) continue;
          const chunk = Math.min(this.C - 1, Math.floor((cx / N) * this.C)) + Math.min(this.C - 1, Math.floor((cz / N) * this.C)) * this.C;
          this.tufts.push({ x, y, z, cell: i, rot: rng.range(0, 6.28), s: rng.range(0.7, 1.35), chunk });
        }
      }
    }
    const geo = tuftGeometry();
    const mat = grassMaterial();
    const col = new THREE.Color();
    const lime = new THREE.Color(0xffffff), olive = new THREE.Color(0xc8d0a0);
    for (let c = 0; c < this.C * this.C; c++) {
      const list = this.tufts.filter((t) => t.chunk === c);
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      list.forEach((t, k) => m.setColorAt(k, col.copy(lime).lerp(olive, ((t.rot * 13) % 1) * 0.8)));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      // Bounds for frustum culling.
      const size = (w.N / this.C) * 1.0;
      const ccx = c % this.C, ccz = Math.floor(c / this.C);
      const bx = (ccx + 0.5) * size - w.half, bz = (ccz + 0.5) * size - w.half;
      m.geometry = geo;
      (m as unknown as { _list: Tuft[] })._list = list;
      m.frustumCulled = true;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(bx, 3, bz), size * 0.75 + 4);
      this.meshes.push(m);
      this.group.add(m);
    }
    this.refresh();
  }

  /** Change visual blade density without moving clumps or affecting simulation. */
  setUltra(enabled: boolean): void {
    if (enabled === this.ultra) return;
    this.ultra = enabled;
    const old = this.meshes[0]?.geometry;
    const geometry = tuftGeometry(enabled ? 12 : 6);
    for (const mesh of this.meshes) mesh.geometry = geometry;
    old?.dispose();
  }

  /** Ground version the clumps' heights were last taken at, and a signature of what covers the ground. */
  private heightsAt = -1;
  private stamp = '';

  /** Re-pack visible clumps (hides those under buildings, farms and worn paths; follows sculpting). */
  refresh(): void {
    const w = this.world;
    this.stamp = this.signature();
    // Heights only change when the land is reshaped.
    const reheight = this.heightsAt !== w.version;
    this.heightsAt = w.version;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const m of this.meshes) {
      const list = (m as unknown as { _list: Tuft[] })._list;
      let n = 0;
      for (const t of list) {
        const i = t.cell;
        if (w.occ[i] !== 0 || w.path[i] || w.wear[i] > 0.3 || w.soil[i] > 0.05 || !w.isLandCell(i)) continue;
        if (reheight) t.y = w.heightAt(t.x, t.z);
        const y = t.y;
        q.setFromAxisAngle(up, t.rot);
        mtx.compose(p.set(t.x, y - 0.01, t.z), q, s.setScalar(t.s));
        m.setMatrixAt(n++, mtx);
      }
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** What decides which clumps show: the land's shape and what is built, paved, farmed or worn into it. */
  private signature(): string {
    const w = this.world;
    let h = 0;
    if (!w.occ) return `${w.version}`;
    for (let i = 0; i < w.occ.length; i++) {
      if (w.occ[i] !== 0 || w.path[i] || w.wear[i] > 0.3 || w.soil[i] > 0.05) h = (Math.imul(h, 31) + i * (1 + w.path[i]) + (w.occ[i] !== 0 ? 7 : 0)) | 0;
    }
    return `${w.version}|${h}`;
  }

  private cullTimer = 0;

  /**
   * @param camPos camera position, and `far`: clumps further than this aren't drawn (a couple of
   * pixels each by then, but thousands of them).
   */
  update(dt: number, camPos?: THREE.Vector3, far = Infinity): void {
    this.cullTimer -= dt;
    if (camPos && this.cullTimer <= 0) {
      this.cullTimer = 0.25;
      for (const m of this.meshes) {
        const bs = m.boundingSphere;
        m.visible = !bs || bs.center.distanceTo(camPos) - bs.radius < far;
      }
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 2.5;
      // Only when something has changed (re-packing every clump is a hitch on a phone).
      if (this.signature() !== this.stamp) this.refresh();
    }
  }
}
