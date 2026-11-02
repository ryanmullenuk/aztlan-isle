import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BI, BONES, BONE_COUNT, type BoneName, type ClipName, type GlbModel, type GlbPeople, type MotionClip } from './glbPeople';

/**
 * The islander characters: public/models/islander_male.glb and islander_female.glb, skinned
 * block-style figures with their own colour texture and animation clips (prepared from the
 * artist's files by `npm run islander:prepare`, which takes each from 200,000 triangles and
 * three 2048 px textures down to about 3,000 triangles and one 1024 px JPEG). Men, boys and old
 * men are drawn with the man; women, girls and old women with the woman (children smaller, with
 * bigger heads; elders with greyed hair).
 *
 * His 52-bone skeleton is folded onto the rig's 19 bones (fingers into the hands, toes into the
 * feet, the four spine bones into hips, spine and chest), so the procedural poses (walking,
 * working, carrying) drive him as before. His clips (idle, sad idle, dance, injured run, run
 * looking back, jog, crawl) are sampled once at load into the same 19 bone frames and played by
 * the rig for the moods and states they belong to.
 *
 * Colour comes from the model's texture. Skin is found by its colour there and tinted by each
 * islander's own tone (the middle tone draws it exactly as painted), and hair by its darkness, so
 * elders' hair can be greyed. A model without a texture is coloured by body part instead.
 */

const FILES = { m: 'models/islander_male.glb', f: 'models/islander_female.glb' } as const;
/** The skin tone the texture is painted in: islanders of this tone look exactly as painted. */
const PAINTED_TONE = new THREE.Color(0xc47a48);

/** Source bones (the file's Mixamo-style names) folded into each rig bone; the first drives it in clips. */
const fingers = (s: 'Left' | 'Right') => ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3, 4].map((k) => `${s}Hand${f}${k}`));
const SOURCE: Record<BoneName, string[]> = {
  hips: ['Hips'], spine: ['Spine1', 'Spine'], chest: ['Spine2'], neck: ['Neck'], head: ['Head', 'HeadTop_End'],
  shoulderL: ['LeftShoulder'], upper_armL: ['LeftArm'], forearmL: ['LeftForeArm'], handL: ['LeftHand', ...fingers('Left')],
  shoulderR: ['RightShoulder'], upper_armR: ['RightArm'], forearmR: ['RightForeArm'], handR: ['RightHand', ...fingers('Right')],
  thighL: ['LeftUpLeg'], shinL: ['LeftLeg'], footL: ['LeftFoot', 'LeftToeBase', 'LeftToe_End'],
  thighR: ['RightUpLeg'], shinR: ['RightLeg'], footR: ['RightFoot', 'RightToeBase', 'RightToe_End'],
};

type V3 = [number, number, number];
/**
 * The rig bones' joints in the bind pose (metres, facing +z), as measured from the model (for
 * tests and anything that needs them before it loads; the loader measures them again).
 */
export const RIGS: Record<'m', { joint: Record<BoneName, V3> }> = {
  m: {
    joint: {
      hips: [-0.011, 0.63, 0.072], spine: [-0.005, 0.877, 0.068], chest: [-0.004, 1.026, 0.061], neck: [-0.001, 1.194, 0.054], head: [-0.002, 1.329, 0.044],
      shoulderL: [0.08, 1.157, 0.07], upper_armL: [0.261, 1.088, 0.073], forearmL: [0.355, 0.9, 0.05], handL: [0.422, 0.715, 0.065],
      shoulderR: [-0.093, 1.156, 0.07], upper_armR: [-0.269, 1.083, 0.076], forearmR: [-0.365, 0.903, 0.049], handR: [-0.431, 0.719, 0.071],
      thighL: [0.135, 0.568, 0.065], shinL: [0.172, 0.346, 0.062], footL: [0.188, 0.177, 0.057],
      thighR: [-0.164, 0.569, 0.053], shinR: [-0.197, 0.344, 0.047], footR: [-0.212, 0.176, 0.049],
    },
  },
};

// ---------------- Colours ----------------

