import { STAGES, TITLES } from '../economy/Progression';
import { HOUSE_STYLES, isHouseStyle, type HouseStyle } from '../buildings/models';
import { buildingOperational } from '../buildings/BuildingCondition';
import { fireBuildingCard } from './FireBuildingCard';
import { PANEL_ICONS } from './panelIcons';
import { NoticeBanner, type Notice } from './NoticeBanner';
import { animalName } from '../entities/Animals';
import { VillagePrioritiesPanel } from './VillagePrioritiesPanel';
import { MoodPanel } from './MoodPanel';
import { TimeLapseView } from './TimeLapseView';
import { MOOD_LABEL, moodOf } from '../economy/Mood';
import { rareBlock, rareLeft } from '../economy/RareGoods';
import { settingsMarkup, wireSettingsTabs } from './SettingsPanel';
import { serialize } from '../world/Save';
import { islandFile, parseIslandFile, downloadIsland, MAX_ISLAND_FILE_BYTES } from '../world/IslandFile';
import { DEFENCE, DOGS, GOODS, GOOD_KEYS, GoodKey, VOYAGE, FAUNA, PATHS, BUILDINGS, BuildingKey, CAMERA, JETTY, MILESTONES, PresetName, SAVE, SPECIES, WARRIOR, FARM_TYPES, SMOKE, TEST_TOOLS, type FixedTime, STONEMASON, BOAT_WORKSHOP, TRADE, TradeOffer, ResourceKey, FIREWORKS, RARE_GOODS, WONDER_KEYS, WONDERS, isWonder, DECREES, PALACE_RULES, type DecreeKey, RESEARCH, RESEARCH_UPGRADE_LABEL, OBSERVATORY, TIME, DECOR_KEYS } from '../config';
import { MONKEY_BASE } from '../entities/Monkeys';
import { DOG_BASE } from '../entities/Dogs';
import { JAG_BASE } from '../entities/Jaguars';
import type { Game } from '../Game';
import { Building } from '../buildings/Buildings';
import { HALL, HEAL } from '../buildings/models';
import { UPGRADES } from '../buildings/Upgrades';
import { jettyBoats, penRoom, smokeWood } from '../buildings/foodUpgrades';
import { upgraded } from '../buildings/UpgradeEffects';
import { healerBeds, medicineSeconds, towerRange } from '../buildings/SafetyUpgrades';
import { CONDITION_LABEL, ROLE_LABEL, type Islander } from '../entities/Islander';
import { islanderLine } from './islanderLines';
import { ISLAND_TYPES, type IslandType } from '../world/generator';
import { PhotoMode } from './PhotoMode';
import { GameDialog, type PopupMode } from './GameDialog';
import { GOD_NAME, randomIslandName } from '../world/names';
import { Ground } from '../world/World';
import { ICONS, icon } from './icons';
import type { Where } from './where';
import { CARGO_KEYS, CargoKey, haulText, holdValue } from '../entities/Voyage';
import { tradeBoatsAt } from '../entities/Trade';
import { Research } from '../economy/Research';
import { Forecaster } from '../economy/Forecast';
import { BUILD_MENU, GARDEN_TOOLS, PAINT_TOOLS, TERRAIN_TOOLS, TOOLBAR, TOOLS, ToolId } from './tools';
import { GARDEN } from '../vegetation/Garden';

/** A building's price as icons and amounts. */
const costHtml = (c: { wood: number; stone: number; belief: number; carvedStone?: number }) =>
  [c.wood ? `${icon('wood')}${c.wood}` : '', c.stone ? `${icon('stone')}${c.stone}` : '', c.belief ? `${icon('belief')}${c.belief}` : '', c.carvedStone ? `${icon('carvedstone')}${c.carvedStone}` : ''].join('');
