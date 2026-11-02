import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { BI, BONES, type BaseModelKey, type BoneName, type GlbModel, type GlbPeople } from './glbPeople';

/**
 * The islanders, built from blocks in the style of the character sheets: a big square head with
 * dot eyes, hair in chunky slabs (topknots, buns, pigtails, a beard), a cream tunic with a red
 * V-neck, red sleeves and a stepped red fret round the hem, a teal belt, cream cuffs, block fists
 * and bare feet on brown soles.
 *
 * Every block rides rigidly on one bone of the rig's 19-bone skeleton (the torso blends from the
 * spine to the chest, and the skirt from the hips toward each thigh, so a striding leg stays
 * under it). Plain blocks take their colour from the vertex colour; the tunic and skirt faces are
 * mapped onto a small painted pattern texture. Skin (aMat 1) is tinted per islander.
 */

type V3 = [number, number, number];

/** Body measurements (metres; the ankle is always 0.1 above the ground). */
interface Build {
  knee: number; hip: number; waist: number; shoulder: number;
  torsoW: number; torsoD: number; armX: number; armW: number; legX: number; legW: number;
  /** Skirt hem height and its half-width and half-depth at the hem. */
  hem: number; hemW: number; hemD: number;
  /** The head block. */
  head: { w: number; h: number; d: number };
  /** Wrist to finger tips. */
  fist: number;
}

const ADULT: Build = {
  knee: 0.33, hip: 0.6, waist: 0.76, shoulder: 1.16, torsoW: 0.43, torsoD: 0.27, armX: 0.29, armW: 0.13, legX: 0.105, legW: 0.17,
  hem: 0.41, hemW: 0.25, hemD: 0.17, head: { w: 0.4, h: 0.36, d: 0.37 }, fist: 0.165,
};
const WOMAN: Build = { ...ADULT, torsoW: 0.4, torsoD: 0.26, armX: 0.275, armW: 0.125, hem: 0.36, hemW: 0.26, hemD: 0.18 };
const HEAVY = (b: Build): Build => ({ ...b, torsoW: b.torsoW + 0.13, torsoD: b.torsoD + 0.11, armX: b.armX + 0.065, armW: b.armW + 0.025, legX: b.legX + 0.025, legW: b.legW + 0.035, hemW: b.hemW + 0.07, hemD: b.hemD + 0.07 });
const CHILD: Build = {
  knee: 0.3, hip: 0.55, waist: 0.69, shoulder: 1.03, torsoW: 0.38, torsoD: 0.24, armX: 0.255, armW: 0.115, legX: 0.095, legW: 0.15,
  hem: 0.38, hemW: 0.23, hemD: 0.16, head: { w: 0.48, h: 0.44, d: 0.45 }, fist: 0.145,
};

type Hair = 'topknot' | 'boy' | 'woman' | 'girl';
interface Look { build: Build; female: boolean; hair: Hair; beard: boolean; grey: boolean; earrings: boolean; brows?: boolean }

const LOOKS: Record<BaseModelKey, Look> = {
  m: { build: ADULT, female: false, hair: 'topknot', beard: true, grey: false, earrings: false },
  f: { build: WOMAN, female: true, hair: 'woman', beard: false, grey: false, earrings: true },
  boy: { build: CHILD, female: false, hair: 'boy', beard: false, grey: false, earrings: false },
  girl: { build: CHILD, female: true, hair: 'girl', beard: false, grey: false, earrings: false },
  oldm: { build: ADULT, female: false, hair: 'topknot', beard: true, grey: true, earrings: false, brows: true },
  oldf: { build: { ...WOMAN, torsoW: 0.44, torsoD: 0.29, armX: 0.29, hemW: 0.28, hemD: 0.2 }, female: true, hair: 'woman', beard: false, grey: true, earrings: true },
  fatm: { build: HEAVY(ADULT), female: false, hair: 'topknot', beard: true, grey: false, earrings: false },
  fatf: { build: HEAVY(WOMAN), female: true, hair: 'woman', beard: false, grey: false, earrings: true },
};

/** The young, clean-shaven man (the bearded man's hairstyle variant). */
const YOUNG_MAN: Look = { ...LOOKS.m, beard: false };

