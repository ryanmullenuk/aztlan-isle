import * as THREE from 'three';
import type { MoodKind } from '../economy/Mood';

/** Badge colour and glyph for each mood. */
/** A mood, or `love`: the red heart over a couple who wish to marry. */
export type MarkerKind = MoodKind | 'love';

const heart = (g: CanvasRenderingContext2D) => {
  g.beginPath(); g.moveTo(32, 49); g.bezierCurveTo(12, 36, 14, 18, 24, 18); g.bezierCurveTo(29, 18, 32, 22, 32, 25);
  g.bezierCurveTo(32, 22, 35, 18, 40, 18); g.bezierCurveTo(50, 18, 52, 36, 32, 49); g.fill();
};

const BADGE: Record<MarkerKind, { fill: string; draw: (g: CanvasRenderingContext2D) => void }> = {
  sick: { fill: '#2f9a6a', draw: (g) => { g.fillRect(27, 15, 10, 34); g.fillRect(15, 27, 34, 10); } },
  hungry: {
    fill: '#d5822c',
    draw: (g) => {
      // A bowl, empty.
      g.beginPath(); g.moveTo(14, 30); g.lineTo(50, 30); g.quadraticCurveTo(48, 48, 32, 49); g.quadraticCurveTo(16, 48, 14, 30); g.fill();
      g.fillRect(24, 50, 16, 4);
    },
  },
  afraid: {
    fill: '#6c4fb0',
    draw: (g) => {
      // Wide eyes and an open mouth.
      g.beginPath(); g.arc(23, 26, 6, 0, 7); g.arc(41, 26, 6, 0, 7); g.fill();
      g.beginPath(); g.ellipse(32, 43, 6, 8, 0, 0, 7); g.fill();
    },
  },
  tired: {
    fill: '#4d6fb8',
    draw: (g) => {
      g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('z', 25, 38); g.font = 'bold 18px sans-serif'; g.fillText('z', 40, 24);
    },
  },
  cold: {
    fill: '#3d8fc4',
    draw: (g) => {
      // A six-armed snowflake.
      g.lineWidth = 4; g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3, c = Math.cos(a) * 17, s = Math.sin(a) * 17;
        g.beginPath(); g.moveTo(32 - c, 32 - s); g.lineTo(32 + c, 32 + s); g.stroke();
      }
    },
  },
  wet: {
    fill: '#2e7fb8',
    draw: (g) => { g.beginPath(); g.moveTo(32, 13); g.bezierCurveTo(44, 30, 46, 36, 46, 39); g.arc(32, 39, 14, 0, Math.PI); g.bezierCurveTo(18, 36, 20, 30, 32, 13); g.fill(); },
  },
  homeless: {
    fill: '#a8582e',
    draw: (g) => {
      // A house outline with a cross through it.
      g.beginPath(); g.moveTo(14, 32); g.lineTo(32, 16); g.lineTo(50, 32); g.lineTo(45, 32); g.lineTo(45, 48); g.lineTo(19, 48); g.lineTo(19, 32); g.closePath(); g.fill();
      g.strokeStyle = '#a8582e'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(25, 30); g.lineTo(39, 44); g.moveTo(39, 30); g.lineTo(25, 44); g.stroke();
    },
  },
  unhappy: {
    fill: '#8a5a3a',
    draw: (g) => {
      g.beginPath(); g.arc(24, 27, 4, 0, 7); g.arc(40, 27, 4, 0, 7); g.fill();
      g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.arc(32, 50, 11, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    },
  },
  happy: { fill: '#d8486a', draw: heart },
  love: { fill: '#d72a26', draw: heart },
};

const mats = new Map<MarkerKind, THREE.SpriteMaterial>();
/** A small round badge in the mood's colour with a white glyph, drawn once. */
function badge(kind: MarkerKind): THREE.SpriteMaterial {
  let m = mats.get(kind);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const b = BADGE[kind];
    g.fillStyle = b.fill; g.strokeStyle = '#2a1a0c'; g.lineWidth = 4;
    g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.arc(32, 32, 23, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
    g.fillStyle = '#fff8ec'; g.strokeStyle = '#fff8ec';
    b.draw(g);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  mats.set(kind, m);
  return m;
}

export interface MoodMarker {
  x: number;
  y: number;
  z: number;
  kind: MarkerKind;
  /** A stable number per islander (so each bobs and blinks on its own beat). */
  seed: number;
}

/**
 * Little round badges over the islanders' heads saying what is wrong (hungry, worn out, sick,
 * frightened, cold, soaked, homeless, unhappy) or, now and then, a heart over someone very happy.
 * These only show when zoomed in close enough to see the islanders themselves. The red heart over
 * a couple who wish to marry shows at any zoom, growing with it so it can be found from afar.
 */
export class MoodMarkers {
  readonly group = new THREE.Group();
  private pool: THREE.Sprite[] = [];
  private time = 0;

  constructor() {
    this.group.name = 'moodMarkers';
    this.group.renderOrder = 29;
  }

  update(realDt: number, list: MoodMarker[], camDist: number): void {
    this.time += realDt;
    // Moods: only close in, where the islanders can be seen. Love hearts: always, kept readable.
    const near = 1 - THREE.MathUtils.smoothstep(camDist, 28, 38);
    const s = 0.4 * Math.min(1.3, Math.max(1, camDist / 20));
    const sLove = 0.45 * Math.max(1, Math.min(3, camDist / 25));
    let used = 0;
    for (const m of list) {
      const love = m.kind === 'love';
      if (!love && near < 0.01) continue;
      // Hearts come and go (a few seconds in every twenty), so a happy village isn't a sea of them.
      let a = love ? 1 : near;
      if (m.kind === 'happy') {
        const ph = (this.time / 20 + m.seed * 0.618) % 1;
        a *= THREE.MathUtils.smoothstep(ph, 0, 0.03) * (1 - THREE.MathUtils.smoothstep(ph, 0.14, 0.18));
        if (a < 0.01) continue;
      }
      let sp = this.pool[used];
      if (!sp) {
        sp = new THREE.Sprite(badge(m.kind));
        sp.renderOrder = 29;
        this.pool.push(sp);
        this.group.add(sp);
      }
      used++;
      sp.material = badge(m.kind);
      // Each sprite's material is shared by kind: fade by scale rather than opacity.
      const k = love ? sLove : s * a;
      sp.scale.set(k, k, 1);
      sp.position.set(m.x, m.y + 0.95 + k * 0.3 + Math.sin(this.time * 2.2 + m.seed * 9) * 0.05, m.z);
      sp.visible = true;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
