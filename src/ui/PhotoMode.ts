import type { Game } from '../Game';
import { ICONS } from './icons';
import { haptic } from './Haptics';
import { RENDER } from '../config';
import { dayFraction } from '../world/Time';
import { PHOTO_FILTERS, VIGNETTE, applyMatrix, filterCss, filterMatrix, tintAlpha, type PhotoFilter } from './photoFilters';

/** One-tap times of day (clock hours) beside the time slider: the lighting only, the island's clock doesn't move. */
const LIGHTS = [
  { label: 'Dawn', hour: 6.4 },
  { label: 'Day', hour: 13.5 },
  { label: 'Dusk', hour: 18.6 },
  { label: 'Night', hour: 23 },
] as const;

/** Weather for the picture: how hard it rains and how stormy the sky and sea look (null = as it is). */
const WEATHERS = [
  { id: 'now', label: 'As it is', rain: null, storm: null },
  { id: 'clear', label: 'Clear', rain: 0, storm: 0 },
  { id: 'rain', label: 'Rain', rain: 0.6, storm: 0 },
  { id: 'storm', label: 'Storm', rain: 1, storm: 1 },
] as const;
type WeatherId = (typeof WEATHERS)[number]['id'];

/** The zoom slider runs from a wide lens to a long one. */
const FOV_WIDE = 75, FOV_LONG = 10;
const fovAt = (z: number): number => FOV_WIDE * Math.pow(FOV_LONG / FOV_WIDE, z);
const zoomAt = (fov: number): number => Math.log(fov / FOV_WIDE) / Math.log(FOV_LONG / FOV_WIDE);

/** Longest edge of a high-resolution photo, in pixels (smaller on phones and tablets, which have less memory). */
const HD_EDGE = { desktop: 3840, touch: 2880 };

type Tab = 'light' | 'lens' | 'focus' | 'look' | 'frame';
const TABS: { id: Tab; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'lens', label: 'Lens' },
  { id: 'focus', label: 'Focus' },
  { id: 'look', label: 'Look' },
  { id: 'frame', label: 'Frame' },
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

type Bridge = { postMessage(m: unknown): void };
const nativePhoto = (): Bridge | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { photo?: Bridge } } }).webkit?.messageHandlers?.photo;

/**
 * A picture or video to the app's share sheet or Save dialog, the browser's share sheet, or a
 * download (the type is told by the file name's extension).
 */
