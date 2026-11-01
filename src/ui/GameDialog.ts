/**
 * Pop-ups in the middle of the screen, one at a time, that the player clears: a framed card with
 * an emblem on its top edge, a title, a few lines and big buttons. Anything that arrives while one
 * is open (or while the player is busy dragging, sculpting or placing) waits its turn; several
 * pieces of everyday news waiting together are shown as one list, so they never stack up.
 */
export type DialogIcon = 'tick' | 'star' | 'warn' | 'ask' | 'info' | 'home';

export interface DialogAction {
  label: string;
  /** Runs when chosen (the pop-up closes either way). */
  run?: () => void;
  primary?: boolean;
}

export interface DialogItem {
  icon: DialogIcon;
  /** Small line above the title ("Building complete", "Milestone"). */
  kicker?: string;
  title: string;
  /** Plain text, or html when `html` is set (trusted, built by the game). */
  body?: string;
  html?: boolean;
  benefit?: string | null;
  image?: string | null;
  actions?: DialogAction[];
  /** Everyday news (a building finished, a birth): merged with other news waiting at the same time. */
  news?: boolean;
  /** Worth showing even when the player keeps only important pop-ups (dangers, titles, coming back). */
  important?: boolean;
  /** Shown whatever the player chose for pop-ups (a reward to collect, not a notice). */
  always?: boolean;
}

/** Which pop-ups the player wants: all of them, only the important ones, or none. */
export type PopupMode = 'all' | 'important' | 'off';

const ICONS: Record<DialogIcon, string> = {
  tick: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#1f9d4c" stroke="#8ef0a8" stroke-width="3"/><path d="M14.5 24.5l6.5 6.5 13-14" fill="none" stroke="#f4fff6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#b9811f" stroke="#ffe08a" stroke-width="3"/><path d="M24 10l4.2 8.9 9.8 1.2-7.2 6.7 1.9 9.7L24 31.7l-8.7 4.8 1.9-9.7-7.2-6.7 9.8-1.2z" fill="#fff4cf"/></svg>',
  warn: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#b23a2c" stroke="#ffb08a" stroke-width="3"/><path d="M24 12v15" stroke="#fff2e8" stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="34.5" r="3" fill="#fff2e8"/></svg>',
  ask: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#2f8f86" stroke="#9ff0e6" stroke-width="3"/><path d="M13 17c0-3 2.5-5 5.5-5h11c3 0 5.5 2 5.5 5v8c0 3-2.5 5-5.5 5H23l-6 5v-5h-.5c-2 0-3.5-2-3.5-5z" fill="#f3fffd"/><path d="M24 16v7" stroke="#2f8f86" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="26.5" r="1.8" fill="#2f8f86"/></svg>',
  info: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#3d5f8f" stroke="#a9c8ff" stroke-width="3"/><circle cx="24" cy="15" r="3" fill="#f2f7ff"/><path d="M24 21v14" stroke="#f2f7ff" stroke-width="5" stroke-linecap="round"/></svg>',
  home: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#9a6a2c" stroke="#ffd690" stroke-width="3"/><path d="M12 25l12-11 12 11" fill="none" stroke="#fff2d6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 23v11h16V23" fill="none" stroke="#fff2d6" stroke-width="4" stroke-linejoin="round"/></svg>',
};

/** Everyday news gathers for at least this long between pop-ups. */
const NEWS_GAP_MS = 40_000;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class GameDialog {
  private queue: DialogItem[] = [];
  private el: HTMLDivElement;
  private open: DialogItem | null = null;
  /** When news was last shown (ms): everyday news waits a while between pop-ups, gathering up. */
  private lastNews = -Infinity;
  /** Whether a pop-up may appear now (not mid-drag, not while placing, not in Photo Mode). */
  canShow: () => boolean = () => true;
  /** The player's choice in Settings (see PopupMode). */
  mode: () => PopupMode = () => 'all';
  onShow: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'gd-backdrop hidden';
    parent.appendChild(this.el);
  }

  get showing(): boolean {
    return !!this.open;
  }

  push(item: DialogItem): void {
    const mode = this.mode();
    if (!item.always && (mode === 'off' || (mode === 'important' && !item.important))) return;
    // The same thing said twice while waiting (a repeated warning) only shows once.
    if (this.queue.some((q) => q.title === item.title && q.body === item.body) || (this.open?.title === item.title && this.open?.body === item.body)) return;
    this.queue.push(item);
    this.next();
  }

  /** Called every frame or so: show the next pop-up once the player is free. */
  tick(): void {
    if (!this.open && this.queue.length) this.next();
  }

  /** Drop waiting pop-ups that match (a request granted before it was shown, say). */
  forget(match: (d: DialogItem) => boolean): void {
    this.queue = this.queue.filter((d) => !match(d));
  }

  private next(): void {
    if (this.open || !this.queue.length || !this.canShow()) return;
    // Important pop-ups first, in order; then all the waiting news together.
    const first = this.queue.findIndex((d) => !d.news);
    let item: DialogItem;
    if (first >= 0) item = this.queue.splice(first, 1)[0];
    else {
      if (performance.now() - this.lastNews < NEWS_GAP_MS) return;
      this.lastNews = performance.now();
      const news = this.queue.splice(0);
      item = news.length === 1 ? news[0] : {
        icon: 'info', kicker: 'Village news', title: `${news.length} things happened`, html: true,
        body: `<ul class="gd-news">${news.map((n) => `<li>${ICONS[n.icon]}<span><b>${esc(n.title)}</b>${n.body && !n.html ? `<br>${esc(n.body)}` : ''}</span></li>`).join('')}</ul>`,
      };
    }
    this.show(item);
  }

  private show(d: DialogItem): void {
    this.open = d;
    const actions = d.actions?.length ? d.actions : [{ label: 'OK', primary: true }];
    this.el.innerHTML = `<div class="gd-card${d.image ? ' has-pic' : ''}" role="dialog" aria-modal="true" aria-labelledby="gd-title">
      <div class="gd-emblem" aria-hidden="true">${ICONS[d.icon]}</div>
      ${d.kicker ? `<div class="gd-kicker">${esc(d.kicker)}</div>` : ''}
      <div class="gd-title" id="gd-title">${esc(d.title)}</div>
      ${d.image ? `<img class="gd-pic" alt="" src="${d.image}">` : ''}
      ${d.body ? `<div class="gd-body">${d.html ? d.body : esc(d.body)}</div>` : ''}
      ${d.benefit ? `<div class="gd-benefit">${esc(d.benefit)}</div>` : ''}
      <div class="gd-actions">${actions.map((a, i) => `<button type="button" class="gd-btn${a.primary || actions.length === 1 ? ' primary' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
    this.el.classList.remove('hidden', 'gd-out');
    // Restart the entrance each time.
    void this.el.offsetWidth;
    this.el.classList.add('gd-in');
    this.el.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => {
      b.onclick = () => {
        const a = actions[Number(b.dataset.i)];
        this.close();
        a.run?.();
      };
    });
    this.el.querySelector<HTMLButtonElement>('.gd-btn.primary')?.focus({ preventScroll: true });
    this.onShow();
  }

  private close(): void {
    this.open = null;
    this.el.classList.remove('gd-in');
    this.el.classList.add('gd-out');
    setTimeout(() => {
      if (this.open) return;
      this.el.classList.add('hidden');
      this.el.innerHTML = '';
      this.next();
    }, 220);
  }
}