const C = { cream: 0xf4c78f, red: 0xe2382b, teal: 0x1f7f6c, sole: 0x6b3a1d, eye: 0x1c1410, hair: 0x2b201b };
/** Skin is white × this × the islander's skin tone: warmer and more orange, as in the character sheets. */
const SKIN_TINT = new THREE.Color(1.2, 0.86, 0.5);

type Paint = { color: number | 'skin'; hair?: boolean };

/**
 * The colour of a vertex from where it is on the body (bind pose) and the source bone that
 * carries it most. Heights are measured from the model's own joints, so a re-exported model of
 * the same design still lines up.
 */
export function paintFor(p: THREE.Vector3, n: THREE.Vector3, bone: string, J: Record<BoneName, THREE.Vector3>, faceZ: number): Paint {
  const skin: Paint = { color: 'skin' };
  if (/Head/.test(bone) && !/Hand/.test(bone)) {
    const hairline = J.head.y + 0.31, x = Math.abs(p.x);
    // The tie round the base of the topknot.
    if (p.y > hairline + 0.095 && p.y < hairline + 0.135 && x < 0.11 && p.z < 0.12) return { color: C.red };
    // The eyes: two small studs on the face.
    if (n.z > 0.7 && p.y > J.head.y + 0.08 && p.y < J.head.y + 0.13 && x > 0.05 && x < 0.125 && p.z > faceZ + 0.001) return { color: C.eye };
    // The face (the sideburns beside it are hair), and the ears at the sides; everything else is hair.
    if (p.y < hairline && p.z > faceZ - 0.12 && x < 0.17) return skin;
    if (p.y < hairline && x < 0.205 && p.z > faceZ - 0.02) return skin;
    if (p.y < hairline - 0.1 && x >= 0.205 && p.z > -0.06 && p.z < 0.14) return skin;
    return { color: C.hair, hair: true };
  }
  if (bone === 'Neck') return skin;
  if (/Hand|Foot|Toe|UpLeg|Leg$/.test(bone)) {
    if (/Foot|Toe/.test(bone) && p.y < 0.045) return { color: C.sole };
    return skin;
  }
  // The shoulder and upper arm bones also carry the upper chest: only beyond the body's sides are they sleeves.
  const outside = Math.abs(p.x) > 0.19;
  if (/Shoulder/.test(bone) && outside) return { color: C.red };
  if (/ForeArm/.test(bone)) {
    const side = p.x > 0 ? 'L' : 'R';
    const t = (J[`forearm${side}`].y - p.y) / (J[`forearm${side}`].y - J[`hand${side}`].y);
    return t > 0.5 ? { color: C.cream } : skin;
  }
  if (/Arm/.test(bone) && !/Shoulder/.test(bone) && outside) {
    const side = p.x > 0 ? 'L' : 'R';
    const t = (J[`upper_arm${side}`].y + 0.07 - p.y) / (J[`upper_arm${side}`].y + 0.07 - J[`forearm${side}`].y);
    return t < 0.55 ? { color: C.red } : t < 0.78 ? { color: C.cream } : skin;
  }
  // The tunic: skirt below the belt, the body above it.
  const belt0 = J.hips.y + 0.135, belt1 = J.hips.y + 0.215, front = p.z > J.hips.z + 0.05 && n.z > 0.25, x = Math.abs(p.x - J.hips.x);
  if (p.y > belt0 && p.y < belt1) return { color: C.teal };
  if (p.y <= belt0) {
    // A red band above the hem (where the fret is carved), and a red panel down the front.
    const hem = J.shinL.y + 0.055;
    if (p.y > hem + 0.045 && p.y < hem + 0.11) return { color: C.red };
    if (front && x < 0.07 && p.y > hem + 0.16) return { color: C.red };
    return { color: C.cream };
  }
  // Above the belt: a red band round the waist, red sleeves at the shoulders, the red V-neck.
  if (p.y < belt1 + 0.04) return { color: C.red };
  if (x > 0.19 && p.y > J.chest.y + 0.05) return { color: C.red };
  if (front && p.y > J.neck.y - 0.14 && x < (p.y - (J.neck.y - 0.14)) * 0.9) return { color: C.red };
  return { color: C.cream };
}

// ---------------- Loading ----------------

