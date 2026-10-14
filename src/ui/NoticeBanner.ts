/**
 * The gold-framed notice banner at the top centre of the screen (the approved frame artwork,
 * public/ui/notice-frame.webp, with text, an icon and a picture laid over its dark centre). It
 * slides in from the top with a little scale and fade, the frame catches a golden shimmer and the
 * tick draws itself in; it stays four seconds, then fades away. Notices that arrive together queue
 * and show one after another. It never takes input, so play carries on underneath.
 *
 * Kept general (an icon, a heading, a line, a highlighted line, an optional picture) so research,
 * population and achievement notices can use it too.
 */
export interface Notice {
  title: string;
  line: string;
  /** Highlighted line beneath (a benefit), or none. */
  benefit?: string | null;
  /** Picture on the right (a data URL or image path), or none. */
  image?: string | null;
  icon?: 'tick';
}

/** Seconds a notice stays fully shown, and its entrance and exit. */
const HOLD = 4, ENTER = 0.5, LEAVE = 0.6;

const TICK_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="nb-tick-ring" cx="24" cy="24" r="20"/><path class="nb-tick-mark" d="M14.5 24.5l6.5 6.5 13-14"/></svg>`;

/** Scale a single-line element's font down until its text fits its box (to 80% at most). */
function fitLine(t: HTMLElement): void {
  t.style.fontSize = '';
  if (!t.textContent || !t.clientWidth) return;
  const base = parseFloat(getComputedStyle(t).fontSize);
  for (let k = 1; k <= 4 && t.scrollWidth > t.clientWidth + 1; k++) t.style.fontSize = `${base * (1 - k * 0.05)}px`;
}

export class NoticeBanner {
  private queue: Notice[] = [];
  private showing = false;
  private el: HTMLDivElement;
  private title: HTMLElement;
  private line: HTMLElement;
  private benefit: HTMLElement;
  private image: HTMLImageElement;
  private icon: HTMLElement;
  private timers: number[] = [];

  constructor(parent: HTMLElement = document.body, private base = '') {
    this.el = document.createElement('div');
    this.el.className = 'notice-banner';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    // An absolute address: a url() inside a custom property resolves against the stylesheet that
    // uses it (assets/ in a built site), not the page, so a relative path would miss the image.
    this.el.style.setProperty('--nb-frame', `url("${new URL(`${base}ui/notice-frame.webp`, document.baseURI).href}")`);
    this.el.innerHTML = `<div class="nb-shimmer"></div><div class="nb-body"><div class="nb-icon"></div><div class="nb-text"><div class="nb-title"></div><div class="nb-line"></div><div class="nb-benefit"></div></div><div class="nb-pic"><img alt=""></div></div>`;
    this.title = this.el.querySelector('.nb-title')!;
    this.line = this.el.querySelector('.nb-line')!;
    this.benefit = this.el.querySelector('.nb-benefit')!;
    this.image = this.el.querySelector('.nb-pic img')!;
    this.icon = this.el.querySelector('.nb-icon')!;
    parent.appendChild(this.el);
  }

  /** Show a notice now, or after the ones already waiting. */
  push(n: Notice): void {
    this.queue.push(n);
    if (!this.showing) this.next();
  }

  /** How many are shown or waiting (for tests and the toast offset). */
  get pending(): number {
    return this.queue.length + (this.showing ? 1 : 0);
  }

  private next(): void {
    const n = this.queue.shift();
    if (!n) {
      this.showing = false;
      document.body.classList.remove('notice-showing');
      return;
    }
    this.showing = true;
    this.title.textContent = n.title;
    this.line.textContent = n.line;
    this.benefit.textContent = n.benefit ?? '';
    this.benefit.hidden = !n.benefit;
    this.icon.innerHTML = n.icon === 'tick' || !n.icon ? TICK_SVG : '';
    this.el.classList.toggle('has-pic', !!n.image);
    if (n.image) this.image.src = n.image;
    else this.image.removeAttribute('src');
    document.body.classList.add('notice-showing');
    // Long names: shrink a line's type until it fits (never below 80%) before resorting to "…".
    for (const t of [this.title, this.line, this.benefit]) fitLine(t);
    // Restart the entrance animations (shimmer, tick) for every notice.
    this.el.classList.remove('nb-in', 'nb-out');
    void this.el.offsetWidth;
    this.el.classList.add('nb-in');
    this.timers.push(window.setTimeout(() => this.el.classList.add('nb-out'), (ENTER + HOLD) * 1000));
    this.timers.push(window.setTimeout(() => {
      this.el.classList.remove('nb-in', 'nb-out');
      this.next();
    }, (ENTER + HOLD + LEAVE) * 1000));
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.el.remove();
  }
}
