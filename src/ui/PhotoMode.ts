import type { Game } from '../Game';
import { ICONS } from './icons';
import { haptic } from './Haptics';

/** The light presets: a time of day for the lighting only (the island's clock doesn't move). */
const LIGHTS = [
  { id: 'dawn', label: 'Dawn', t: 0.215 },
  { id: 'day', label: 'Day', t: 0.45 },
  { id: 'night', label: 'Night', t: 0.95 },
] as const;

type Bridge = { postMessage(m: unknown): void };
const nativePhoto = (): Bridge | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { photo?: Bridge } } }).webkit?.messageHandlers?.photo;

/**
 * Photo Mode: the interface is hidden but for a small toolbar, the island pauses, and the player
 * frames a shot with the usual pan, turn and zoom. Choose dawn, day or night light, add a little
 * tilt-shift, and capture: the picture goes to the share sheet (or a Save dialog on the Mac, or a
 * download in a browser). Closing puts the camera, light, depth of field and pause back as they were.
 */
export class PhotoMode {
  readonly bar: HTMLDivElement;
  private saved: { paused: boolean; goal: Game['rig']['goal']; dof: boolean; strength: number; follow: number } | null = null;
  private lightBtns = new Map<string, HTMLButtonElement>();
  private tilt!: HTMLButtonElement;
  private strength!: HTMLInputElement;
  private light: (typeof LIGHTS)[number]['id'] | null = null;
  private busy = false;

  constructor(private game: Game, private root: HTMLElement, private toast: (text: string, kind?: 'info' | 'warn') => void) {
    this.bar = document.createElement('div');
    this.bar.className = 'photo-bar hidden';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Photo Mode');
    const lights = document.createElement('div');
    lights.className = 'pb-seg';
    for (const l of LIGHTS) {
      const b = document.createElement('button');
      b.className = 'pb-btn';
      b.textContent = l.label;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => this.setLight(this.light === l.id ? null : l.id);
      this.lightBtns.set(l.id, b);
      lights.append(b);
    }
    this.tilt = document.createElement('button');
    this.tilt.className = 'pb-btn';
    this.tilt.textContent = 'Tilt-shift';
    this.tilt.setAttribute('aria-pressed', 'false');
    this.tilt.onclick = () => this.setTilt(!this.game.post.dofEnabled);
    this.strength = document.createElement('input');
    this.strength.type = 'range';
    this.strength.min = '0.2';
    this.strength.max = '2';
    this.strength.step = '0.05';
    this.strength.className = 'pb-range';
    this.strength.setAttribute('aria-label', 'Tilt-shift strength');
    this.strength.oninput = () => { this.game.post.dofStrength = +this.strength.value; };
    const tiltWrap = document.createElement('div');
    tiltWrap.className = 'pb-seg pb-tilt';
    tiltWrap.append(this.tilt, this.strength);
    const shoot = document.createElement('button');
    shoot.className = 'pb-shoot';
    shoot.setAttribute('aria-label', 'Take photo');
    shoot.innerHTML = '<span></span>';
    shoot.onclick = () => void this.capture();
    const close = document.createElement('button');
    close.className = 'pb-close';
    close.setAttribute('aria-label', 'Close Photo Mode');
    close.innerHTML = ICONS.close;
    close.onclick = () => this.close();
    this.bar.append(lights, tiltWrap, shoot, close);
    root.append(this.bar);
  }

  get open(): boolean {
    return !!this.saved;
  }

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
    // Tilt-shift is a post effect: offered only where the device draws it smoothly.
    const canBlur = g.settings.preset !== 'low';
    this.tilt.disabled = !canBlur;
    this.strength.value = String(Math.min(1.2, g.settings.dofStrength || 0.8));
    this.setTilt(false);
    this.setLight(null);
    g.audio?.sfx('click');
  }

  close(): void {
    const s = this.saved;
    if (!s) return;
    const g = this.game;
    g.photoMode = false;
    g.photoLight = null;
    g.time.paused = s.paused;
    g.rig.goal = { ...s.goal };
    g.post.dofEnabled = s.dof;
    g.post.dofStrength = s.strength;
    if (s.follow >= 0 && g.colony.byId(s.follow)) g.followId = s.follow;
    this.saved = null;
    this.root.classList.remove('photo');
    this.bar.classList.add('hidden');
    g.audio?.sfx('click');
  }

  private setLight(id: (typeof LIGHTS)[number]['id'] | null): void {
    this.light = id;
    this.game.photoLight = id ? LIGHTS.find((l) => l.id === id)!.t : null;
    for (const [k, b] of this.lightBtns) b.setAttribute('aria-pressed', String(k === id));
  }

  private setTilt(on: boolean): void {
    on &&= !this.tilt.disabled;
    this.game.post.dofEnabled = on;
    this.game.post.dofStrength = +this.strength.value;
    this.tilt.setAttribute('aria-pressed', String(on));
    this.strength.disabled = !on;
  }

  private async capture(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const blob = await this.game.capturePhoto();
      if (!blob) throw new Error('No picture');
      this.flash();
      haptic('light');
      this.game.audio?.sfx('select');
      const name = `${(this.game.islandName || 'Aztlan Isle').replace(/[^\w -]+/g, '').trim() || 'Aztlan Isle'} ${new Date().toISOString().slice(0, 10)}.jpg`;
      await this.deliver(blob, name);
    } catch {
      this.toast('The photo could not be taken. Please try again.', 'warn');
    } finally {
      this.busy = false;
    }
  }

  /** To the app's share sheet or Save dialog, the browser's share sheet, or a download. */
  private async deliver(blob: Blob, name: string): Promise<void> {
    const native = nativePhoto();
    if (native) {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
      native.postMessage({ name, data });
      return;
    }
    const file = new File([blob], name, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: name });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
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
    this.toast('Photo saved to your downloads.');
  }

  /** A brief white flash over the picture, like a shutter. */
  private flash(): void {
    const f = document.createElement('div');
    f.className = 'photo-flash';
    this.root.append(f);
    f.animate([{ opacity: 0.75 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' }).finished.finally(() => f.remove());
  }
}