/** The clip names in the file. */
const CLIPS: ClipName[] = ['idle', 'sad_idle', 'twerk', 'injured_run', 'run_look_back', 'jog', 'zombie_crawl'];
/** Samples per second stored for each clip (played back with interpolation). */
const FPS = 30;

/** Bind frames at each joint, limbs turned so -y runs down the bone (the rig's convention). */
function bindFrames(joint: Record<BoneName, THREE.Vector3>): THREE.Matrix4[] {
  const down = new THREE.Vector3(0, -1, 0), one = new THREE.Vector3(1, 1, 1);
  const frame = (at: THREE.Vector3, to?: THREE.Vector3) => {
    const q = to ? new THREE.Quaternion().setFromUnitVectors(down, to.clone().sub(at).normalize()) : new THREE.Quaternion();
    return new THREE.Matrix4().compose(at, q, one);
  };
  return BONES.map((bn) => {
    const s = bn.slice(-1);
    if (bn.startsWith('upper_arm')) return frame(joint[bn], joint[`forearm${s}` as BoneName]);
    if (bn.startsWith('forearm')) return frame(joint[bn], joint[`hand${s}` as BoneName]);
    if (bn.startsWith('hand')) return frame(joint[bn], joint[bn].clone().multiplyScalar(2).sub(joint[`forearm${s}` as BoneName]));
    if (bn.startsWith('thigh')) return frame(joint[bn], joint[`shin${s}` as BoneName]);
    if (bn.startsWith('shin')) return frame(joint[bn], joint[`foot${s}` as BoneName]);
    return frame(joint[bn]);
  });
}

/** What a texel shows: skin (orange), hair (near black), or anything else. */
export function texelKind(r: number, g: number, b: number): 'skin' | 'hair' | 'other' {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 0.16 && max - min < 0.16) return 'hair';
  // Orange-brown: red well above green, green well above blue, and saturated (cream is pale, red cloth has little green).
  if (r > 0.45 && g > r * 0.38 && g < r * 0.78 && b < g * 0.75 && (max - min) / max > 0.45) return 'skin';
  return 'other';
}

