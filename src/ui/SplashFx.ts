/**
 * Loading screen dressing: drifting golden pollen, an occasional gold sweep across the title
 * lettering, and the "Preparing your island" card with real progress and rotating tips. Visual
 * only: boot order, saves and the Play flow are untouched. Everything stops when the game starts.
 */
import * as THREE from 'three';

const TIPS = [
  'Every great civilisation begins with a single settlement.',
  'Homes bring new families to your island.',
  'Build an Observatory to see storms and eruptions coming.',
  'Select trees and rocks, then clear the ground before you build.',
  'Water gardens grow food on calm shallows.',
  'Keep the stores full before the seasons turn.',
  'A Palace lets you issue decrees that shape island life.',
  'Islanders gather wood and stone: build close to what they need.',
];

/** Stages of a real boot, as fractions of the bar. Assets fill the band between world and ready. */
const STAGE = { script: 0.08, world: 0.14, generated: 0.6, assets: 0.88, ready: 1 } as const;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

class Progress {
  private target = 0;
  private shown = 0;
  private assetShare = 0;
  private raf = 0;
  private tipTimer = 0;
  private full: (() => void) | null = null;
  private tip = Math.floor(Math.random() * TIPS.length);
  private readonly root = document.getElementById('splash-progress');
  private readonly pct = this.root?.querySelector<HTMLElement>('.sp-pct');
  private readonly fill = this.root?.querySelector<HTMLElement>('.sp-fill');
  private readonly tipEl = this.root?.querySelector<HTMLElement>('.sp-tip');

  constructor() {
    if (!this.root) return;
    this.showTip();
    this.tipTimer = window.setInterval(() => this.nextTip(), 4800);
    // Model and texture requests made while booting (character models, textures).
    THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
      this.assetShare = total ? loaded / total : 1;
      this.stage(STAGE.generated + (STAGE.assets - STAGE.generated) * this.assetShare);
    };
  }

  /** Never moves backwards; the display eases towards it. */
  stage(f: number): void {
    this.target = Math.max(this.target, Math.min(1, f));
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /** World generated: whatever assets have already arrived count straight away. */
  generated(): void {
    this.stage(STAGE.generated + (STAGE.assets - STAGE.generated) * this.assetShare);
  }

  private readonly tick = (): void => {
    const gap = this.target - this.shown;
    const rate = this.target >= 1 ? 0.22 : 0.14;
    this.shown = reduced() || gap < 0.003 ? this.target : this.shown + Math.max(gap * rate, 0.003);
    this.paint();
    this.raf = this.shown < this.target ? requestAnimationFrame(this.tick) : 0;
    if (this.shown >= 1 && this.full) {
      this.full();
      this.full = null;
    }
  };

  private paint(): void {
    const n = Math.round(this.shown * 100);
    if (this.pct) this.pct.textContent = `${n}%`;
    if (this.fill) this.fill.style.width = `${this.shown * 100}%`;
    this.root?.setAttribute('aria-valuenow', String(n));
  }

  private showTip(): void {
    if (this.tipEl) this.tipEl.textContent = TIPS[this.tip];
  }

  private nextTip(): void {
    const el = this.tipEl;
    if (!el) return;
    this.tip = (this.tip + 1) % TIPS.length;
    if (reduced()) return this.showTip();
    el.classList.add('out');
    window.setTimeout(() => {
      this.showTip();
      el.classList.remove('out');
    }, 420);
  }

  /** Fill to 100%, then let the Play button take the card's place. */
  finish(show: () => void): void {
    const root = this.root;
    if (!root) return show();
    let shown = false;
    const reveal = () => {
      if (shown) return;
      shown = true;
      this.shown = this.target;
      this.paint();
      root.classList.add('done');
      window.setTimeout(() => {
        root.classList.add('hidden');
        show();
      }, reduced() ? 0 : 280);
    };
    this.full = () => window.setTimeout(reveal, reduced() ? 0 : 320);
    this.stage(STAGE.ready);
    // Never hold Play back for the animation (frames can stall in a background tab).
    window.setTimeout(reveal, 1600);
  }

  hide(): void {
    this.root?.classList.add('hidden');
    this.stop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.tipTimer);
    THREE.DefaultLoadingManager.onProgress = () => {};
  }
}

