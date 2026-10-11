import { VILLAGE_PRIORITIES, type VillagePriority } from '../ai/VillagePriority';

/** Small, collapsible workforce controls; simulation changes wait for its normal job tick. */
export class VillagePrioritiesPanel {
  readonly button = document.createElement('button');
  readonly panel = document.createElement('section');
  private choices: HTMLButtonElement[] = [];
  private current?: VillagePriority;

  constructor(private get: () => VillagePriority, private set: (value: VillagePriority) => void, beforeOpen: () => void) {
    this.button.className = 'inventory-toggle village-toggle';
    this.button.type = 'button';
    this.button.setAttribute('aria-controls', 'village-priorities');
    this.button.setAttribute('aria-expanded', 'false');
    this.panel.className = 'panel village-priorities hidden';
    this.panel.id = 'village-priorities';
    this.panel.setAttribute('aria-label', 'Village priorities');
    this.panel.innerHTML = '<h2>Village priorities</h2><p class="muted small">Workers change jobs gradually after finishing their current task; individual orders and needs come first.</p>';
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Workforce preference');
    for (const [key, option] of Object.entries(VILLAGE_PRIORITIES)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'village-choice';
      button.dataset.priority = key;
      button.innerHTML = `<strong>${option.label}</strong><span>${option.effect}</span>`;
      button.onclick = () => { this.set(key as VillagePriority); this.sync(); };
      button.onkeydown = event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = this.choices.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.choices.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + this.choices.length) % this.choices.length;
        this.choices[next].focus();
      };
      this.choices.push(button);
      group.append(button);
    }
    this.panel.append(group);
    this.panel.onkeydown = event => {
      event.stopPropagation(); // Space/arrows here must not pause or pan the island.
      if (event.key === 'Escape') { event.preventDefault(); this.close(); this.button.focus(); }
    };
    this.button.onkeydown = event => event.stopPropagation();
    this.button.onclick = () => {
      if (!this.panel.classList.contains('hidden')) { this.close(); return; }
      beforeOpen();
      this.sync();
      this.panel.classList.remove('hidden');
      this.button.setAttribute('aria-expanded', 'true');
    };
    this.sync();
  }

  sync(): void {
    const priority = this.get();
    if (priority === this.current) return;
    this.current = priority;
    this.button.innerHTML = `<span>Village · ${VILLAGE_PRIORITIES[priority].label}</span><span class="inventory-chevron" aria-hidden="true">⌄</span>`;
    this.button.setAttribute('aria-label', `Village priorities: ${VILLAGE_PRIORITIES[priority].label}`);
    for (const button of this.choices) button.setAttribute('aria-pressed', String(button.dataset.priority === priority));
  }

  close(): boolean {
    const open = !this.panel.classList.contains('hidden');
    this.panel.classList.add('hidden');
    this.button.setAttribute('aria-expanded', 'false');
    return open;
  }
}