/** Read a texture's pixels (once, at load) to tell skin and hair apart. */
function texels(map: THREE.Texture): ((u: number, v: number) => [number, number, number]) | null {
  const img = map.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data, W = cv.width, H = cv.height;
  return (u, v) => {
    // glTF texture coordinates: (0, 0) at the image's top left (the texture isn't flipped).
    const x = Math.min(W - 1, Math.max(0, Math.floor((u - Math.floor(u)) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((v - Math.floor(v)) * H)));
    const i = (y * W + x) * 4;
    return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
  };
}

async function loadModel(file: string): Promise<GlbModel> {
  const gltf = await new GLTFLoader().loadAsync(new URL(file, document.baseURI).href);
  const FILE = file;
  gltf.scene.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((o) => { if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error(`${FILE}: no skinned mesh`);
  const sk = mesh as THREE.SkinnedMesh;
  const bones = sk.skeleton.bones, inv = sk.skeleton.boneInverses;
  const toRig = new Int8Array(bones.length).fill(-1), driver = new Array<number>(BONE_COUNT).fill(-1);
  bones.forEach((b, i) => {
    for (const rb of BONES) {
      const k = SOURCE[rb].indexOf(b.name);
      if (k < 0) continue;
      toRig[i] = BI[rb];
      if (k === 0) driver[BI[rb]] = i;
    }
  });
  if (driver.some((d) => d < 0)) throw new Error(`${FILE}: missing bones for ${BONES.filter((_, i) => driver[i] < 0).join(', ')}`);
  // Mesh space at bind (the skin's bind matrix), where the feet stand at y = 0 facing +z.
  const bind = sk.bindMatrix, bindInv = sk.bindMatrixInverse;
  const joint = {} as Record<BoneName, THREE.Vector3>;
  for (const b of BONES) joint[b] = new THREE.Vector3().setFromMatrixPosition(bindInv.clone().multiply(inv[driver[BI[b]]].clone().invert()));
  const frames = bindFrames(joint);

  // Geometry: positions, flat normals, the weights folded onto the rig's bones, and colours.
  const src = sk.geometry.index ? sk.geometry.toNonIndexed() : sk.geometry;
  const P = src.getAttribute('position'), N = src.getAttribute('normal'), UV = src.getAttribute('uv');
  const map = ((Array.isArray(sk.material) ? sk.material[0] : sk.material) as THREE.MeshStandardMaterial).map ?? null;
  const read = map && UV ? texels(map) : null;
  const SI = src.getAttribute('skinIndex'), SW = src.getAttribute('skinWeight');
  const n = P.count;
  const si = new Float32Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3), mat = new Float32Array(n), hairB = new Float32Array(n);
  const p = new THREE.Vector3(), nn = new THREE.Vector3(), c = new THREE.Color();
  // The face plane: the typical depth of the head's front-facing faces below the hairline.
  const fronts: number[] = [];
  for (let i = 0; i < n; i++) if (N.getZ(i) > 0.9 && Math.abs(P.getX(i)) < 0.15 && P.getY(i) > joint.head.y + 0.04 && P.getY(i) < joint.head.y + 0.28) fronts.push(P.getZ(i));
  fronts.sort((a, b) => a - b);
  const faceZ = fronts[fronts.length >> 1] ?? 0.25;
  // Each triangle takes one colour, from its middle and the bone carrying it most: big flat
  // facets, as in the character sheets, with no colour bleeding across a seam.
  const boneW = new Map<number, number>();
  for (let t = 0; t < n; t += 3) {
    boneW.clear();
    p.set(0, 0, 0);
    nn.set(0, 0, 0);
    for (let i = t; i < t + 3; i++) {
      p.x += P.getX(i) / 3; p.y += P.getY(i) / 3; p.z += P.getZ(i) / 3;
      nn.x += N.getX(i); nn.y += N.getY(i); nn.z += N.getZ(i);
      for (let k = 0; k < 4; k++) {
        const b = SI.getComponent(i, k), wt = SW.getComponent(i, k);
        if (wt > 0) boneW.set(b, (boneW.get(b) ?? 0) + wt);
      }
    }
    nn.normalize();
    if (read && UV) {
      // Textured: the texel at the triangle's corners and middle decides skin or hair.
      const votes = { skin: 0, hair: 0, other: 0 };
      let mu = 0, mv = 0;
      for (let i = t; i < t + 3; i++) {
        votes[texelKind(...read(UV.getX(i), UV.getY(i)))]++;
        mu += UV.getX(i) / 3; mv += UV.getY(i) / 3;
      }
      votes[texelKind(...read(mu, mv))] += 2;
      // Only clearly skin (or hair): a triangle straddling cloth and skin stays as painted.
      const kind = votes.skin >= 4 ? 'skin' : votes.hair >= 4 ? 'hair' : 'other';
      // Skin: white over the painted tone, so the islander's own tone takes its place.
      if (kind === 'skin') c.setRGB(1 / PAINTED_TONE.r, 1 / PAINTED_TONE.g, 1 / PAINTED_TONE.b);
      else c.setRGB(1, 1, 1);
      for (let i = t; i < t + 3; i++) {
        col.set([c.r, c.g, c.b], i * 3);
        mat[i] = kind === 'skin' ? 1 : 0;
        hairB[i] = kind === 'hair' ? 1 : 0;
      }
      continue;
    }
    let top = 0, topW = -1;
    for (const [b, wt] of boneW) if (wt > topW) { topW = wt; top = b; }
    const paint = paintFor(p, nn, bones[top]?.name ?? 'Hips', joint, faceZ);
    if (paint.color === 'skin') c.copy(SKIN_TINT); else c.setHex(paint.color);
    for (let i = t; i < t + 3; i++) {
      col.set([c.r, c.g, c.b], i * 3);
      mat[i] = paint.color === 'skin' ? 1 : 0;
      hairB[i] = paint.hair ? 1 : 0;
    }
  }
  for (let i = 0; i < n; i++) {
    const w = new Map<number, number>();
    for (let k = 0; k < 4; k++) {
      const b = SI.getComponent(i, k), wt = SW.getComponent(i, k);
      if (wt <= 0) continue;
      const r = toRig[b] >= 0 ? toRig[b] : BI.hips;
      w.set(r, (w.get(r) ?? 0) + wt);
    }
    const list = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((s, [, x]) => s + x, 0) || 1;
    list.forEach(([b, x], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = x / sum; });
    if (!list.length) { si[i * 4] = BI.hips; sw[i * 4] = 1; }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', P.clone());
  geometry.setAttribute('normal', N.clone());
  geometry.setAttribute('uv', UV ? UV.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 2).fill(0.5), 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('aSkinI', new THREE.Float32BufferAttribute(si, 4));
  geometry.setAttribute('aSkinW', new THREE.Float32BufferAttribute(sw, 4));
  geometry.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  geometry.setAttribute('aHairB', new THREE.Float32BufferAttribute(hairB, 1));
  geometry.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  geometry.computeBoundingSphere();
  if (src !== sk.geometry) src.dispose();

  // Clips: each sampled into the rig's bone frames, so skin = frame × the rig's bind frame⁻¹
  // reproduces the clip's own skinning. Root motion is taken out (the game moves the islander);
  // its speed is kept, so the playback can match how fast they actually go.
  const clips: Partial<Record<ClipName, MotionClip>> = {};
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const hipsBone = bones[driver[BI.hips]], hipsRest = hipsBone.position.clone();
  const S = new THREE.Matrix4(), M = new THREE.Matrix4();
  for (const name of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === name);
    if (!clip) continue;
    const root = clip.tracks.find((t) => t.name === `${hipsBone.name}.position`);
    let speed = 0;
    if (root) {
      const v = root.values, last = v.length - 3;
      speed = Math.hypot(v[last] - v[0], v[last + 2] - v[2]) / Math.max(1e-3, clip.duration);
      for (let k = 0; k < v.length; k += 3) { v[k] = hipsRest.x; v[k + 2] = hipsRest.z; }
    }
    const count = Math.max(2, Math.round(clip.duration * FPS) + 1);
    const data = new Float32Array(count * BONE_COUNT * 16);
    const action = mixer.clipAction(clip);
    action.play();
    for (let f = 0; f < count; f++) {
      mixer.setTime(Math.min(clip.duration, f / FPS));
      gltf.scene.updateMatrixWorld(true);
      for (let b = 0; b < BONE_COUNT; b++) {
        const d = driver[b];
        S.multiplyMatrices(bindInv, bones[d].matrixWorld).multiply(inv[d]).multiply(bind);
        M.multiplyMatrices(S, frames[b]);
        data.set(M.elements, (f * BONE_COUNT + b) * 16);
      }
    }
    action.stop();
    clips[name] = { data, count, fps: FPS, duration: clip.duration, speed };
  }
  mixer.uncacheRoot(gltf.scene);

  const tip = joint.handL.clone().multiplyScalar(2).sub(joint.forearmL).lerp(joint.handL, 0.35);
  return {
    geometry,
    map: map as unknown as THREE.Texture,
    skinUv: new THREE.Vector2(0.5, 0.5),
    // Headdresses were fitted to a head about 0.39 m across sitting just above the head joint.
    hat: { y: 0.05, z: 0, s: 1.9 },
    joint,
    bindInv: frames.map((m) => m.clone().invert()),
    ankle: joint.footL.y,
    clips,
    len: {
      upper: joint.upper_armL.distanceTo(joint.forearmL),
      fore: joint.forearmL.distanceTo(joint.handL),
      thigh: joint.thighL.distanceTo(joint.shinL),
      shin: joint.shinL.distanceTo(joint.footL),
      hand: joint.handL.distanceTo(tip),
    },
  };
}

let pending: Promise<GlbPeople> | null = null;

/** The islander models (loaded once; shared by the rig and the canoe passengers). */
export function loadIslanderModels(): Promise<GlbPeople> {
  if (pending) return pending;
  pending = Promise.all([loadModel(FILES.m), loadModel(FILES.f)]).then(([m, f]) => ({
    m, m_loosehair: m, boy: m, oldm: m, fatm: m,
    f, f_flower: f, girl: f, oldf: f, fatf: f,
  }));
  return pending;
}
