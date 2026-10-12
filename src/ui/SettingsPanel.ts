import { ICONS } from './icons';

const switchRow = (key: string, label: string, note = '', inverted = false) => `<label class="settings-row settings-switch-row"><span>${label}${note ? `<small>${note}</small>` : ''}</span><input type="checkbox" role="switch" data-k="${key}"${inverted ? ' data-invert="true"' : ''}></label>`;
const action = (name: string, label: string, icon: string) => `<button type="button" class="settings-action" data-a="${name}"><span class="settings-action-icon" aria-hidden="true">${ICONS[icon]}</span><span>${label}</span><span class="settings-chevron" aria-hidden="true">›</span></button>`;
const slider = (key: string, label: string, max = 1) => `<label class="settings-slider"><span>${label}<output data-value="${key}"></output></span><input type="range" min="0" max="${max}" step="0.05" data-k="${key}"></label>`;

export function settingsMarkup(): string {
  return `<header class="settings-header"><span class="settings-ornament" aria-hidden="true">◇</span><h1 id="settings-title">Settings</h1><span class="settings-ornament" aria-hidden="true">◇</span><button type="button" class="settings-close" data-a="close" aria-label="Close settings">${ICONS.close}</button></header>
  <nav class="settings-tabs" role="tablist" aria-label="Settings categories">${['Game', 'Graphics', 'Sound'].map((name, i) => `<button type="button" role="tab" id="settings-tab-${name.toLowerCase()}" aria-controls="settings-${name.toLowerCase()}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${name}</button>`).join('')}</nav>
  <div class="settings-body">
    <section id="settings-game" role="tabpanel" aria-labelledby="settings-tab-game">
      <h2>Your island</h2>
      <div class="settings-row settings-name"><label for="settings-island-name">Island name</label><span class="settings-name-edit"><input id="settings-island-name" type="text" maxlength="32" spellcheck="false" autocomplete="off" data-n="name"><button type="button" class="settings-random" data-a="rename" title="Pick a random island name" aria-label="Pick a random island name">${ICONS.o_new}</button></span></div>
      ${action('save', 'Save island', 'o_save')}${action('copy', 'Copy island', 'o_link')}${action('load', 'Load island', 'o_save')}
      <p class="settings-note">Progress autosaves. Copy island creates a file you can share or keep.</p>
      <h2>Help</h2>${action('help', 'How to play', 'o_help')}${action('tutorial', 'Tutorial', 'o_tutorial')}
      <label class="settings-row settings-switch-row godrow hidden"><span>Instant building</span><input type="checkbox" role="switch" data-k="instantBuild"></label>
      <details class="settings-disclosure settings-new"><summary>Start a new island<span aria-hidden="true">›</span></summary><div class="settings-details"><p class="settings-note">Starting again replaces your current island. Copy it first to keep it.</p>${action('new', 'Normal game', 'o_new')}<div class="godrow hidden">${action('sandbox', 'Sandbox · unlimited resources', 'o_new')}</div></div></details>
      <input type="file" data-a="island-file" accept=".json,application/json" hidden>
    </section>
    <section id="settings-graphics" role="tabpanel" aria-labelledby="settings-tab-graphics" hidden>
      <h2>Display</h2>
      <label class="settings-row">Detail<select data-k="preset" aria-label="Graphics detail"><option value="ultra">Ultra</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
      ${switchRow('shadows', 'Shadows')}${switchRow('dayNight', 'Day & night')}${switchRow('weather', 'Weather')}${switchRow('motion', 'Plant movement', 'Includes leaves and sea spray')}
      <h2>Performance</h2>${switchRow('motionRes', 'Smoother camera movement', 'Adjusts resolution while moving')}
      <details class="settings-disclosure"><summary>Advanced options<span aria-hidden="true">›</span></summary><div class="settings-details">
        ${switchRow('autoQuality', 'Automatic graphics', 'Lowers detail if the frame rate drops')}${switchRow('pixel', 'Pixel style')}${switchRow('dof', 'Depth of field')}${slider('dofStrength', 'Blur strength', 2)}${switchRow('fps', 'Show FPS')}${switchRow('showMap', 'Show map button')}
      </div></details>
    </section>
    <section id="settings-sound" role="tabpanel" aria-labelledby="settings-tab-sound" hidden>
      <h2>Audio</h2>${switchRow('muted', 'Sound', '', true)}${slider('volume', 'Volume')}${slider('music', 'Music')}
      <h2>Village</h2>${switchRow('wildlifeAlerts', 'Wildlife encounters', 'Optional alerts with a Watch action; animals still visit when off')}${switchRow('chatter', 'Islander chatter', 'Hear conversations when you zoom in')}
    </section>
  </div>
  <footer class="settings-footer"><button type="button" class="settings-return" data-a="return">Return to island</button></footer>`;
}

/** Accessible single-tab navigation; changing tabs never rebuilds controls or loses their state. */
export function wireSettingsTabs(card: HTMLElement): void {
  const tabs = [...card.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const activate = (chosen: HTMLButtonElement) => {
    for (const tab of tabs) {
      const selected = tab === chosen;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      card.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)!.hidden = !selected;
    }
    card.querySelector('.settings-body')!.scrollTop = 0;
  };
  tabs.forEach((tab, index) => {
    tab.onclick = () => activate(tab);
    tab.onkeydown = e => {
      let next: number;
      if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      else return;
      e.preventDefault(); activate(tabs[next]); tabs[next].focus();
    };
  });
}
