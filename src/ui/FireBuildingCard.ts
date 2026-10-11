import type { Building } from '../buildings/Buildings';
import type { Cost } from '../economy/Economy';

/** Compact replacement for production controls while a building is out of service. */
export function fireBuildingCard(b: Building, status: string, cost: Cost, affordable: boolean, storm: boolean): string {
  const condition = Math.round(b.integrity * 100);
  const canRepair = b.fire <= 0 && !b.repairing && affordable;
  return `<div class="card-head"><span>${b.label}${b.ruined ? ' · Ruins' : ''}</span></div>
    <p class="muted small">${b.def.description}</p>
    <div class="kv"><span>${b.fire > 0 ? 'On fire' : b.ruined ? 'Destroyed' : 'Damaged'}</span><b>Condition ${condition}%</b></div>
    <progress class="fire-condition" aria-label="Building condition" max="1" value="${b.integrity}"></progress>
    <p class="small">${status}</p>
    ${b.repairing ? `<progress class="fire-repair" aria-label="Repair progress" max="1" value="${b.repairProgress}"></progress>` : ''}
    <p class="muted small">Level ${b.houseLevel || b.tier} is retained.${b.upgrading ? ` Upgrade progress ${Math.round(b.progress * 100)}% is retained.` : ''}</p>
    <div class="actions fire-actions">
      ${!b.repairing ? `<button class="btn small" data-a="repair" ${canRepair ? '' : 'disabled'}>${b.ruined ? 'Rebuild' : 'Repair'} · ${cost.wood} wood · ${cost.stone} stone</button>` : b.fire <= 0 ? '<button class="btn small" data-a="helpers">Call repair helpers</button>' : ''}
      ${storm ? '<button class="btn small" data-a="calmfire">Calm Storm · 50 Belief</button>' : ''}
      <button class="btn small ghost" data-a="demolish">${b.ruined ? 'Clear ruins' : 'Demolish'}</button>
    </div>
    ${b.fire > 0 ? '<p class="muted small">Extinguish the fire first. Damage remains after the flames are out and needs repairing.</p>' : !b.repairing && !affordable ? '<p class="muted small">Gather the required wood and stone to begin repairs.</p>' : ''}`;
}
