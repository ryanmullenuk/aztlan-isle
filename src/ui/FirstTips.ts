/**
 * First-time tips: a short word the first time each newer feature matters (the god's hand, smiting,
 * fear or love, the dead, the Funeral Pyre, the Ancestor Altar and its night, swimming). Each shows
 * once per player, ever (remembered in storage), one at a time, never during the tutorial, and only
 * when nothing else is on screen to read. The logic here is plain data so it can be tested; the UI
 * feeds it a snapshot of the game and a yes or no for "may a tip show now".
 */

export type TipKey = 'hand' | 'smite' | 'devotion' | 'death' | 'grave' | 'pyre' | 'altar' | 'ancestors' | 'swim';

export interface Tip { title: string; text: string }

export const TIPS: Record<TipKey, Tip> = {
  hand: { title: 'The god’s hand', text: 'Press on an islander and drag to pick them up, then let go to throw them. Thrown into the sea or a lake they swim back, if no shark or jellyfish finds them first.' },
  smite: { title: 'Smiting', text: 'The Smite button on an islander’s card strikes them dead at once (select several for Smite all). Those nearby flee, and the village carries the dead away.' },
  devotion: { title: 'Fear or love', text: 'Smiting and throwing make your people fear you: they work harder but are less happy. Kindness wins their love and more Belief; watch the meter in the Mood panel.' },
  death: { title: 'The dead', text: 'Your people bury their dead. Build a Funeral Pyre to burn them with honour, and an Ancestor Altar to visit their spirits.' },
  grave: { title: 'Graves', text: 'Tap a grave to see who lies there. Move grave lets you set it somewhere else and turn it to face the way you like.' },
  pyre: { title: 'Funeral Pyre', text: 'Now the dead are carried to the pyre and burned once five mourners have gathered. A Graveyard keeps their ashes in urns.' },
  altar: { title: 'Ancestor Altar', text: 'Islanders will ask to visit the ancestors, or tap the altar and choose Honour the ancestors tonight. Paper Flags make a fine decoration around it.' },
  ancestors: { title: 'Night of the Ancestors', text: 'The spirits of the dead are at the altar tonight. Tap a ghost to learn who they were.' },
  swim: { title: 'Swimming', text: 'Your islanders are swimming! They love a dip in the lakes, rivers and the waterfall pool, and come out happier.' },
};

/** What the tips look at, read from the game each check. */
export interface TipState {
  /** One islander selected (their id), or -1. */
  islander: number;
  /** How many islanders are selected together. */
  group: number;
  /** Fear or love: anything but plain respect means it has moved. */
  devotion: string;
  /** How many have died (the ancestors remembered). */
  dead: number;
  graves: number;
  pyre: boolean;
  altar: boolean;
  /** The ancestors are out tonight. */
  ancestorNight: boolean;
  swimming: boolean;
}

/** May a tip show now: not in the tutorial, Photo Mode, a pop-up or a banner, and pop-ups not turned off. */
export interface TipGate {
  tutorial: boolean;
  busy: boolean;
  popups: 'all' | 'important' | 'off';
}

export const TIPS_KEY = 'aztec-isle-tips-v1';
/** Seconds between one tip and the next. */
export const TIP_GAP = 25;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export class FirstTips {
  readonly seen = new Set<TipKey>();
  /** Triggered, waiting for a quiet moment, oldest first. */
  readonly pending: TipKey[] = [];
  /** A tip is on screen now. */
  open = false;
  private lastShown = -Infinity;
  private lastIslander = -1;
  private lastGroup = 0;
  private deadAtStart = -1;

  constructor(private store: Store | null, private show: (key: TipKey, tip: Tip) => void) {
    try {
      for (const k of (store?.getItem(TIPS_KEY) ?? '').split(',')) if (k in TIPS) this.seen.add(k as TipKey);
    } catch { /* storage unavailable: tips show once this session */ }
  }

  private want(k: TipKey): void {
    if (!this.seen.has(k) && !this.pending.includes(k)) this.pending.push(k);
  }

  /** Is a waiting tip still worth saying? */
  private still(k: TipKey, s: TipState): boolean {
    if (k === 'death') return !s.pyre && !s.altar;
    if (k === 'ancestors') return s.ancestorNight;
    return true;
  }

  /** Look at the game (every quarter second or so) and show the next tip if the moment is right. Returns the tip shown. */
  poll(s: TipState, gate: TipGate, now: number): TipKey | null {
    // A new selection: the first teaches the hand, the next (or a group) teaches smiting.
    const picked = s.islander >= 0 && s.islander !== this.lastIslander;
    const grouped = s.group > 1 && this.lastGroup <= 1;
    this.lastIslander = s.islander;
    this.lastGroup = s.group;
    if (picked) this.want(this.seen.has('hand') || this.pending.includes('hand') ? 'smite' : 'hand');
    if (grouped) this.want('smite');
    if (s.devotion !== 'Respectful') this.want('devotion');
    // A death seen while playing (not the dead of an island loaded already).
    if (this.deadAtStart < 0) this.deadAtStart = s.dead;
    if (s.dead > this.deadAtStart && !s.pyre && !s.altar) this.want('death');
    if (s.graves > 0) this.want('grave');
    if (s.pyre) this.want('pyre');
    if (s.altar) this.want('altar');
    if (s.ancestorNight) this.want('ancestors');
    if (s.swimming) this.want('swim');
    if (this.open || gate.tutorial || gate.busy || gate.popups === 'off' || now - this.lastShown < TIP_GAP) return null;
    while (this.pending.length) {
      const k = this.pending.shift()!;
      if (this.seen.has(k) || !this.still(k, s)) continue;
      this.seen.add(k);
      this.save();
      this.open = true;
      this.lastShown = now;
      this.show(k, TIPS[k]);
      return k;
    }
    return null;
  }

  /** The tip on screen has gone (closed or timed out). */
  closed(now: number): void {
    this.open = false;
    this.lastShown = Math.max(this.lastShown, now - TIP_GAP + 8);
  }

  private save(): void {
    try { this.store?.setItem(TIPS_KEY, [...this.seen].join(',')); } catch { /* ignore */ }
  }
}

/** The small tip card above the toolbar: a heading, a line and Got it. It fades by itself. */
export class TipCard {
  readonly el: HTMLDivElement;
  private timer = 0;
  onClose: () => void = () => {};

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'panel first-tip hidden';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
  }

  show(tip: Tip): void {
    this.el.innerHTML = '<div class="ft-kicker">Tip</div><div class="ft-title"></div><p class="ft-text"></p><button type="button" class="btn small">Got it</button>';
    this.el.querySelector('.ft-title')!.textContent = tip.title;
    this.el.querySelector('.ft-text')!.textContent = tip.text;
    this.el.querySelector('button')!.onclick = () => this.hide();
    this.el.classList.remove('hidden', 'ft-in');
    void this.el.offsetWidth;
    this.el.classList.add('ft-in');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), 15000);
  }

  hide(): void {
    if (this.el.classList.contains('hidden')) return;
    clearTimeout(this.timer);
    this.el.classList.add('hidden');
    this.el.classList.remove('ft-in');
    this.onClose();
  }
}