/** Joints from the body measurements (L = +x; limbs hang straight down in the bind pose). */
function jointsOf(b: Build): { joint: Record<BoneName, V3>; tip: V3; toe: V3 } {
  const sh = b.shoulder - 0.06, wrist = b.hip + 0.02, elbow = (sh + wrist) / 2 + 0.02, x = b.armX;
  const L = { shoulder: [0.08, sh, 0] as V3, upper_arm: [x, sh, 0] as V3, forearm: [x, elbow, 0] as V3, hand: [x, wrist, 0] as V3, thigh: [b.legX, b.hip, 0] as V3, shin: [b.legX, b.knee, 0] as V3, foot: [b.legX, 0.1, 0] as V3 };
  const R = (p: V3): V3 => [-p[0], p[1], p[2]];
  const head = b.shoulder + 0.03;
  return {
    joint: {
      hips: [0, b.hip + 0.02, 0], spine: [0, b.waist + 0.02, 0], chest: [0, b.waist + (b.shoulder - b.waist) * 0.55, 0], neck: [0, b.shoulder + 0.01, 0], head: [0, head, 0],
      shoulderL: L.shoulder, upper_armL: L.upper_arm, forearmL: L.forearm, handL: L.hand,
      shoulderR: R(L.shoulder), upper_armR: R(L.upper_arm), forearmR: R(L.forearm), handR: R(L.hand),
      thighL: L.thigh, shinL: L.shin, footL: L.foot, thighR: R(L.thigh), shinR: R(L.shin), footR: R(L.foot),
    },
    tip: [x, wrist - b.fist, 0],
    toe: [b.legX, 0.02, 0.17],
  };
}

/** Each base model's joints (bind pose, metres, facing +z): what the rig poses. */
export const RIGS = Object.fromEntries((Object.keys(LOOKS) as BaseModelKey[]).map((k) => [k, jointsOf(LOOKS[k].build)])) as Record<BaseModelKey, ReturnType<typeof jointsOf>>;

// ---------------- Colours and the pattern texture ----------------

const C = {
  cream: 0xf4c78f, red: 0xe2382b, teal: 0x1f7f6c, sole: 0x6b3a1d, eye: 0x1c1410,
  hair: 0x2b201b, grey: 0x9a9690, greyDark: 0x85817c, gold: 0xf0b21e,
};
/** Skin blocks are white × this × the islander's skin tone: warmer and more orange, as in the sheets. */
const SKIN_TINT = new THREE.Color(1.2, 0.86, 0.5);

/** Pattern regions on the 512×256 texture (pixels, y down). */
type Rect = [number, number, number, number];
const TEX = { w: 512, h: 256 };
const R = {
  torsoFront: [0, 0, 120, 120] as Rect,
  torsoBack: [128, 0, 248, 120] as Rect,
  skirtFront: [0, 128, 120, 248] as Rect,
  skirtBack: [128, 128, 248, 248] as Rect,
  dressFront: [256, 128, 376, 248] as Rect,
  white: [384, 0, 512, 128] as Rect,
};
const WHITE_UV: [number, number] = [(R.white[0] + R.white[2]) / 2 / TEX.w, 1 - (R.white[1] + R.white[3]) / 2 / TEX.h];

