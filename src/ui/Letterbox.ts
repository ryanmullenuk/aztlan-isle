/**
 * The cinema bars for a cinematic camera move: two dark bars ease in at the top and bottom, the
 * interface dims, and any tap, click, key, wheel or drag hands the view straight back (the skip
 * callback). The input that skipped still does what it normally would, so control is never lost.
 */
export class Letterbox {
  private el: HTMLDivElement;
  private shown = false;

  constructor(private onSkip: () => void, parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'cine-bars';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<div class="cine-bar cine-top"></div><div class="cine-bar cine-bottom"><span class="cine-skip">Tap to skip</span></div>';
    parent.append(this.el);
    // Capture phase, so the move is dropped before the game's own handlers see the input.
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
      window.addEventListener(type, () => { if (this.shown) this.onSkip(); }, { capture: true, passive: true });
    }
    // Leaving the app mid-move: come back to the game as it was.
    window.addEventListener('blur', () => { if (this.shown) this.onSkip(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.shown) this.onSkip(); });
  }

  get visible(): boolean {
    return this.shown;
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.el.classList.add('on');
    document.body.classList.add('cinematic');
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('on');
    document.body.classList.remove('cinematic');
  }
}
