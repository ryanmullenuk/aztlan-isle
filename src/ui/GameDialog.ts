/**
 * Pop-ups in the middle of the screen, one at a time, that the player clears: a framed card with
 * an emblem on its top edge, a title, a few lines and big buttons. Anything that arrives while one
 * is open (or while the player is busy dragging, sculpting or placing) waits its turn; several
 * pieces of everyday news waiting together are shown as one list, so they never stack up.
 *
 * News with nothing to decide (a building finished, a milestone, a wedding) is not a card at all:
 * it passes by in the notice banner at the top and goes by itself, and news arriving together
 * shares one banner (see newsOnly and combineNotices).
 */
import { artFor, artSrc, type ArtKey } from './eventArt';
import { combineNotices, type Notice } from './NoticeBanner';
import { AZ_CORNERS, AZ_LEAVES } from './aztecKit';

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
  /** A picture of the thing itself (a building drawn on its own), shown beside the words. */
  image?: string | null;
  /** Its own drawn picture (a volcano, a whale…); without one, a picture is chosen from the words. Null for none. */
  art?: ArtKey | null;
  actions?: DialogAction[];
  /** Everyday news (a building finished, a birth): merged with other news waiting at the same time. */
  news?: boolean;
  /** Worth showing even when the player keeps only important pop-ups (dangers, titles, coming back). */
  important?: boolean;
  /** Shown whatever the player chose for pop-ups (a reward to collect, not a notice). */
  always?: boolean;
  /**
   * The first pop-up of its kind offers to turn that kind off (once only, ever): `key` names the
   * kind, `label` the button, and `run` turns them off.
   */
  optOut?: { key: string; label: string; run: () => void };
  /** Seconds of play this session before it may show, and never straight after another pop-up (the daily chest). */
  minPlay?: number;
}

/**
 * News with nothing to decide: no picture-book page (html), no danger, not a reward to collect,
 * and no button that does anything (news may keep one, "Show me", which becomes a tap on the banner).
 */
export function newsOnly(d: DialogItem): boolean {
  if (d.always || d.html || d.icon === 'warn' || d.minPlay) return false;
  const acts = d.actions ?? [];
  const doing = acts.filter((a) => a.run).length;
  return d.news ? doing <= 1 : doing === 0 && acts.length <= 1;
}

/** Long first lines are moved down into the line, under the kicker as the heading. */
const TITLE_MAX = 26;