/** Where the art is drawn inside its frame (object-fit cover/contain and object-position). */
function artRect(img: HTMLImageElement): { x: number; y: number; w: number; h: number } | null {
  const fw = img.clientWidth, fh = img.clientHeight, iw = img.naturalWidth, ih = img.naturalHeight;
  if (!fw || !fh || !iw || !ih) return null;
  const css = getComputedStyle(img);
  const fit = css.objectFit;
  const s = fit === 'cover' ? Math.max(fw / iw, fh / ih) : fit === 'contain' ? Math.min(fw / iw, fh / ih) : 0;
  const w = s ? iw * s : fw, h = s ? ih * s : fh;
  const [px, py] = css.objectPosition.split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
  return { x: (fw - w) * (px ?? 0.5), y: (fh - h) * (py ?? 0.5), w, h };
}

/** Title lettering boxes in each artwork, as fractions of the image. */
const TITLE = {
  portrait: { x0: 0.09, x1: 0.89, y0: 0.165, y1: 0.29, mask: './ui/title-mask.png' },
  desktop: { x0: 0.35, x1: 0.645, y0: 0.15, y1: 0.325, mask: './ui/title-mask-desktop.png' },
};

class TitleShimmer {
  private timer = 0;
  private anim: Animation | null = null;
  private readonly el = document.querySelector<HTMLElement>('.splash-shimmer');
  private readonly band = this.el?.querySelector<HTMLElement>('i');
  private readonly img = document.querySelector<HTMLImageElement>('.splash-art');

  constructor() {
    if (!this.el || !this.band || !this.img || reduced()) return;
    this.timer = window.setTimeout(() => this.sweep(), rand(2500, 4500));
  }

  private sweep(): void {
    const el = this.el!, band = this.band!, img = this.img!;
    const r = artRect(img);
    const t = img.currentSrc.includes('splash-desktop') ? TITLE.desktop : TITLE.portrait;
    if (r) {
      const mask = `url("${new URL(t.mask, document.baseURI).href}")`;
      el.style.setProperty('mask-image', mask);
      el.style.setProperty('-webkit-mask-image', mask);
      el.style.setProperty('mask-size', `${r.w}px ${r.h}px`);
      el.style.setProperty('-webkit-mask-size', `${r.w}px ${r.h}px`);
      el.style.setProperty('mask-position', `${r.x}px ${r.y}px`);
      el.style.setProperty('-webkit-mask-position', `${r.x}px ${r.y}px`);
      const left = r.x + r.w * t.x0, right = r.x + r.w * t.x1, top = r.y + r.h * t.y0, height = r.h * (t.y1 - t.y0);
      const width = Math.max(44, (right - left) * 0.2);
      Object.assign(band.style, { top: `${top - height * 0.1}px`, height: `${height * 1.2}px`, width: `${width}px`, left: '0px' });
      this.anim?.cancel();
      this.anim = band.animate(
        [
          { transform: `translateX(${left - width * 1.5}px) skewX(-18deg)`, opacity: 0 },
          { opacity: 1, offset: 0.15 },
          { opacity: 1, offset: 0.85 },
          { transform: `translateX(${right + width * 0.5}px) skewX(-18deg)`, opacity: 0 },
        ],
        { duration: rand(1500, 2000), easing: 'cubic-bezier(.45,.05,.55,.95)' }
      );
    }
    this.timer = window.setTimeout(() => this.sweep(), rand(10000, 15000));
  }

  stop(): void {
    clearTimeout(this.timer);
    this.anim?.cancel();
  }
}

interface Mote {
  x: number; y: number; vx: number; vy: number; phase: number; sway: number;
  size: number; soft: boolean; age: number; life: number; glint: number;
}

/**
 * A few dozen pollen motes on a 2D canvas: two pre-drawn sprites (soft and crisp) for depth, born
 * mostly over the foreground foliage and islanders, drifting on a breeze, fading in and out.
 */
class Pollen {
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private motes: Mote[] = [];
  private readonly canvas = document.querySelector<HTMLCanvasElement>('.splash-pollen');
  private readonly ctx = this.canvas?.getContext('2d') ?? null;
  private readonly sprites = { soft: sprite(true), crisp: sprite(false) };
  private readonly coarse = matchMedia('(pointer: coarse)').matches;
  private readonly onResize = () => this.resize();

  constructor() {
    if (!this.canvas || !this.ctx || reduced()) {
      this.canvas?.remove();
      return;
    }
    this.resize();
    addEventListener('resize', this.onResize);
    const count = this.coarse ? 34 : 56;
    for (let i = 0; i < count; i++) this.motes.push(this.spawn(Math.random()));
    this.raf = requestAnimationFrame(this.frame);
  }

