import { lapseFrames, type LapseFrame } from '../world/LapseStore';
import { ICONS } from './icons';
import { shareFile } from './PhotoMode';

/** Pictures a second, playing and in the video. */
const FPS = 8;
/** Longest video, in pictures (longer time-lapses skip some to fit). */
const VIDEO_MAX = 240;

/** The first video format this browser can record (null if it can't record the canvas at all). */
function videoType(): string | null {
  const MR = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  for (const t of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']) if (MR.isTypeSupported?.(t)) return t;
  return null;
}

/**
 * The island through time: one picture from every day played, taken from the same place each
 * afternoon, played back as a time-lapse of the village growing from its first fire. Scrub
 * through it, or save it as a video to share.
 */
export class TimeLapseView {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scrub: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private videoBtn: HTMLButtonElement;
  private note: HTMLParagraphElement;
  private frames: LapseFrame[] = [];
  private at = 0;
  private timer = 0;
  private playing = false;
  private busy = false;
  private drawn = -1;

  constructor(host: HTMLElement, private islandName: () => string, private toast: (t: string, k?: 'info' | 'warn') => void) {
    this.root = document.createElement('div');
    this.root.className = 'lapse hidden';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Time-lapse');
    this.root.innerHTML = `<div class="lapse-card panel">
      <div class="card-head"><span>Your island through time</span><button class="ib small" data-a="close" aria-label="Close">${ICONS.close}</button></div>
      <canvas class="lapse-canvas" width="960" height="540"></canvas>
      <input class="lapse-scrub" type="range" min="0" max="0" step="1" value="0" aria-label="Day">
      <div class="lapse-row"><button class="btn" data-a="play">Play</button><button class="btn" data-a="video">Save video</button></div>
      <p class="lapse-note muted small"></p></div>`;
    host.append(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.scrub = this.root.querySelector('.lapse-scrub')!;
    this.playBtn = this.root.querySelector('[data-a="play"]')!;
    this.videoBtn = this.root.querySelector('[data-a="video"]')!;
    this.note = this.root.querySelector('.lapse-note')!;
    this.root.querySelector<HTMLButtonElement>('[data-a="close"]')!.onclick = () => this.close();
    this.playBtn.onclick = () => this.setPlaying(!this.playing);
    this.videoBtn.onclick = () => void this.saveVideo();
    this.scrub.oninput = () => { this.setPlaying(false); this.at = +this.scrub.value; void this.show(this.at); };
    this.root.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') this.close(); };
    this.root.onclick = (e) => { if (e.target === this.root) this.close(); };
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  async openFor(island: string): Promise<void> {
    this.frames = await lapseFrames(island);
    const n = this.frames.length;
    this.root.classList.remove('hidden');
    this.scrub.max = String(Math.max(0, n - 1));
    this.scrub.disabled = n < 2;
    this.playBtn.disabled = n < 2;
    this.videoBtn.disabled = n < 2 || !videoType();
    this.videoBtn.hidden = !videoType();
    this.note.textContent = n < 2
      ? 'A picture of the island is taken each afternoon. Come back after a few days of play to watch your village grow.'
      : `${n} days so far: a picture is added each afternoon.`;
    this.at = 0;
    this.drawn = -1;
    if (n) await this.show(0);
    else this.blank();
    if (n >= 2) this.setPlaying(true);
  }

  close(): void {
    this.setPlaying(false);
    this.root.classList.add('hidden');
    this.frames = [];
  }

  private setPlaying(on: boolean): void {
    this.playing = on && this.frames.length > 1;
    this.playBtn.textContent = this.playing ? 'Pause' : 'Play';
    clearTimeout(this.timer);
    if (this.playing) this.tick();
  }

  private tick(): void {
    if (!this.playing) return;
    void this.show(this.at).then(() => {
      if (!this.playing) return;
      // Hold the last day a moment before going round again.
      const last = this.at >= this.frames.length - 1;
      this.at = last ? 0 : this.at + 1;
      this.timer = window.setTimeout(() => this.tick(), last ? 1800 : 1000 / FPS);
    });
  }

  private async show(i: number): Promise<void> {
    if (i === this.drawn) return;
    const f = this.frames[i];
    if (!f) return;
    await this.draw(this.ctx, this.canvas, f);
    this.drawn = i;
    this.scrub.value = String(i);
  }

  private blank(): void {
    const c = this.ctx;
    c.fillStyle = '#18222a';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** One day's picture, with its caption along the bottom. */
  private async draw(c: CanvasRenderingContext2D, cv: HTMLCanvasElement, f: LapseFrame): Promise<void> {
    let img: ImageBitmap | HTMLImageElement;
    try {
      img = await createImageBitmap(f.blob);
    } catch {
      img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = URL.createObjectURL(f.blob);
      });
    }
    const W = cv.width, H = cv.height;
    c.drawImage(img, 0, 0, W, H);
    if ('close' in img) img.close();
    else URL.revokeObjectURL(img.src);
    const g = c.createLinearGradient(0, H * 0.78, 0, H);
    g.addColorStop(0, 'rgba(10,14,18,0)');
    g.addColorStop(1, 'rgba(10,14,18,0.7)');
    c.fillStyle = g;
    c.fillRect(0, H * 0.78, W, H * 0.22);
    const s = H / 540;
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#ffe7a6';
    c.font = `700 ${Math.round(26 * s)}px Georgia, serif`;
    c.fillText(`Day ${f.day + 1}`, 24 * s, H - 46 * s);
    c.fillStyle = '#f4efe4';
    c.font = `600 ${Math.round(17 * s)}px system-ui, sans-serif`;
    c.fillText(`${f.season}, year ${f.year} · ${f.title} · ${f.pop} islander${f.pop === 1 ? '' : 's'}`, 24 * s, H - 20 * s);
    c.textAlign = 'right';
    c.fillStyle = 'rgba(255,231,166,0.85)';
    c.font = `700 ${Math.round(15 * s)}px Georgia, serif`;
    c.fillText(this.islandName() || 'Aztlan Isle', W - 22 * s, H - 20 * s);
    c.textAlign = 'left';
  }

  /** Record the whole time-lapse from a canvas of its own and hand it to the share sheet. */
  private async saveVideo(): Promise<void> {
    const type = videoType();
    if (this.busy || !type || this.frames.length < 2) return;
    this.busy = true;
    this.setPlaying(false);
    const label = this.videoBtn.textContent;
    this.videoBtn.disabled = true;
    try {
      const cv = document.createElement('canvas');
      cv.width = this.canvas.width;
      cv.height = this.canvas.height;
      const c = cv.getContext('2d')!;
      const step = Math.max(1, this.frames.length / VIDEO_MAX);
      const pick: LapseFrame[] = [];
      for (let k = 0; k < this.frames.length; k += step) pick.push(this.frames[Math.floor(k)]);
      if (pick[pick.length - 1] !== this.frames[this.frames.length - 1]) pick.push(this.frames[this.frames.length - 1]);
      await this.draw(c, cv, pick[0]);
      const stream = cv.captureStream(FPS);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5_000_000 });
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start(500);
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let k = 0; k < pick.length; k++) {
        this.videoBtn.textContent = `Making video ${Math.round((k / pick.length) * 100)}%`;
        const t0 = performance.now();
        await this.draw(c, cv, pick[k]);
        await wait(Math.max(0, 1000 / FPS - (performance.now() - t0)));
      }
      await wait(1500);
      rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(parts, { type: type.split(';')[0] });
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const name = `${(this.islandName() || 'Aztlan Isle').replace(/[^\w -]+/g, '').trim() || 'Aztlan Isle'} time-lapse.${ext}`;
      if ((await shareFile(blob, name)) === 'downloaded') this.toast('Time-lapse saved to your downloads.');
    } catch {
      this.toast('The video could not be made. Please try again.', 'warn');
    } finally {
      this.busy = false;
      this.videoBtn.textContent = label;
      this.videoBtn.disabled = false;
    }
  }
}