/** The banner for a piece of news. */
export function toNotice(d: DialogItem): Notice {
  const short = d.body?.match(/^(.+?) (?:constructed successfully|built|upgraded)$/)?.[1] ?? d.body?.match(/^([^:]{2,24}): /)?.[1];
  const long = d.title.length > TITLE_MAX && !!d.kicker;
  const go = d.actions?.find((a) => a.run)?.run;
  return {
    title: long ? d.kicker! : d.title,
    line: long ? [d.title + (/[.!?…]$/.test(d.title) ? '' : '.'), d.body].filter(Boolean).join(' ') : d.body ?? '',
    benefit: d.benefit, image: d.image, icon: d.icon === 'star' ? 'star' : 'tick', important: d.important,
    kicker: long ? undefined : d.kicker, onClick: go, group: d.title, short: short ?? d.title,
  };
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
/** A pop-up that waits for play (the daily chest) also leaves this long after the last one closed. */
const CALM_MS = 4_000;

/** A small picture on the secondary buttons that take you somewhere or look at something. */
const PIN = '<svg class="gd-bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c-3.9 0-7 3-7 6.9 0 5 7 12.1 7 12.1s7-7.1 7-12.1c0-3.9-3.1-6.9-7-6.9z" fill="#f2c14e" stroke="#7a4c10" stroke-width="1.4"/><circle cx="12" cy="9.4" r="2.6" fill="#3a2410"/></svg>';
function buttonIcon(label: string): string {
  return /^(show|go|watch|look|see)\b/i.test(label) ? PIN : '';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class GameDialog {
  private queue: DialogItem[] = [];
  private el: HTMLDivElement;
  private open: DialogItem | null = null;
  /** When news was last shown (ms): everyday news waits a while between pop-ups, gathering up. */
  private lastNews = -Infinity;
  /** News waiting for the banner, gathered so that what arrives together shows together. */
  private notices: Notice[] = [];
  /** Time played this session (ms), and when the last pop-up closed. */
  private played = 0;
  private lastTick = -1;
  private lastClosed = -Infinity;
  /** Where news goes instead of a card; without one, news is a card as before. */
  banner: { push(n: Notice): void; readonly pending: number } | null = null;
  /** Whether the banner may show now (not in Photo Mode, not with the interface hidden). */
  canBanner: () => boolean = () => true;
  /** Whether the island is being played (counts towards `minPlay`). */
  playing: () => boolean = () => true;  /** Whether a pop-up may appear now (not mid-drag, not while placing, not in Photo Mode). */
  canShow: () => boolean = () => true;
  /** The player's choice in Settings (see PopupMode). */
  mode: () => PopupMode = () => 'all';
  onShow: () => void = () => {};
  /** Has this kind of pop-up offered to be turned off already? `offered` remembers that it has. */
  wasOffered: (key: string) => boolean = () => true;
  offered: (key: string) => void = () => {};

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
    if (this.banner && newsOnly(item)) {
      const n = toNotice(item);
      if (!this.notices.some((q) => q.title === n.title && q.line === n.line)) this.notices.push(n);
      return;
    }
    this.queue.push(item);
    this.next();
  }

  /** Called every frame or so: show the next pop-up once the player is free, and pass news to the banner. */
  tick(): void {
    const now = performance.now();
    if (this.lastTick >= 0 && this.playing()) this.played += Math.min(now - this.lastTick, 250);
    this.lastTick = now;
    if (!this.open && this.queue.length) this.next();
    // News gathers while a banner is showing, then goes up together in the next one.
    if (this.notices.length && this.banner && !this.banner.pending && this.canBanner()) {
      for (const n of combineNotices(this.notices.splice(0))) this.banner.push(n);
    }
  }

  /** Drop waiting pop-ups that match (a request granted before it was shown, say). */
  forget(match: (d: DialogItem) => boolean): void {
    this.queue = this.queue.filter((d) => !match(d));
  }

  /** May this pop-up show yet? One that waits for play waits, and gives the player a moment after the last. */
  private ready(d: DialogItem): boolean {
    return !d.minPlay || (this.played >= d.minPlay * 1000 && performance.now() - this.lastClosed >= CALM_MS);
  }

  private next(): void {
    if (this.open || !this.queue.length || !this.canShow()) return;
    // Important pop-ups first, in order; then all the waiting news together.
    // Those waiting for play (the daily chest) go after everything else that is ready.
    let first = this.queue.findIndex((d) => !d.news && !d.minPlay);
    if (first < 0) first = this.queue.findIndex((d) => !d.news && this.ready(d));
    let item: DialogItem;
    if (first >= 0) item = this.queue.splice(first, 1)[0];
    else {
      if (!this.queue.some((d) => d.news) || performance.now() - this.lastNews < NEWS_GAP_MS) return;
      this.lastNews = performance.now();
      const news = this.queue.filter((d) => d.news);
      this.queue = this.queue.filter((d) => !d.news);
      item = news.length === 1 ? news[0] : {
        icon: 'info', kicker: 'Village news', title: `${news.length} things happened`, html: true,
        body: `<ul class="gd-news">${news.map((n) => `<li>${ICONS[n.icon]}<span><b>${esc(n.title)}</b>${n.body && !n.html ? `<br>${esc(n.body)}` : ''}</span></li>`).join('')}</ul>`,
      };
    }
    this.show(item);
  }

  private show(d: DialogItem): void {
    this.open = d;
    let actions = d.actions?.length ? d.actions : [{ label: 'OK', primary: true }];
    // The first of its kind: a way to turn them off, and where to turn them back on.
    const offer = d.optOut && !this.wasOffered(d.optOut.key) ? d.optOut : null;
    if (offer) {
      this.offered(offer.key);
      actions = [{ label: offer.label, run: offer.run }, ...actions];
    }
    // The picture: the thing itself (a building), or the event's own picture in its gold ring.
    let pic = '';
    const art = d.art === undefined ? (d.html ? null : artFor(`${d.title} ${d.body ?? ''}`)) : d.art;
    if (d.image) pic = `<div class="gd-pic"><img alt="" src="${d.image}"></div>`;
    else if (art) pic = `<div class="gd-pic gd-art"><img alt="" src="${artSrc(art)}"></div>`;
    this.el.innerHTML = `<div class="gd-card az-plate${pic ? ' has-pic' : ''}${d.html ? ' stack' : ''}${d.icon === 'warn' ? ' warn' : ''}" role="dialog" aria-modal="true" aria-labelledby="gd-title">
      ${AZ_CORNERS}
      <div class="gd-emblem" aria-hidden="true">${AZ_LEAVES}<span class="gd-medal">${ICONS[d.icon]}</span></div>
      ${d.kicker ? `<div class="gd-kicker az-rule"><span>${esc(d.kicker)}</span></div>` : ''}
      <div class="gd-main">
        ${pic}
        <div class="gd-text">
          <div class="gd-title" id="gd-title">${esc(d.title)}</div>
          ${d.body ? `<div class="gd-body">${d.html ? d.body : esc(d.body)}</div>` : ''}
          ${d.benefit ? `<div class="gd-benefit">${esc(d.benefit)}</div>` : ''}
        </div>
      </div>
      ${offer ? '<div class="gd-optout">Don’t want these? You can turn them off here, and change it any time in Settings.</div>' : ''}
      <div class="gd-actions">${actions.map((a, i) => {
        const primary = a.primary || actions.length === 1;
        return `<button type="button" class="gd-btn az-btn${primary ? ' primary' : ''}" data-i="${i}">${!primary ? buttonIcon(a.label) : ''}<span>${esc(a.label)}</span></button>`;
      }).join('')}</div>
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
    this.lastClosed = performance.now();
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
