import * as THREE from 'three';
import { CameraRig } from './CameraRig';

export interface WildlifeSubject {
  id: string;
  name: string;
  distance: number;
  behaviour?(): string;
  /** Null when this individual is no longer available. */
  position(): THREE.Vector3 | null;
}

export const WILDLIFE_TOUR_SECONDS = 20;

/** Translate simulation states into readable, live observation labels. */
export function wildlifeBehaviour(state: string): string {
  const labels: Record<string, string> = {
    idle: 'Watching the surroundings', walk: 'Walking', feed: 'Feeding', rest: 'Resting',
    alert: 'On alert', avoid: 'Keeping its distance', flee: 'Fleeing', held: 'Being escorted', penned: 'In its pen',
    sit: 'Sitting in the canopy', climb: 'Climbing', hang: 'Hanging from a branch', crouch: 'Crouching',
    jump: 'Jumping between branches', land: 'Landing', eat: 'Eating', watch: 'Watching', run: 'Running', steal: 'Taking food',
    swim: 'Swimming', rise: 'Rising for air', surface: 'Breathing at the surface',
    fly: 'Flying', takeoff: 'Taking off', ground: 'On the shore', perch: 'Perching', hop: 'Hopping between perches',
    crawl: 'Crawling along the beach', enter: 'Entering the sea', breathe: 'Coming up to breathe',
    approach: 'Approaching the beach', exit: 'Coming ashore', cruise: 'Cruising', circle: 'Circling',
    chase: 'Chasing fish', leave: 'Moving away', prowl: 'Prowling', stalk: 'Stalking', charge: 'Charging',
    confront: 'Confronting a threat', fight: 'Fighting', retreat: 'Retreating', arrive: 'Emerging from the jungle',
    stand: 'Standing in the shallows', oneleg: 'Resting on one leg', preen: 'Preening', stretch: 'Stretching its wings',
    dive: 'Diving for fish', under: 'Underwater', swallow: 'Swallowing a fish', strike: 'Striking at fish', recover: 'Recovering after a strike',
  };
  return labels[state] ?? 'Roaming';
}

/** A passive wildlife camera; subjects only expose their current position. */
export class WildlifeView {
  active = false;
  tourRunning = false;
  private tourElapsed = 0;
  private subject: WildlifeSubject | null = null;
  private saved: { goal: CameraRig['goal']; cur: CameraRig['cur'] } | null = null;
  private overlay: HTMLDivElement;
  private label: HTMLElement;
  private behaviourLabel: HTMLElement;
  private tourButton: HTMLButtonElement;

  constructor(private rig: CameraRig, private subjects: () => WildlifeSubject[], private onExit: () => void) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'wildlife-ui hidden';
    this.overlay.innerHTML = `<div class="wildlife-heading"><div class="wildlife-caption"><span class="wildlife-name"></span><span class="wildlife-behaviour"></span></div><div class="wildlife-actions"><button class="obtn sm" data-action="tour" aria-pressed="false">Start tour</button><button class="obtn sm" data-action="next">Next creature</button><button class="obtn sm" data-action="exit">Exit wildlife</button></div></div><div class="wildlife-help">Drag to rotate · pinch or scroll to zoom</div>`;
    this.label = this.overlay.querySelector('.wildlife-name')!;
    this.behaviourLabel = this.overlay.querySelector('.wildlife-behaviour')!;
    this.tourButton = this.overlay.querySelector<HTMLButtonElement>('[data-action="tour"]')!;
    this.tourButton.onclick = () => this.toggleTour();
    this.tourButton.title = 'Switch creatures automatically every 20 seconds';
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
    let pool = others.length ? others : all;
    if (this.tourRunning) {
      const differentSpecies = pool.filter(s => s.name !== this.subject?.name);
      if (differentSpecies.length) pool = differentSpecies;
      // A large gull flock should not crowd smaller wildlife populations out of the tour.
      const names = [...new Set(pool.map(s => s.name))];
      const name = names[Math.floor(Math.random() * names.length)];
      pool = pool.filter(s => s.name === name);
    }
    if (!pool.length) { if (this.active) this.onExit(); return false; }
    this.subject = pool[Math.floor(Math.random() * pool.length)];
    this.rig.cinematicTarget = this.subject.position();
    this.rig.goal.dist = this.subject.distance;
    this.rig.goal.tilt = 0;
    this.label.textContent = this.subject.name;
    this.tourElapsed = 0;
    this.updateBehaviour();
    return true;
  }

  toggleTour(): void {
    if (!this.active) return;
    this.tourRunning = !this.tourRunning;
    this.tourElapsed = 0;
    this.tourButton.textContent = this.tourRunning ? 'Stop tour' : 'Start tour';
    this.tourButton.setAttribute('aria-pressed', String(this.tourRunning));
  }

  private updateBehaviour(): void {
    const label = this.subject?.behaviour?.() ?? 'Roaming';
    if (this.behaviourLabel.textContent !== label) this.behaviourLabel.textContent = label;
  }

  update(realDt = 0): void {
    if (!this.active) return;
    const position = this.subject?.position();
    if (!position) { this.next(); return; }
    this.rig.cinematicTarget = position;
    this.updateBehaviour();
    if (this.tourRunning) {
      this.tourElapsed += Math.max(0, realDt);
      if (this.tourElapsed >= WILDLIFE_TOUR_SECONDS) this.next();
    }
  }

  exit(): void {
    this.active = false;
    this.tourRunning = false; this.tourElapsed = 0;
    this.tourButton.textContent = 'Start tour';
    this.tourButton.setAttribute('aria-pressed', 'false');
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
