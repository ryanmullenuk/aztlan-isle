import { COMFORTS, FOOD_KEYS } from '../config';
import { islandMood, MOOD_LABEL, MOOD_WORRIES, moodTips, type IslandMood, type MoodKind } from '../economy/Mood';
import type { Game } from '../Game';
import { MIRACLES, MIRACLE_IDS, miracleThreshold, miracleUnlocked, unlockText, type MiraclePath } from '../economy/Miracles';
import { ICONS, icon } from './icons';

/** Badge colours, as the badges over the islanders' heads. */
const COLOR: Record<MoodKind, string> = {
  sick: '#2f9a6a', hungry: '#d5822c', afraid: '#6c4fb0', tired: '#4d6fb8', cold: '#3d8fc4', wet: '#2e7fb8', homeless: '#a8582e', unhappy: '#8a5a3a', happy: '#d8486a',
};

/** A face for the score: beaming, smiling, flat or frowning. */
function face(score: number): string {
  const mouth = score >= 80 ? 'M7.5 13.5q4.5 4.5 9 0' : score >= 60 ? 'M8 14q4 2.5 8 0' : score >= 40 ? 'M8.5 14.5h7' : 'M8 16q4-3 8 0';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/><path d="${mouth}"/></svg>`;
}

/**
 * The village's mood at a glance, under the clock: a face and a score on the button; opened, how
 * many islanders are hungry, worn out, sick, frightened or homeless, and what would cheer them.
 */
export class MoodPanel {
  readonly button = document.createElement('button');
  readonly panel = document.createElement('section');
  private key = '';

  constructor(private game: Game, beforeOpen: () => void) {
    this.button.className = 'inventory-toggle village-toggle mood-toggle';
    this.button.type = 'button';
    this.button.setAttribute('aria-controls', 'mood-panel');
    this.button.setAttribute('aria-expanded', 'false');
    this.panel.className = 'panel village-priorities mood-panel hidden';
    this.panel.id = 'mood-panel';
    this.panel.setAttribute('aria-label', 'Island mood');
    this.panel.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); this.button.focus(); }
    };
    this.button.onkeydown = (e) => e.stopPropagation();
    this.button.onclick = () => {
      if (!this.panel.classList.contains('hidden')) { this.close(); return; }
      beforeOpen();
      this.key = '';
      this.panel.classList.remove('hidden');
      this.button.setAttribute('aria-expanded', 'true');
      this.sync();
    };
    this.sync();
  }

  close(): void {
    this.panel.classList.add('hidden');
    this.button.setAttribute('aria-expanded', 'false');
  }

  private read(): IslandMood {
    const g = this.game;
    return islandMood(g.colony.list, g.moodWorld());
  }

  /** Refresh the button (and the panel while it is open) when anything shown has changed. */
  sync(): void {
    const g = this.game, m = this.read();
    const open = !this.panel.classList.contains('hidden');
    const dv = g.devotion;
    const key = `${m.score}|${JSON.stringify(m.counts)}|${open}|${g.buildings.list.length}|${g.time.day}|${Math.round(dv.value * 20)}`;
    if (key === this.key) return;
    this.key = key;
    this.button.innerHTML = `<span class="az-ico" aria-hidden="true">${face(m.score)}</span><span class="az-lbl"><span class="az-pre">Mood · </span>${m.total ? `${m.score}% ${m.label}` : '—'}</span><span class="inventory-chevron" aria-hidden="true">⌄</span>`;
    this.button.setAttribute('aria-label', m.total ? `Island mood: ${m.label}, ${m.score} percent` : 'Island mood');
    if (!open) return;
    const rows = MOOD_WORRIES.filter((k) => m.counts[k]).map((k) =>
      `<li><i style="background:${COLOR[k]}"></i><span>${MOOD_LABEL[k]}</span><b>${m.counts[k]}</b></li>`).join('');
    const tips = moodTips(this.facts(m));
    this.panel.innerHTML = `<h2>Island mood</h2>
      <div class="mood-score"><b>${m.score}%</b> ${m.label}</div>
      <div class="nb ${m.score >= 60 ? 'good' : m.score < 40 ? 'low' : ''}"><div style="width:${m.score}%"></div></div>
      <p class="muted small">Happy islanders bring Belief. The badges over their heads show who needs something.</p>
      ${this.devotionHtml()}
      ${rows ? `<ul class="mood-list">${rows}</ul>` : '<p class="small">Nobody needs anything right now.</p>'}
      ${tips.length ? `<h3>To lift spirits</h3><ul class="mood-tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}`;
  }

  /** Fear or love: a meter from Feared to Loved, where the village stands, and what it means. */
  private devotionHtml(): string {
    const d = this.game.devotion, pct = Math.round(Math.abs(d.value) * 100);
    const what = d.fear > 0.05
      ? `They work ${Math.round((d.pace - 1) * 100)}% faster, but are less happy.`
      : d.love > 0.05 ? `They are happier, and bring ${Math.round((d.belief - 1) * 100)}% more Belief.` : 'Neither afraid of you nor devoted.';
    const fill = d.value < 0 ? `right:50%;width:${pct / 2}%` : `left:50%;width:${pct / 2}%`;
    return `<h3>How they see you: ${d.label}</h3>
      <div class="devotion-meter ${d.value < 0 ? 'fear' : 'love'}" role="meter" aria-label="Fear or love" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${Math.round(d.value * 100)}"><i style="${fill}"></i><b></b></div>
      <div class="devotion-ends"><span>Feared</span><span>Loved</span></div>
      <p class="muted small">${what} Smiting and throwing islanders makes them afraid; blessings, rain, calming storms, granted wishes and nights with the ancestors win their love. Either fades slowly.</p>
      ${this.miraclesHtml()}`;
  }

  /** The miracles each path has unlocked (under Power), and what comes next. */
  private miraclesHtml(): string {
    const v = this.game.devotion.value;
    const row = (path: MiraclePath) => {
      const ids = MIRACLE_IDS.filter((id) => MIRACLES[id].path === path);
      const items = ids.map((id) => {
        const on = miracleUnlocked(id, v), d = MIRACLES[id];
        return `<li class="${on ? 'on' : 'off'}" title="${on ? 'Unlocked: under Power (6)' : unlockText(id, v)}"><span class="mi-ic">${on ? icon(d.icon) : ICONS.lock}</span>${d.name}<em>${Math.round(miracleThreshold(d.tier) * 100)}%</em></li>`;
      }).join('');
      const next = ids.find((id) => !miracleUnlocked(id, v));
      const lean = path === 'love' ? v > 0 : v < 0;
      const say = !next ? 'All three are yours.' : lean || next === ids[0] ? `Next: ${MIRACLES[next].name}. ${unlockText(next, v)}` : '';
      return `<div class="mi-path ${path}"><b>${path === 'love' ? 'Miracles of love' : 'Miracles of fear'}</b><ul>${items}</ul>${say ? `<p class="muted small">${say}</p>` : ''}</div>`;
    };
    return `<h3>Miracles</h3>${v < 0 ? row('fear') + row('love') : row('love') + row('fear')}`;
  }

  private facts(m: IslandMood) {
    const g = this.game, b = g.buildings;
    const done = (k: string) => b.list.some((x) => x.key === k && x.complete);
    const wells = b.list.filter((w) => w.key === 'well' && w.complete);
    const r2 = COMFORTS.wellRadius ** 2;
    const homes = b.list.filter((h) => (h.key === 'hut' || h.key === 'home') && h.complete);
    return {
      homeless: m.counts.homeless ?? 0,
      hungry: m.counts.hungry ?? 0,
      sick: m.counts.sick ?? 0,
      hasTemple: done('temple') || done('greattemple'),
      hasGreatTemple: done('greattemple'),
      foodKinds: FOOD_KEYS.filter((k) => g.eco.res[k] > 0).length,
      dryHomes: homes.filter((h) => !wells.some((w) => (w.x - h.x) ** 2 + (w.z - h.z) ** 2 < r2)).length,
      huts: homes.filter((h) => h.key === 'hut').length,
      hasHealer: done('healer'),
    };
  }
}