import { DAILY_PEARLS, dayKey, rushPearls } from '../economy/DailyChest';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.floor(n)}`);

/** A message as a pop-up: its first sentence as the title (when short), the rest beneath. */
function splitMessage(text: string): { title: string; body?: string } {
  const plain = text.replace(/<[^>]+>/g, '');
  const m = /^(.{8,70}?[.!?])\s+(.+)$/.exec(plain);
  if (m) return { title: m[1].replace(/[.]$/, ''), body: m[2] };
  if (plain.length <= 70) return { title: plain.replace(/[.]$/, '') };
  return { title: plain.slice(0, plain.indexOf(' ', 50) > 0 ? plain.indexOf(' ', 50) : 60) + '…', body: plain };
}

/** Little maps for the island picker. */
const ISLAND_ICONS: Record<IslandType, string> = {
  classic: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#2f8f9a"/><path d="M8 26c2-8 9-13 15-11 4 1 7-3 9 2 1 4-2 9-6 12-6 5-16 6-18-3z" fill="#7fb35a"/><path d="M30 18c4-3 10-1 10 5s-4 10-8 9-5-10-2-14z" fill="#3f7a3a"/><circle cx="16" cy="22" r="3" fill="#e5d39a"/></svg>',
  volcanic: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#2f8f9a"/><path d="M8 26c2-8 9-13 15-11 4 1 7-3 9 2 1 4-2 9-6 12-6 5-16 6-18-3z" fill="#6c6f5e"/><path d="M30 18c4-3 10-1 10 5s-4 10-8 9-5-10-2-14z" fill="#4d4a44"/><path d="M33 24l2-5 2 5z" fill="#e8622a"/><path d="M34 18c-1-3 2-5 1-8" stroke="#9a9a9a" stroke-width="2" fill="none"/></svg>',
  jungle: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#2f8f9a"/><path d="M8 26c2-8 9-13 15-11 4 1 7-3 9 2 1 4-2 9-6 12-6 5-16 6-18-3z" fill="#2f6b30"/><path d="M30 18c4-3 10-1 10 5s-4 10-8 9-5-10-2-14z" fill="#245a28"/><ellipse cx="20" cy="27" rx="4" ry="2.5" fill="#4a5e3a"/><ellipse cx="34" cy="26" rx="3" ry="2" fill="#4a5e3a"/></svg>',
  twin: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#2f8f9a"/><path d="M6 25c1-8 8-12 13-10 4 2 4 9 1 13-4 5-14 5-14-3z" fill="#7fb35a"/><path d="M28 15c6-3 14 1 14 9s-6 13-11 11-9-16-3-20z" fill="#5f9a48"/><path d="M21 24h6" stroke="#e5d39a" stroke-width="2"/></svg>',
  archipelago: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#2f8f9a"/><circle cx="22" cy="24" r="7" fill="#7fb35a"/><circle cx="9" cy="12" r="3.5" fill="#6fa64e"/><circle cx="38" cy="10" r="4" fill="#6fa64e"/><circle cx="40" cy="30" r="3.5" fill="#6fa64e"/><circle cx="10" cy="37" r="4" fill="#6fa64e"/><circle cx="28" cy="40" r="3" fill="#6fa64e"/><circle cx="34" cy="20" r="2.5" fill="#6fa64e"/></svg>',
};

/** Whether the clock's menu (inventory, agenda, objective) is open (remembered per device). */
const HUD_OPEN_KEY = 'aztlan-hud-open';
/** Whether the goal checklist is open (remembered per device). */
const GOALS_OPEN_KEY = 'aztlan-goals-open';

const BUILD_ICON: Record<BuildingKey, string> = {
  boatworkshop: 'b_boatworkshop', market: 'b_market', stonemason: 'b_stonemason', herbalist: 'b_herbalist', herbalgarden: 'b_herbalgarden', firemaker: 'b_firemaker', olmechead: 'b_olmechead', sunstone: 'b_sunstone', skytower: 'b_skytower',
  campfire: 'belief', hut: 'b_hut', home: 'b_home', temple: 'b_temple', greattemple: 'b_greattemple', farm: 'b_farm', butcher: 'b_butcher',
  woodstore: 'b_woodstore', grainstore: 'b_grainstore', warroom: 'b_warroom', jetty: 'b_jetty',
  maizefarm: 'b_maize', chinampa: 'b_chinampa', smokehouse: 'b_smoke',
  tradedock: 'b_trade', torch: 'b_torch', bonfire: 'b_bonfire', firepit: 'b_firepit', well: 'b_well', kennel: 'b_kennel', greathall: 'b_greathall', palace: 'b_palace', observatory: 'b_observatory',
  ceremony: 'b_ceremony', graveyard: 'b_graveyard', pigpen: 'b_pigpen', chickenpen: 'b_chickenpen', healer: 'b_healer', watchtower: 'b_tower', fishhut: 'b_fishhut',
  bannersun: 'b_bannersun', bannereagle: 'b_bannereagle', bannerteal: 'b_bannerteal', pennants: 'b_pennants', featherbanner: 'b_featherbanner', flagstring: 'b_flagstring',
};

interface TutorialStep {
  title: string;
  text: string;
  done: (g: Game) => boolean;
}

/** The whole HTML overlay: HUD, toolbar, menus, info panels, minimap, modals, tutorial and toasts. */
/** Icons for the building placement actions (drawn in the button's colour). */
const PL_ICONS = {
  place: '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19.5 3.5v4.5H15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  snap: '<svg viewBox="0 0 24 24">' + [5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => `<rect x="${x - 2}" y="${y - 2}" width="4" height="4" rx="0.6" fill="currentColor"/>`)).join('') + '</svg>',
  cancel: '<svg viewBox="0 0 24 24"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};
/** How long a building takes: one islander alone, and with its full crew of builders. */
export function buildTimeText(seconds: number, builders: number): string {
  const t = (s: number) => (s >= 90 ? `${Math.round(s / 60 * 10) / 10} min` : `${Math.round(s)} s`);
  return builders > 1 ? `Build time: ${t(seconds)} for one islander, ${t(seconds / builders)} with ${builders}` : `Build time: ${t(seconds)}`;
}
/** Change a placement action's label, leaving its icon. */
const setLabel = (b: HTMLButtonElement, text: string) => {
  const l = b.querySelector('.pl-lbl');
  if (l && l.textContent !== text) l.textContent = text;
};

export class UI {
  private root = document.getElementById('hud')!;
  private tl!: HTMLDivElement;
  private villagePriorities!: VillagePrioritiesPanel;
  private moodPanel!: MoodPanel;
  private moodTimer = 0;
  /** The growth time-lapse viewer. */
  timeLapse!: TimeLapseView;
  private resEls: Record<string, HTMLSpanElement> = {};
  private timeEl!: HTMLDivElement;
  private perfEl!: HTMLDivElement;
  private dateEl!: HTMLDivElement;
  private sunIcon!: HTMLSpanElement;
  private beliefFill!: HTMLDivElement;
  private beliefText!: HTMLSpanElement;
  private toolbar!: HTMLDivElement;
  private slots: HTMLButtonElement[] = [];
  private buildMenu!: HTMLDivElement;
  private info!: HTMLDivElement;
  private toasts!: HTMLDivElement;
  private hint!: HTMLDivElement;
  private placementControls!: HTMLDivElement;
  private placementStatus!: HTMLDivElement;
  private placementPlace!: HTMLButtonElement;
  private placementRotate!: HTMLButtonElement;
  private placementSnap!: HTMLButtonElement;
  private tooltip!: HTMLDivElement;
  private speedBtns: HTMLButtonElement[] = [];
  private pauseBtn!: HTMLButtonElement;
  private settings!: HTMLDivElement;
  private help!: HTMLDivElement;
  private tutorial!: HTMLDivElement;
  private minimap!: HTMLCanvasElement;
  private mapVisible = false;
  private mapWrap!: HTMLDivElement;
  private alertButton!: HTMLButtonElement;
  private alertPanel!: HTMLDivElement;
  private alerts: { text: string; at?: Where; toast?: HTMLElement; key?: string; onView?: () => void; label?: string; noFocus?: boolean }[] = [];
  private miniBase: ImageData | null = null;
  private miniVersion = -1;
  private timer = 0;
  private miniTimer = 0;
  private tutStep = 0;
  private tutStart = { x: 0, z: 0, dist: 0 };
  private infoKey = '';
  private buildItems = new Map<BuildingKey, HTMLButtonElement>();
  private tutSteps: TutorialStep[] = [
    { title: 'Found your village', text: 'Your first two villagers have come ashore. Choose open, flat land for the campfire: your village will grow around it. (Tap Place campfire if you closed the placement.)', done: (g) => g.buildings.hasCampfire },
    { title: 'Look around', text: 'With Move (1), drag with the mouse or one finger to pan the island; WASD and the arrow keys work too. Rotate with Q/E, a middle-drag, or by dragging the compass at the end of the toolbar.', done: (g) => Math.hypot(g.rig.cur.x - this.tutStart.x, g.rig.cur.z - this.tutStart.z) > 8 || Math.abs(g.rig.cur.yaw - g.rig.goal.yaw) > 0.3 },
    { title: 'Zoom in', text: 'Scroll or pinch to zoom in close to your islanders (you can hear them chatter), and out to see the whole island.', done: (g) => Math.abs(g.rig.cur.dist - this.tutStart.dist) > 15 },
    { title: 'Meet your villagers', text: 'Tap an islander near the campfire to see their name, job and needs. More settlers arrive by canoe when you have spare beds and food.', done: (g) => g.selectedIslander >= 0 },
    { title: 'Your village at a glance', text: 'Tap the clock and island name (top left) to open <b>Inventory</b> (what you have), <b>Agenda</b> (what your villagers focus on), <b>Mood</b> (how they feel, and what would cheer them) and <b>Objective</b> (what the village needs for its next title). Tap it again to tuck them away.', done: () => this.hudOpened },
    { title: 'Build a Hut', text: 'Open Build (3), choose a Hut and place it on flat land. Your builders bring the wood and put it up.', done: (g) => g.buildings.list.some((b) => b.key === 'hut' || b.key === 'home') },
    { title: 'Grow food', text: 'Build a Vegetable Farm, or a Fishing Jetty on the shore. Your first harvest or catch moves the village on to the next stage.', done: (g) => g.buildings.list.some((b) => b.key === 'farm' || b.key === 'jetty') },
    { title: 'Clear the ground', text: 'Pick Select (2) and drag over trees and rocks, then choose Clear area. Islanders fell the trees and quarry the rocks, leaving open land to build on.', done: (g) => g.stats.cleared > 0 },
    { title: 'Store your supplies', text: 'Once the first food is in, build a Wood & Stone Store and a Food Store. Full stores keep the village going and unlock skilled buildings.', done: (g) => g.buildings.list.some((b) => b.key === 'woodstore' || b.key === 'grainstore') },
    { title: 'Shape the land', text: 'Open Terrain (4) and pick Raise, Lower or Flatten: hold and drag to make level ground for bigger buildings. Sculpting costs Belief.', done: (g) => g.stats.sculpted > 0 },
  ];

  constructor(private game: Game) {
    this.buildTopLeft();
    this.buildTopRight();
    this.buildBottom();
    this.buildMenuPanel();
    this.info = el('div', 'panel info hidden');
    this.root.appendChild(this.info);
    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);
    this.dialog = new GameDialog(this.root);
    this.dialog.mode = () => this.game.settings.popups ?? 'all';
    // Not while the player is busy: mid-drag, placing, sculpting, in Photo Mode or a cinematic.
    this.dialog.canShow = () => {
      const g = this.game;
      return !this.zen && !this.photo?.open && !g.placing && !g.input?.touching && !g.input?.navigating && !g.wildlifeView?.active
        && g.isPlaying && (this.settings?.classList.contains('hidden') ?? true);
    };
    this.tooltip = el('div', 'tooltip hidden');
    this.root.appendChild(this.tooltip);
    this.buildMinimap();
    this.buildRotate();
    this.buildSettings();
    this.buildHelp();
    this.buildTutorial();
    this.updateIslandName();
    this.refresh(true);
  }

  // ---------------- Construction ----------------

  private nameInput?: HTMLInputElement;
  private isleNameEl!: HTMLDivElement;

  /** Show the island's name on the HUD (and in the settings field). */
  updateIslandName(): void {
    const n = this.game.islandName;
    const stage = this.game.progression?.stage;
    const title = this.game.eco?.godMode || !stage ? '' : TITLES[stage - 1];
    this.isleNameEl.textContent = n.toUpperCase() === 'GODMODE' ? '' : title ? `${n} · ${title}` : n;
    this.isleNameEl.classList.toggle('hidden', !this.isleNameEl.textContent);
    if (this.nameInput && document.activeElement !== this.nameInput) this.nameInput.value = n;
    // God-mode-only settings.
    this.syncGodOptions();
  }

  private godOptionsUnlocked(): boolean {
    return TEST_TOOLS || this.game.islandName.trim().toUpperCase() === GOD_NAME;
  }

  private syncGodOptions(): void {
    const unlocked = this.godOptionsUnlocked();
    this.settings?.querySelectorAll('.godrow').forEach(row => row.classList.toggle('hidden', !unlocked));
    const instant = this.settings?.querySelector<HTMLInputElement>('[data-k="instantBuild"]');
    const sandbox = this.settings?.querySelector<HTMLButtonElement>('[data-a="sandbox"]');
    if (instant) instant.disabled = !unlocked;
    if (sandbox) sandbox.disabled = !unlocked;
    // The testing tools (god mode on this island, a held clock, extra islanders) are never shown in a release.
    this.settings?.querySelectorAll('.testrow').forEach(row => row.classList.toggle('hidden', !TEST_TOOLS));
    const god = this.settings?.querySelector<HTMLInputElement>('[data-t="god"]');
    if (god) god.checked = !!this.game.eco?.godMode;
  }

  private buildTopLeft(): void {
    this.tl = el('div', 'tl');
    const timePanel = el('div', 'panel time-panel');
    this.isleNameEl = el('div', 'islename') as HTMLDivElement;
    timePanel.appendChild(this.isleNameEl);
    const clock = el('div', 'clock');
    this.sunIcon = el('span', 'sunicon', ICONS.sun);
    this.timeEl = el('div', 'time');
    this.dateEl = el('div', 'date');
    this.perfEl = el('div', 'perf');
    const tx = el('div', 'clocktext');
    tx.append(this.timeEl, this.dateEl, this.perfEl);
    clock.append(this.sunIcon, tx);
    timePanel.appendChild(clock);
    // The clock and island name open and close everything else in this corner.
    timePanel.insertAdjacentHTML('beforeend', '<span class="tl-chev" aria-hidden="true">⌄</span>');
    timePanel.setAttribute('role', 'button');
    timePanel.tabIndex = 0;
    timePanel.setAttribute('aria-label', 'Village: inventory, agenda and objective');
    let hudOpen = false;
    try { hudOpen = localStorage.getItem(HUD_OPEN_KEY) === '1'; } catch { /* storage unavailable */ }
    const setOpen = (on: boolean) => {
      this.tl.classList.toggle('tl-collapsed', !on);
      timePanel.setAttribute('aria-expanded', String(on));
      if (on) this.hudOpened = true;
      else { this.closeInventory(); this.villagePriorities?.close(); this.moodPanel?.close(); this.setGoalsOpen(false); }
      try { localStorage.setItem(HUD_OPEN_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
    };
    timePanel.onclick = () => { setOpen(this.tl.classList.contains('tl-collapsed')); this.game.audio?.sfx('click'); };
    timePanel.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); timePanel.click(); } };
    this.tl.classList.toggle('tl-collapsed', !hudOpen);
    timePanel.setAttribute('aria-expanded', String(hudOpen));
    this.tl.appendChild(timePanel);
    const grid = el('div', 'panel resgrid inventory-panel hidden');
    grid.id = 'inventory-panel';
    grid.setAttribute('aria-label', 'Island inventory');
    for (const k of ['people', 'wood', 'stone', 'grain', 'fruit', 'meat', 'fish', 'pearls', 'herbs', 'spices', 'medicine', 'carvedstone', 'gunpowder', 'fireworks']) {
      const r = el('div', 'res', icon(k));
      if (k === 'gunpowder' || k === 'fireworks') r.classList.add('hidden');
      r.title = k === 'people' ? 'Islanders (housed / total)' : k === 'pearls' ? 'Pearls: found on beaches and in fishing catches; worth a lot on a voyage' : k === 'herbs' ? 'Herbs: harvested at Herbal Gardens and delivered for processing into medicine' : k === 'medicine' ? 'Medicine: made by Herbalists; treats patients at Healing Centres' : k === 'spices' ? 'Spices: brought home by voyages; cure the sick and injured at a Healing Centre' : k === 'gunpowder' ? 'Gunpowder: a rare find from voyages, bought for pearls at a Trade Dock; packed into fireworks' : k === 'fireworks' ? 'Fireworks: made at a Firemaker’s Workshop; launch them to celebrate' : k[0].toUpperCase() + k.slice(1);
      const v = el('span', 'v');
      r.appendChild(v);
      this.resEls[k] = v;
      grid.appendChild(r);
    }
    const inventory = el('button', 'inventory-toggle', `<span class="az-ico" aria-hidden="true">${PANEL_ICONS.crate}</span><span class="az-lbl">Inventory</span><span class="inventory-chevron" aria-hidden="true">⌄</span>`);
    inventory.type = 'button';
    inventory.setAttribute('aria-controls', grid.id);
    inventory.setAttribute('aria-expanded', 'false');
    inventory.onclick = () => {
      const open = inventory.getAttribute('aria-expanded') !== 'true';
      inventory.setAttribute('aria-expanded', String(open));
      grid.classList.toggle('hidden', !open);
      if (open) { this.villagePriorities.close(); this.moodPanel.close(); this.setGoalsOpen(false); }
    };
    this.closeInventory = () => { inventory.setAttribute('aria-expanded', 'false'); grid.classList.add('hidden'); };
    this.villagePriorities = new VillagePrioritiesPanel(
      () => this.game.colony.villagePriority,
      value => this.game.colony.setVillagePriority(value),
      () => {
        this.closePopups();
        inventory.setAttribute('aria-expanded', 'false');
        grid.classList.add('hidden');
        this.moodPanel.close();
        this.setGoalsOpen(false);
      });
    this.moodPanel = new MoodPanel(this.game, () => {
      this.closePopups();
      this.closeInventory();
      this.villagePriorities.close();
      this.setGoalsOpen(false);
    });
    this.tl.append(inventory, grid, this.villagePriorities.button, this.villagePriorities.panel, this.moodPanel.button, this.moodPanel.panel);
    // The next village title and what it still needs: a checklist, each building a tap away.
    this.goalToggle = el('button', 'inventory-toggle goal-toggle hidden', '') as HTMLButtonElement;
    this.goalToggle.type = 'button';
    this.goalList = el('div', 'panel goal-list hidden') as HTMLDivElement;
    this.goalList.id = 'goal-list';
    this.goalToggle.setAttribute('aria-controls', this.goalList.id);
    let open = !matchMedia('(max-width: 720px)').matches;
    try { const saved = localStorage.getItem(GOALS_OPEN_KEY); if (saved) open = saved === '1'; } catch { /* storage unavailable */ }
    this.goalsOpen = open;
    this.goalToggle.onclick = () => {
      this.setGoalsOpen(!this.goalsOpen);
      try { localStorage.setItem(GOALS_OPEN_KEY, this.goalsOpen ? '1' : '0'); } catch { /* storage unavailable */ }
      // One list open at a time down the left side.
      if (this.goalsOpen) { this.closeInventory(); this.villagePriorities.close(); this.moodPanel.close(); }
    };
    this.goalList.onclick = (e) => {
      if ((e.target as HTMLElement).closest('[data-wed]')) { this.game.weddings?.grant(); this.game.audio?.sfx('click'); return; }
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-build]');
      if (!item) return;
      const key = item.dataset.build as BuildingKey;
      const reason = this.game.buildings.constructionRequirement(key);
      if (reason) this.toast(reason, 'warn');
      else this.game.startPlacing(key);
    };
    this.tl.append(this.goalToggle, this.goalList);
    this.root.appendChild(this.tl);
  }

  private closeInventory: () => void = () => {};
  /** The tutorial card is on screen. */
  get tutorialOpen(): boolean {
    return !!this.tutorial && !this.tutorial.classList.contains('hidden');
  }

  /** The player has opened the clock's menu at least once (for the tutorial). */
  private hudOpened = false;
  private setGoalsOpen(open: boolean): void {
    if (this.goalsOpen === open) return;
    this.goalsOpen = open;
    this.goalShown = '';
    this.renderGoals();
  }

  private goalToggle!: HTMLButtonElement;
  private goalList!: HTMLDivElement;
  private goalsOpen = true;
  private goalShown = '';

  /** The goal checklist: hidden in sandbox, during the tutorial and once the last title is earned. */
  private renderGoals(): void {
    const g = this.game, p = g.progression, next = p.stage + 1;
    const hide = g.eco.godMode || next > TITLES.length || !this.tutorial.classList.contains('hidden') || this.zen;
    const items = hide ? [] : p.checklist(next).filter((i) => !(i.done && i.text.startsWith('Reach ')));
    const asks = hide ? [] : g.requests?.list ?? [];
    const wed = hide ? null : g.weddings?.wishText ?? null;
    const season = hide ? null : g.seasonGoals?.text ?? null, seasonMet = !!g.seasonGoals?.met;
    const key = hide ? 'hidden' : `${next}|${this.goalsOpen}|${items.map((i) => `${i.done ? 1 : 0}${i.text}`).join('|')}|${asks.map((r) => r.id).join(',')}|${wed}|${season}|${seasonMet}`;
    if (key === this.goalShown) return;
    this.goalShown = key;
    this.goalToggle.classList.toggle('hidden', hide);
    this.goalList.classList.toggle('hidden', hide || !this.goalsOpen);
    if (hide) return;
    const done = items.filter((i) => i.done).length;
    this.goalToggle.setAttribute('aria-expanded', String(this.goalsOpen));
    this.goalToggle.innerHTML = `<span class="az-ico" aria-hidden="true">${PANEL_ICONS.temple}</span><span class="az-lbl">Objective</span><span class="goal-count">${done}/${items.length}</span><span class="inventory-chevron" aria-hidden="true">⌄</span>`;
    this.goalList.innerHTML = `<div class="goal-head">Become a <b>${TITLES[next - 1]}</b> · ${STAGES[next - 1]}</div>` + items.map((i) => {
      const mark = i.done ? '<span class="goal-mark done">✓</span>' : '<span class="goal-mark"></span>';
      return i.build && !i.done
        ? `<button type="button" class="goal-item" data-build="${i.build}">${mark}<span>${i.text}</span><span class="goal-go" aria-hidden="true">›</span></button>`
        : `<div class="goal-item${i.done ? ' done' : ''}">${mark}<span>${i.text}</span></div>`;
    }).join('') + (season ? `<div class="goal-head goal-asks">This season</div><div class="goal-item${seasonMet ? ' done' : ''}"><span class="goal-mark${seasonMet ? ' done' : ''}">${seasonMet ? '✓' : ''}</span><span>${season}</span></div>` : '') +
      (asks.length || wed ? `<div class="goal-head goal-asks">Requests</div>` : '') +
      (wed ? `<button type="button" class="goal-item ask" data-wed="1"><span class="goal-mark ask">♥</span><span>${wed}: tap to grant the wedding</span><span class="goal-go" aria-hidden="true">›</span></button>` : '') +
      asks.map((r) =>
      `<button type="button" class="goal-item ask" data-build="${r.key}"><span class="goal-mark ask">!</span><span>${r.text}</span><span class="goal-go" aria-hidden="true">›</span></button>`).join('');
  }

  private buildTopRight(): void {
    const tr = el('div', 'panel tr');
    this.pauseBtn = el('button', 'ib', ICONS.pause);
    this.pauseBtn.title = 'Pause (Space)';
    this.pauseBtn.onclick = () => this.game.togglePause();

    // Fast forward: opens the 1× / 2× / 3× choice.
    this.speedBtn = el('button', 'ib ff', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="10" r="7"/><path d="M12 5v5l3 2"/></svg><span class="ff-x"></span>');
    this.speedBtn.title = 'Time: play, pause and speed';
    this.speedBtn.setAttribute('aria-label', 'Time controls');
    this.speedPop = el('div', 'panel popup speed-pop hidden');
    this.speedPop.appendChild(this.pauseBtn);
    for (const s of [1, 2, 3]) {
      const b = el('button', 'ib sp', `${s}×`);
      b.title = `Speed ${s}×`;
      b.onclick = () => {
        this.game.setSpeed(s);
        this.closePopups();
      };
      this.speedBtns.push(b);
      this.speedPop.appendChild(b);
    }
    this.speedBtn.onclick = () => this.openPopup(this.speedPop, this.speedBtn, 'below');
    tr.appendChild(this.speedBtn);
    this.root.appendChild(this.speedPop);
    const gear = el('button', 'ib', ICONS.gear);
    gear.title = 'Settings';
    gear.onclick = () => this.toggle(this.settings);
    const over = el('button', 'ib', ICONS.island);
    over.title = 'See the whole map from above (O) · again to go back';
    over.onclick = () => this.game.rig.toggleOverview();
    const camera = el('button', 'ib', ICONS.camera);
    camera.title = 'Photo Mode: frame and capture a picture of your island';
    camera.setAttribute('aria-label', 'Photo Mode');
    camera.onclick = () => this.photo.enter();
    const eye = el('button', 'ib', ICONS.eye);
    eye.title = 'Hide the interface: just the island (V)';
    eye.onclick = () => this.toggleZen(true);
    const explore = el('button', 'ib', ICONS.person);
    explore.title = 'Explore at islander eye level';
    explore.setAttribute('aria-label', 'Explore island');
    explore.onclick = () => this.game.toggleExplore();
    const wildlife = el('button', 'ib wildlife-button', ICONS.wildlife);
    wildlife.title = 'Follow a random creature in cinematic mode';
    wildlife.setAttribute('aria-label', 'Watch wildlife');
    wildlife.onclick = () => this.game.toggleWildlife();
    const views = el('div', 'view-controls');
    this.alertButton = el('button', 'ib alert-button', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v9"/><circle cx="12" cy="19" r="1"/></svg>');
    this.alertButton.setAttribute('aria-label', 'Alerts: none');
    this.alertButton.setAttribute('aria-expanded', 'false');
    this.alertButton.setAttribute('aria-controls', 'island-alerts');
    this.alertPanel = el('div', 'panel alert-panel hidden');
    this.alertPanel.id = 'island-alerts';
    this.alertPanel.setAttribute('aria-label', 'Island alerts');
    this.alertButton.onclick = () => {
      this.renderAlerts();
      const open = this.alertPanel.classList.contains('hidden');
      this.alertPanel.classList.toggle('hidden', !open);
      this.alertButton.setAttribute('aria-expanded', String(open));
    };
    this.root.appendChild(this.alertPanel);
    views.append(camera, eye, explore, wildlife, this.alertButton);
    tr.append(over, gear, views);
    this.root.appendChild(tr);
    // Shown on its own while the interface is hidden: brings everything back.
    this.zenBtn = el('button', 'ib zen-eye', ICONS.eye);
    this.zenBtn.title = 'Show the interface again (V)';
    this.zenBtn.onclick = () => this.toggleZen(false);
    this.root.appendChild(this.zenBtn);
    this.photo = new PhotoMode(this.game, this.root, (text, kind) => this.toast(text, kind));
    this.timeLapse = new TimeLapseView(this.root, () => this.game.islandName, (text, kind) => this.toast(text, kind));
  }

  /** Photo Mode's toolbar and state. */
  photo!: PhotoMode;

  private zenBtn!: HTMLButtonElement;
  /** Natural mode: every button, panel, hint and notification hidden but the one eye. */
  zen = false;
  /** Pop-ups in the middle of the screen (see GameDialog). */
  dialog!: GameDialog;
  /** Announce something in the banner (not while the interface is hidden). */
  notice(n: Notice): void {
    if (this.zen || this.photo?.open) return;
    this.dialog.push({
      icon: n.important ? 'star' : 'tick', kicker: n.kicker ?? (n.important ? 'Milestone' : 'Complete'), title: n.title, body: n.line,
      benefit: n.benefit, image: n.image, news: !n.important, important: n.important,
    });
  }

  toggleZen(on = !this.zen): void {
    this.zen = on;
    this.root.classList.toggle('zen', on);
    this.tooltip.classList.add('hidden');
    if (on) this.toasts.replaceChildren();
    this.game.audio?.sfx('click');
  }

  private speedBtn!: HTMLButtonElement;
  private speedPop!: HTMLDivElement;
  private terrainSlot!: HTMLButtonElement;
  private terrainPop!: HTMLDivElement;
  private terrainItems: HTMLButtonElement[] = [];
  private floraSlot!: HTMLButtonElement;
  private floraPop!: HTMLDivElement;
  private blessingPop!: HTMLDivElement;
  private blessingSlot!: HTMLButtonElement;
  private floraItems: HTMLButtonElement[] = [];

  /** Show a small popup menu next to the button that opened it (toggles if already open). */
  private openPopup(pop: HTMLElement, from: HTMLElement, side: 'above' | 'below'): void {
    const wasOpen = !pop.classList.contains('hidden');
    this.closePopups();
    if (wasOpen) return;
    this.game.audio?.sfx('click');
    pop.classList.remove('hidden');
    const r = from.getBoundingClientRect();
    pop.style.left = pop.style.right = pop.style.top = pop.style.bottom = '';
    if (side === 'above') {
      pop.style.left = `${r.left + r.width / 2}px`;
      pop.style.bottom = `${innerHeight - r.top + 10}px`;
      pop.style.transform = 'translateX(-50%)';
    } else if (getComputedStyle(from.parentElement!).flexDirection === 'column') {
      // Phones: the top-right buttons run down the edge, so open to their left.
      pop.style.top = `${r.top}px`;
      pop.style.right = `${innerWidth - r.left + 8}px`;
      pop.style.transform = '';
    } else {
      pop.style.top = `${r.bottom + 8}px`;
      pop.style.left = `${r.left + r.width / 2}px`;
      pop.style.transform = 'translateX(-50%)';
    }
  }

  closePopups(): boolean {
    let closed = this.villagePriorities?.close() ?? false;
    for (const p of [this.speedPop, this.terrainPop, this.floraPop, this.blessingPop]) {
      if (p && !p.classList.contains('hidden')) {
        p.classList.add('hidden');
        closed = true;
      }
    }
    this.blessingSlot?.setAttribute('aria-expanded', 'false');
    return closed;
  }

  /** The Terrain slot's popup: Raise, Lower, Flatten (number key 3 too). */
  toggleTerrain(): void {
    this.openPopup(this.terrainPop, this.terrainSlot, 'above');
  }

  /** The Flora slot's popup: Flowers, Bushes, Shrubs & ferns, Trees, Dig up plants (number key 4 too). */
  toggleFlora(): void {
    this.openPopup(this.floraPop, this.floraSlot, 'above');
  }

  toggleBlessings(): void {
    this.openPopup(this.blessingPop, this.blessingSlot, 'above');
    this.blessingSlot.setAttribute('aria-expanded', String(!this.blessingPop.classList.contains('hidden')));
  }

  private buildBottom(): void {
    const bottom = el('div', 'bottom');
    this.hint = el('div', 'hint hidden');
    this.placementControls=el('div','placement-controls hidden');
    this.placementStatus = el('div', 'placement-status');
    this.placementStatus.setAttribute('role', 'status');
    this.placementStatus.setAttribute('aria-live', 'polite');
    // Each action: its icon and a label (only the label changes, e.g. Place / Move here).
    const action = (svg: string, label: string) => el('button', 'btn pl-btn', `<span class="pl-ico">${svg}</span><span class="pl-lbl">${label}</span>`) as HTMLButtonElement;
    this.placementPlace = action(PL_ICONS.place, 'Place');
    this.placementRotate = action(PL_ICONS.rotate, 'Rotate 90°');
    this.placementSnap = action(PL_ICONS.snap, 'Snap: On');
    const place = this.placementPlace, rotate = this.placementRotate, cancel = action(PL_ICONS.cancel, 'Cancel');
    this.placementSnap.title = 'Snap to suitable ground within one square; grid alignment stays on';
    this.placementSnap.onclick = () => this.game.togglePlacementSnap();
    place.onclick=()=>this.game.confirmPlacement();rotate.onclick=()=>this.game.rotatePlacement();cancel.onclick=()=>this.game.cancelPlacement();
    const actions = el('div', 'placement-actions');
    actions.append(place, rotate, this.placementSnap, cancel);
    // What the coloured squares under the building mean.
    const legend = el('div', 'placement-legend', [['ok', 'Valid position'], ['grow', 'Expansion'], ['walk', 'Walkway'], ['bad', 'Blocked']]
      .map(([k, t]) => `<span class="pl-key"><i class="pl-sw ${k}"></i>${t}</span>`).join(''));
    this.placementControls.append(this.placementStatus, legend, actions);
    bottom.appendChild(this.placementControls);
    // Shown until the village is founded, in case the campfire placement is closed.
    this.foundBtn = el('button', 'btn found-btn hidden', `${ICONS.belief} Place campfire`) as HTMLButtonElement;
    this.foundBtn.onclick = () => this.game.promptCampfire();
    bottom.appendChild(this.foundBtn);
    // While following someone: who, and an obvious way to stop.
    this.followPill = el('button', 'btn follow-pill hidden') as HTMLButtonElement;
    this.followPill.onclick = () => this.game.follow(-1);
    bottom.appendChild(this.followPill);
    const bb = el('div', 'beliefbar');
    bb.title = 'Belief: earned from happy islanders and temples, spent on god powers';
    bb.innerHTML = `<span class="bicon">${ICONS.belief}</span>`;
    const track = el('div', 'track');
    this.beliefFill = el('div', 'fill');
    track.appendChild(this.beliefFill);
    this.beliefText = el('span', 'btext');
    bb.append(track, this.beliefText);
    this.toolbar = el('div', 'toolbar');
    TOOLBAR.forEach((t, i) => {
      const b = el('button', 'slot', `<span class="key">${i + 1}</span>${icon(t.icon)}<span class="nm">${t.name}</span>${t.cost ? `<span class="cost">${icon('belief')}${t.cost}</span>` : '<span class="cost"></span>'}`);
      const id = t.id;
      if (id === 'terrain') {
        this.terrainSlot = b;
        b.onclick = () => this.toggleTerrain();
      } else if (id === 'flora') {
        this.floraSlot = b;
        b.onclick = () => this.toggleFlora();
      } else if (id === 'blessings') {
        this.blessingSlot = b;
        b.setAttribute('aria-expanded', 'false');
        b.onclick = () => this.toggleBlessings();
      } else b.onclick = () => {
        this.closePopups();
        this.game.setTool(id as ToolId);
      };
      this.addTip(b, `<b>${t.name}</b> <span class="kbd">${i + 1}</span><br>${t.hint}${t.cost ? `<br><span class="c">${icon('belief')} ${t.cost}${id === 'terrain' ? ' per cell' : ''}</span>` : ''}`);
      this.slots.push(b);
      this.toolbar.appendChild(b);
    });
    // Terrain: a vertical popup of the three sculpt tools.
    this.terrainPop = el('div', 'panel popup terrain-pop hidden');
    for (const id of TERRAIN_TOOLS) {
      const t = TOOLS.find((x) => x.id === id)!;
      const b = el('button', 'tp-item', `${icon(t.icon)}<span class="nm">${t.name}</span><span class="cost">${icon('belief')}${t.cost ?? ''}</span>`) as HTMLButtonElement;
      b.dataset.tool = id;
      b.onclick = () => {
        this.closePopups();
        if (this.game.tool !== id) this.game.setTool(id);
      };
      this.addTip(b, `<b>${t.name}</b><br>${t.hint}<br><span class="c">${icon('belief')} ${t.cost} per cell</span>`);
      this.terrainItems.push(b);
      this.terrainPop.appendChild(b);
    }
    this.root.appendChild(this.terrainPop);
    // Flora: the planting brushes, the same way.
    this.floraPop = el('div', 'panel popup terrain-pop flora-pop hidden');
    const flora: { id: ToolId; name: string; ic: string; cost: string; tip: string }[] = [
      { id: 'flowers', name: 'Flowers', ic: 'b_flowers', cost: 'Free', tip: '<b>Plant flowers</b><br>Hold and drag to plant garden flowers: red, yellow, orange, purple, pink, white, blue and orchids. Each stroke favours one or two colours, so beds grow in drifts. They pop up as you go.' },
      { id: 'bushes', name: 'Bushes', ic: 'b_bushes', cost: 'Free', tip: '<b>Plant bushes</b><br>Hold and drag to plant small bushes: green, hibiscus, bougainvillea, golden allamanda and white gardenia.' },
      { id: 'shrubs', name: 'Shrubs & ferns', ic: 'b_shrubs', cost: 'Free', tip: '<b>Plant shrubs and ferns</b><br>Hold and drag to plant ferns, broad-leaved tropical plants, colourful crotons, agaves and feathery grasses.' },
      { id: 'trees', name: 'Trees', ic: 'b_trees', cost: `${icon('belief')}${GARDEN.treeCost}`, tip: `<b>Plant trees</b><br>Hold and drag to plant real trees that spring up out of the ground: palms, jungle and meadow trees, and orange and banana trees. Woodcutters can fell them for wood (they regrow from the stump), and fruit trees feed your gatherers. Palms grow on the beach.<br><span class="c">${icon('belief')} ${GARDEN.treeCost} Belief per tree</span>` },
      { id: 'unplant', name: 'Dig up plants', ic: 'b_unplant', cost: '', tip: '<b>Dig up plants</b><br>Hold and drag over garden plants, or trees you planted, to dig them up.' },
    ];
    for (const f of flora) {
      const b = el('button', 'tp-item', `${icon(f.ic)}<span class="nm">${f.name}</span><span class="cost">${f.cost}</span>`) as HTMLButtonElement;
      b.dataset.tool = f.id;
      b.onclick = () => {
        this.closePopups();
        if (this.game.tool !== f.id) this.game.setTool(f.id);
      };
      this.addTip(b, f.tip);
      this.floraItems.push(b);
      this.floraPop.appendChild(b);
    }
    this.root.appendChild(this.floraPop);
    this.blessingPop = el('div', 'panel popup terrain-pop hidden');
    for (const id of ['bless', 'rain', 'calm'] as ToolId[]) {
      const t = TOOLS.find(t => t.id === id)!;
      const b = el('button', 'tp-item', `${icon(t.icon)}<span class="nm">${t.name}</span><span class="cost">${icon('belief')}${t.cost}</span>`);
      b.dataset.tool = id;
      b.onclick = () => { this.closePopups(); this.game.setTool(id); };
      this.addTip(b, t.hint);
      this.blessingPop.appendChild(b);
    }
    this.root.appendChild(this.blessingPop);
    // Tapping anywhere else closes an open popup.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if ([this.villagePriorities?.panel, this.villagePriorities?.button, this.speedPop, this.terrainPop, this.floraPop, this.blessingPop, this.speedBtn, this.terrainSlot, this.floraSlot, this.blessingSlot].some((el2) => el2?.contains(t))) return;
      this.closePopups();
    }, true);
    // The belief bar sits under the toolbar.
    bottom.append(this.hint, this.toolbar, bb);
    this.root.appendChild(bottom);
  }

  private buildMenuPanel(): void {
    this.buildMenu = el('div', 'panel buildmenu hidden');
    const head = el('div', 'bm-head', '<span>Build</span>');
    const x = el('button', 'ib small', ICONS.close);
    x.onclick = () => this.game.setTool('select');
    head.appendChild(x);
    this.buildMenu.appendChild(head);
    const goals=el('p','muted small');goals.dataset.progression='';this.buildMenu.appendChild(goals);
    const grid = el('div', 'bm-grid');
    const buildItem = (key: BuildingKey) => {
      const def = BUILDINGS[key];
      const cost = costHtml(def.cost);
      const b = el('button', 'bm-item', `<span class="bm-ic">${ICONS[BUILD_ICON[key]]}</span><span class="bm-nm">${def.name}</span><span class="bm-cost">${cost}</span>`);
      b.setAttribute('aria-label', def.name);
      if (key === 'herbalgarden' || key === 'herbalist') {
        const purpose = el('span', 'bm-purpose');
        purpose.textContent = key === 'herbalgarden' ? 'Grow herbs' : 'Make medicine';
        b.querySelector('.bm-nm')?.after(purpose);
      }
      b.onclick = () => {
        const reason = this.game.buildings.constructionRequirement(key);
        if (reason) this.toast(reason, 'warn');
        else this.game.startPlacing(key);
      };
      this.addTip(b, `<b>${def.name}</b><br>${def.description}<br><span class="c">${cost || 'Free'} · ${def.size[0]}×${def.size[1]}</span><br><span class="muted">${buildTimeText(def.buildTime, def.builders)}</span>`);
      grid.appendChild(b);
      this.buildItems.set(key, b);
    };
    BUILD_MENU.forEach(buildItem);
    // Paths: drag-to-paint tools rather than a building.
    const pathItem = (id: ToolId, name: string, iconKey: string, cost: string, tip: string) => {
      const b = el('button', 'bm-item', `<span class="bm-ic">${ICONS[iconKey]}</span><span class="bm-nm">${name}</span><span class="bm-cost">${cost}</span>`);
      b.onclick = () => this.game.setTool(id);
      this.addTip(b, tip);
      grid.appendChild(b);
    };
    pathItem('path', 'Stone path', 'b_path', `${icon('stone')}${PATHS.stonePerCell}`, `<b>Stone path</b><br>Hold and drag to lay a paved path. Islanders prefer paths and walk faster on them.<br><span class="c">${icon('stone')} ${PATHS.stonePerCell} per cell</span>`);
    pathItem('dirtpath', 'Dirt path', 'b_dirtpath', 'Free', '<b>Dirt path</b><br>Hold and drag to tread a simple earth track. Free, and islanders walk a little faster on it (a stone path is faster). Lay stone over it later to pave it.');
    pathItem('canal', 'Water canal', 'b_canal', `${icon('wood')}${PATHS.canalWood}`, `<b>Water canal</b><br>Hold and drag outward from a river, pool or the sea to dig a channel and bring water into the village. Chinampas can be built beside canals.<br><span class="c">${icon('wood')} ${PATHS.canalWood} per section</span>`);
    pathItem('bridge', 'Rope bridge', 'b_bridge', `${icon('wood')}${PATHS.bridgeWood}`, `<b>Rope bridge</b><br>Hold and drag from the shore across shallow water, like the strait to the wild island, to build a plank bridge islanders can cross.<br><span class="c">${icon('wood')} ${PATHS.bridgeWood} per section</span>`);
    pathItem('unpath', 'Remove path', 'b_unpath', '', '<b>Remove path, bridge or canal</b><br>Hold and drag over a path, bridge or canal to take it away (canals are filled back in).');
    pathItem('regrass', 'Restore grass', 'b_regrass', 'Free', '<b>Restore grass</b><br>Hold and drag over bare, trodden earth or old dirt tracks to grow the grass back. Stone paths stay (use Remove path for those).');
    // Banners and flags to dress the village.
    // Wonders: rare late monuments, one of each.
    grid.appendChild(el('div', 'bm-section', 'Wonders'));
    WONDER_KEYS.forEach(buildItem);
    grid.appendChild(el('div', 'bm-section', 'Decorations'));
    DECOR_KEYS.forEach(buildItem);
    this.buildMenu.appendChild(grid);
    this.root.appendChild(this.buildMenu);
    // Drop the bottom fade once scrolled to the end (or when everything fits).
    const edge = () => grid.classList.toggle('end', grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 4);
    grid.addEventListener('scroll', edge, { passive: true });
    new ResizeObserver(edge).observe(grid);
  }

  private buildMinimap(): void {
    const wrap = this.mapWrap = el('div', 'panel minimap');
    wrap.classList.toggle('hidden', !this.game.settings.showMap);
    const toggle = el('button', 'map-toggle', 'MAP');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'island-minimap');
    wrap.appendChild(toggle);
    this.minimap = el('canvas', 'hidden');
    this.minimap.id = 'island-minimap';
    toggle.onclick = () => {
      this.mapVisible = !this.mapVisible;
      this.minimap.classList.toggle('hidden', !this.mapVisible);
      toggle.setAttribute('aria-expanded', String(this.mapVisible));
      this.pruneAlerts();
      if (this.mapVisible) this.drawMinimap();
    };
    this.minimap.width = this.minimap.height = 168;
    wrap.appendChild(this.minimap);
    const go = (e: PointerEvent) => {
      const r = this.minimap.getBoundingClientRect();
      const w = this.game.world;
      const x = ((e.clientX - r.left) / r.width) * w.N - w.half;
      const z = ((e.clientY - r.top) / r.height) * w.N - w.half;
      this.game.rig.goal.x = x;
      this.game.rig.goal.z = z;
      this.game.followId = -1;
    };
    this.minimap.addEventListener('pointerdown', (e) => {
      go(e);
      const mv = (ev: PointerEvent) => go(ev);
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
    this.root.appendChild(wrap);
  }

  private compassNeedle!: HTMLSpanElement;

  /** Rotate control: the compass at the end of the toolbar. Drag it left/right (mouse or finger) to turn the view; double-tap resets. Q / E still turn it too. */
  private buildRotate(): void {
    const dial = el('button', 'slot compass-slot dial');
    dial.title = 'Drag to rotate the view · double-tap to reset';
    dial.setAttribute('aria-label', 'Compass: drag to rotate the view, double-tap to reset');
    this.compassNeedle = el('span', 'needle', ICONS.compass);
    dial.appendChild(this.compassNeedle);
    this.toolbar.appendChild(dial);
    let lastX = 0, dragging = false, lastTap = 0;
    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        dial.setPointerCapture(e.pointerId);
      } catch {
        /* optional */
      }
      dragging = true;
      lastX = e.clientX;
      const now = performance.now();
      if (now - lastTap < 320) this.game.resetRotation();
      lastTap = now;
    });
    dial.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.game.rig.rotate(-(e.clientX - lastX) * CAMERA.dragRotateSpeed * 1.4);
      lastX = e.clientX;
    });
    const end = () => (dragging = false);
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);
  }

  private buildSettings(): void {
    this.settings = el('div', 'modal settings-modal hidden');
    this.settings.setAttribute('role', 'dialog');
    this.settings.setAttribute('aria-modal', 'true');
    this.settings.setAttribute('aria-labelledby', 'settings-title');
    const s = this.game.settings;
    const card = el('div', 'settings-card', settingsMarkup());
    wireSettingsTabs(card);
    for (const action of ['close', 'return']) card.querySelector<HTMLButtonElement>(`[data-a="${action}"]`)!.onclick = () => this.toggle(this.settings, false);
    card.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.toggle(this.settings, false); }
      if (e.key === 'Tab') {
        const controls = [...card.querySelectorAll<HTMLElement>('button, input, select, summary')].filter(node =>
          !node.closest('[hidden], .hidden') && !(node as HTMLInputElement).disabled && node.tabIndex >= 0 &&
          !node.closest('details:not([open]) .settings-details'));
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    });
    const sel = card.querySelector('select[data-k="preset"]') as HTMLSelectElement;
    sel.value = s.preset;
    sel.onchange = () => {
      s.preset = sel.value as PresetName;
      s.autoQuality = false;
      // Choosing graphics yourself gives back full resolution.
      s.renderScale = 1;
      this.game.applySettings();
      this.syncSettingsControls();
    };
    this.presetSelect = sel;
    const popups = card.querySelector<HTMLSelectElement>('[data-n="popups"]');
    if (popups) {
      popups.value = s.popups ?? 'all';
      popups.onchange = () => { s.popups = popups.value as PopupMode; this.game.applySettings(); };
    }
    // Island name: typed, or rolled from Nahuatl place-name roots.
    const nameIn = card.querySelector<HTMLInputElement>('[data-n="name"]')!;
    nameIn.value = this.game.islandName;
    const applyName = (v: string) => {
      const r = this.game.setIslandName(v);
      if (r.god && r.changed) this.toast('The gods smile upon this island.');
      this.updateIslandName();
    };
    nameIn.onchange = () => applyName(nameIn.value);
    nameIn.onkeydown = (e) => {
      if (e.key === 'Enter') nameIn.blur();
    };
    card.querySelector<HTMLButtonElement>('[data-a="rename"]')!.onclick = () => {
      nameIn.value = randomIslandName();
      applyName(nameIn.value);
    };
    this.nameInput = nameIn;
    card.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) => {
      const k = inp.dataset.k as keyof typeof s;
      if (inp.type === 'checkbox') inp.checked = inp.dataset.invert ? !s[k] : !!s[k];
      else inp.value = String(s[k]);
      inp.oninput = () => {
        (s as unknown as Record<string, unknown>)[k] = inp.type === 'checkbox' ? (inp.dataset.invert ? !inp.checked : inp.checked) : parseFloat(inp.value);
        this.game.applySettings();
        this.syncSettingsControls();
        if (k === 'showMap') {
          this.mapWrap.classList.toggle('hidden', !s.showMap);
          if (!s.showMap) {
            this.mapVisible = false;
            this.minimap.classList.add('hidden');
            this.mapWrap.querySelector('button')!.setAttribute('aria-expanded', 'false');
          }
        }
      };
    });
    // Testing tools.
    card.querySelector<HTMLInputElement>('[data-t="god"]')!.onchange = (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.game.setGodMode(on);
      this.toast(on ? 'God mode on: unlimited resources.' : 'God mode off.');
    };
    const timeSel = card.querySelector<HTMLSelectElement>('[data-t="time"]')!;
    timeSel.value = s.fixedTime ?? '';
    timeSel.onchange = () => {
      s.fixedTime = timeSel.value as FixedTime | '';
      this.game.applySettings();
    };
    const count = card.querySelector<HTMLInputElement>('[data-t="count"]')!;
    card.querySelector<HTMLButtonElement>('[data-t="add"]')!.onclick = () => {
      const n = this.game.addTestIslanders(Math.min(100, parseInt(count.value, 10) || 0));
      this.toast(n ? `${n} islander${n === 1 ? '' : 's'} added.` : 'The island is full.');
    };
    card.querySelector<HTMLButtonElement>('[data-a="new"]')!.onclick = () => this.chooseIsland(false);
    card.querySelector<HTMLButtonElement>('[data-a="sandbox"]')!.onclick = () => {
      if (!this.godOptionsUnlocked()) return;
      this.chooseIsland(true);
    };
    card.querySelector<HTMLButtonElement>('[data-a="save"]')!.onclick = () => {
      this.game.save();
      this.toast('Island saved.');
    };
    card.querySelector<HTMLButtonElement>('[data-a="copy"]')!.onclick = async () => {
      try {
        const file = islandFile(serialize(this.game));
        // In the iPhone, iPad and Mac apps the app itself shares or saves the file.
        const native = (window as unknown as { webkit?: { messageHandlers?: { islandFile?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers?.islandFile;
        if (native) {
          native.postMessage({ name: file.name, text: await file.text() });
          return;
        }
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: this.game.islandName });
            return;
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') return;
          }
        }
        downloadIsland(file);
        this.toast('Island copy downloaded. Share the file, then open it with Load Island.');
      } catch {
        this.toast('Could not create an island copy. Please try again.');
      }
    };
    const fileInput = card.querySelector<HTMLInputElement>('[data-a="island-file"]')!;
    card.querySelector<HTMLButtonElement>('[data-a="load"]')!.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        if (file.size > MAX_ISLAND_FILE_BYTES) throw new Error('Island file is too large.');
        const save = parseIslandFile(await file.text());
        if (!confirm(`Load ${save.name || 'this island'}? This replaces your current island. Use Copy Island first if you want to keep it.`)) return;
        this.game.importIsland(save);
      } catch (e) {
        this.toast(e instanceof Error && !(e instanceof SyntaxError) ? e.message : 'This file is not a valid island save.');
      }
    };
    card.querySelector<HTMLButtonElement>('[data-a="help"]')!.onclick = () => {
      this.toggle(this.settings, false);
      this.toggle(this.help, true);
    };
    card.querySelector<HTMLButtonElement>('[data-a="tutorial"]')!.onclick = () => {
      this.toggle(this.settings, false);
      this.startTutorial(true);
    };
    this.settings.appendChild(card);
    this.syncSettingsControls();
    this.settings.onclick = (e) => {
      if (e.target === this.settings) this.toggle(this.settings, false);
    };
    this.root.appendChild(this.settings);
  }

  private buildHelp(): void {
    this.help = el('div', 'modal hidden');
    const card = el('div', 'panel card help');
    card.innerHTML = `
      <div class="card-head"><span>How to play</span></div>
      <p>Guide your Aztec tribe as they settle the island. Keep them fed, housed and happy: happy islanders and temples create <b>Belief</b>, which pays for your god powers. Grow from a camp into the Capital of the Isle.</p>
      <div class="cols">
        <div><h4>Desktop</h4><ul>
          <li><b>Drag</b> (left or right) or <b>WASD</b>: pan</li>
          <li><b>Scroll</b>: zoom · <b>Q / E</b>, <b>middle-drag</b> or <b>Alt/Shift + drag</b>: rotate</li>
          <li>Or drag the <b>compass</b> at the end of the toolbar (double-click resets)</li>
          <li><b>Click</b>: select or place · <b>R</b>: rotate a building</li>
          <li><b>Hold and drag</b> with a Terrain tool: sculpt</li>
          <li><b>1–7</b>: toolbar · <b>Space</b>: pause · <b>Esc</b>: cancel</li>
        </ul></div>
        <div><h4>Touch</h4><ul>
          <li><b>One finger</b>: pan (or sculpt with a sculpt tool)</li>
          <li><b>Pinch</b>: zoom · <b>Twist</b> with two fingers: rotate</li>
          <li>Drag the <b>compass</b> at the end of the toolbar with one finger to rotate (double-tap resets)</li>
          <li><b>Tap</b>: select or place</li>
        </ul></div>
      </div>
      <h4>Your village</h4><ul>
        <li>Light the <b>tribal fire</b> where your first two islanders land: a husband and wife. The <b>Objective</b> list (top left) shows what earns the next title, from Camp to <b>Capital of the Isle</b>; each title unlocks new buildings.</li>
        <li><b>Titles come in order, and take time:</b> food first (Village), then health (Large Village: Well, Herbalist, Healing Centre), then the town’s halls (Town: Market, Great Hall, Watchtower), and only then worship (Temple Town: the <b>Temple</b>). From the Village on, a settlement must also settle in for a day or more at each title before it earns the next.</li>
        <li><b>Building costs rise:</b> after the first couple of each kind (a few more for huts, homes and farms), each further one costs a little more. Your builders can only work on a few buildings at once: two to start, one more for every six islanders.</li>
        <li>Buildings need flat land (flatten it with the Terrain tools). A <b>Stonemason’s Workshop</b> turns stone into <b>carved stone</b>, which every stone building needs; its upgrades unlock Temples, the Great Pyramid and the Great Temple.</li>
        <li><b>Upgrades:</b> most buildings can be improved up to three times from their card (more jobs, more storage, faster work, happier islanders). The first upgrade is open from the start, the second from Healthy village, the third from Community. A carved marker by an upgraded building shows a gold disc for each upgrade.</li>
        <li>Idle islanders help build by day without being asked. Select an islander, then tap a building, tree, rock or fruit bush to give them that job; they keep to it.</li>
        <li>Stores hold your wood, stone and food. Felled trees lie where they fall until all their wood is carried home, then regrow from the stump. Plant more with <b>Flora → Trees</b>.</li>
        <li>New settlers arrive by canoe when there are spare beds and food. The island holds up to 100 adults.</li>
      </ul>
      <h4>Islanders and families</h4><ul>
        <li>Islanders need food, rest and a home. Their <b>Mood</b> (top left) shows how the village feels; badges over heads show who is hungry, tired, sick, afraid, wet, cold, homeless or unhappy, and hearts show the very happy. Happy islanders bring <b>Belief</b>.</li>
        <li>Unhappy islanders with needs and nothing to do mope about; very happy ones sometimes break into a dance.</li>
        <li><b>Only married couples have children</b>, and only a husband and wife living together (one child per house). Children play and never work; after four days they <b>come of age</b> and join the village’s work.</li>
        <li><b>Weddings:</b> now and then a man and a woman <b>wish to marry</b> (at most one wedding every five days). The wish waits for a day in your <b>Requests</b>: grant it and the couple kneel at the temple (or the tribal fire) while the village gathers, then everyone dances, and the newlyweds make a home together (+Belief). Let a wish go ungranted and the couple are heartbroken and the gods displeased (−Belief).</li>
        <li><b>Requests:</b> islanders also wish for things like a Well or a Torch near their home. Build it in time for Belief and a happier islander.</li>
        <li>Some adults are <b>elders</b>, with grey hair and a walking staff. When a child comes of age, an elder (from their own home if one lives there) passes on their skills: the young adult is <b>skilled</b> and builds, farms, gathers and carves a quarter faster for life.</li>
        <li><b>The willow glade:</b> new islands have a larger main island with a quiet glade of weeping willows round a freshwater lake, with lily pads and lotus flowers. Its fresh fish bite readily: islanders come to fish from its shore.</li>
        <li><b>Ceremonial Platform:</b> a wooden deck on the beach, its arch facing the sea. Once built, weddings are held there: a priest marries the couple under the arch while the guests fill the benches.</li>
        <li><b>Graveyard:</b> once built, when an elder passes two islanders carry them there on a litter and a headstone is raised in the next plot, in neat rows either side of the path (sixteen in all).</li>
        <li>Elders don’t live for ever. After some weeks an elder passes away peacefully in their sleep, and the village gathers to lay them to rest near the temple (or the tribal fire). A grave with a carved stone and marigolds marks the spot; tap it to see who lies there. A small village (fewer than six grown islanders) keeps its elders a while longer.</li>
      </ul>
      <h4>Belief and the gods</h4><ul>
        <li>Belief comes from happy islanders, priests praying at temples, bonfire evenings, granted wishes, weddings, seasonal goals and celebrations. Spend it on god powers (<b>Power</b>, 6): rain, calming storms and the volcano, and more.</li>
        <li><b>Before a temple, Belief is a slow trickle.</b> A working Temple multiplies the Belief your happy islanders bring (two and a half times, more as it is upgraded), and a Great Temple adds more again.</li>
        <li>Temples upgrade twice into the Great Pyramid. The Great Temple is built in four phases.</li>
        <li><b>Wonders</b> (Capital of the Isle, one of each, built in four phases): the <b>Colossal Head</b> makes everyone a little happier, the <b>Sun Stone</b> brings a steady trickle of Belief, and the <b>Sky Tower</b> makes research half as fast again. Each wonder (and the Great Temple) also adds to your island’s <b>fame</b>: visiting traders come sooner and offer better deals.</li>
      </ul>
      <h4>Health and danger</h4><ul>
        <li>Once the village has more than 50 islanders, someone sometimes falls sick, and sickness spreads to the people they share a home with. A working <b>Herbalist</b> slows the spread. Sick and hurt islanders limp along. Build a <b>Healing Centre</b> and cure them with food (or medicine and spices) before their time runs out.</li>
        <li><b>Jaguars and alligators</b> attack islanders who venture <b>out beyond the village</b>; among the houses they are very rarely bold enough to strike. The freshly mauled crawl home. Dogs, warriors and a <b>Watchtower</b> (which shoots by itself, day and night) keep them off.</li>
        <li>Anyone fleeing, or answering the Great Hall’s alarm bell, runs looking back over their shoulder.</li>
        <li>The <b>volcano</b> sleeps for a day or more at a time. When it smokes, most times it only smokes and rumbles and then settles; about one time in three it erupts five minutes later (−75 Belief). In the last minute and a half before lava the ground shakes and the smoke turns black. Tap it and <b>Calm</b> it for 50 Belief, or wait and see. It never erupts in the first five days, nor before your village is a Village. An <b>Observatory</b> warns of storms and of whether the volcano will erupt, and studies research that unlocks buildings.</li>
        <li><b>Raiders:</b> every few days rival canoes come looking for an easy village. With enough warriors and watchtowers (a warrior and a watchtower will do) they turn back (+Belief); otherwise they land and carry off some of your food, wood and stone (half as much if a warrior meets them).</li>
      </ul>
      <h4>Trade, pearls and fireworks</h4><ul>
        <li><b>Pearls</b> wash up on the beaches (tap one, or a passer-by picks it up) and turn up in fishing catches; a <b>daily chest</b> waits each day you play. Spend them to finish a building now, or trade them.</li>
        <li>A <b>Trade Dock</b> builds trade boats and the great <b>voyage ship</b>. Voyages meet storms (calm them in time), raiders, markets and green islands, and come home with chickens, herbs, spices and goods. Some never return.</li>
        <li>Voyagers may bring home <b>gunpowder</b>, a rare discovery. After that the Trade Dock sells a few jars a day for pearls, and a <b>Firemaker’s Workshop</b> packs it into fireworks. Launch them from its card, or when a new title or a wedding is celebrated.</li>
      </ul>
      <h4>Seasons and events</h4><ul>
        <li>Seasons change every few days. Storms pour (calm them with Belief); after rain, look for a rainbow.</li>
        <li><b>Seasonal goals:</b> each season sets the village a goal (more islanders in spring, wood and stone in summer, food before winter, good cheer through winter), shown with your objectives. Meet it by the season’s end for Belief and a happier village.</li>
        <li><b>Lantern Night:</b> on the last evening of autumn the village walks down to the shore and lets paper lanterns drift out over the sea (+Belief, a happier village).</li>
        <li>Rare events: an <b>eclipse</b> frightens the village until the priests hold a ritual, a <b>comet</b> crosses the night sky, and a <b>whale</b> may strand on a beach for your islanders to push back to sea.</li>
        <li>Whales, turtles, dolphins, octopuses, jellyfish, birds and fireflies live around the island. Tap a whale to bring it up. Octopuses rest on the seabed in the shallows and swim from rock to rock; tap one, or row a canoe close, and it jets away in a cloud of ink.</li>
      </ul>
      <h4>Extras</h4><ul>
        <li><b>Photo Mode</b> (camera button) takes pictures, and its <b>Time-lapse</b> plays a picture from every day you’ve played as a video of your island growing.</li>
        <li>Plant gardens with <b>Flora</b>: hold and drag over open ground. It’s free and just for looks.</li>
        <li>Across the strait lies a wild island with thick jungle; build a <b>Rope bridge</b> to reach it.</li>
        <li>At night in first-person view, look up: the stars and the Milky Way are out on a clear night.</li>
      </ul>`;
    const close = el('button', 'ib small close', ICONS.close);
    close.onclick = () => this.toggle(this.help, false);
    card.querySelector('.card-head')!.appendChild(close);
    this.help.appendChild(card);
    this.help.onclick = (e) => {
      if (e.target === this.help) this.toggle(this.help, false);
    };
    this.root.appendChild(this.help);
  }

  private buildTutorial(): void {
    this.tutorial = el('div', 'panel tutorial hidden');
    this.root.appendChild(this.tutorial);
    let done = false;
    try {
      done = localStorage.getItem(SAVE.tutorialKey) === 'done';
    } catch {
      /* storage unavailable */
    }
    if (!done) setTimeout(() => this.startTutorial(false), 1800);
  }

  startTutorial(force: boolean): void {
    if (force) {
      try {
        localStorage.removeItem(SAVE.tutorialKey);
      } catch {
        /* ignore */
      }
    }
    this.tutStep = 0;
    this.tutStart = { x: this.game.rig.cur.x, z: this.game.rig.cur.z, dist: this.game.rig.cur.dist };
    this.renderTutorial();
    this.tutorial.classList.remove('hidden');
  }

  private renderTutorial(): void {
    const s = this.tutSteps[this.tutStep];
    if (!s) {
      this.tutorial.innerHTML = `<div class="tut-step">Tutorial complete</div><div class="tut-title">The island is yours</div><p>Keep your people fed and housed and follow the village's progress. Next, build an Observatory to forecast storms and eruptions and research new buildings, raise a Temple for Belief, and work towards the Great Pyramid and the Tlatoani's Palace.</p><div class="tut-actions"><button class="btn small" data-a="ok">Let's go</button></div>`;
      this.tutorial.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => this.endTutorial();
      return;
    }
    const dots = this.tutSteps.map((_, i) => `<span class="dot ${i < this.tutStep ? 'done' : i === this.tutStep ? 'cur' : ''}"></span>`).join('');
    this.tutorial.innerHTML = `<div class="tut-step">Step ${this.tutStep + 1} of ${this.tutSteps.length} <span class="dots">${dots}</span></div><div class="tut-title">${s.title}</div><p>${s.text}</p><div class="tut-actions"><button class="btn small ghost" data-a="skip">Skip tutorial</button></div>`;
    this.tutorial.querySelector<HTMLButtonElement>('[data-a="skip"]')!.onclick = () => this.endTutorial();
  }

  private endTutorial(): void {
    this.tutorial.classList.add('hidden');
    this.tutStep = 99;
    try {
      localStorage.setItem(SAVE.tutorialKey, 'done');
    } catch {
      /* ignore */
    }
  }

  private settingsOpener: HTMLElement | null = null;

  private syncSettingsControls(): void {
    this.syncGodOptions();
    const s = this.game.settings;
    this.settings.querySelectorAll<HTMLInputElement>('input[data-k]').forEach(inp => {
      const key = inp.dataset.k as keyof typeof s;
      if (inp.type === 'checkbox') inp.checked = inp.dataset.invert ? !s[key] : !!s[key];
      else inp.value = String(s[key]);
      const output = this.settings.querySelector<HTMLOutputElement>(`[data-value="${key}"]`);
      if (output) {
        const percent = Math.round(Number(s[key]) / Number(inp.max) * 100);
        output.value = `${percent}%`;
        inp.style.setProperty('--slider-fill', `${percent}%`);
      }
      if (key === 'dofStrength') inp.disabled = !s.dof;
    });
    if (this.presetSelect) this.presetSelect.value = s.preset;
  }

  private presetSelect: HTMLSelectElement | null = null;

  private toggle(m: HTMLElement, show?: boolean): void {
    const on = show ?? m.classList.contains('hidden');
    if (m === this.settings) {
      if (on) { this.settingsOpener = document.activeElement as HTMLElement; this.syncSettingsControls(); }
      else this.settingsOpener?.focus();
    }
    m.classList.toggle('hidden', !on);
    if (on && m === this.settings) this.settings.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    if (on && this.presetSelect) this.presetSelect.value = this.game.settings.preset;
    if (on) this.updateIslandName();
  }

  toggleHelp(): void {
    this.toggle(this.help);
  }

  // ---------------- Trade menu ----------------

  private tradeModal?: HTMLDivElement;
  private tradeDock: Building | null = null;
  private tradeTimer = 0;

  /** The Trade Dock's market: pick a bargain and how many loads to send with a boat. */
  openTrade(dock: Building): void {
    if (!this.tradeModal) {
      this.tradeModal = el('div', 'modal hidden') as HTMLDivElement;
      this.tradeModal.onclick = (e) => {
        if (e.target === this.tradeModal) this.toggle(this.tradeModal!, false);
      };
      this.root.appendChild(this.tradeModal);
    }
    this.tradeDock = dock;
    this.renderTrade();
    this.toggle(this.tradeModal, true);
  }

  private renderTrade(): void {
    const m = this.tradeModal, dock = this.tradeDock;
    if (!m || !dock) return;
    const g = this.game;
    const goods = (r: Partial<Record<ResourceKey, number>>, k = 1) => (Object.entries(r) as [ResourceKey, number][]).map(([key, n]) => `<span class="tg">${icon(key)} ${n * k}</span>`).join(' ');
    const ships = g.trade.of(dock);
    const docked = ships.filter((s) => s.state === 'docked').length;
    const away = ships.filter((s) => s.state !== 'docked');
    const status = !ships.length ? 'No trade boats yet: build one at the dock first.' : `${docked} boat${docked === 1 ? '' : 's'} ready${away.length ? ` · ${away.length} at sea${away.map((s) => (s.state === 'away' ? ` (back in ~${Math.ceil(s.timer + 15)}s)` : s.state === 'back' ? ' (sailing home)' : ' (sailing out)')).join('')}` : ''}`;
    const rows = TRADE.offers.map((o: TradeOffer) => {
      const btn = (k: number) => {
        const ok = g.trade.canTrade(dock, o, k);
        return `<button class="btn small" data-o="${o.id}" data-k="${k}" ${ok.ok ? '' : 'disabled'} title="${ok.reason}">×${k}</button>`;
      };
      return `<div class="trow"><span class="tgive">${goods(o.give)}</span><span class="tarrow">→</span><span class="tget">${goods(g.trade.haul(dock, o))}</span><span class="tbtns">${btn(1)}${btn(3)}</span></div>`;
    }).join('');
    m.innerHTML = `<div class="panel card trade">
      <div class="card-head"><span>${ICONS.boat} Trade Dock market</span></div>
      <p class="muted small">Load a boat with spare goods and send it to trade. It sails over the horizon and returns with what you bargained for.</p>
      <div class="kv"><span>Boats</span><b>${status}</b></div>
      <div class="trows">${rows}</div>
      ${this.rareGoodsHtml()}
      <p class="muted small">Traders speak of new goods soon: ${TRADE.comingSoon.join(', ')}.</p>
    </div>`;
    const close = el('button', 'ib small close', ICONS.close);
    close.onclick = () => this.toggle(m, false);
    m.querySelector('.card-head')!.appendChild(close);
    m.querySelectorAll<HTMLButtonElement>('button[data-rare]').forEach((b) => {
      b.onclick = () => {
        this.toast(g.buyRareGood(b.dataset.rare as GoodKey, parseInt(b.dataset.k ?? '1', 10)));
        this.renderTrade();
      };
    });
    m.querySelectorAll<HTMLButtonElement>('button[data-o]').forEach((b) => {
      b.onclick = () => {
        const o = TRADE.offers.find((x) => x.id === b.dataset.o)!;
        const msg = g.trade.send(dock, o, parseInt(b.dataset.k ?? '1', 10));
        g.audio?.sfx('click');
        this.toast(msg);
        this.renderTrade();
      };
    });
  }

  /** The Trade Dock's Rare Goods: bought outright for pearls, a few a day, once discovered. */
  private rareGoodsHtml(): string {
    const g = this.game, day = g.time.day;
    const rows = RARE_GOODS.map((o) => {
      const found = g.found(o.key);
      if (!found) return `<div class="trow rare locked"><span class="tgive">${icon(o.key)} <b>???</b></span><span class="muted small">Undiscovered: voyagers may find it in distant markets.</span></div>`;
      const left = rareLeft(g.rareSales, day, o);
      const btn = (k: number) => {
        const why = rareBlock(g.eco, g.rareSales, day, o, true, k);
        return `<button class="btn small" data-rare="${o.key}" data-k="${k}" ${why ? 'disabled' : ''} title="${why}">×${k}</button>`;
      };
      return `<div class="trow rare"><span class="tgive"><span class="tg">${icon('pearls')} ${o.pearls}</span></span><span class="tarrow">→</span><span class="tget"><span class="tg">${icon(o.key)} 1</span> <span class="muted small">${GOODS[o.key].name} · ${left} left today</span></span><span class="tbtns">${btn(1)}${btn(Math.min(3, o.perDay))}</span></div><p class="muted small rare-note">${o.note}</p>`;
    }).join('');
    return `<div class="sec-h">Rare goods</div><p class="muted small">Paid for in pearls (you have ${Math.floor(g.eco.goods.pearls)}). The traders bring only a little each day.</p><div class="trows">${rows}</div>`;
  }

  closeModals(): boolean {
    let closed = this.closePopups();
    for (const m of [this.settings, this.help, this.tradeModal].filter(Boolean) as HTMLElement[]) {
      if (!m.classList.contains('hidden')) {
        this.toggle(m, false);
        closed = true;
      }
    }
    return closed;
  }

  private addTip(target: HTMLElement, html: string): void {
    target.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType !== 'mouse') return;
      this.tooltip.innerHTML = html;
      this.tooltip.classList.remove('hidden');
      const r = target.getBoundingClientRect();
      const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
      this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
      this.tooltip.style.top = `${Math.max(8, r.top - th - 10)}px`;
    });
    target.addEventListener('pointerleave', () => this.tooltip.classList.add('hidden'));
    target.addEventListener('pointerdown', () => this.tooltip.classList.add('hidden'));
  }

  // ---------------- Notifications ----------------

  private renderAlerts(): void {
    this.alertButton.classList.toggle('unread', this.alerts.length > 0);
    this.alertButton.setAttribute('aria-label', this.alerts.length ? `Alerts: ${this.alerts.length} active` : 'Alerts: none');
    this.alertPanel.replaceChildren();
    const heading = el('div', 'alert-heading', '<strong>Alerts</strong>');
    const close = el('button', 'ib small', ICONS.close);
    close.setAttribute('aria-label', 'Close alerts');
    close.onclick = () => {
      this.alertPanel.classList.add('hidden');
      this.alertButton.setAttribute('aria-expanded', 'false');
    };
    heading.appendChild(close);
    this.alertPanel.appendChild(heading);
    if (!this.alerts.length) this.alertPanel.appendChild(el('p', '', 'No active alerts.'));
    for (const alert of this.alerts) {
      const row = el('div', 'alert-entry');
      const message = el('p');
      message.textContent = alert.text;
      row.appendChild(message);
      if (alert.at) {
        const go = el('button', 'obtn sm', alert.label ?? 'View');
        go.onclick = () => {
          if (typeof alert.at === 'function' && alert.at() === null) { this.pruneAlerts(); return; }
          alert.onView?.();
          if (!alert.noFocus) this.game.focusAt(alert.at!);
          close.click();
        };
        row.appendChild(go);
      }
      const clear = el('button', 'obtn sm', 'Clear');
      clear.setAttribute('aria-label', `Clear alert: ${alert.text}`);
      clear.onclick = () => {
        alert.toast?.remove();
        this.alerts = this.alerts.filter(a => a !== alert);
        this.renderAlerts();
      };
      row.appendChild(clear);
      this.alertPanel.appendChild(row);
    }
  }

  private pruneAlerts(): void {
    const remaining = this.alerts.filter(a => {
      if (typeof a.at !== 'function' || a.at() !== null) return true;
      a.toast?.remove();
      return false;
    });
    if (remaining.length !== this.alerts.length) {
      this.alerts = remaining;
      this.renderAlerts();
    }
  }

  /** Change a standing alert's words (a forecast re-stated) without a new pop-up. */
  updateAlert(key: string, text: string): void {
    const a = this.alerts.find((x) => x.key === key);
    if (!a || a.text === text) return;
    a.text = text;
    const msg = a.toast?.querySelector('.encounter-text');
    if (msg) msg.textContent = text;
    else if (a.toast) a.toast.textContent = text;
    this.renderAlerts();
  }

  dismissAlert(key: string): void {
    const old = this.alerts.find(a => a.key === key);
    if (!old) return;
    old.toast?.remove();
    this.alerts = this.alerts.filter(a => a.key !== key);
    this.renderAlerts();
  }

  /** @param at where the news is: clicking the notification takes the camera there */
  toast(text: string, kind: 'info' | 'milestone' | 'warn' = 'info', at?: Where, action?: { key: string; onView: () => void; label?: string; noFocus?: boolean }): void {
    const retained = kind === 'warn' || !!action?.label;
    if (retained) {
      const existing = this.alerts.find(a => action ? a.key === action.key : !a.key && a.text === text);
      if (existing) { existing.at = at; return; }
      this.alerts.push({ text, at, key: action?.key, onView: action?.onView, label: action?.label, noFocus: action?.noFocus });
      // Bound the inbox when warnings arrive faster than they can be read.
      if (this.alerts.length > 30) this.alerts.shift()?.toast?.remove();
      this.renderAlerts();
    }
    // Keep warnings in the inbox while the interface is hidden.
    if (this.zen) return;
    // Anything worth stopping for is a pop-up in the middle of the screen, cleared by the player:
    // milestones, events with a choice, and news or warnings about a place on the island.
    const split = splitMessage(text);
    if (kind === 'milestone') {
      this.dialog.push({ icon: 'star', kicker: 'Milestone', title: split.title, body: split.body, important: true });
      return;
    }
    if (action?.label) {
      this.dialog.push({
        icon: kind === 'warn' ? 'warn' : 'ask', kicker: kind === 'warn' ? 'Warning' : 'Something to see', title: split.title, body: split.body,
        actions: [
          { label: 'Later' },
          { label: action.label, primary: true, run: () => {
            if (typeof at === 'function' && at() === null) { this.dismissAlert(action.key); return; }
            action.onView();
            this.dismissAlert(action.key);
          } },
        ],
      });
      return;
    }
    if (at) {
      this.dialog.push({
        icon: kind === 'warn' ? 'warn' : 'info', kicker: kind === 'warn' ? 'Warning' : 'News', title: split.title, body: split.body,
        news: kind !== 'warn', important: kind === 'warn',
        actions: [{ label: 'Show me', run: () => this.game.focusAt(at) }, { label: 'OK', primary: true }],
      });
      return;
    }
    // Quick feedback on what the player just did: a short message mid-screen that fades by itself.
    const t = el('div', `toast ${kind}`, text);
    if (retained) this.alerts.find(a => action ? a.key === action.key : !a.key && a.text === text)!.toast = t;
    t.setAttribute('role', 'status');
    this.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 500);
    }, 3000);
    // One quick message at a time, and only the latest two kept.
    while (this.toasts.children.length > 2) this.toasts.firstElementChild?.remove();
  }

  setHint(text: string | null): void {
    this.hint.classList.toggle('hidden', !text);
    // Phones: lift the tutorial card clear of the hint above the toolbar.
    this.root.classList.toggle('has-hint', !!text);
    if (text) this.hint.innerHTML = text;
  }

  // ---------------- Per-frame ----------------

  private foundBtn!: HTMLButtonElement;
  private followPill!: HTMLButtonElement;
  private followShown = '';

  update(dt: number): void {
    const g0 = this.game;
    this.villagePriorities.sync();
    this.moodTimer -= dt;
    if (this.moodTimer <= 0) { this.moodTimer = 1; this.moodPanel.sync(); }
    // Keep the open trade menu's boat timers fresh.
    if (this.tradeModal && !this.tradeModal.classList.contains('hidden')) {
      this.tradeTimer -= dt;
      if (this.tradeTimer <= 0) {
        this.tradeTimer = 1;
        if (this.tradeDock && !g0.buildings.byId(this.tradeDock.id)) this.toggle(this.tradeModal, false);
        else this.renderTrade();
      }
    }
    const placingOnTouch = !!g0.placing && g0.touchPlacementActive;
    this.placementControls.classList.toggle('hidden', !placingOnTouch);
    this.placementControls.parentElement?.classList.toggle('placing', placingOnTouch);
    this.foundBtn.classList.toggle('hidden', !(g0.awaitingFire && g0.colony.list.length > 0 && g0.placing !== 'campfire'));
    const followed = g0.followId >= 0 ? g0.colony.byId(g0.followId) : undefined;
    const fk = followed ? `${followed.id}|${followed.name}` : '';
    if (fk !== this.followShown) {
      this.followShown = fk;
      this.followPill.classList.toggle('hidden', !followed);
      if (followed) this.followPill.innerHTML = `${ICONS.follow}<span>Following <b>${followed.name}</b></span><span class="fp-x" aria-hidden="true">${ICONS.close}</span>`;
      this.followPill.setAttribute('aria-label', followed ? `Stop following ${followed.name}` : '');
    }
    this.dialog.tick();
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.25;
      this.renderGoals();
      if (g0.placing && g0.touchPlacementActive) {
        g0.refreshPlacement();
        const status = g0.placementFeedback;
        const ready = !!status?.ok;
        const dock = g0.placing === 'jetty' || g0.placing === 'tradedock';
        this.placementPlace.disabled = !ready;
        setLabel(this.placementPlace, g0.moving ? 'Move here' : 'Place');
        this.placementRotate.disabled = dock;
        setLabel(this.placementRotate, dock ? 'Faces shore' : 'Rotate 90°');
        this.placementSnap.disabled = dock;
        setLabel(this.placementSnap, `Snap: ${g0.placementSnap ? 'On' : 'Off'}`);
        this.placementSnap.setAttribute('aria-pressed', String(g0.placementSnap));
        this.placementStatus.classList.toggle('invalid', !ready);
        const lines = [ready ? 'Ready to place' : status?.reason || 'Drag the building onto the island',
          `${status?.slope || 'Slope: choose a position'} · ${status?.snapped ? 'Snapped to nearby ground' : 'Aligned to grid'}`];
        if (this.placementStatus.textContent !== lines.join('\n')) this.placementStatus.textContent = lines.join('\n');
      }
      this.refresh(false);
    }
    // Compass needle points to the island's north as the camera turns.
    const compass = `rotate(${((-this.game.rig.cur.yaw * 180) / Math.PI).toFixed(2)}deg)`;
    if (this.compassNeedle.style.transform !== compass) this.compassNeedle.style.transform = compass;
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.5;
      this.pruneAlerts();
      if (this.mapVisible) this.drawMinimap();
    }
    if (this.tutStep < this.tutSteps.length && !this.tutorial.classList.contains('hidden')) {
      if (this.tutSteps[this.tutStep].done(this.game)) {
        this.tutStep++;
        this.tutStart = { x: this.game.rig.cur.x, z: this.game.rig.cur.z, dist: this.game.rig.cur.dist };
        this.renderTutorial();
      }
    }
  }

  private refresh(force: boolean): void {
    const g = this.game;
    const t = g.time;
    this.timeEl.textContent = t.clock;
    // Show FPS: frame rate and the worst frame, then the graphics in use and script time per frame.
    const perf = g.settings.fps ? `${Math.round(g.fpsValue)} fps · worst ${Math.round(g.worstFrameMs)} ms\n${g.qualityLabel} · cpu ${g.cpuMs.toFixed(1)} ms` : '';
    if (this.perfEl.textContent !== perf) this.perfEl.textContent = perf;
    this.dateEl.textContent = `${t.season} ${t.dayOfSeason} · Year ${t.year}`;
    const h = t.hour;
    const iconName = t.isNight ? 'moon' : h > 16 || h < 7.5 ? 'sunset' : 'sun';
    if (this.sunIcon.dataset.i !== iconName) {
      this.sunIcon.innerHTML = ICONS[iconName];
      this.sunIcon.dataset.i = iconName;
    }
    const e = g.eco;
    const housed = g.colony.list.filter((i) => i.home >= 0).length;
    this.resEls.people.textContent = `${housed}/${g.colony.list.length}`;
    this.resEls.wood.textContent = `${fmt(e.res.wood)}`;
    this.resEls.stone.textContent = `${fmt(e.res.stone)}`;
    for (const k of ['grain', 'fruit', 'meat', 'fish'] as const) this.resEls[k].textContent = fmt(e.res[k]);
    for (const k of GOOD_KEYS) this.resEls[k].textContent = fmt(e.goods[k]);
    const powder = this.game.found('gunpowder');
    for (const k of ['gunpowder', 'fireworks']) this.resEls[k].parentElement?.classList.toggle('hidden', !powder);
    this.resEls.wood.parentElement!.title = `Wood ${Math.floor(e.res.wood)} / ${e.woodCap}`;
    this.resEls.stone.parentElement!.title = `Stone ${Math.floor(e.res.stone)} / ${e.woodCap}`;
    this.resEls.grain.parentElement!.title = `Food ${Math.floor(e.food)} / ${e.foodCap}`;
    this.beliefFill.style.width = `${Math.min(100, (e.res.belief / e.beliefCap) * 100)}%`;
    this.beliefText.textContent = `${Math.floor(e.res.belief)} / ${e.beliefCap}`;
    this.slots.forEach((b, i) => {
      const tool = TOOLBAR[i];
      const terrain = tool.id === 'terrain' && TERRAIN_TOOLS.includes(g.tool);
      const flora = tool.id === 'flora' && GARDEN_TOOLS.includes(g.tool);
      b.classList.toggle('on', g.tool === tool.id || terrain || flora || (tool.id === 'blessings' && ['bless', 'rain', 'calm'].includes(g.tool)) || (tool.id === 'build' && PAINT_TOOLS.includes(g.tool) && !GARDEN_TOOLS.includes(g.tool)));
      b.classList.toggle('dim', !!tool.cost && e.res.belief < tool.cost);
      // The Flora slot names the brush in use.
      if (tool.id === 'flora') {
        const nm = b.querySelector('.nm')!;
        const want = flora ? this.floraItems.find((x) => x.dataset.tool === g.tool)!.querySelector('.nm')!.textContent! : 'Flora';
        if (nm.textContent !== want) nm.textContent = want;
      }
      // The Terrain slot names the sculpt tool in use.
      if (tool.id === 'terrain') {
        const nm = b.querySelector('.nm')!;
        const want = terrain ? TOOLS.find((x) => x.id === g.tool)!.name : 'Terrain';
        if (nm.textContent !== want) nm.textContent = want;
      }
    });
    for (const b of this.terrainItems) b.classList.toggle('on', g.tool === b.dataset.tool);
    for (const b of this.floraItems) b.classList.toggle('on', g.tool === b.dataset.tool);
    const ffx = this.speedBtn.querySelector('.ff-x')!;
    const sp = t.paused ? 'Ⅱ' : `${t.speed}×`;
    if (ffx.textContent !== sp) ffx.textContent = sp;
    this.speedBtn.classList.toggle('on', !t.paused && t.speed > 1);
    const pauseIcon = t.paused ? 'play' : 'pause';
    if (this.pauseBtn.dataset.icon !== pauseIcon) {
      this.pauseBtn.innerHTML = ICONS[pauseIcon];
      this.pauseBtn.dataset.icon = pauseIcon;
    }
    this.pauseBtn.title = t.paused ? 'Play (Space)' : 'Pause (Space)';
    this.pauseBtn.setAttribute('aria-label', t.paused ? 'Play' : 'Pause');
    this.pauseBtn.classList.toggle('on', t.paused);
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', !t.paused && t.speed === i + 1));
    this.buildMenu.classList.toggle('hidden', g.tool !== 'build' || !!g.placing);
    if (!this.buildMenu.classList.contains('hidden')) {
      const goals=this.buildMenu.querySelector('[data-progression]');if(goals)goals.textContent=g.progression.summary;
      for (const [key, b] of this.buildItems) {
        const reason = g.buildings.constructionRequirement(key);
        const price = g.buildings.costFor(key);
        b.classList.toggle('dim', !!reason || !e.canAfford(price));
        // The price rises with each one already built.
        const pc = b.querySelector<HTMLElement>('.bm-cost'), tag = `${price.wood}|${price.stone}|${price.belief}|${price.carvedStone ?? 0}`;
        if (pc && pc.dataset.c !== tag) { pc.dataset.c = tag; pc.innerHTML = costHtml(price); }
        b.title = reason || BUILDINGS[key].name;
        let lock=b.querySelector('.bm-lock');if(!lock){lock=el('span','bm-purpose bm-lock');b.appendChild(lock);}lock.textContent=reason;
        b.setAttribute('aria-disabled', String(!!reason));
      }
    }
    this.renderInfo(force);
  }

  // ---------------- Info panel ----------------

  /** What changes the Observatory card (so it redraws only when something shown has changed). */
  private observatoryKey(): string {
    const g = this.game, r = g.research, s = g.powers.stormOutlook, v = g.volcanoOutlook;
    return `${r.done}:${r.active}:${Math.round(r.fraction * 100)}:${g.colony.observatoryStaff()}:${g.colony.observing > 0}:${g.time.seasonIndex}:${Math.round(g.time.secondsToNextSeason / 30)}:${s ? Math.round(s.inSeconds / 30) : -1}:${v ? Math.round(v.inSeconds / 30) : -1}:${g.volcano?.state.phase}:${Math.floor(g.eco.food / 5)}:${g.time.speed}`;
  }

  /** The Observatory card: staff, seasons, forecasts and the ten tiers of research. */
  private observatoryHtml(): string {
    const g = this.game, r = g.research, staff = g.colony.observatoryStaff(), onDuty = g.colony.observing;
    const speed = Math.max(1, g.time.speed);
    const mins = (s: number) => { const m = Math.max(1, Math.round(s / 60)); return `about ${m} min`; };
    let h = `<div class="kv"><span>Priests on staff</span><b>${staff} / ${BUILDINGS.observatory.workers + (g.observatoryUpgrades >= 3 ? 1 : 0)}${staff ? ` · ${onDuty} on duty now` : ''}</b></div>`;
    if (!staff) h += '<p class="muted small">No priest on staff: forecasts and research are paused. A priest joins once the village has four workers (two at eight).</p>';
    // Seasons.
    h += `<div class="sec-h">${ICONS.b_observatory} Seasons</div><div class="kv"><span>Now</span><b>${g.time.season}, day ${g.time.dayOfSeason} of ${TIME.daysPerSeason}</b></div>`;
    h += r.has(1)
      ? `<div class="kv"><span>Coming</span><b>${g.time.nextSeason} in ${mins(g.time.secondsToNextSeason / speed)}</b></div>`
      : '<p class="muted small">Study The Count of Seasons to foresee the coming season.</p>';
    // Forecasts.
    h += '<div class="sec-h">Forecasts</div>';
    if (!staff) h += '<p class="muted small">Without a priest watching, only the sky and the mountain’s own signs warn of what is coming.</p>';
    else {
      const s = g.powers.stormOutlook;
      h += `<div class="kv"><span>Storms</span><b>${g.powers.state === 'storm' ? 'A storm is raging now' : s && s.inSeconds <= Forecaster.stormWindow(g.observatoryUpgrades) ? `Expected in ${mins(s.inSeconds / speed)}${r.has(10) ? `, lasting ${mins(s.length / speed)}` : ''}` : 'None in sight'}</b></div>`;
      if (g.volcano?.group.visible) {
        const v = g.volcanoOutlook, win = Forecaster.volcanoWindow(r.done, g.observatoryUpgrades);
        h += `<div class="kv"><span>Volcano</span><b>${g.volcano.state.active ? 'Active now' : v && v.inSeconds <= win ? `Smoke expected in ${mins(v.inSeconds)}` : 'The mountain sleeps'}</b></div>`;
      }
    }
    // Research.
    h += `<div class="sec-h">Research · ${r.done} of ${RESEARCH.length}</div>`;
    if (r.active) {
      // Estimated from the staff (priests step away to eat and sleep, so the count on duty flickers).
      const left = r.remaining(Math.min(2, staff)) / Research.boost(g.observatoryUpgrades, staff);
      h += this.bar(`${RESEARCH[r.active - 1].name} ${Math.round(r.fraction * 100)}%${Number.isFinite(left) ? ` · ${mins(left / speed)} left` : ' · paused: no priest on staff'}`, r.fraction, 'good');
    }
    h += '<ol class="rs-list">';
    RESEARCH.forEach((t, i) => {
      const tier = i + 1, st = r.state(tier), why = r.lockReason(tier);
      const unlocks = [...t.unlocks.map((k) => BUILDINGS[k].name), ...t.upgrades.map((u) => RESEARCH_UPGRADE_LABEL[u]), ...t.gains].join(', ');
      const cost = `${t.cost.food ? `${icon('grain')}${t.cost.food} ` : ''}${t.cost.wood ? `${icon('wood')}${t.cost.wood} ` : ''}${t.cost.stone ? `${icon('stone')}${t.cost.stone} ` : ''}${t.cost.belief ? `${icon('belief')}${t.cost.belief} ` : ''}· ${Math.round(t.time / 60)} min`;
      const mark = st === 'done' ? '✓' : st === 'active' ? '◐' : st === 'available' ? '○' : '·';
      let act = '';
      if (st === 'available') act = `<button class="btn small" data-a="research:${tier}" ${g.eco.canAfford(t.cost) ? '' : 'disabled title="Not enough food, wood, stone or Belief"'}>Study</button>`;
      h += `<li class="rs-${st}"><div class="rs-top"><span class="rs-mark" aria-hidden="true">${mark}</span><b>${tier}. ${t.name}</b>${act}</div>
        <div class="rs-text">${t.text}</div><div class="rs-unl"><span>Unlocks</span> ${unlocks}</div>
        ${st === 'done' ? '' : `<div class="rs-cost">${cost}</div>`}${st === 'locked' ? `<div class="rs-why">${why}</div>` : ''}</li>`;
    });
    return h + '</ol>';
  }

  private bar(label: string, v: number, cls = ''): string {
    return `<div class="need"><span>${label}</span><div class="nb ${cls}"><div style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></div></div></div>`;
  }

  /** Sick or mauled: the condition and the time left untreated (else a limp, if any). */
  private healthText(isl: Islander): string {
    if (isl.condition !== 'well') return `${CONDITION_LABEL[isl.condition]} · ${this.game.eco.godMode ? 'in no danger' : `${Math.ceil(isl.conditionT / 60)} min left`}`;
    return isl.injured > 0 ? `Injured, limping (${Math.ceil(isl.injured)}s)` : '';
  }

  renderInfo(force: boolean): void {
    const g = this.game;
    const isl = g.selectedIslander >= 0 ? g.colony.byId(g.selectedIslander) : undefined;
    const b = g.selectedBuilding >= 0 ? g.buildings.byId(g.selectedBuilding) : undefined;
    const sa = g.selectedAnimal;
    const mk = sa >= MONKEY_BASE && sa < DOG_BASE ? g.wildlife.monkeys.get(sa) : undefined;
    const dog = sa >= DOG_BASE && sa < JAG_BASE ? g.dogs.byId(sa - DOG_BASE) : undefined;
    const jag = sa >= JAG_BASE ? g.jaguars.list.find((j) => j.id === sa - JAG_BASE) : undefined;
    if (sa >= MONKEY_BASE && !mk && !dog && !jag) g.select(null);
    const an = g.selectedAnimal >= 0 && g.selectedAnimal < MONKEY_BASE ? g.wildlife.animals.get(g.selectedAnimal) : undefined;
    if (an && !an.alive) g.select(null);
    if (!isl && !b && !(an && an.alive) && !mk && !dog && !jag && !g.areaSel) {
      this.info.classList.add('hidden');
      this.infoKey = '';
      return;
    }
    if (this.info.classList.contains('hidden') && matchMedia('(max-width: 720px), (max-height: 520px)').matches) {
      // Small screens: a selection card and the left-hand lists would overlap. Fold the lists away.
      this.closeInventory();
      this.villagePriorities.close();
      this.goalsOpen = false;
      this.goalShown = '';
      this.renderGoals();
    }
    this.info.classList.remove('hidden');
    let html = '';
    let key = '';
    if (g.areaSel) {
      const a = g.areaSel, w = Math.abs(a.x1 - a.x0), d = Math.abs(a.z1 - a.z0);
      const inside = g.districtsInSelection();
      key = `area:${a.x0},${a.z0},${a.x1},${a.z1}:${inside.length}:${g.districts.length}`;
      const row = (label: string, n: number, ic: string) => (n ? `<div class="kv"><span>${ic} ${label}</span><b>${n}</b></div>` : '');
      const clearable = a.trees.length + a.logs.length + a.rocks.length > 0;
      const styles = (Object.keys(HOUSE_STYLES) as HouseStyle[]).map((k) => `<button class="btn small district-style" data-a="district-${k}" title="${HOUSE_STYLES[k].about}"><span class="swatch" style="background:#${HOUSE_STYLES[k].tint.toString(16).padStart(6, '0')}"></span>${HOUSE_STYLES[k].name}</button>`).join('');
      html = `<div class="card-head"><span>Selected area</span><span class="tag">${Math.max(1, Math.round(w))} × ${Math.max(1, Math.round(d))}</span></div>
        ${row('Trees', a.trees.length, icon('wood'))}${row('Fallen logs', a.logs.length, icon('wood'))}${row('Rocks', a.rocks.length, icon('stone'))}
        ${clearable ? `<p class="muted small">Clearing puts these first: islanders fell the trees, carry off the logs and quarry the rocks, taking the wood and stone to your stores. The ground is then clear to build on.</p>` : ''}
        <div class="actions">${clearable ? `<button class="btn small" data-a="clear-area">${ICONS.harvest} Clear area</button>` : ''}<button class="btn small ghost" data-a="cancel-area">Cancel</button></div>
        <div class="district-pick"><div class="card-sub">Make a district</div><p class="muted small">Homes built here take its look; homes already here take it on at their next upgrade.</p><div class="district-styles">${styles}</div>
        ${inside.length ? `<button class="btn small ghost" data-a="remove-district">Remove ${inside.length === 1 ? inside[0].name : `${inside.length} districts`}</button>` : ''}</div>`;
    } else if (g.selectedIslanders.size > 0) {
      const people = [...g.selectedIslanders].map(id => g.colony.byId(id)).filter(Boolean);
      key = `group:${people.map(i => i!.id).join(',')}`;
      html = `<div class="card-head"><span>${people.length} islanders selected</span></div>
        <p class="muted small">Tap a tree to collect wood, a rock to collect stone, or a workplace to assign the group.</p>
        <p class="muted small">Islanders manage food and rest automatically when not called to work.</p>
        <div class="actions"><button class="btn small" data-a="group-wood">Collect wood</button><button class="btn small" data-a="group-stone">Collect stone</button></div>
        <div class="actions"><button class="btn small" data-a="group-auto">Return to automatic jobs</button></div>`;
    } else if (isl) {
      const home = isl.home >= 0 ? g.buildings.byId(isl.home) : undefined;
      const role = isl.child ? 'Child' : isl.warrior ? (isl.warrior === 'jaguar' ? 'Jaguar warrior' : 'Eagle warrior') : ROLE_LABEL[isl.role];
      const carry = isl.carry ? `${icon(isl.carry.res === 'wood' ? 'wood' : isl.carry.res)} ${isl.carry.n} ${isl.carry.res}` : 'Nothing';
      const say = islanderLine(isl, g.colony.activity(isl), performance.now() / 1000);
      const req = g.requests?.of(isl.id);
      key = `i${isl.id}|${say}|${req?.id ?? ''}|${Math.ceil(isl.injured / 10)}|${isl.condition}|${Math.ceil(isl.conditionT / 60)}|${role}|${g.colony.activity(isl)}|${carry}|${home?.id}|${Math.round(isl.hunger * 20)}|${Math.round(isl.rest * 20)}|${Math.round(isl.happy * 20)}|${g.followId === isl.id}`;
      html = `
        <div class="card-head"><span>${isl.name}</span><span class="tag ${isl.gender}">${isl.gender === 'm' ? 'Male' : 'Female'}${isl.child ? ' · child' : ''}</span></div>
        <p class="isl-say">“${say}”</p>
        ${req ? `<div class="isl-req"><span>💬 ${req.text}</span><button class="btn small" data-a="req-build">Build ${BUILDINGS[req.key].name}</button></div>` : ''}
        <div class="kv"><span>Job</span><b>${role}${isl.manualRole ? ' <em>(assigned)</em>' : ''}</b></div>
        <div class="kv"><span>Doing</span><b>${g.colony.activity(isl)}</b></div>
        <div class="kv"><span>Carrying</span><b>${carry}</b></div>
        <div class="kv"><span>Home</span><b>${home ? home.label : 'None, sleeps by the fire'}</b></div>
        ${isl.spouse !== undefined ? `<div class="kv"><span>Married to</span><b>${g.colony.byId(isl.spouse)?.name ?? '—'}</b></div>` : ''}
        ${isl.skilled ? `<div class="kv"><span>Skilled</span><b class="good">Taught by ${isl.teacher ?? 'an elder'}: works faster</b></div>` : ''}
        ${this.healthText(isl) ? `<div class="kv"><span>Health</span><b>${this.healthText(isl)}</b></div>` : ''}
        ${isl.condition !== 'well' ? `<p class="muted small">${g.buildings.list.some((x) => x.key === 'healer' && x.complete) ? 'Cure them from the Healing Centre’s card.' : 'Build a Healing Centre to cure them.'}</p>` : ''}
        ${this.bar('Food', isl.hunger, isl.hunger < 0.3 ? 'low' : '')}
        ${this.bar('Rest', isl.rest, isl.rest < 0.25 ? 'low' : '')}
        ${this.bar('Happiness', isl.happy, isl.happy > 0.6 ? 'good' : '')}
        ${(() => { const k = moodOf(isl, g.moodWorld()); return k ? `<div class="kv"><span>Feeling</span><b>${MOOD_LABEL[k]}</b></div>` : ''; })()}
        <div class="actions">
          <button class="btn small" data-a="explore">Explore POV</button><button class="btn small" data-a="follow">${ICONS.follow} ${g.followId === isl.id ? 'Stop following' : 'Follow'}</button>
          ${isl.manualRole ? '<button class="btn small" data-a="auto">Auto job</button>' : ''}
        </div>
        ${isl.child ? '' : '<p class="muted small">Tip: click a building, tree, rock or fruit bush to give them that job.</p>'}`;
    } else if (dog) {
      const D = g.dogs;
      const owner = dog.owner >= 0 ? g.colony.byId(dog.owner) : undefined;
      const k = g.buildings.byId(dog.kennel);
      const doing = D.describe(dog);
      const role = k?.dogRole === 'guard' ? 'Guarding the settlement' : 'Free to roam';
      key = `d${dog.id}|${doing}|${owner?.id}|${role}|${Math.round(dog.hunger * 10)}|${Math.ceil(dog.injured / 10)}|${dog.puppy}`;
      html = `
        <div class="card-head"><span>${ICONS.dog} ${dog.name}</span><span class="tag">${dog.puppy ? 'Puppy' : 'Village dog'}</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <div class="kv"><span>Belongs to</span><b>${owner ? `${owner.name}'s household` : k ? 'The kennel' : 'The whole village'}</b></div>
        <div class="kv"><span>Role</span><b>${role}</b></div>
        ${dog.injured > 0 ? `<div class="kv"><span>Health</span><b>Injured, limping (${Math.ceil(dog.injured)}s)</b></div>` : ''}
        ${this.bar('Fed', dog.hunger, dog.hunger < 0.3 ? 'low' : 'good')}
        <p class="muted small">Dogs smell jaguars long before villagers see them, bark the alarm and try to drive them off.</p>`;
    } else if (jag) {
      const doing = g.jaguars.describe(jag);
      key = `j${jag.id}|${doing}`;
      html = `
        <div class="card-head"><span>Jaguar</span><span class="tag">Predator</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <p class="muted small">Jaguars live deep in the jungle and sometimes stalk the village, especially at night. Villagers only see one when it's close. Dogs (build a Kennel) and warriors drive them off.</p>`;
    } else if (mk) {
      const M = g.wildlife.monkeys;
      const doing = M.describe(mk);
      const free = M.canHunt(g.selectedAnimal);
      key = `m${mk.id}|${doing}|${free}`;
      html = `
        <div class="card-head"><span>Spider monkey</span><span class="tag">${mk.raid ? 'Pest' : 'Wild'}</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <p class="muted small">Monkeys raid food stores by day. Wave the pointer at raiders to scare them back to the trees, keep warriors about, or hunt them for ${FAUNA.monkeyMeat} meat.</p>
        <div class="actions"><button class="btn small" data-a="capture" ${free ? '' : 'disabled'}>${ICONS.harvest} Hunt</button></div>
        <p class="muted small">Tip: select an islander first, then tap a monkey to send them after it.</p>`;
    } else if (an) {
      const d = SPECIES[an.sp];
      const A = g.wildlife.animals;
      const doing = A.describe(an);
      const free = A.capturable(an);
      const hasPen = g.buildings.list.some((x) => x.complete && (x.key === 'butcher' || x.key === 'farm' || x.key === 'pigpen' || (x.key === 'chickenpen' && !d.needsPen)));
      key = `a${an.id}|${doing}|${free}|${hasPen}`;
      const how = d.capture === 'hunt' ? `Hunted for ${d.meat} meat. Hard to catch.` : d.needsPen ? `Caught and led on a leash to a Pig Pen (or a Butcher or Farm pen)${hasPen ? '' : ' (build one first)'}. Butchered for meat.` : 'Caught and carried to a Chicken Pen or Farm pen (or straight to the food store).';
      const label = d.capture === 'hunt' ? 'Hunt' : 'Capture';
      html = `
        <div class="card-head"><span>${animalName(an)}</span><span class="tag">Wild</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <p class="muted small">${how}</p>
        <div class="actions"><button class="btn small" data-a="capture" ${free && (!d.needsPen || hasPen) ? '' : 'disabled'}>${ICONS.harvest} ${label}</button></div>
        <p class="muted small">Tip: select an islander first, then tap an animal to send them after it.</p>`;
    } else if (b) {
      key = `b${b.id}|${['pigpen','chickenpen'].includes(b.key) ? g.wildlife.penCount(b)+'/'+g.buildings.of('butcher',true).filter(buildingOperational).length : ''}|${Math.round(b.integrity * 100)}:${b.fire > 0}:${b.ruined}:${b.repairing}:${Math.round(b.repairProgress * 100)}:${g.powers.state}:${g.fires.status(b)}:${g.eco.canAfford(g.buildings.repairCost(b))}|${Math.floor(g.eco.goods.carvedstone)}|${g.progression.summary}|${g.buildings.boatRequirement(3)}|${g.buildings.constructionRequirement('home')}|${g.buildings.list.filter(x=>x.key==='stonemason' && x.complete).map(x=>x.tier).join(',')}|${Math.floor(g.eco.food)}|${b.key === 'tradedock' || b.key === 'market' ? g.trade.visitKey(b) + '|' + g.voyage.key() + '|' + JSON.stringify(g.eco.goods) : ''}|${b.key === 'greathall' ? JSON.stringify(g.colony.hallCount(b)) : ''}|${b.key === 'palace' ? `${b.decree ?? ''}${b.decree2 ?? ''}` : ''}|${b.key === 'observatory' ? this.observatoryKey() : ''}|${b.key === 'healer' ? g.colony.patients(b).map((p) => `${p.id}:${p.condition}:${Math.ceil(p.conditionT / 60)}:${p.task?.slot}:${g.colony.canCure(p)}`).join(',') + JSON.stringify(g.eco.goods) : ''}|${b.key === 'watchtower' ? `${g.defence.stats(b).shots}|${g.defence.stats(b).kills}|` : ''}${b.key === 'kennel' ? `${g.dogs.alive.length}|${g.dogs.alive.filter((d) => d.puppy).length}|${Math.ceil(b.breedT)}|${Math.ceil(b.breedCool / 5)}|${b.dogRole}|${Math.floor(g.eco.food / 4)}|` : ''}${b.key === 'market' ? JSON.stringify(b.marketStock) : ''}|${b.key === 'herbalist' || b.key === 'stonemason' || b.key === 'firemaker' ? JSON.stringify(g.eco.goods) : ''}${b.key === 'firemaker' ? `${g.fireworks.active}|${g.colony.list.map((i) => i.task?.kind === 'firework' && i.task.target === b.id ? `${i.id}:${i.task.stage}:${Math.ceil(i.task.timer / 3)}` : '').join('')}` : ''}|${b.complete}|${Math.round(b.progress * 50)}|${b.tier}|${b.residents.length}|${b.upgrading}|${Math.round(b.growth * 20)}|${b.boats.length}|${b.boatBuild > 0}|${b.training.length}|${Math.floor(g.eco.res.wood / 5)}|${Math.floor(g.eco.res.stone / 5)}|${Math.floor(g.eco.res.belief / 5)}|${Math.floor(g.eco.goods.pearls)}`;
      html = this.buildingHtml(b);
    }
    if (!force && key === this.infoKey) return;
    this.infoKey = key;
    this.info.innerHTML = html;
    const close = el('button', 'ib small close', ICONS.close);
    close.onclick = () => g.select(null);
    this.info.querySelector('.card-head')?.appendChild(close);
    this.info.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((btn) => (btn.onclick = () => this.infoAction(btn.dataset.a!, isl?.id, b, an?.id ?? (mk ? g.selectedAnimal : undefined))));
  }

  private buildingHtml(b: Building): string {
    const g = this.game;
    if (b.fire > 0 || b.integrity < 1 || b.ruined || b.repairing) {
      const cost = g.buildings.repairCost(b);
      return fireBuildingCard(b, g.fires.status(b), cost, g.eco.canAfford(cost), g.powers.state === 'storm');
    }
    let body = '';
    if(b.key==='palace'&&!b.complete){const names=['Platform','Grand stair and plaza','Halls and courtyard','Roofs, crest and gardens'];const phase=Math.min(3,Math.floor(b.progress*4));body+=`<p>${names[phase]} · Phase ${phase+1}/4</p>`;}
    if (isWonder(b.key)) {
      const w = WONDERS[b.key];
      if (!b.complete) {
        const phase = Math.min(3, Math.floor(b.progress * 4)), c = b.def.cost;
        body += `<p>${w.phases[phase]} · Phase ${phase + 1}/4</p><p class="muted small">Each phase: ${c.wood} wood · ${c.stone} stone · ${c.carvedStone ?? 0} carved stone · ${c.belief} Belief. Builders pause until the next phase can be supplied.</p><p class="muted small">When it stands: ${w.bonus.toLowerCase()}, and the island's fame grows (traders come sooner with better deals).</p>`;
      } else body += `<div class="kv"><span>Wonder</span><b>${w.bonus}</b></div><div class="kv"><span>Fame</span><b>${g.fame}: traders come sooner and offer more</b></div>`;
    }
    if(b.key==='greattemple'&&!b.complete){const names=['Foundations','Terraces','Stairs','Shrines'];const phase=Math.min(3,Math.floor(b.progress*4));body+=`<p>${names[phase]} · Phase ${phase+1}/4</p><p class="muted small">Each phase: 40 wood · 120 stone · 30 carved stone · 50 Belief. Builders pause until the next phase can be supplied.</p>`;}
    if (!b.complete) body += `${this.bar(`Building ${Math.round(b.progress * 100)}%`, b.progress, 'good')}<div class="kv"><span>Builders</span><b>${b.builders.size} / ${b.def.builders}</b></div>`;
    else if (b.upgrading) body += `${this.bar(`Upgrading ${Math.round(b.progress * 100)}%`, b.progress, 'good')}`;
    if (b.complete && b.def.housing) {
      body += `<div class="kv"><span>Residents</span><b>${b.residents.map((id) => g.colony.byId(id)?.name).filter(Boolean).join(', ') || 'Empty'} (${b.residents.length}/${b.housing})</b></div>`;
      const kid = g.colony.list.find((i) => i.child && i.home === b.id);
      body += `<div class="kv"><span>Child</span><b>${kid ? kid.name : 'None yet'}</b></div>`;
    }
    const workers = g.colony.list.filter((i) => i.workplace === b.id && b.complete);
    if (b.complete && b.jobs) body += `<div class="kv"><span>Workers</span><b>${workers.map((w) => w.name).join(', ') || 'None yet'}</b></div>`;
    if (b.key === 'market' && b.complete) {
      const stock = Object.entries(b.marketStock).filter(([,n]) => n > 0).map(([k,n]) => `${icon(k)} ${Math.floor(Math.min(n, g.eco.res[k as ResourceKey]))}`).join(' · ');
      body += `<div class="kv"><span>Goods displayed</span><b>${stock || 'Waiting for surplus deliveries'}</b></div><p class="muted small">Market keepers bring surplus from the stores. Visiting canoes offer exchanges at the nearest accessible shore; accept offers here. Displayed goods remain part of your village inventory.</p>`;
    }
    if(b.key==='boatworkshop' && b.complete)body+=`<p>Research level ${b.tier}/3 · ${b.tier===1?'Canoes':b.tier===2?'Canoes and larger fishing boats':'All boats, including trade boats'}</p><p class="muted small">Build vessels at your jetties and docks. Larger fishing boats carry 50% more fish.</p>`;
    if (b.key === 'stonemason' && b.complete) body += `<div class="kv"><span>Carved stone in store</span><b>${Math.floor(g.eco.goods.carvedstone)}</b></div><p class="muted small">Each stonemason turns 4 raw stone into 2 carved stone per minute of work. Workshop upgrade ${b.tier - 1} / 3. ${b.tier === 1 ? 'Houses and village buildings unlocked.' : b.tier === 2 ? 'Temples unlocked.' : b.tier === 3 ? 'Great Pyramid upgrades unlocked.' : 'Great Temple unlocked.'}</p>`;
    if (b.key === 'herbalist' && b.complete) body += this.bar('Making medicine', b.growth, 'good') + `<div class="kv"><span>Delivered herb bundles</span><b>${Math.floor(g.eco.goods.herbs)}</b></div><div class="kv"><span>Medicine in store</span><b>${Math.floor(g.eco.goods.medicine)}</b></div><p class="muted small">One herb bundle → one medicine every ${medicineSeconds(b) / 60} game minutes. ${b.stock > 0 ? 'Processing a herb bundle.' : g.eco.goods.medicine >= 40 ? 'Medicine store full.' : 'Waiting for herbs from a Herbal Garden.'}</p>`;
    if (b.key === 'firemaker' && b.complete) {
      const maker = g.colony.list.find((i) => i.task?.kind === 'firework' && i.task.target === b.id && i.task.stage >= 2);
      const progress = maker?.task ? 1 - Math.max(0, maker.task.timer) / FIREWORKS.batchSeconds : 0;
      body += this.bar('Packing fireworks', progress, 'good') + `<div class="kv"><span>Gunpowder</span><b>${Math.floor(g.eco.goods.gunpowder)} jar${Math.floor(g.eco.goods.gunpowder) === 1 ? '' : 's'}</b></div><div class="kv"><span>Fireworks</span><b>${Math.floor(g.eco.goods.fireworks)} / ${FIREWORKS.cap}</b></div><p class="muted small">One jar of gunpowder → ${FIREWORKS.perJar} fireworks. ${maker ? `${maker.name} is at the workbench.` : g.eco.goods.gunpowder < 1 ? 'Waiting for gunpowder: buy it for pearls at a Trade Dock, or send a voyage.' : g.eco.goods.fireworks > FIREWORKS.cap - FIREWORKS.perJar ? 'The fireworks store is full.' : 'Waiting for a firemaker.'} A display uses ${FIREWORKS.perShow} fireworks and cheers the village.</p>`;
    }
    if (b.key === 'herbalgarden' && b.complete) body += `<p class="muted small">Farmers harvest these beds and deliver herbs to a completed Herbalist’s Garden.${g.buildings.of('herbalist').length ? '' : ' Build a Herbalist’s Garden to receive the harvest.'}</p>`;
    if (b.key === 'healer' && b.complete) body += `<p class="muted small">Medicine treatment: 60 seconds for sickness, 90 seconds for wounds. One medicine per patient; treatment pauses when medicine runs out.</p>`;
    if (b.key === 'smokehouse' && b.complete) body += `<div class="kv"><span>Smoking</span><b>${b.tendTimer > 0 ? 'Fire lit, racks full' : g.eco.res.fish >= SMOKE.input || g.eco.res.meat >= SMOKE.input ? 'Waiting for a keeper' : 'Needs raw fish or meat'}</b></div><p class="muted small">${SMOKE.input} raw fish or meat + ${smokeWood(b, SMOKE.wood)} wood → ${SMOKE.output} smoked.</p>`;
    if (FARM_TYPES[b.key] && b.complete) body += this.bar(b.growth >= 1 ? 'Ready to harvest' : `${FARM_TYPES[b.key]!.label} growing ${Math.round(b.growth * 100)}%`, b.growth, 'good') + (b.blessTimer > 0 ? '<div class="kv"><span>Blessed</span><b>Growing faster</b></div>' : '');
    if (b.key === 'greattemple' && b.complete) {
      const praying = workers.filter(i => i.task?.kind === 'pray' && i.task.target === b.id && i.task.stage === 2 && i.anim === 'pray').length;
      body += `<div class="kv"><span>Praying now</span><b>${praying}</b></div><div class="kv"><span>Belief</span><b>+1 per worshipper / 5 min of prayer</b></div><p>Prayer progress is kept between visits. Assign islanders here to pray.</p>`;
    }
    if (b.key === 'temple' && b.complete) body += `<div class="kv"><span>Belief</span><b>+${(0.25 * b.tier * 60).toFixed(0)}/min and more from priests</b></div>`;
    if (b.key === 'woodstore' || b.key === 'campfire') body += `<div class="kv"><span>Wood / Stone</span><b>${Math.floor(g.eco.res.wood)} · ${Math.floor(g.eco.res.stone)} of ${g.eco.woodCap}</b></div>`;
    if (b.key === 'grainstore' || b.key === 'campfire') body += `<div class="kv"><span>Food</span><b>${Math.floor(g.eco.food)} of ${g.eco.foodCap}</b></div>`;
    if (b.key === 'jetty' && b.complete) body += `<div class="kv"><span>Boats</span><b>${b.boats.length} / ${jettyBoats(b)}${b.boatBuild > 0 ? ` (building ${Math.round((b.boatBuild / JETTY.boatBuildSeconds) * 100)}%)` : ''}</b></div>`;
    if (b.key === 'tradedock' && b.complete) body += this.voyageSection(b);
    if (b.key === 'tradedock' && b.complete) {
      const ships = g.trade.of(b);
      const docked = ships.filter((s) => s.state === 'docked').length;
      body += `<div class="kv"><span>Trade boats</span><b>${ships.length ? `${docked} moored · ${ships.length - docked} at sea` : 'None yet'}${b.boatBuild > 0 ? ` (building ${Math.round((b.boatBuild / TRADE.boatBuildSeconds) * 100)}%)` : ''}</b></div>`;
    }
    if ((b.key === 'tradedock' || b.key === 'market') && b.complete) {
      // Visiting traders moored at the dock, with their bargains.
      const v = g.trade.visiting(b);
      if (v) {
        const goods = (r: Partial<Record<ResourceKey, number>>) => (Object.entries(r) as [ResourceKey, number][]).map(([key, n]) => `<span class="tg">${icon(key)} ${n}</span>`).join(' ');
        const rows = v.deals.map((d, k) => {
          const why = g.trade.whyNot(d, b);
          const btn = d.taken ? '<span class="muted small">Traded</span>' : `<button class="btn small" data-a="visit${k}" ${why ? 'disabled' : ''} title="${why ?? ''}">Accept</button>${why ? ` <span class="muted small">${why}</span>` : ''}`;
          return `<div class="trow"><span class="tgive">${goods(d.give)}</span><span class="tarrow">→</span><span class="tget">${goods(d.get)}</span><span class="tbtns">${btn}</span></div>`;
        }).join('');
        body += `<div class="sec-h">${ICONS.boat} Visiting traders</div>
          <p class="muted small">Traders from ${v.from} ${b.key === 'market' ? 'have stopped at the nearby shoreline' : 'are moored here'} (leaving in about ${Math.max(1, Math.ceil(v.timer / 60))} min). You give the goods on the left for those on the right.</p>
          <div class="trows">${rows}</div>`;
      }
    }
    if (b.key === 'kennel' && b.complete) {
      const D = g.dogs;
      const all = D.alive;
      const adults = all.filter((d) => !d.puppy).length, pups = all.length - adults;
      body += `<div class="sec-h">${ICONS.dog} Dogs</div>
        <div class="kv"><span>Adult</span><b>${adults}</b></div>
        <div class="kv"><span>Puppies</span><b>${pups}${b.breedT > 0 ? ` (+1 on the way, ${Math.ceil(b.breedT)}s)` : ''}</b></div>
        <div class="kv"><span>Capacity</span><b>${all.length}/${D.capacity}</b></div>
        <div class="kv"><span>Food</span><b>~${(adults + pups * 0.5) * DOGS.foodPerMinute < 1 ? ((adults + pups * 0.5) * DOGS.foodPerMinute).toFixed(1) : Math.round((adults + pups * 0.5) * DOGS.foodPerMinute)} per minute</b></div>`;
    }
    if (b.key === 'observatory' && b.complete) body += this.observatoryHtml();
    if (b.key === 'palace' && b.complete) {
      const now = b.decree ?? PALACE_RULES.firstDecree;
      body += `<div class="sec-h">${ICONS.b_palace} Royal decree</div><div class="kv"><span>In force</span><b>${DECREES[now].name}</b></div><p class="muted small">${DECREES[now].text}. ${upgraded(b, 3) ? 'With the second throne two decrees are in force at once' : 'One decree is in force across the island at a time'}; issuing a new one costs ${PALACE_RULES.decreeCost} Belief.</p>`;
      if (upgraded(b, 3)) body += `<div class="kv"><span>Second throne</span><b>${b.decree2 && b.decree2 !== now ? DECREES[b.decree2].name : 'None yet'}</b></div>${b.decree2 && b.decree2 !== now ? `<p class="muted small">${DECREES[b.decree2].text}.</p>` : ''}`;
    }
    if (b.key === 'greathall' && b.complete) {
      const h = g.colony.hallCount(b);
      body += `<div class="kv"><span>Seats</span><b>100</b></div><div class="kv"><span>Resting</span><b>${h.resting}</b></div>
        <div class="kv"><span>Sheltering</span><b>${h.sheltering}</b></div>
        <div class="kv"><span>Room for</span><b>${HALL.seats.length} seated, ${HALL.stands.length + g.colony.hallCrowd(b)} standing</b></div>`;
    }
    if (b.key === 'healer' && b.complete) {
      const pts = g.colony.patients(b);
      body += `<div class="kv"><span>Beds in use</span><b>${pts.filter((p) => (p.task?.slot ?? -1) >= 0).length} / ${healerBeds(b)}</b></div><div class="sec-h">Patients</div>`;
      if (!pts.length) body += '<p class="muted small">Nobody is here. The sick and the injured come here to be cared for.</p>';
      for (const p of pts) {
        const cost = g.colony.cureCost(p);
        body += `<div class="kv"><span><button class="btn small ghost" data-a="patient:${p.id}" title="Select ${p.name}">${p.name}</button></span><b>${this.healthText(p)}</b></div>
          <div class="actions" style="margin-top:2px"><button class="btn small" data-a="cure:${p.id}" ${g.colony.canCure(p) ? '' : 'disabled'}>Cure <span class="c">${cost ? `${cost} food` : 'free'}</span></button>${(['medicine', 'spices'] as const).filter((k) => g.eco.goods[k] >= 1).map((k) => `<button class="btn small" data-a="cure${k}:${p.id}" title="Cure with ${GOODS[k].one}">${icon(k)} Cure <span class="c">1 ${k === 'medicine' ? 'medicine' : 'spice'}</span></button>`).join('')}</div>`;
      }
    }
    if (b.key === 'warroom' && b.complete) body += `<div class="kv"><span>Warriors</span><b>${g.colony.list.filter((i) => i.warrior).length}${b.training.length ? ` (+${b.training.length} training)` : ''}</b></div>`;
    if (b.key === 'watchtower' && b.complete) {
      const st = g.defence.stats(b);
      body += `<div class="kv"><span>Arrows loosed</span><b>${st.shots}</b></div><div class="kv"><span>Predators brought down</span><b>${st.kills}</b></div>
        <p class="muted small">Needs nobody to man it: arrows fly from its windows at jaguars and alligators within ${towerRange(b)} paces, day and night. Wounded beasts flee; a few hits kill one, but others will come in from beyond the island in time.</p>`;
    }
    if (b.complete && (b.key === 'pigpen' || b.key === 'chickenpen')) {
      body += `<div class="kv"><span>Animals in pen</span><b>${g.wildlife.penCount(b)} / ${penRoom(b)}</b></div>`;
      body += `<p class="muted small">${g.buildings.of('butcher',true).some(buildingOperational) ? 'Slaughterhouse workers collect these animals and take them there to prepare meat.' : 'Animals stay in this pen. Build a completed, working Slaughterhouse to turn penned animals into food.'}</p>`;
    }
    let actions = '';
    const rushLeft = g.eco.godMode ? null : g.buildings.rushSeconds(b);
    if (rushLeft !== null) {
      const n = rushPearls(rushLeft), have = Math.floor(g.eco.goods.pearls);
      actions += `<button class="btn small" data-a="rush" ${have >= n ? '' : 'disabled'} title="${have >= n ? 'Spend pearls to finish it now' : `You have ${have} pearl${have === 1 ? '' : 's'}`}">Finish now <span class="c">${icon('pearls')}${n}</span></button>`;
    }
    if (b.complete && (b.key === 'pigpen' || b.key === 'chickenpen')) actions += `<button class="btn small" data-a="roundup" ${g.wildlife.penCount(b) < penRoom(b) ? '' : 'disabled title="The pen is full"'}>${ICONS.people} ROUND UP</button><p class="muted small">Send idle adults to catch ${b.key === 'pigpen' ? 'pigs' : 'chickens'} and bring them to this pen.</p>`;
    if (b.key === 'palace' && b.complete) {
      const now = b.decree ?? PALACE_RULES.firstDecree;
      for (const k of Object.keys(DECREES) as DecreeKey[]) {
        if (k === now) continue;
        actions += `<button class="btn small" data-a="decree:${k}" ${g.eco.res.belief >= PALACE_RULES.decreeCost ? '' : 'disabled'} title="${DECREES[k].text}">${DECREES[k].name} <span class="c">${icon('belief')}${PALACE_RULES.decreeCost}</span></button>`;
      }
      if (upgraded(b, 3)) for (const k of Object.keys(DECREES) as DecreeKey[]) {
        if (k === now || k === b.decree2) continue;
        actions += `<button class="btn small" data-a="decree2:${k}" ${g.eco.res.belief >= PALACE_RULES.decreeCost ? '' : 'disabled'} title="Second throne: ${DECREES[k].text}">Also ${DECREES[k].name} <span class="c">${icon('belief')}${PALACE_RULES.decreeCost}</span></button>`;
      }
    }
    if (b.key === 'greathall' && b.complete) actions += `<button class="btn small" data-a="bell">${ICONS.bell} Ring the bell (drill)</button>`;
    const up = g.buildings.canUpgrade(b);
    if (b.complete && !b.upgrading && (b.key === 'hut' || (b.key === 'home' && b.tier < (b.def.maxTier ?? 1)) || (b.key === 'temple' && b.tier < 3) || (b.key === 'stonemason' && b.tier < 4) || (b.key === 'boatworkshop' && b.tier < 3))) {
      const c = up.cost;
      const next = [4, 7, 12, 16][b.key === 'hut' ? 0 : b.tier];
      const label = b.key === 'boatworkshop' ? `Research level ${b.tier+1}: ${BOAT_WORKSHOP.upgrades[b.tier-1].unlock}` : b.key === 'stonemason' ? `Workshop upgrade ${b.tier}: ${STONEMASON.upgrades[b.tier - 1].unlock}` : b.key === 'hut' ? 'Upgrade to level 2 (4 people)' : b.key === 'home' ? `Upgrade to level ${b.tier + 2} (${next} people)` : b.tier === 2 ? 'Raise the Great Pyramid' : 'Upgrade temple';
      actions += `<button class="btn small" data-a="upgrade" ${up.ok ? '' : 'disabled'} title="${up.reason}">${ICONS.upgrade} ${label} <span class="c">${c.wood ? icon('wood') + c.wood : ''} ${c.stone ? icon('stone') + c.stone : ''} ${c.belief ? icon('belief') + c.belief : ''} ${c.carvedStone ? icon('carvedstone') + c.carvedStone : ''} ${c.food ? icon('grain') + c.food + ' food' : ''}</span></button>`;
    }
    if(!up.ok && up.reason && ['hut','home','temple','stonemason','boatworkshop'].includes(b.key)) actions+=`<p class="muted small">${up.reason}</p>`;
    const steps = UPGRADES[b.key];
    if (steps && b.complete) {
      const done = b.tier - 1, next = steps[done];
      body += `<div class="sec-h">Upgrades ${done}/${steps.length}</div>` + steps.map((st, k) =>
        `<div class="kv upg${k < done ? ' done' : ''}"><span>${k < done ? '✓' : `${k + 1}.`} ${st.name}</span><b>${st.text}</b></div>`).join('');
      if (next && !b.upgrading) {
        const c = up.cost;
        actions += `<button class="btn small" data-a="upgrade" ${up.ok ? '' : 'disabled'} title="${up.reason}">${ICONS.upgrade} ${next.name} <span class="c">${c.wood ? icon('wood') + c.wood : ''} ${c.stone ? icon('stone') + c.stone : ''} ${c.belief ? icon('belief') + c.belief : ''} ${c.carvedStone ? icon('carvedstone') + c.carvedStone : ''}</span></button>`;
        if (!up.ok && up.reason) actions += `<p class="muted small">${up.reason}</p>`;
      }
    }
    if (b.key === 'jetty' && b.complete) {
      const c = JETTY.boatCost;
      actions += `<button class="btn small" data-a="boat" ${!g.buildings.boatRequirement(1) && b.boats.length + (b.boatBuild > 0 ? 1 : 0) < jettyBoats(b) && !b.boatBuild && g.eco.canAfford(c) ? '' : 'disabled'}>${ICONS.boat} Build canoe <span class="c">${icon('wood')}${c.wood}</span></button>`;
    }
    if(b.key==='jetty'&&b.complete){const c=BOAT_WORKSHOP.largeCost,reason=g.buildings.boatRequirement(2);
      actions+=`<button class="btn small" data-a="largeboat" ${!reason && !b.boatBuild && b.boats.length<jettyBoats(b) && g.eco.canAfford(c)?'':'disabled'}>${ICONS.boat} Build larger boat <span class="c">${icon('wood')}${c.wood} ${icon('stone')}${c.stone}</span></button>`;
      if(reason)actions+=`<p class="muted small">${g.buildings.boatRequirement(1)||reason}</p>`;
    }
    if (b.key === 'tradedock' && b.complete) {
      const c = TRADE.boatCost;
      const boatLock=g.buildings.boatRequirement(3);
      if(boatLock)actions+=`<p class="muted small">${boatLock}</p>`;
      const canBoat = !boatLock && !b.boatBuild && g.trade.of(b).length + (b.boatBuild > 0 ? 1 : 0) < tradeBoatsAt(b) && g.eco.canAfford(c);
      actions += `<button class="btn small" data-a="trade">${ICONS.boat} Trade goods</button>`;
      actions += `<button class="btn small" data-a="tradeboat" ${canBoat ? '' : 'disabled'}>${ICONS.boat} Build trade boat <span class="c">${icon('wood')}${c.wood} ${icon('stone')}${c.stone}</span></button>`;
    }
    if (b.key === 'firemaker' && b.complete) {
      const why = g.fireworksBlock(b);
      actions += `<button class="btn small" data-a="fireworks" ${why ? 'disabled' : ''} title="${why}">${icon('fireworks')} Launch fireworks <span class="c">${icon('fireworks')}${FIREWORKS.perShow}</span></button>`;
    }
    if (b.key === 'kennel' && b.complete) {
      const ok = g.dogs.canBreed(b);
      actions += `<button class="btn small" data-a="breed" ${ok.ok ? '' : 'disabled'} title="${ok.reason}">${ICONS.dog} Breed dog <span class="c">${DOGS.breedFood} food</span></button>`;
      if (!ok.ok) actions += `<p class="muted small">${ok.reason}.</p>`;
      actions += `<div class="sec-h">Role</div><div class="seg">
        <button class="btn small${b.dogRole === 'roam' ? ' on' : ''}" data-a="dogroam" title="Dogs wander farther and go out with hunters and explorers">Free roam</button>
        <button class="btn small${b.dogRole === 'guard' ? ' on' : ''}" data-a="dogguard" title="Dogs stay close to the houses and people">Guard settlement</button></div>`;
    }
    if (b.key === 'warroom' && b.complete) {
      const c = WARRIOR.cost;
      const cs = `<span class="c">${icon('wood')}${c.wood} ${icon('stone')}${c.stone} ${icon('belief')}${c.belief}</span>`;
      actions += `<button class="btn small" data-a="jaguar" ${g.eco.canAfford(c) ? '' : 'disabled'}>${ICONS.warrior} Jaguar ${cs}</button><button class="btn small" data-a="eagle" ${g.eco.canAfford(c) ? '' : 'disabled'}>${ICONS.eagle} Eagle ${cs}</button>`;
    }
    if (!b.complete || b.upgrading) actions += `<button class="btn small" data-a="helpers" title="Call the nearest free villagers to come and build">${ICONS.people} Call helpers</button>`;
    if (g.buildings.canRelocate(b)) actions += `<button class="btn small" data-a="rotate" title="Turn a quarter turn">${ICONS.rotate} Rotate</button><button class="btn small" data-a="move" title="Pick it up and place it somewhere else">${ICONS.move} Move</button>`;
    if (b.key !== 'campfire') actions += `<button class="btn small ghost" data-a="demolish">${ICONS.demolish} ${b.complete ? 'Demolish' : 'Cancel'}</button>`;
    return `<div class="card-head"><span><span class="bic">${ICONS[BUILD_ICON[b.key]]}</span> ${b.label}</span></div>
      <p class="muted small">${b.def.description}</p>${body}<div class="actions">${actions}</div>`;
  }

  private infoAction(a: string, islId: number | undefined, b: Building | undefined, animalId?: number): void {
    if (a === 'clear-area') { this.game.clearSelectedArea(); this.renderInfo(true); return; }
    if (a === 'cancel-area') { this.game.clearAreaSelection(); this.renderInfo(true); return; }
    if (a.startsWith('district-') && isHouseStyle(a.slice(9))) { this.game.makeDistrict(a.slice(9) as HouseStyle); this.renderInfo(true); return; }
    if (a === 'remove-district') { this.game.removeDistricts(); this.renderInfo(true); return; }
    const g = this.game;
    g.audio?.sfx('click');
    if (a === 'group-wood' || a === 'group-stone') {
      g.collectWithSelectedGroup(a === 'group-wood' ? 'wood' : 'stone');
      return;
    }
    if (a === 'group-auto') {
      for (const id of g.selectedIslanders) {
        const person = g.colony.byId(id);
        if (!person) continue;
        person.manualRole = false; person.workplace = -1; person.role = 'idle'; person.focusPlant = -1; person.think = 0;
        g.colony.cancelTask(person);
      }
      g.select(null);
      return;
    }
    if (animalId !== undefined && a === 'capture') g.captureAnimal(animalId);
    if (islId !== undefined) {
      const isl = g.colony.byId(islId);
      if (!isl) return;
      if (a === 'explore') g.toggleExplore();
      if (a === 'follow') g.follow(g.followId === isl.id ? -1 : isl.id);
      if (a === 'req-build') {
        const req = g.requests?.of(isl.id);
        const reason = req ? g.buildings.constructionRequirement(req.key) : '';
        if (reason) this.toast(reason, 'warn');
        else if (req) g.startPlacing(req.key);
      }
      if (a === 'auto') {
        isl.manualRole = false;
        isl.workplace = -1;
        isl.role = 'idle';
        g.colony.cancelTask(isl);
      }
    }
    if (b) {
      if (a === 'repair') { this.toast(g.buildings.repair(b)); this.renderInfo(true); return; }
      if (a === 'rush') {
        const left = g.buildings.rushSeconds(b), n = left === null ? 0 : rushPearls(left);
        if (left !== null && g.eco.goods.pearls >= n) {
          g.eco.goods.pearls -= n;
          g.buildings.rush(b);
          g.audio?.sfx('build', b.x, b.z);
        }
        this.renderInfo(true);
        return;
      }
      if (a === 'calmfire') { g.powers.calm(); this.renderInfo(true); return; }
      if (a.startsWith('patient:')) g.select({ islander: Number(a.slice(8)) });
      if (a.startsWith('curemedicine:') || a.startsWith('curespices:')) {
        const good = a.startsWith('curemedicine:') ? 'medicine' : 'spices';
        const p = g.colony.byId(Number(a.slice(a.indexOf(':') + 1)));
        if (p && g.colony.cureWith(p, good)) this.toast(`${p.name} is cured with ${GOODS[good].one} and will go back to work.`);
        else this.toast(`No ${good} left.`, 'warn');
      }
      if (a === 'vbuild') this.toast(g.voyage.buildAt(b));
      if (a === 'vsail') this.toast(g.voyage.sail());
      if (a === 'vunload') this.toast(g.voyage.unload());
      if (a === 'vcalm') this.toast(g.voyage.calm(), g.voyage.calmed ? 'info' : 'warn');
      if (a.startsWith('vl+:') || a.startsWith('vl-:')) {
        const msg = g.voyage.load(a.slice(4) as CargoKey, a[2] === '+' ? 1 : -1);
        if (msg) this.toast(msg, 'warn');
        g.audio?.sfx('click');
      }
      if (a.startsWith('cure:')) {
        const p = g.colony.byId(Number(a.slice(5)));
        const cost = p ? g.colony.cureCost(p) : 0;
        if (p && g.colony.cure(p)) this.toast(`${p.name} is cured${cost ? ` (${cost} food)` : ''} and will go back to work.`);
        else this.toast('Not enough food to cure them.', 'warn');
      }
      if (a === 'roundup') g.roundUpAnimals(b);
      if (a === 'bell') g.ringHallBell(b);
      if (a.startsWith('research:')) {
        const tier = Number(a.slice(9));
        const err = g.research.start(tier);
        if (err) this.toast(err, 'warn');
        else this.toast(`The priests begin to study ${RESEARCH[tier - 1].name}.`);
        this.renderInfo(true);
        return;
      }
      if (a.startsWith('decree:')) {
        const k = a.slice(7) as DecreeKey;
        if (k in DECREES && g.buildings.setDecree(b, k)) this.toast(`The Tlatoani decrees ${DECREES[k].name}: ${DECREES[k].text.toLowerCase()}.`);
        else this.toast(`Issuing a decree needs ${PALACE_RULES.decreeCost} Belief.`, 'warn');
      }
      if (a.startsWith('decree2:')) {
        const k = a.slice(8) as DecreeKey;
        if (k in DECREES && g.buildings.setDecree(b, k, true)) this.toast(`From the second throne, the Tlatoani also decrees ${DECREES[k].name}: ${DECREES[k].text.toLowerCase()}.`);
        else this.toast(`Issuing a decree needs ${PALACE_RULES.decreeCost} Belief.`, 'warn');
      }
      if (a === 'helpers') {
        const came = g.colony.callHelpers(b);
        this.toast(came.length ? `${came.length === 1 ? came[0].name + ' is' : came.length + ' villagers are'} coming to help build the ${b.label}.` : 'Nobody is free nearby to help.', came.length ? 'info' : 'warn');
      }
      if (a === 'upgrade') {
        const nb = g.buildings.upgrade(b);
        if (nb) {
          const step = UPGRADES[b.key]?.[nb.upgrading ? nb.tier - 1 : nb.tier - 2];
          if (step) this.toast(nb.upgrading ? `Work begins on the ${b.def.name}: ${step.name.toLowerCase()}.` : `${b.def.name}: ${step.name.toLowerCase()} done.`);
          else if (nb.complete && !nb.upgrading) this.toast(nb.key === 'home' ? `The house is now level ${nb.tier + 1}.` : 'The temple rises a tier.');
          else this.toast(b.key === 'hut' ? 'The hut will be rebuilt as a level 2 Home.' : b.key === 'home' ? `The house is being extended to level ${b.tier + 2}.` : 'Temple upgrade started.');
          if (nb !== b) g.select({ building: nb.id });
        }
      }
      if (a === 'rotate') {
        g.rotateBuilding(b);
        return;
      }
      if (a === 'move') {
        g.startMove(b);
        return;
      }
      if (a === 'demolish') {
        g.buildings.remove(b, !b.ruined);
        g.select(null);
      }
      if (a === 'boat') g.buildBoat(b);
      if (a === 'fireworks') this.toast(g.launchFireworks(b));
      if (a === 'largeboat') {if(g.boats.order(b,true))this.toast('Work begins on a larger fishing boat.');}
      if (a === 'tradeboat') this.toast(g.trade.orderBoat(b));
      if (a.startsWith('visit')) this.toast(g.trade.accept(b, parseInt(a.slice(5), 10)));
      if (a === 'breed') this.toast(g.dogs.breed(b));
      if (a === 'dogroam' || a === 'dogguard') {
        b.dogRole = a === 'dogguard' ? 'guard' : 'roam';
        this.toast(b.dogRole === 'guard' ? 'The dogs will stay close and guard the settlement.' : 'The dogs are free to roam and go out with villagers.');
        this.renderInfo(true);
      }
      if (a === 'trade') this.openTrade(b);
      if (a === 'jaguar' || a === 'eagle') {
        if (g.colony.trainWarrior(b, a)) this.toast(`A ${a === 'jaguar' ? 'Jaguar' : 'Eagle'} warrior begins training.`);
        else this.toast('Nobody is free to train, or not enough resources.', 'warn');
      }
    }
    this.infoKey = '';
    this.refresh(true);
  }

  /** The Trade Dock card's voyage ship section: build it, load it, send it, calm a storm, unload. */
  private voyageSection(b: Building): string {
    const g = this.game, V = g.voyage;
    const name = (k: CargoKey) => (k in GOODS ? GOODS[k as GoodKey].name : k[0].toUpperCase() + k.slice(1));
    let h = `<div class="sec-h">${icon('voyage')} Voyage ship</div>`;
    if (V.state === 'none') {
      const why = V.whyNotBuild(b), c = VOYAGE.shipCost;
      h += `<p class="muted small">A great ship to load with goods and send off beyond the horizon with ${VOYAGE.crew} villagers. Out there it may meet storms and raiders, or good markets; it comes home with chickens, herbs and spices for healing, and goods. Some voyages never return.</p>
        <div class="actions"><button class="btn small" data-a="vbuild" ${why ? 'disabled' : ''} title="${why ?? ''}">${icon('voyage')} Build voyage ship <span class="c">${icon('wood')}${c.wood} ${icon('stone')}${c.stone}</span></button></div>`;
      return h;
    }
    if (V.dock !== b.id) return h + '<p class="muted small">The island\'s voyage ship belongs to another Trade Dock.</p>';
    if (V.state === 'building') return h + this.bar(`Shipwrights at work ${Math.round((V.build / VOYAGE.buildSeconds) * 100)}%`, V.build / VOYAGE.buildSeconds, 'good');
    const news = V.log.length ? `<div class="vnews">${V.log.slice(-4).map((l) => `<div class="muted small">· ${l}</div>`).join('')}</div>` : '';
    if (V.state === 'docked' && V.haul) {
      return h + `<div class="kv"><span>Home from ${V.place}</span><b class="good">Goods waiting aboard</b></div>${news}
        <div class="kv"><span>Aboard</span><b>${haulText(V.haul)}</b></div>
        <div class="actions"><button class="btn small" data-a="vunload">${icon('voyage')} Unload the goods</button></div>`;
    }
    if (V.state === 'docked') {
      const rows = CARGO_KEYS.map((k) => {
        const have = k in GOODS ? g.eco.goods[k as GoodKey] : g.eco.res[k as ResourceKey];
        const n = V.hold[k] ?? 0;
        if (!n && have < 1) return '';
        return `<div class="vrow"><span class="vname">${icon(k)} ${name(k)}</span><span class="muted small">${Math.floor(have)} in store</span><span class="vctl"><button class="btn small ghost" data-a="vl-:${k}" ${n ? '' : 'disabled'}>−</button><b class="vn">${n}</b><button class="btn small ghost" data-a="vl+:${k}" ${have >= 1 ? '' : 'disabled'}>+</button></span></div>`;
      }).join('');
      const why = V.whyNotSail();
      const worth = Math.round(holdValue(V.hold));
      return h + `<p class="muted small">Load goods from your stores (pearls are worth the most abroad), then set sail. ${VOYAGE.crew} villagers go as crew.</p>
        <div class="vrows">${rows || '<p class="muted small">The stores are empty.</p>'}</div>
        <div class="kv"><span>Cargo worth</span><b>${worth}</b></div>${V.voyages ? news : ''}
        <div class="actions"><button class="btn small" data-a="vsail" ${why ? 'disabled' : ''} title="${why ?? ''}">${icon('voyage')} Set sail</button>${why ? ` <span class="muted small">${why}</span>` : ''}</div>`;
    }
    const where = V.state === 'out' ? 'Sailing out to sea' : V.state === 'back' ? 'Sailing home: coming in to the dock' : `Away at ${V.place} (expected back in about ${Math.max(1, Math.ceil((V.timer + 20) / 60))} min)`;
    h += `<div class="kv"><span>Status</span><b>${where}</b></div>`;
    if (V.crew.length) h += `<div class="kv"><span>Crew</span><b>${V.crew.map((c) => c.name).join(', ')}</b></div>`;
    if (V.storm > 0) {
      const ok = g.eco.res.belief >= VOYAGE.calmCost || g.eco.godMode;
      h += `<p class="warn small">A storm is raging around the ship! ${Math.ceil(V.storm)} seconds to calm it before it does its worst.</p>
        <div class="actions"><button class="btn small" data-a="vcalm" ${ok ? '' : 'disabled'}>${icon('calm')} Calm the far seas <span class="c">${icon('belief')}${VOYAGE.calmCost}</span></button></div>`;
    }
    return h + news;
  }

  // ---------------- Minimap ----------------

  private drawMinimap(): void {
    const g = this.game;
    const w = g.world;
    const ctx = this.minimap.getContext('2d')!;
    const S = this.minimap.width;
    if (!this.miniBase || this.miniVersion !== w.version) {
      this.miniVersion = w.version;
      const img = ctx.createImageData(S, S);
      const cols: Record<number, [number, number, number]> = {
        [Ground.Sand]: [242, 221, 176], [Ground.Grass]: [156, 194, 58], [Ground.Jungle]: [47, 122, 51], [Ground.Rock]: [154, 140, 138], [Ground.River]: [63, 214, 224],
      };
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const cx = Math.floor((x / S) * w.N), cz = Math.floor((y / S) * w.N);
          const i = w.idx(cx, cz);
          const L = w.layer[i];
          let c: [number, number, number];
          if (w.ground[i] === Ground.Water) {
            const d = Math.min(1, -L / 6);
            c = [Math.round(63 - 52 * d), Math.round(214 - 135 * d), Math.round(224 - 68 * d)];
          } else {
            c = cols[w.ground[i]] ?? [156, 194, 58];
            const shade = 0.82 + Math.min(10, L) * 0.025;
            c = [c[0] * shade, c[1] * shade, c[2] * shade];
          }
          const k = (y * S + x) * 4;
          img.data[k] = c[0];
          img.data[k + 1] = c[1];
          img.data[k + 2] = c[2];
          img.data[k + 3] = 255;
        }
      }
      this.miniBase = img;
    }
    ctx.putImageData(this.miniBase, 0, 0);
    const k = S / w.N;
    const toPx = (x: number, z: number): [number, number] => [(x + w.half) * k, (z + w.half) * k];
    for (const b of g.buildings.list) {
      const [x, y] = toPx(b.cx - w.half, b.cz - w.half);
      ctx.fillStyle = b.complete ? (['temple', 'greattemple'].includes(b.key) ? '#ffd24a' : '#f5e6c4') : 'rgba(245,230,196,0.5)';
      ctx.fillRect(x, y, Math.max(2, b.w * k), Math.max(2, b.d * k));
    }
    ctx.fillStyle = '#ffffff';
    for (const i of g.colony.list) {
      if (i.hidden) continue;
      const [x, y] = toPx(i.x, i.z);
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
    ctx.fillStyle = '#1b2a38';
    for (const wh of g.marine.positions()) {
      const [x, y] = toPx(wh.x, wh.z);
      ctx.beginPath();
      ctx.ellipse(x, y, 2.6, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const bt of g.boatList()) {
      const [x, y] = toPx(bt.x, bt.z);
      ctx.fillStyle = '#8b5a34';
      ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }
    // Camera view footprint.
    const r = g.rig;
    const [cx, cy] = toPx(r.cur.x, r.cur.z);
    const half = r.viewRadius * 0.55 * k;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-r.cur.yaw);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-half * g.rig.camera.aspect * 0.7, -half * 0.7, half * g.rig.camera.aspect * 1.4, half * 1.4);
    ctx.restore();
  }

  /** Starting a new island: pick the kind of island, then confirm (the current one is replaced). */
  private chooseIsland(sandbox: boolean): void {
    const current = this.game.world?.islandType;
    const modal = el('div', 'modal island-modal');
    const cards = (Object.keys(ISLAND_TYPES) as IslandType[]).map((t) => {
      const it = ISLAND_TYPES[t];
      return `<button type="button" class="island-pick" data-type="${t}">
        <span class="ip-map" aria-hidden="true">${ISLAND_ICONS[t]}</span>
        <span class="ip-text"><span class="ip-name"><b>${it.name}</b>${t === current ? '<span class="ip-now">Current</span>' : ''}</span><span>${it.about}</span><em>${it.resources}</em></span>
      </button>`;
    }).join('');
    modal.innerHTML = `<div class="panel card island-card" role="dialog" aria-labelledby="ip-title">
      <div class="card-head"><span id="ip-title">${sandbox ? 'New Sandbox island' : 'Choose your island'}</span><button class="ib small" data-a="close" aria-label="Close">${ICONS.close}</button></div>
      <p class="muted small">Your current island will be replaced. Copy it first (Settings → Copy island) to keep it.</p>
      <div class="island-picks">${cards}</div>
    </div>`;
    modal.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === modal || target.closest('[data-a="close"]')) { modal.remove(); return; }
      const pick = target.closest<HTMLButtonElement>('[data-type]');
      if (!pick) return;
      const t = pick.dataset.type as IslandType;
      if (confirm(`Start a new ${ISLAND_TYPES[t].name}${sandbox ? ' Sandbox' : ''}? Your progress on this island will be lost.`)) this.game.newIsland(sandbox, t);
    };
    this.root.appendChild(modal);
  }

  /** Back after a while: how long, what the islanders gathered, and what the village needs next. */
  welcomeBack(seconds: number, gains: Partial<Record<ResourceKey, number>>): void {
    if (this.photo?.open || this.zen) return;
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    const away = seconds >= 86400 ? `${Math.floor(seconds / 86400)} day${seconds >= 172800 ? 's' : ''}` : h ? `${h} h ${m} min` : `${m} minutes`;
    const food = (gains.grain ?? 0) + (gains.fruit ?? 0) + (gains.meat ?? 0) + (gains.fish ?? 0);
    const list = [['wood', gains.wood], ['stone', gains.stone], ['grain', food], ['belief', gains.belief]]
      .filter(([, n]) => (n as number) > 0)
      .map(([k, n]) => `<span class="wb-gain">${icon(k as string)}<b>+${n}</b> ${k === 'grain' ? 'food' : k}</span>`).join('');
    const p = this.game.progression, next = p.stage + 1;
    const goal = next <= TITLES.length && !this.game.eco.godMode
      ? (() => { const items = p.checklist(next).filter((i) => !(i.done && i.text.startsWith('Reach '))); const todo = items.find((i) => !i.done);
        return `<p class="wb-next"><b>Next: ${TITLES[next - 1]}</b> · ${items.filter((i) => i.done).length} of ${items.length} done${todo ? `<br><span class="muted">${todo.text}</span>` : ''}</p>`; })()
      : '';
    this.dialog.push({
      icon: 'home', kicker: `You were away ${away}`, title: `Welcome back to ${this.game.islandName}`, html: true,
      body: (list ? `<p>Your islanders kept busy while you were gone:</p><div class="wb-gains">${list}</div>` : '<p>Your islanders have been waiting for you. All is well on the island.</p>') + goal,
      actions: [{ label: 'Back to the island', primary: true }], important: true,
    });
    this.game.audio?.sfx('milestone');
  }

  /**
   * Today's chest: a row of the week's chests with today's lit up, and a button to open it. Shown
   * even when pop-ups are turned off (it is a reward to collect, not a notice).
   */
  dailyChest(day: number, pearls: number, claim: () => void): void {
    const week = DAILY_PEARLS.map((n, i) => {
      const d = i + 1, cur = Math.min(day, DAILY_PEARLS.length);
      return `<span class="dc-day${d < cur ? ' done' : d === cur ? ' today' : ''}"><small>Day ${d}${d === DAILY_PEARLS.length ? '+' : ''}</small>${icon('pearls')}<b>${n}</b></span>`;
    }).join('');
    this.dialog.push({
      icon: 'star', kicker: day > 1 ? `${day} days in a row` : 'A gift from the sea', title: 'Daily chest', html: true, always: true,
      body: `<div class="dc-week">${week}</div><p>Open a chest every day to keep your streak going: the pearls grow each day. Spend them to finish a build straight away, or trade them on a voyage.</p>`,
      actions: [{ label: `Open · ${pearls} pearl${pearls === 1 ? '' : 's'}`, primary: true, run: claim }],
    });
  }

  milestone(id: string): void {
    const m = MILESTONES.find((x) => x.id === id);
    if (m) this.toast(m.text, 'milestone');
  }

  setToolFromKey(id: ToolId): void {
    this.game.setTool(id);
  }
}