  private resize(): void {
    const c = this.canvas!;
    this.dpr = Math.min(devicePixelRatio || 1, this.coarse ? 1.5 : 2);
    this.w = c.clientWidth;
    this.h = c.clientHeight;
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
  }

  /** Mostly low in the frame (foliage, islanders) and up the leafy sides; a few anywhere. */
  private spawn(age = 0): Mote {
    const wide = this.w > this.h;
    const roll = Math.random();
    let x: number, y: number;
    if (roll < 0.3) {
      // Around the islanders.
      x = wide ? rand(0.14, 0.38) : rand(0.18, 0.8);
      y = wide ? rand(0.5, 0.88) : rand(0.5, 0.8);
    } else if (roll < 0.65) {
      // Foreground foliage along the bottom.
      x = rand(0, 1);
      y = rand(0.7, 1);
    } else if (roll < 0.88) {
      // Leaves on either side.
      x = Math.random() < 0.5 ? rand(0, 0.16) : rand(0.84, 1);
      y = rand(0.05, 0.9);
    } else {
      x = rand(0, 1);
      y = rand(0.35, 0.9);
    }
    const soft = Math.random() < 0.45;
    const near = soft ? 1 : rand(0.55, 1);
    return {
      x: x * this.w, y: y * this.h,
      vx: rand(6, 16) * near, vy: rand(-7, -2) * near,
      phase: rand(0, Math.PI * 2), sway: rand(0.4, 1.1),
      size: soft ? rand(6, 12) : rand(2.6, 5),
      soft, age: age * 8, life: rand(6, 11), glint: 0,
    };
  }

  private readonly frame = (now: number): void => {
    const ctx = this.ctx!;
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    const t = now / 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    // A slow gust that swells and settles.
    const gust = 1 + 0.6 * Math.sin(t * 0.35) * Math.sin(t * 0.13 + 1);
    for (let i = 0; i < this.motes.length; i++) {
      let m = this.motes[i];
      m.age += dt;
      if (m.age > m.life || m.x > this.w + 20 || m.y < -20) m = this.motes[i] = this.spawn();
      m.x += (m.vx * gust + Math.sin(t * m.sway + m.phase) * 6) * dt;
      m.y += (m.vy + Math.cos(t * m.sway * 1.3 + m.phase) * 4) * dt;
      if (m.glint <= 0 && Math.random() < dt * 0.05) m.glint = 1;
      m.glint = Math.max(0, m.glint - dt * 1.6);
      const life = m.age / m.life;
      const fade = Math.min(1, 1.6 * Math.sin(Math.PI * Math.min(1, Math.max(0, life))));
      const a = fade * (m.soft ? 0.55 : 0.95) * (1 + m.glint * 0.8);
      if (a <= 0.01) continue;
      const s = m.size * (1 + m.glint * 0.5);
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(m.soft ? this.sprites.soft : this.sprites.crisp, m.x - s, m.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.frame);
  };

  stop(): void {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    this.motes = [];
    this.canvas?.remove();
  }
}

function sprite(soft: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  if (!x) return c;
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  if (soft) {
    g.addColorStop(0, 'rgba(255, 240, 170, 1)');
    g.addColorStop(0.3, 'rgba(252, 218, 120, 0.6)');
    g.addColorStop(1, 'rgba(240, 200, 90, 0)');
  } else {
    g.addColorStop(0, 'rgba(255, 252, 225, 1)');
    g.addColorStop(0.25, 'rgba(255, 228, 140, 0.95)');
    g.addColorStop(0.55, 'rgba(240, 196, 80, 0.3)');
    g.addColorStop(1, 'rgba(240, 196, 80, 0)');
  }
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return c;
}

/** The splash's effects, from the moment the game bundle runs until Play. */
export class SplashFx {
  readonly progress = new Progress();
  private readonly shimmer = new TitleShimmer();
  private readonly pollen = new Pollen();

  constructor() {
    this.progress.stage(STAGE.script);
  }

  /** About to generate the world (synchronous): show the step before the main thread is busy. */
  generating(): void {
    this.progress.stage(STAGE.world);
  }

  generated(): void {
    this.progress.generated();
  }

  /** The first frame has rendered: fill the bar, then reveal Play in the card's place. */
  ready(showPlay: () => void): void {
    this.progress.finish(showPlay);
  }

  failed(): void {
    this.progress.hide();
  }

  /** Entering the game: stop and release every splash animation. */
  dispose(): void {
    this.progress.stop();
    this.shimmer.stop();
    this.pollen.stop();
  }
}