/** Paint the cloth patterns: V-neck and waist band, the skirt panels, and the stepped fret. */
function patternTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = TEX.w;
  cv.height = TEX.h;
  const g = cv.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(C.cream);
  g.fillRect(0, 0, TEX.w, TEX.h);
  g.fillStyle = '#ffffff';
  g.fillRect(...(R.white.slice(0, 2) as [number, number]), R.white[2] - R.white[0], R.white[3] - R.white[1]);
  g.fillStyle = hex(C.red);
  const at = (r: Rect, x: number, y: number, w: number, h: number) => g.fillRect(r[0] + x, r[1] + y, w, h);
  // Tunic: a red V-neck at the front, a red band round the waist.
  const tf = R.torsoFront;
  g.beginPath();
  g.moveTo(tf[0] + 26, tf[1]);
  g.lineTo(tf[0] + 94, tf[1]);
  g.lineTo(tf[0] + 60, tf[1] + 50);
  g.closePath();
  g.fill();
  for (const r of [R.torsoFront, R.torsoBack]) at(r, 0, 100, 120, 20);
  // Skirts: a red front panel (the women's with two side stripes), and the fret above the hem.
  at(R.skirtFront, 40, 0, 40, 58);
  at(R.dressFront, 44, 0, 32, 58);
  at(R.dressFront, 8, 0, 12, 58);
  at(R.dressFront, 100, 0, 12, 58);
  for (const r of [R.skirtFront, R.skirtBack, R.dressFront]) {
    at(r, 0, 64, 120, 7);
    // Square teeth hanging from the line, joined along the bottom in turn: the stepped fret.
    for (let x = 0; x < 120; x += 30) {
      at(r, x + 6, 64, 7, 34);
      at(r, x + 6, 91, 22, 7);
      at(r, x + 21, 78, 7, 20);
      at(r, x + 21, 78, 15, 6);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------- Building blocks ----------------

/** Bone weights for a point (up to four). */
type Weigh = (p: THREE.Vector3) => [number, number][];
type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const FACES: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

interface Part {
  /** Colour (sRGB hex), or 'skin' for a block tinted by the islander's skin tone. */
  color: number | 'skin';
  bone: BoneName | Weigh;
  hair?: boolean;
  /** Faces mapped onto a pattern region (drawn white × texture). */
  faces?: Partial<Record<Face, Rect>>;
}

class Blocks {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private mat: number[] = [];
  private hair: number[] = [];
  private p = new THREE.Vector3();

  private push(g: THREE.BufferGeometry, part: Part, face?: Face): void {
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv');
    const rect = face ? part.faces?.[face] : undefined;
    const c = part.color === 'skin' || rect ? new THREE.Color(1, 1, 1) : new THREE.Color(part.color);
    if (part.color === 'skin') c.copy(SKIN_TINT);
    const ids = g.index ? Array.from(g.index.array) : Array.from({ length: P.count }, (_, i) => i);
    const group = face && g.index ? g.groups[FACES.indexOf(face)] : null;
    const list = group ? ids.slice(group.start, group.start + group.count) : ids;
    for (const i of list) {
      this.p.fromBufferAttribute(P as THREE.BufferAttribute, i);
      this.pos.push(this.p.x, this.p.y, this.p.z);
      this.nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      if (rect && U) {
        const u = U.getX(i), v = U.getY(i);
        this.uv.push((rect[0] + u * (rect[2] - rect[0])) / TEX.w, 1 - (rect[1] + (1 - v) * (rect[3] - rect[1])) / TEX.h);
      } else this.uv.push(...WHITE_UV);
      this.col.push(c.r, c.g, c.b);
      const w = typeof part.bone === 'string' ? [[BI[part.bone], 1] as [number, number]] : part.bone(this.p);
      for (let k = 0; k < 4; k++) {
        this.si.push(w[k]?.[0] ?? 0);
        this.sw.push(w[k]?.[1] ?? 0);
      }
      this.mat.push(part.color === 'skin' ? 1 : 0);
      this.hair.push(part.hair ? 1 : 0);
    }
  }

  /**
   * A block from min to max corner. `seg` subdivides it (for blended weights) and `shape` can
   * move its vertices afterwards (a flared skirt).
   */
  box(min: V3, max: V3, part: Part, seg: V3 = [1, 1, 1], shape?: (p: THREE.Vector3) => void): void {
    const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2], seg[0], seg[1], seg[2])
      .translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    if (shape) {
      const P = g.getAttribute('position'), v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        shape(v.fromBufferAttribute(P as THREE.BufferAttribute, i));
        P.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
    }
    for (const f of FACES) this.push(g, part, f);
    g.dispose();
  }

  /** A block with its edges cut off (heads, hair, buns, fists): faceted, as in the sheets. */
  chamfer(min: V3, max: V3, cut: number, part: Part): void {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const pts: THREE.Vector3[] = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
      const sx = x === x0 ? 1 : -1, sy = y === y0 ? 1 : -1, sz = z === z0 ? 1 : -1;
      pts.push(new THREE.Vector3(x, y + sy * cut, z + sz * cut), new THREE.Vector3(x + sx * cut, y, z + sz * cut), new THREE.Vector3(x + sx * cut, y + sy * cut, z));
    }
    const g = new ConvexGeometry(pts);
    this.push(g, part);
    g.dispose();
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSkinI', new THREE.Float32BufferAttribute(this.si, 4));
    g.setAttribute('aSkinW', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aHairB', new THREE.Float32BufferAttribute(this.hair, 1));
    g.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.computeBoundingSphere();
    return g;
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Build one islander's geometry from its look (bind pose, metres, facing +z). */
export function islanderGeometry(look: Look): THREE.BufferGeometry {
  const b = look.build, { joint, tip } = jointsOf(b), B = new Blocks();
  const hairC = look.grey ? C.grey : C.hair;

  // Legs: skin thighs (under the skirt) and shins, bare feet on brown soles.
  for (const s of [1, -1]) {
    const x = s * b.legX, hw = b.legW / 2, side = s > 0 ? 'L' : 'R';
    B.box([x - hw - 0.005, b.knee - 0.02, -0.1], [x + hw + 0.005, b.hip + 0.04, 0.1], { color: 'skin', bone: `thigh${side}` as BoneName });
    B.box([x - hw, 0.1, -0.085], [x + hw, b.knee + 0.03, 0.085], { color: 'skin', bone: `shin${side}` as BoneName });
    B.box([x - hw - 0.005, 0.028, -0.075], [x + hw + 0.005, 0.11, 0.17], { color: 'skin', bone: `foot${side}` as BoneName });
    B.box([x - hw - 0.01, 0, -0.085], [x + hw + 0.01, 0.03, 0.18], { color: C.sole, bone: `foot${side}` as BoneName });
  }

  // The skirt: flared, hanging from the hips and drawn toward each thigh lower down.
  const top = b.waist + 0.01, tw = b.torsoW / 2 + 0.005, td = b.torsoD / 2 + 0.005;
  const skirtW: Weigh = (p) => {
    const t = smooth(top, b.hem, p.y) * 0.65, fl = smooth(-tw * 0.9, tw * 0.9, p.x);
    return [[BI.hips, 1 - t], [BI.thighL, t * fl], [BI.thighR, t * (1 - fl)]];
  };
  B.box([-tw, b.hem, -td], [tw, top, td],
    { color: C.cream, bone: skirtW, faces: { pz: look.female ? R.dressFront : R.skirtFront, nz: R.skirtBack, px: R.skirtBack, nx: R.skirtBack } },
    [4, 2, 2], (p) => {
      const t = (top - p.y) / (top - b.hem);
      p.x *= 1 + t * (b.hemW / tw - 1);
      p.z *= 1 + t * (b.hemD / td - 1);
    });
  // The teal belt.
  B.box([-b.torsoW / 2 - 0.02, b.waist - 0.045, -b.torsoD / 2 - 0.025], [b.torsoW / 2 + 0.02, b.waist + 0.045, b.torsoD / 2 + 0.025], { color: C.teal, bone: 'hips' });
  // The tunic's body, bending from the spine to the chest.
  const torsoW: Weigh = (p) => {
    const t = smooth(b.waist, b.shoulder, p.y);
    return [[BI.spine, 1 - t], [BI.chest, t]];
  };
  B.box([-b.torsoW / 2, b.waist, -b.torsoD / 2], [b.torsoW / 2, b.shoulder, b.torsoD / 2],
    { color: C.cream, bone: torsoW, faces: { pz: R.torsoFront, nz: R.torsoBack, px: R.torsoBack, nx: R.torsoBack } }, [1, 2, 1]);
  B.box([-0.075, b.shoulder - 0.02, -0.075], [0.075, b.shoulder + 0.05, 0.075], { color: 'skin', bone: 'neck' });

  // Arms: red sleeves with a cream band, bare arms, cream cuffs and block fists.
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R', x = s * b.armX, a = b.armW / 2;
    const sh = joint.upper_armL[1], el = joint.forearmL[1], wr = joint.handL[1];
    const ua = `upper_arm${side}` as BoneName, fa = `forearm${side}` as BoneName, hd = `hand${side}` as BoneName;
    B.box([x - a - 0.02, sh - 0.15, -a - 0.02], [x + a + 0.02, b.shoulder + 0.005, a + 0.02], { color: C.red, bone: ua });
    B.box([x - a - 0.028, sh - 0.2, -a - 0.028], [x + a + 0.028, sh - 0.14, a + 0.028], { color: C.cream, bone: ua });
    B.box([x - a, el - 0.035, -a], [x + a, sh - 0.15, a], { color: 'skin', bone: ua });
    B.box([x - a + 0.005, wr, -a + 0.005], [x + a - 0.005, el + 0.02, a - 0.005], { color: 'skin', bone: fa });
    B.box([x - a - 0.015, wr - 0.005, -a - 0.015], [x + a + 0.015, wr + 0.07, a + 0.015], { color: C.cream, bone: fa });
    B.chamfer([x - a - 0.012, tip[1], -a - 0.015], [x + a + 0.012, wr, a + 0.015], 0.02, { color: 'skin', bone: hd });
  }

  // The head: a big square block with dot eyes and block ears.
  const H = joint.head[1], { w, h, d } = b.head, hw = w / 2, hd = d / 2;
  B.chamfer([-hw, H, -hd], [hw, H + h, hd], 0.018, { color: 'skin', bone: 'head' });
  const eyeY = H + h * 0.55, eyeX = w * 0.19;
  for (const s of [1, -1]) {
    B.box([s * eyeX - 0.016, eyeY - 0.02, hd - 0.004], [s * eyeX + 0.016, eyeY + 0.02, hd + 0.006], { color: C.eye, bone: 'head' });
    B.box([s * (hw + 0.035) - 0.0225, H + h * 0.33, -0.05], [s * (hw + 0.035) + 0.0225, H + h * 0.6, 0.03], { color: 'skin', bone: 'head' });
  }
  if (look.brows) for (const s of [1, -1]) B.box([s * eyeX - 0.05, eyeY + 0.045, hd - 0.002], [s * eyeX + 0.05, eyeY + 0.075, hd + 0.02], { color: C.grey, bone: 'head', hair: true });

  // Hair: a cap over the crown with the fringe across the forehead, the back of the head, and
  // the sides down to the ears; then each style's own pieces.
  const hair: Part = { color: hairC, bone: 'head', hair: true };
  const full = look.grey && look.female ? 0.02 : 0;
  const cx = hw + 0.03 + full, top0 = H + h * 0.78, crown = H + h + 0.1 + full;
  B.chamfer([-cx, top0, -hd - 0.03 - full], [cx, crown, hd + 0.025], 0.035, hair);
  B.box([-cx, H + h * 0.18, -hd - 0.03 - full], [cx, top0 + 0.01, -hd + 0.06], hair);
  for (const s of [1, -1]) B.box([s > 0 ? hw - 0.004 : -cx, H + h * 0.58, -hd - 0.03], [s > 0 ? cx : -hw + 0.004, top0 + 0.01, hd * 0.25], hair);
  const tie = (y: number, r: number) => B.box([-r, y, -r - 0.02], [r, y + 0.045, r - 0.02], { color: C.red, bone: 'head' });
  const bun = (y: number, s: number) => B.chamfer([-s / 2, y, -s / 2 - 0.02], [s / 2, y + s, s / 2 - 0.02], s * 0.2, hair);
  if (look.hair === 'topknot') {
    tie(crown - 0.01, 0.06);
    bun(crown + 0.03, 0.17);
  } else if (look.hair === 'boy') {
    // A bowl-cut fringe and a small topknot.
    B.box([-cx, H + h * 0.66, hd - 0.01], [cx, top0 + 0.01, hd + 0.03], hair);
    tie(crown - 0.01, 0.045);
    bun(crown + 0.025, 0.12);
  } else if (look.hair === 'woman') {
    // Hair framing the face and falling to the shoulders, long at the back, a high bun (an
    // elder's fuller and rounder).
    const lock = 0.03 + full * 2;
    for (const s of [1, -1]) B.box([s > 0 ? hw - 0.004 : -cx - lock, H - (full ? 0.0 : 0.1), -hd - 0.03 - full], [s > 0 ? cx + lock : -hw + 0.004, top0 + 0.01, hd + 0.02], hair);
    B.box([-cx - 0.015, H - 0.07, -hd - 0.05 - full], [cx + 0.015, H + h * 0.3, -hd + 0.04], hair);
    tie(crown - 0.01, 0.07);
    bun(crown + 0.03, 0.2 + full);
  } else {
    // Hair to the cheeks, and two pigtails tied in red.
    for (const s of [1, -1]) {
      B.box([s > 0 ? hw - 0.004 : -cx - 0.01, H + h * 0.35, -hd - 0.03], [s > 0 ? cx + 0.01 : -hw + 0.004, top0 + 0.01, hd + 0.015], hair);
      // Hanging beside the face below the ears, in front of the shoulders.
      const px = s * (cx + 0.03);
      B.box([px - 0.045, H + 0.15, -0.01], [px + 0.045, H + 0.195, 0.09], { color: C.red, bone: 'head' });
      B.chamfer([px - 0.065, H - 0.04, -0.02], [px + 0.065, H + 0.155, 0.12], 0.025, hair);
      B.box([s > 0 ? hw - 0.004 : -cx - 0.01, H + 0.18, -0.03], [s > 0 ? cx + 0.01 : -hw + 0.004, H + h * 0.4, 0.06], hair);
    }
  }
  if (look.beard) {
    // A full beard along the jaw and over the chin, with the mouth showing through.
    const beard: Part = { color: look.grey ? C.grey : C.hair, bone: 'head', hair: true };
    B.box([-hw - 0.004, H - 0.035, hd - 0.012], [hw + 0.004, H + h * 0.36, hd + 0.035], beard);
    for (const s of [1, -1]) B.box([s > 0 ? hw - 0.01 : -hw - 0.03, H - 0.02, -0.06], [s > 0 ? hw + 0.03 : -hw + 0.01, H + h * 0.6, hd + 0.03], beard);
    B.box([-0.05, H + h * 0.19, hd + 0.03], [0.05, H + h * 0.27, hd + 0.042], { color: 'skin', bone: 'head' });
  }
  if (look.earrings) for (const s of [1, -1]) {
    const x = s * (cx + (look.hair === 'woman' ? 0.045 + full * 2 : 0.012));
    B.box([x - 0.022, H + h * 0.2, 0.05], [x + 0.022, H + h * 0.36, 0.1], { color: C.gold, bone: 'head' });
  }
  return B.geometry();
}

/** Bind frames at each joint, limbs turned so -y runs down the bone (the rig's convention). */
function bindInverse(joint: Record<BoneName, THREE.Vector3>): THREE.Matrix4[] {
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
  }).map((m) => m.invert());
}

