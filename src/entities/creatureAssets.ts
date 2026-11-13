import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { warmLoads } from '../render/WarmUp';

/**
 * The creature models (public/models/creatures, made from the artist's GLBs by
 * `npx @gltf-transform/cli optimize … --compress meshopt --simplify false`). Every model faces +z,
 * stands on y = 0 and is coloured by its vertices (no textures). Each loads once and is shared.
 *
 * Two ways to use one:
 *  - `CreatureRig`: a skinned copy playing the model's own clips, for animals there are only a few
 *    dozen of (livestock, dogs, birds, crabs, turtles…). Each is one draw call and one mixer, so
 *    owners should pause (`visible = false`, no `update`) the ones far from the camera.
 *  - `creatureGeometry`: one pose baked into plain geometry (vertex colours included), for animals
 *    drawn by the hundred as instances (reef fish, starfish, anemones), animated in their shaders.
 */
export type CreatureName =
  | 'starfish' | 'reef-crab' | 'shore-crab' | 'hermit-crab' | 'sea-anemone'
  | 'clownfish' | 'blue-tang' | 'banggai-cardinalfish' | 'flame-angelfish' | 'foxface-rabbitfish' | 'green-chromis' | 'chromis'
  | 'moray-eel' | 'stingray' | 'sea-turtle' | 'dolphin' | 'moon-jellyfish'
  | 'crocodile' | 'pig' | 'goat' | 'ox' | 'dog' | 'chicken' | 'duck'
  | 'gull' | 'parrot' | 'butterfly' | 'bumblebee';

export interface CreatureAsset {
  name: CreatureName;
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** The model's bounds in its bind pose (model units). */
  box: THREE.Box3;
  /** Nose-to-tail length along z (model units): scale by `wanted / length` to size it in the world. */
  length: number;
}

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<CreatureName, Promise<CreatureAsset>>();
const loaded = new Map<CreatureName, CreatureAsset>();

/** Load a creature model (once; later calls share the same promise). Counted in the splash warm-up. */
export function loadCreature(name: CreatureName): Promise<CreatureAsset> {
  let p = cache.get(name);
  // Outside a browser (the tests in Node) nothing loads: callers keep their stand-ins.
  if (!p && typeof document === 'undefined') {
    p = new Promise<CreatureAsset>(() => undefined);
    cache.set(name, p);
  }
  if (!p) {
    const url = typeof document === 'undefined' ? `models/creatures/${name}.glb` : new URL(`models/creatures/${name}.glb`, document.baseURI).href;
    p = loader.loadAsync(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const asset: CreatureAsset = { name, scene: gltf.scene, clips: gltf.animations, box, length: Math.max(1e-3, box.max.z - box.min.z) };
      loaded.set(name, asset);
      return asset;
    });
    p.catch((err) => console.error(`Creature model "${name}" failed to load.`, err));
    if (typeof document !== 'undefined') warmLoads.push(p.catch(() => undefined));
    cache.set(name, p);
  }
  return p;
}

/** The model if it has finished loading (null until then). */
export function creatureNow(name: CreatureName): CreatureAsset | null {
  return loaded.get(name) ?? null;
}

/** Find a clip by name, ignoring case ('walk' finds 'Walk'); falls back to the first clip. */
export function findClip(clips: THREE.AnimationClip[], ...names: string[]): THREE.AnimationClip | undefined {
  for (const n of names) {
    const c = clips.find((k) => k.name.toLowerCase() === n.toLowerCase());
    if (c) return c;
  }
  return undefined;
}

/**
 * A skinned copy of a creature playing its own clips, cross-fading between them. `root` is what to
 * position, turn and scale; the model sits inside it (facing +z, feet at y = 0, `size` world
 * units nose to tail).
 */
export class CreatureRig {
  readonly root = new THREE.Group();
  readonly body: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  playing: string | null = null;

