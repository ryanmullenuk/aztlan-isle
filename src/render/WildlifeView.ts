import * as THREE from 'three';
import { CameraRig } from './CameraRig';

export interface WildlifeSubject {
  id: string;
  name: string;
  distance: number;
  /** Null when this individual is no longer available. */
  position(): THREE.Vector3 | null;
}

/** A passive wildlife camera; subjects only expose their current position. */
export class WildlifeView {
  active = false;
  private subject: WildlifeSubject | null = null;
  private saved: { goal: CameraRig['goal']; cur: CameraRig['cur'] } | null = null;
  private overlay: HTMLDivElement;
  private label: HTMLElement;

  constructor(private rig: CameraRig, private subjects: () => WildlifeSubject[], private onExit: () => void) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'wildlife-ui hidden';
    this.overlay.innerHTML = `<div class="wildlife-heading"><span class="wildlife-name"></span><div class="wildlife-actions"><button class="obtn sm" data-action="next">Next creature</button><button class="obtn sm" data-action="exit">Exit wildlife</button></div></div><div class="wildlife-help">Drag to rotate · pinch or scroll to zoom</div>`;
    this.label = this.overlay.querySelector('.wildlife-name')!;
    this.overlay.querySelector<HTMLButtonElement>('[data-action="next"]')!.onclick = () => this.next();
    this.overlay.querySelector<HTMLButtonElement>('[data-action="exit"]')!.onclick = onExit;
    document.body.appendChild(this.overlay);
  }

  enter(): boolean {
    this.saved = { goal: { ...this.rig.goal }, cur: { ...this.rig.cur } };
    if (!this.next()) { this.saved = null; return false; }
    this.active = true;
    document.body.classList.add('watching-wildlife');
    this.overlay.classList.remove('hidden');
    return true;
  }

  next(): boolean {
    const all = this.subjects().filter(s => s.position() !== null);
    const others = all.filter(s => s.id !== this.subject?.id);
    const pool = others.length ? others : all;
    if (!pool.length) { if (this.active) this.onExit(); return false; }
    this.subject = pool[Math.floor(Math.random() * pool.length)];
    this.rig.cinematicTarget = this.subject.position();
    this.rig.goal.dist = this.subject.distance;
    this.rig.goal.tilt = 0;
    this.label.textContent = this.subject.name;
    return true;
  }

  update(): void {
    if (!this.active) return;
    const position = this.subject?.position();
    if (!position) { this.next(); return; }
    this.rig.cinematicTarget = position;
  }

  exit(): void {
    this.active = false;
    this.subject = null;
    this.rig.cinematicTarget = null;
    if (this.saved) {
      this.rig.goal = { ...this.saved.goal };
      this.rig.cur = { ...this.saved.cur };
      this.rig.update(1);
    }
    this.saved = null;
    this.overlay.classList.add('hidden');
    document.body.classList.remove('watching-wildlife');
  }
}