export async function shareFile(blob: Blob, name: string): Promise<'shared' | 'downloaded'> {
  const native = nativePhoto();
  if (native) {
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
    native.postMessage({ name, data });
    return 'shared';
  }
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

/**
 * Photo Mode: the interface is hidden but for a small toolbar, the island pauses, and the player
 * frames a shot with the usual pan, turn and zoom plus a photographer's controls:
 *
 *  - Light: any time of day, and clear, rainy or stormy weather (for the picture only);
 *  - Lens: zoom (field of view), camera angle from ground level to straight down, and roll;
 *  - Focus: tap anything on the island to make it sharp, with adjustable background blur;
 *  - Look: colour filters with a strength, and a vignette;
 *  - Frame: rule-of-thirds grid, hide everything, and high-resolution saving.
 *
 * The picture goes to the share sheet (or a Save dialog on the Mac, or a download in a browser).
 * Closing puts the camera, light, weather, depth of field and pause back as they were.
 */
export class PhotoMode {
  readonly bar: HTMLDivElement;
  private saved: { paused: boolean; goal: Game['rig']['goal']; dof: boolean; strength: number; follow: number } | null = null;
  private busy = false;
  /** Overlays over the island (under the interface): the vignette, grid and focus mark, and the filter's tint. */
  private stage: HTMLDivElement;
  private tintEl: HTMLDivElement;
  private vigEl: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private reticle: HTMLDivElement;
  private panel: HTMLDivElement;
  private tabBtns = new Map<Tab, HTMLButtonElement>();
  private sections = new Map<Tab, HTMLDivElement>();
  private tab: Tab | null = null;
  /** Syncs every control to the state below (run on entering and after a reset). */
  private syncers: (() => void)[] = [];

  // What the photographer has chosen.
  private hour: number | null = null;
  private weather: WeatherId = 'now';
  private wx = { rain: 0, storm: 0 };
  private lens = { fov: RENDER.fov as number, roll: 0, pitch: null as number | null };
  private focus: { x: number; y: number; z: number } | null = null;
  private filter: PhotoFilter = PHOTO_FILTERS[0];
  private filterStrength = 1;
  private vignette = 0;
  private grid = false;
  private hd = true;
  private uiHidden = false;
  private canBlur = true;

  /** A photo waiting for the next frame to be drawn. */
  private shot: { resolve: (c: HTMLCanvasElement) => void; reject: (e: unknown) => void } | null = null;
  private hooked: unknown = null;

  constructor(private game: Game, private root: HTMLElement, private toast: (text: string, kind?: 'info' | 'warn') => void) {
    this.bar = el('div', 'photo-bar pb2 hidden');
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Photo Mode');
    this.panel = el('div', 'pb-panel hidden');
    const main = el('div', 'pb-main');
    const tabs = el('div', 'pb-seg pb-tabs');
    for (const t of TABS) {
      const b = this.button(t.label, () => this.setTab(this.tab === t.id ? null : t.id));
      b.setAttribute('aria-expanded', 'false');
      this.tabBtns.set(t.id, b);
      tabs.append(b);
      const sec = el('div', `pb-sec pb-sec-${t.id} hidden`);
      this.sections.set(t.id, sec);
      this.panel.append(sec);
    }
    this.buildLight(this.sections.get('light')!);
    this.buildLens(this.sections.get('lens')!);
    this.buildFocus(this.sections.get('focus')!);
    this.buildLook(this.sections.get('look')!);
    this.buildFrame(this.sections.get('frame')!);
    const shoot = el('button', 'pb-shoot');
    shoot.setAttribute('aria-label', 'Take photo');
    shoot.innerHTML = '<span></span>';
    shoot.onclick = () => void this.capture();
    const close = el('button', 'pb-close');
    close.setAttribute('aria-label', 'Close Photo Mode');
    close.innerHTML = ICONS.close;
    close.onclick = () => this.close();
    main.append(tabs, shoot, close);
    this.bar.append(this.panel, main);
    root.append(this.bar);

    this.stage = el('div', 'photo-stage hidden');
    this.stage.setAttribute('aria-hidden', 'true');
    this.tintEl = el('div', 'photo-tint hidden');
    this.vigEl = el('div', 'photo-vignette');
    this.gridEl = el('div', 'photo-grid hidden');
    this.gridEl.innerHTML = '<i></i><i></i><i></i><i></i>';
    this.reticle = el('div', 'photo-reticle');
    this.stage.append(this.vigEl, this.gridEl, this.reticle);
    // The tint blends with the island (soft light), so it must sit straight over the canvas, not inside another layer.
    document.body.append(this.tintEl, this.stage);
    this.listen();
  }

  get open(): boolean {
    return !!this.saved;
  }

  // ---------------- Controls ----------------

  private button(label: string, run: () => void, pressed?: () => boolean): HTMLButtonElement {
    const b = el('button', 'pb-btn', label);
    b.type = 'button';
    b.onclick = () => { run(); this.sync(); b.blur(); };
    if (pressed) {
      b.setAttribute('aria-pressed', 'false');
      this.syncers.push(() => b.setAttribute('aria-pressed', String(pressed())));
    }
    return b;
  }

  /** A labelled slider with a read-out. `get` gives the value to show; `set` takes the player's. */
  private slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, show: (v: number) => string, enabled?: () => boolean): HTMLLabelElement {
    const wrap = el('label', 'pb-field');
    const name = el('span', 'pb-name', label);
    const input = el('input', 'pb-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    const out = el('span', 'pb-val');
    input.oninput = () => { set(+input.value); out.textContent = show(+input.value); };
    // The keyboard goes back to moving the camera once the slider is let go.
    input.onchange = () => input.blur();
    this.syncers.push(() => {
      const v = get();
      input.value = String(v);
      out.textContent = show(v);
      input.disabled = enabled ? !enabled() : false;
    });
    wrap.append(name, input, out);
    return wrap;
  }

  private row(...kids: HTMLElement[]): HTMLDivElement {
    const r = el('div', 'pb-row');
    r.append(...kids);
    return r;
  }

  private sync(): void {
    for (const s of this.syncers) s();
  }

  private setTab(tab: Tab | null): void {
    this.tab = tab;
    this.panel.classList.toggle('hidden', !tab);
    for (const [id, b] of this.tabBtns) {
      b.setAttribute('aria-pressed', String(id === tab));
      b.setAttribute('aria-expanded', String(id === tab));
    }
    for (const [id, s] of this.sections) s.classList.toggle('hidden', id !== tab);
  }

  private buildLight(sec: HTMLElement): void {
    const clock = (h: number) => {
      const m = Math.round(h * 60) % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    };
    const time = this.slider('Time', 0, 24, 0.1, () => this.hour ?? this.game.time.hour, (v) => this.setHour(v), clock);
    const chips = el('div', 'pb-seg');
    chips.append(this.button('Now', () => this.setHour(null), () => this.hour === null));
    for (const l of LIGHTS) chips.append(this.button(l.label, () => this.setHour(l.hour), () => this.hour === l.hour));
    const weather = el('div', 'pb-seg');
    for (const w of WEATHERS) weather.append(this.button(w.label, () => this.setWeather(w.id), () => this.weather === w.id));
    sec.append(this.row(time), this.row(chips), this.row(el('span', 'pb-name', 'Weather'), weather));
  }

  private buildLens(sec: HTMLElement): void {
    const rig = this.game.rig;
    const zoom = this.slider('Zoom', 0, 1, 0.005, () => zoomAt(this.lens.fov), (v) => { this.lens.fov = fovAt(v); }, (v) => `${Math.round(fovAt(v))}°`);
    const angle = this.slider('Angle', 3, 89, 0.5, () => this.lens.pitch ?? rig.pitchDegrees, (v) => { this.lens.pitch = v; }, (v) => `${Math.round(v)}°`);
    const roll = this.slider('Roll', -45, 45, 0.5, () => this.lens.roll, (v) => { this.lens.roll = Math.abs(v) < 1 ? 0 : v; }, (v) => `${Math.abs(v) < 1 ? 0 : Math.round(v)}°`);
    const reset = this.button('Reset lens', () => { this.lens.fov = RENDER.fov; this.lens.roll = 0; this.lens.pitch = null; });
    sec.append(this.row(zoom), this.row(angle), this.row(roll), this.row(reset));
  }

  private buildFocus(sec: HTMLElement): void {
    const post = this.game.post;
    const blur = this.button('Background blur', () => this.setBlur(!post.dofEnabled), () => post.dofEnabled);
    this.syncers.push(() => { blur.disabled = !this.canBlur; });
    const centre = this.button('Focus on centre', () => { this.focus = null; this.reticle.classList.remove('on'); });
    this.syncers.push(() => { centre.disabled = !this.focus; });
    const strength = this.slider('Blur', 0.2, 3, 0.05, () => post.dofStrength, (v) => { post.dofStrength = v; }, (v) => `${Math.round(v * 100)}%`, () => post.dofEnabled);
    const hint = el('p', 'pb-hint', 'Tap anything on the island to make it sharp.');
    this.syncers.push(() => { hint.textContent = this.canBlur ? 'Tap anything on the island to make it sharp.' : 'Background blur needs Medium quality or higher (see Settings).'; });
    sec.append(this.row(blur, centre), this.row(strength), hint);
  }

  private buildLook(sec: HTMLElement): void {
    const chips = el('div', 'pb-seg pb-wrap');
    for (const f of PHOTO_FILTERS) chips.append(this.button(f.label, () => { this.filter = f; this.applyLook(); }, () => this.filter === f));
    const strength = this.slider('Strength', 0, 1, 0.01, () => this.filterStrength, (v) => { this.filterStrength = v; this.applyLook(); }, (v) => `${Math.round(v * 100)}%`, () => this.filter.id !== 'none');
    const vig = this.slider('Vignette', 0, 1, 0.01, () => this.vignette, (v) => { this.vignette = v; this.applyLook(); }, (v) => `${Math.round(v * 100)}%`);
    sec.append(this.row(chips), this.row(strength), this.row(vig));
  }

  private buildFrame(sec: HTMLElement): void {
    const grid = this.button('Thirds grid', () => this.setGrid(!this.grid), () => this.grid);
    const hd = this.button('High resolution', () => { this.hd = !this.hd; }, () => this.hd && !this.game.settings.pixel);
    this.syncers.push(() => { hd.disabled = !!this.game.settings.pixel; });
    const hide = this.button('Hide controls', () => this.hideUi(true));
    // The island's growth time-lapse (a picture taken each afternoon).
    const lapse = this.button('Time-lapse', () => void this.game.ui.timeLapse.openFor(this.game.lapseKey));
    sec.append(this.row(grid, hd), this.row(hide, lapse), el('p', 'pb-hint', 'With the controls hidden, tap the island to bring them back.'));
  }

  // ---------------- Opening and closing ----------------

  enter(): void {
    if (this.saved) return;
    const g = this.game;
    if (g.explorer?.active) g.toggleExplore();
    if (g.wildlifeView?.active) g.toggleWildlife();
    g.setTool('select');
    g.select(null);
    this.saved = { paused: g.time.paused, goal: { ...g.rig.goal }, dof: g.post.dofEnabled, strength: g.post.dofStrength, follow: g.followId };
    // Everything holds still for the picture; the simulation picks up exactly where it was.
    g.time.paused = true;
    g.followId = -1;
    g.photoMode = true;
    this.root.classList.add('photo');
    this.bar.classList.remove('hidden');
    this.stage.classList.remove('hidden');
    // Background blur is a post effect: offered only where the device draws it smoothly.
    this.canBlur = g.settings.preset !== 'low';
    g.post.dofStrength = Math.min(1.2, g.settings.dofStrength || 0.8);
    g.post.dofEnabled = false;
    // A fresh roll of film each time.
    this.hour = null;
    this.weather = 'now';
    this.lens = { fov: RENDER.fov, roll: 0, pitch: null };
    g.rig.lens = this.lens;
    this.focus = null;
    this.filter = PHOTO_FILTERS[0];
    this.filterStrength = 1;
    this.vignette = 0;
    this.setGrid(false);
    this.hideUi(false);
    this.reticle.classList.remove('on');
    g.photoLight = null;
    this.applyLook();
    this.setTab(null);
    this.hook();
    this.sync();
    g.audio?.sfx('click');
  }

  close(): void {
    const s = this.saved;
    if (!s) return;
    const g = this.game;
    g.photoMode = false;
    g.photoLight = null;
    g.time.paused = s.paused;
    g.rig.lens = null;
    g.rig.goal = { ...s.goal };
    g.post.dofEnabled = s.dof;
    g.post.dofStrength = s.strength;
    if (s.follow >= 0 && g.colony.byId(s.follow)) g.followId = s.follow;
    this.saved = null;
    this.focus = null;
    // (The weather eases back to the island's own by itself once it is no longer held.)
    this.weather = 'now';
    g.renderer.domElement.style.filter = '';
    this.tintEl.classList.add('hidden');
    this.root.classList.remove('photo');
    this.bar.classList.add('hidden');
    this.bar.classList.remove('pb-off');
    this.stage.classList.add('hidden');
    this.uiHidden = false;
    g.audio?.sfx('click');
  }

  // ---------------- Light and weather ----------------

  /** The light of this clock hour (null = the island's own time). */
  private setHour(hour: number | null): void {
    this.hour = hour;
    this.game.photoLight = hour === null ? null : Math.min(0.999, dayFraction(hour));
  }

  private setWeather(id: WeatherId): void {
    if (this.weather === 'now' && id !== 'now') {
      // Start from the sky as it is, so the change rolls in rather than snapping.
      this.wx.rain = this.game.powers.rainAmt;
      this.wx.storm = this.game.powers.stormAmt;
    }
    this.weather = id;
  }

  /**
   * Hold the look of the chosen weather: only how hard the rain falls and how dark and rough the
   * sky and sea are drawn. The island's real weather (and everything that depends on it) is
   * untouched and, with the island paused, nothing gets wet or struck; closing lets it ease back.
   */
  private holdWeather(dt: number): void {
    const w = WEATHERS.find((x) => x.id === this.weather)!;
    if (w.rain === null) return;
    const k = Math.min(1, Math.max(0, dt) * 1.2);
    this.wx.rain += (w.rain - this.wx.rain) * k;
    this.wx.storm += (w.storm - this.wx.storm) * k;
    this.game.powers.rainAmt = this.wx.rain;
    this.game.powers.stormAmt = this.wx.storm;
  }

  // ---------------- Focus ----------------

  private setBlur(on: boolean): void {
    this.game.post.dofEnabled = on && this.canBlur;
    if (!on) { this.focus = null; this.reticle.classList.remove('on'); }
  }

  /** Make whatever is under this screen point the sharp part of the picture. */
  private focusOn(sx: number, sy: number): void {
    if (!this.canBlur) return;
    const p = this.game.pickGround(sx, sy);
    if (!p) return;
    this.focus = { x: p.x, y: p.y, z: p.z };
    this.game.post.dofEnabled = true;
    const r = this.reticle;
    r.style.left = `${sx}px`;
    r.style.top = `${sy}px`;
    // Restart the mark's little pulse.
    r.classList.remove('on');
    void r.offsetWidth;
    r.classList.add('on');
    haptic('light');
    this.sync();
  }

  /** How far in front of the camera the chosen focus point is (null = focus on the screen's centre). */
  private focusDepth(): number | null {
    const f = this.focus;
    if (!f) return null;
    const cam = this.game.rig.camera, e = cam.matrixWorld.elements;
    // Depth along the view axis (what the blur compares against), not the straight-line distance.
    const depth = -((f.x - e[12]) * e[8] + (f.y - e[13]) * e[9] + (f.z - e[14]) * e[10]);
    return Math.max(cam.near * 2, depth);
  }

  // ---------------- Look and framing ----------------

  /** The live preview of the filter and vignette: CSS over the game canvas (the saved photo repeats it, see develop). */
  private applyLook(): void {
    const f = this.filter, s = this.filterStrength;
    this.game.renderer.domElement.style.filter = filterCss(f, s);
    const a = tintAlpha(f, s);
    this.tintEl.style.background = f.tint?.color ?? 'transparent';
    this.tintEl.style.opacity = String(a);
    // (Taken away altogether when unused: a blended full-screen layer is not free.)
    this.tintEl.classList.toggle('hidden', a <= 0);
    const v = this.vignette * VIGNETTE.alpha;
    this.vigEl.style.background = v > 0
      ? `radial-gradient(ellipse farthest-corner at center, rgba(0,0,0,0) ${VIGNETTE.start * 100}%, rgba(0,0,0,${v.toFixed(3)}) 100%)`
      : 'none';
  }

  private setGrid(on: boolean): void {
    this.grid = on;
    this.gridEl.classList.toggle('hidden', !on);
  }

  private hideUi(on: boolean): void {
    this.uiHidden = on;
    this.bar.classList.toggle('pb-off', on);
    // The grid is a framing aid: it goes with the controls.
    this.gridEl.classList.toggle('hidden', on || !this.grid);
  }

  // ---------------- Input ----------------

  private listen(): void {
    const canvas = this.game.renderer.domElement;
    // A tap (not a drag or a pinch) on the island: focus there, or bring hidden controls back.
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    let fingers = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.saved) return;
      fingers++;
      tap = fingers === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
    });
    const up = (e: PointerEvent) => {
      fingers = Math.max(0, fingers - 1);
      const t = tap;
      if (!t || t.id !== e.pointerId) return;
      tap = null;
      if (!this.saved || e.type !== 'pointerup') return;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || performance.now() - t.t > 450) return;
      if (this.uiHidden) this.hideUi(false);
      else this.focusOn(e.clientX, e.clientY);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (!this.saved || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' && this.uiHidden) { this.hideUi(false); e.stopImmediatePropagation(); return; }
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (k === 'h') this.hideUi(!this.uiHidden);
      else if (k === 'g') { this.setGrid(!this.grid); this.sync(); }
      else if (k === 'enter') void this.capture();
    }, true);
  }

  // ---------------- Taking the picture ----------------

  /**
   * Photo Mode sits in front of the frame's final draw: while it is open it holds the chosen
   * weather, hands the blur its focus distance, and (when a photo is asked for) draws that one
   * frame at high resolution and copies it out. Closed, it passes straight through.
   */
  private hook(): void {
    const post = this.game.post;
    if (post.render === this.hooked) return;
    const inner = post.render;
    const wrapped: typeof post.render = (dt, focus, night) => {
      if (!this.saved) { inner.call(post, dt, focus, night); return; }
      this.holdWeather(dt);
      const f = this.focusDepth() ?? focus;
      const shot = this.shot;
      if (!shot) { inner.call(post, dt, f, night); return; }
      this.shot = null;
      try {
        shot.resolve(this.expose((d) => inner.call(post, d, f, night), dt));
      } catch (err) {
        shot.reject(err);
      }
    };
    post.render = wrapped;
    this.hooked = wrapped;
  }

  /** The pixel ratio for a high-resolution photo (never below what is on screen now). */
  private hiRatio(base: number): number {
    const r = this.game.renderer, c = r.domElement, gl = r.getContext();
    const longest = Math.max(c.width, c.height) / base;
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const edge = Math.min(touch ? HD_EDGE.touch : HD_EDGE.desktop, limit);
    return Math.max(base, Math.min(4, edge / Math.max(1, longest)));
  }

  /** Draw one frame (larger than the screen for a high-resolution photo) and copy it to a 2D canvas. */
  private expose(draw: (dt: number) => void, dt: number): HTMLCanvasElement {
    const g = this.game, r = g.renderer, c = r.domElement;
    const base = r.getPixelRatio();
    const hi = this.hd && !g.settings.pixel ? this.hiRatio(base) : base;
    const big = hi > base * 1.05;
    if (big) { r.setPixelRatio(hi); g.resize(); }
    try {
      draw(dt);
      const out = document.createElement('canvas');
      out.width = c.width;
      out.height = c.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('No 2D canvas');
      ctx.drawImage(c, 0, 0);
      return out;
    } finally {
      // Back to the screen's own size, redrawn at once so the view never blinks.
      if (big) { r.setPixelRatio(base); g.resize(); draw(0); }
    }
  }

  /** The next frame as a picture (rejects if nothing is drawn within a few seconds). */
  private grab(): Promise<HTMLCanvasElement> {
    this.hook();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.shot = null; reject(new Error('No frame')); }, 4000);
      this.shot = {
        resolve: (c) => { clearTimeout(timer); resolve(c); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
    });
  }

  /** The filter, tint and vignette on the saved picture, matching the live preview. */
  private develop(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    const m = filterMatrix(this.filter, this.filterStrength);
    if (m) {
      // In bands, so a large photo never needs a second full copy in memory.
      for (let y = 0; y < h; y += 256) {
        const rows = Math.min(256, h - y);
        const img = ctx.getImageData(0, y, w, rows);
        applyMatrix(img.data, m);
        ctx.putImageData(img, 0, y);
      }
    }
    const a = tintAlpha(this.filter, this.filterStrength);
    if (a > 0 && this.filter.tint) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = a;
      ctx.fillStyle = this.filter.tint.color;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    const v = this.vignette * VIGNETTE.alpha;
    if (v > 0) {
      // An ellipse reaching the corners, as the preview's CSS gradient does.
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale((w / 2) * Math.SQRT2, (h / 2) * Math.SQRT2);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(VIGNETTE.start, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${v})`);
      ctx.fillStyle = grad;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }

  private async capture(): Promise<void> {
    if (this.busy || !this.saved) return;
    this.busy = true;
    try {
      const canvas = await this.grab();
      this.flash();
      haptic('light');
      this.game.audio?.sfx('select');
      this.develop(canvas);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.93));
      if (!blob) throw new Error('No picture');
      const name = `${(this.game.islandName || 'Aztlan Isle').replace(/[^\w -]+/g, '').trim() || 'Aztlan Isle'} ${new Date().toISOString().slice(0, 10)}.jpg`;
      if ((await shareFile(blob, name)) === 'downloaded') this.toast('Photo saved to your downloads.');
    } catch {
      this.toast('The photo could not be taken. Please try again.', 'warn');
    } finally {
      this.busy = false;
    }
  }

  /** A brief white flash over the picture, like a shutter. */
  private flash(): void {
    const f = document.createElement('div');
    f.className = 'photo-flash';
    this.root.append(f);
    f.animate([{ opacity: 0.75 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' }).finished.finally(() => f.remove());
  }
}