  constructor(readonly asset: CreatureAsset, size: number, opts: { tint?: THREE.ColorRepresentation; material?: (m: THREE.MeshStandardMaterial) => THREE.Material } = {}) {
    this.body = cloneSkinned(asset.scene);
    this.body.traverse((n) => {
      const m = n as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      // Skinned bounds follow the bind pose, not the animation: never cull on them.
      m.frustumCulled = false;
      m.castShadow = true;
      if (opts.tint !== undefined || opts.material) {
        let mat = (m.material as THREE.MeshStandardMaterial).clone();
        if (opts.tint !== undefined) mat.color.multiply(new THREE.Color(opts.tint));
        if (opts.material) mat = opts.material(mat) as THREE.MeshStandardMaterial;
        m.material = mat;
      }
    });
    this.body.scale.setScalar(size / asset.length);
    this.root.add(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    for (const clip of asset.clips) this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip));
  }

  /**
   * Lift or drop the model so its lowest point rests on y = 0 of `root` while playing `clip` (the
   * clips can carry the body away from the bind pose, e.g. a turtle raised on its flippers).
   */
  groundTo(clip: string, time = 0): void {
    const action = this.actions.get(clip.toLowerCase());
    if (!action) return;
    const prev = this.playing;
    action.reset().play();
    this.mixer.update(time);
    this.body.position.y = 0;
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    let low = Infinity;
    const v = new THREE.Vector3();
    this.body.traverse((n) => {
      const m = n as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const P = m.geometry.getAttribute('position');
      for (let i = 0; i < P.count; i += 3) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        if (v.y < low) low = v.y;
      }
    });
    if (Number.isFinite(low)) this.body.position.y = -low;
    action.stop();
    this.playing = null;
    if (prev) this.play(prev, 0);
  }

  private bones = new Map<string, THREE.Object3D | null>();
  /** A bone of this copy by name (null if the model has none of that name). */
  bone(name: string): THREE.Object3D | null {
    let b = this.bones.get(name);
    if (b === undefined) {
      b = this.body.getObjectByName(name) ?? null;
      this.bones.set(name, b);
    }
    return b;
  }

  /** Which side of the body a bone sits on: +1 or -1 along the model's x (0 if on the middle line or missing). */
  side(name: string): number {
    const b = this.bone(name);
    if (!b) return 0;
    this.root.updateWorldMatrix(true, true);
    const p = this.root.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
    return Math.abs(p.x) < 1e-4 ? 0 : Math.sign(p.x);
  }

  /**
   * Turn a bone by `angle` about an axis given in the model's own frame (x across, y up, z nose),
   * on top of whatever the playing clip has done to it. Call after update(), every frame: the
   * mixer sets the bone afresh each time. For hand-made motion the clips lack (a crawl, a sit).
   */
  swing(name: string, axis: THREE.Vector3, angle: number): void {
    const b = this.bone(name);
    if (!b || !b.parent || angle === 0) return;
    b.parent.updateWorldMatrix(true, false);
    const rootQ = this.root.getWorldQuaternion(_q1), parentQ = b.parent.getWorldQuaternion(_q2);
    // World turn = root * turn * root⁻¹; applied in front of the bone's world rotation, then put back into its parent's frame.
    const turn = _q3.setFromAxisAngle(axis, angle).premultiply(rootQ).multiply(_q4.copy(rootQ).invert());
    b.quaternion.premultiply(parentQ).premultiply(turn).premultiply(_q4.copy(parentQ).invert());
  }

  has(clip: string): boolean {
    return this.actions.has(clip.toLowerCase());
  }

  /** Cross-fade to a clip (by name, any case). Loops start at a random point so a herd never moves in step. */
  play(clip: string, fade = 0.3, speed = 1): void {
    const key = clip.toLowerCase();
    const next = this.actions.get(key);
    if (!next) return;
    next.timeScale = speed;
    if (this.playing === key) return;
    const prev = this.playing ? this.actions.get(this.playing) : undefined;
    next.reset();
    next.time = Math.random() * next.getClip().duration;
    next.play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else prev?.stop();
    this.playing = key;
  }

  /** Change the playing clip's speed (e.g. to match a walk to how fast it is going). */
  setSpeed(speed: number): void {
    const a = this.playing ? this.actions.get(this.playing) : undefined;
    if (a) a.timeScale = speed;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

/**
 * One pose of a creature baked into plain, indexed geometry: position, normal and colour (the
 * vertex colours times the material colour), centred on x, nose towards +z, scaled so it is
 * `length` world units nose to tail with its lowest point at y = 0 (`centreY`: its middle at y = 0,
 * for swimmers). `clip`/`time` pick the pose (default: the bind pose).
 */
export function bakeCreature(asset: CreatureAsset, opts: { length?: number; clip?: string; time?: number; centreY?: boolean } = {}): THREE.BufferGeometry {
  const root = cloneSkinned(asset.scene);
  if (opts.clip) {
    const clip = findClip(asset.clips, opts.clip);
    if (clip) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixer.update(opts.time ?? 0);
    }
  }
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  root.traverse((n) => {
    const m = n as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const src = m.geometry;
    const P = src.getAttribute('position'), C = src.getAttribute('color');
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const tint = mat.color ?? new THREE.Color(1, 1, 1);
    const pos = new Float32Array(P.count * 3), col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      // getVertexPosition applies the skinning (and morphs) for this pose.
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.getVertexPosition(i, v);
      else v.fromBufferAttribute(P, i);
      v.applyMatrix4(m.matrixWorld);
      pos.set([v.x, v.y, v.z], i * 3);
      const r = C ? C.getX(i) : 1, g = C ? C.getY(i) : 1, b = C ? C.getZ(i) : 1;
      col.set([r * tint.r, g * tint.g, b * tint.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (src.index) g.setIndex(src.index.clone());
    parts.push(g);
  });
  let geo = parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!, L = Math.max(1e-4, bb.max.z - bb.min.z), k = (opts.length ?? L) / L;
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, y0 = opts.centreY ? (bb.min.y + bb.max.y) / 2 : bb.min.y;
  geo.translate(-cx, -y0, -cz);
  geo.scale(k, k, k);
  geo = mergeVertices(geo, 1e-5);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A lighter copy of an indexed geometry (`ratio` of its triangles, borders kept), for distant
 * instances. Resolves to the geometry itself if the simplifier can't run.
 */
export async function simplifyGeometry(geo: THREE.BufferGeometry, ratio: number): Promise<THREE.BufferGeometry> {
  try {
    await MeshoptSimplifier.ready;
    const P = geo.getAttribute('position') as THREE.BufferAttribute, I = geo.index!;
    const target = Math.max(3, Math.floor((I.count * ratio) / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(new Uint32Array(I.array), new Float32Array(P.array), 3, target, 0.02, ['LockBorder']);
    const g = geo.clone();
    g.setIndex(new THREE.BufferAttribute(out, 1));
    return g;
  } catch {
    return geo;
  }
}

/** The swim attribute the fish shader bends (see fishModels.ts): `aFish` = (sideways swing, fin flap, wave phase). */
export function addFishSwim(geo: THREE.BufferGeometry, finFlap = 0): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const P = geo.getAttribute('position'), bb = geo.boundingBox!, L = Math.max(1e-4, bb.max.z - bb.min.z);
  const fish = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const u = THREE.MathUtils.clamp((bb.max.z - P.getZ(i)) / L, 0, 1);
    // The head barely moves; the swing builds toward the tail (carangiform swimming).
    fish[i * 3] = L * (0.012 + 0.2 * Math.pow(u, 2.2));
    fish[i * 3 + 1] = finFlap * Math.abs(P.getX(i)) / Math.max(1e-4, bb.max.x - bb.min.x);
    fish[i * 3 + 2] = u * 3.4;
  }
  geo.setAttribute('aFish', new THREE.BufferAttribute(fish, 3));
  return geo;
}

const fishCache = new Map<string, Promise<{ hi: THREE.BufferGeometry; lo: THREE.BufferGeometry }>>();
/**
 * A fish model ready for instancing with the fish shader: baked, centred, `length` nose to tail,
 * with its swim attribute, plus a lighter copy for distant fish. Shared per (name, length).
 */
export function fishModel(name: CreatureName, length: number): Promise<{ hi: THREE.BufferGeometry; lo: THREE.BufferGeometry }> {
  const key = `${name}:${length.toFixed(4)}`;
  let p = fishCache.get(key);
  if (!p) {
    p = loadCreature(name).then(async (asset) => {
      const hi = addFishSwim(bakeCreature(asset, { length, centreY: true }), 1);
      const lo = await simplifyGeometry(hi, 0.3);
      return { hi, lo };
    });
    fishCache.set(key, p);
  }
  return p;
}

/**
 * Swap instanced meshes over to a creature's model once it loads (they keep drawing their
 * stand-in geometry until then, and keep it if the model fails to load).
 */
export function swapToFish(name: CreatureName, length: number, hi: THREE.Mesh[], lo: THREE.Mesh[] = []): void {
  if (typeof document === 'undefined') return;
  fishModel(name, length).then((m) => {
    for (const mesh of hi) mesh.geometry = m.hi;
    for (const mesh of lo) mesh.geometry = m.lo;
  }).catch(() => undefined);
}