/** One islander model, ready for the rig. */
export function islanderModel(look: Look, map: THREE.Texture | null): GlbModel {
  const r = jointsOf(look.build);
  const joint = Object.fromEntries(BONES.map((bn) => [bn, new THREE.Vector3(...r.joint[bn])])) as Record<BoneName, THREE.Vector3>;
  const tip = new THREE.Vector3(...r.tip);
  // Headdresses were fitted to a head about 0.39 m across, sitting just above the head joint.
  const s = (look.build.head.w + 0.05) / 0.39 * 1.63;
  return {
    geometry: islanderGeometry(look),
    map: map as THREE.Texture,
    skinUv: new THREE.Vector2(...WHITE_UV),
    hat: { y: 0.02, z: 0, s },
    joint,
    bindInv: bindInverse(joint),
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

/** Every islander model (built once, shared by the rig and the canoe passengers). */
export function loadIslanderModels(): Promise<GlbPeople> {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const map = patternTexture();
    const base = Object.fromEntries((Object.keys(LOOKS) as BaseModelKey[]).map((k) => [k, islanderModel(LOOKS[k], map)])) as Record<BaseModelKey, GlbModel>;
    // The hairstyle variants: a young clean-shaven man, and the woman's look again.
    resolve({ ...base, m_loosehair: islanderModel(YOUNG_MAN, map), f_flower: base.f });
  });
  return pending;
}

export { LOOKS };
