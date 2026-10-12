import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNotice, QUIET_BUILDINGS } from '../src/ui/buildingNotice';
import { BUILDINGS, ECONOMY, HOMES, STONEMASON, type BuildingKey } from '../src/config';

const fresh = (key: BuildingKey, extra: object = {}) => ({ key, tier: 1, label: BUILDINGS[key].name, lastWork: { upgrade: false, fromTier: 1 }, ...extra });

test('completion banners report the real benefit of each new building', () => {
  assert.deepEqual(buildingNotice(fresh('hut')), { title: 'Building Complete', line: 'Hut constructed successfully', benefit: '+2 Islander Capacity' });
  assert.equal(buildingNotice(fresh('home')).benefit, `+${BUILDINGS.home.housing} Islander Capacity`);
  // A house built in place of a hut adds only the extra room.
  assert.equal(buildingNotice(fresh('home', { fromHut: true })).benefit, `+${BUILDINGS.home.housing! - BUILDINGS.hut.housing!} Islander Capacity`);
  assert.equal(buildingNotice(fresh('woodstore')).benefit, `+${BUILDINGS.woodstore.woodCap} Wood & Stone Storage`);
  assert.equal(buildingNotice(fresh('grainstore')).benefit, `+${BUILDINGS.grainstore.foodCap} Food Storage`);
  assert.equal(buildingNotice(fresh('temple')).benefit, `+${ECONOMY.beliefCapPerTempleTier} Belief Capacity`);
  assert.equal(buildingNotice(fresh('farm')).benefit, `+${BUILDINGS.farm.workers} Jobs`);
  // Every placeable building gets a heading and a line; long names keep the line short.
  for (const key of Object.keys(BUILDINGS) as BuildingKey[]) {
    const n = buildingNotice(fresh(key));
    assert.equal(n.title, 'Building Complete');
    assert.ok(n.line.length <= 40, `${key}: "${n.line}" is too long for the banner`);
  }
  assert.ok(QUIET_BUILDINGS.has('torch') && QUIET_BUILDINGS.has('campfire'));
});

test('upgrade banners report the improvement gained, not the total', () => {
  const home = { key: 'home' as const, tier: 3, label: 'Home (level 4)', lastWork: { upgrade: true, fromTier: 2 } };
  assert.deepEqual(buildingNotice(home), { title: 'Upgrade Complete', line: 'Home (level 4) upgraded', benefit: `+${HOMES.housing[2] - HOMES.housing[1]} Islander Capacity` });
  const mason = { key: 'stonemason' as const, tier: 2, label: BUILDINGS.stonemason.name, lastWork: { upgrade: true, fromTier: 1 } };
  assert.equal(buildingNotice(mason).benefit, `${STONEMASON.upgrades[0].unlock} unlocked`);
  const pyramid = { key: 'temple' as const, tier: 3, label: 'Great Pyramid', lastWork: { upgrade: true, fromTier: 2 } };
  assert.equal(buildingNotice(pyramid).line, 'The Great Pyramid stands complete');
});
