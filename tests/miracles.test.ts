import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/ai/Colony';
import { Building } from '../src/buildings/Buildings';
import { Economy } from '../src/economy/Economy';
import { Devotion } from '../src/economy/Devotion';
import { MIRACLE_IDS, MIRACLES, Miracles, miracleUnlocked, unlockText, type MiracleId } from '../src/economy/Miracles';
import { makeIslander } from '../src/entities/Islander';
import { VOLCANO, Volcano, VolcanoCycle } from '../src/entities/Volcano';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { POWERS, WORLD } from '../src/config';
import { FirstTips, type TipState } from '../src/ui/FirstTips';

const M = POWERS.miracles;

function setup(value = 0) {
  const world = { half: 100, layerY: () => 0, groundY: () => 0 } as any;
  const eco = new Economy();
  eco.beliefCap = 10000;
  eco.res.belief = 1000;
  Object.assign(eco.res, { grain: 40, fruit: 30, meat: 20, fish: 30 });
  const list: Building[] = [];
  let nextId = 1;
  const bld = { list, byId: (id: number) => list.find((b) => b.id === id), of: (k: string) => list.filter((b) => b.key === k) } as any;
  const colony = new Colony(world, {} as any, eco, bld, {} as any, {} as any, () => 0.5);
  const notes: { text: string; kind?: string }[] = [];
  colony.hooks = { notify: () => {} };
  const devotion = new Devotion();
  devotion.value = value;
  const effects: MiracleId[] = [];
  let volcano: VolcanoCycle | null = null;
  const scattered: number[] = [];
  const m = new Miracles(eco, devotion, {
    people: () => colony.list,
    buildings: () => list,
    heal: (i) => colony.heal(i),
    scatter: (x, z, r) => { scattered.push(r); return colony.scatter(x, z, r); },
    canWakeVolcano: () => (volcano ? (volcano.phase === 'dormant' ? '' : 'The volcano is already stirring.') : 'There is no volcano on this island.'),
    wakeVolcano: (s) => !!volcano?.wake(s),
    volcanoPhase: () => volcano?.phase ?? null,
    notify: (text, kind) => notes.push({ text, kind }),
    effect: (id) => effects.push(id),
  }, () => 0.5);
  /** A finished building with its middle at (x, z). */
  const add = (key: any, x = 0, z = 0) => {
    const b = new Building(nextId++, key, 100, 100, 0, 0, world);
    b.complete = true;
    b.x = x; b.z = z;
    list.push(b);
    return b;
  };
  const person = (x: number, z: number) => {
    const i = makeIslander(colony.list.length + 1, `P${colony.list.length}`, 'f', x, z, () => 0.5);
    colony.list.push(i);
    return i;
  };
  return { eco, devotion, colony, m, notes, effects, add, person, scattered, list, setVolcano: (v: VolcanoCycle | null) => { volcano = v; } };
}

test('miracles unlock as the meter fills toward their path, and lock again as it falls back', () => {
  for (const id of MIRACLE_IDS) {
    const d = MIRACLES[id], need = M.tiers[d.tier - 1], sign = d.path === 'love' ? 1 : -1;
    assert.equal(miracleUnlocked(id, 0), false, id);
    assert.equal(miracleUnlocked(id, sign * (need - 0.01)), false, id);
    assert.equal(miracleUnlocked(id, sign * need), true, id);
    assert.equal(miracleUnlocked(id, -sign * 1), false, `${id} never from the other side`);
  }
  assert.match(unlockText('rainbow', 0.3), /Adoring: 75% toward Loved \(now 30%\)/);
  assert.match(unlockText('quake', 0), /Fearful: 25% toward Feared/);
  // Told as they unlock and lock (not on the first look, e.g. on loading).
  const s = setup(0.3);
  const seen: string[] = [];
  s.m.hooks.unlocked = (id, on) => seen.push(`${id}:${on}`);
  s.m.update(1);
  assert.deepEqual(seen, []);
  s.devotion.value = 0.55; s.m.update(1);
  assert.deepEqual(seen, ['harvest:true']);
  s.devotion.value = 0.2; s.m.update(1);
  assert.deepEqual(seen, ['harvest:true', 'healrain:false', 'harvest:false']);
  s.person(0, 0);
  assert.equal(s.m.cast('healrain', 0, 0), false);
  assert.match(s.notes.at(-1)!.text, /Unlocks when/);
});

test('miracles cost Belief, start a cooldown, and nudge the meter along their path', () => {
  const s = setup(0.3);
  s.person(0, 0);
  const before = s.eco.res.belief, dv = s.devotion.value;
  assert.equal(s.m.cast('healrain', 0, 0), true);
  assert.equal(s.eco.res.belief, before - M.healrain.cost);
  assert.ok(s.devotion.value > dv);
  assert.equal(s.m.cooldown.healrain, M.healrain.cooldown);
  assert.equal(s.m.cast('healrain', 0, 0), false, 'not again while it gathers strength');
  assert.match(s.notes.at(-1)!.text, /ready in/);
  s.m.update(M.healrain.cooldown);
  assert.equal(s.m.cast('healrain', 0, 0), true);
  // Too little Belief: nothing is spent and nothing happens.
  s.m.update(M.healrain.cooldown);
  s.eco.res.belief = 10;
  assert.equal(s.m.cast('healrain', 0, 0), false);
  assert.equal(s.eco.res.belief, 10);
  // Fear miracles push toward fear.
  const f = setup(-0.3);
  f.m.cast('quake', 0, 0);
  assert.ok(f.devotion.value < -0.3);
  // Cooldowns survive saving.
  const g = setup(-0.3);
  g.m.restore(JSON.parse(JSON.stringify(f.m.save())));
  assert.equal(g.m.cooldown.quake, M.quake.cooldown);
  assert.equal(g.m.cooldown.healrain, 0);
});

test('sandbox: miracles are free, unlocked and ready at once', () => {
  const s = setup(0);
  s.eco.godMode = true;
  s.person(0, 0);
  assert.equal(s.m.cast('healrain', 0, 0), true);
  assert.equal(s.m.cast('healrain', 0, 0), true);
  assert.equal(s.m.cast('quake', 0, 0), true);
});

test('healing rain makes the sick and hurt well inside its circle only', () => {
  const s = setup(0.3);
  const near = s.person(2, 1), edge = s.person(M.healrain.radius - 0.5, 0), far = s.person(M.healrain.radius + 3, 0);
  for (const i of [near, edge, far]) { s.colony.afflict(i, i === edge ? 'mauled' : 'sick'); i.happy = 0.4; }
  assert.equal(s.m.cast('healrain', 0, 0), true);
  assert.equal(near.condition, 'well');
  assert.equal(edge.condition, 'well');
  assert.equal(far.condition, 'sick');
  assert.ok(near.happy > 0.4 && far.happy === 0.4);
  assert.deepEqual(s.effects, ['healrain']);
  assert.match(s.notes.at(-1)!.text, /2 islanders are made well/);
});

test('bountiful harvest ripens the fields in its circle, and their next harvest is half as large again', () => {
  const s = setup(0.6);
  const kinds = ['farm', 'maizefarm', 'chinampa', 'herbalgarden'] as const;
  const inside = kinds.map((k, n) => s.add(k, n * 2, 0));
  const outside = s.add('farm', M.harvest.radius + 10, 0);
  const hut = s.add('hut', 1, 1);
  assert.equal(s.m.cast('harvest', 0, 0), true);
  for (const f of inside) { assert.equal(f.growth, 1, f.key); assert.equal(f.bounty, M.harvest.bonus); }
  assert.equal(outside.growth, 0);
  assert.equal(hut.growth, 0);
  // Nothing to ripen: refused, nothing spent.
  const t = setup(0.6), b = t.eco.res.belief;
  assert.equal(t.m.cast('harvest', 0, 0), false);
  assert.equal(t.eco.res.belief, b);
});

test('the rainbow blessing doubles Belief and cheers the village for one day', () => {
  const s = setup(0.8);
  const p = s.person(50, 50);
  p.happy = 0.5;
  assert.equal(s.m.beliefFactor, 1);
  assert.equal(s.m.cast('rainbow'), true);
  assert.ok(p.happy > 0.5);
  assert.equal(s.m.beliefFactor, 2);
  assert.ok(s.m.mood > 0);
  s.m.update(599);
  assert.equal(s.m.beliefFactor, 2);
  const saved = JSON.parse(JSON.stringify(s.m.save()));
  s.m.update(2);
  assert.equal(s.m.beliefFactor, 1);
  assert.equal(s.m.mood, 0);
  const again = setup(0.8);
  again.m.restore(saved);
  assert.equal(again.m.beliefFactor, 2, 'the blessing survives saving');
});

test('an earthquake cracks buildings but never fells them, scatters people, and the prayer after brings Belief back', () => {
  const s = setup(-0.3);
  const centre = s.add('hut', 0, 0), mid = s.add('home', 5, 0), out = s.add('hut', 40, 0), field = s.add('farm', 2, 2), fire = s.add('campfire', 1, 0);
  const p = s.person(1, 1);
  const before = s.eco.res.belief;
  assert.equal(s.m.cast('quake', 1, 0), true);
  assert.ok(centre.integrity < 1 && centre.integrity >= M.quake.floor);
  assert.ok(mid.integrity < 1);
  assert.equal(out.integrity, 1);
  assert.equal(field.integrity, 1);
  assert.equal(fire.integrity, 1);
  assert.equal(p.task?.kind, 'flee');
  // Again and again: still standing, repairable.
  for (let k = 0; k < 5; k++) { s.m.update(M.quake.cooldown); s.m.cast('quake', 1, 0); }
  assert.ok(centre.integrity >= M.quake.floor && !centre.ruined);
  // Each quake's prayer, after a while: more Belief than it cost.
  const fresh = setup(-0.3);
  const b0 = fresh.eco.res.belief;
  fresh.m.cast('quake', 0, 0);
  fresh.m.update(M.quake.prayDelay - 1);
  assert.equal(fresh.eco.res.belief, b0 - M.quake.cost);
  fresh.m.update(2);
  assert.equal(fresh.eco.res.belief, b0 - M.quake.cost + M.quake.belief);
  assert.ok(M.quake.belief > M.quake.cost);
  assert.match(fresh.notes.at(-1)!.text, /\+50 Belief/);
  void before;
});

test('locusts strip the fields in their circle over their stay, then the village prays', () => {
  const s = setup(-0.55);
  const f = s.add('farm', 0, 0), g = s.add('maizefarm', 4, 0), out = s.add('farm', 40, 0);
  f.growth = 0.9; g.growth = 0.5; f.stock = 10; out.growth = 0.9;
  const b0 = s.eco.res.belief;
  assert.equal(s.m.cast('locusts', 0, 0), true);
  assert.equal(s.m.swarms.length, 1);
  s.m.update(M.locusts.seconds / 2);
  assert.ok(f.growth < 0.9 && f.growth > 0);
  // Saved mid-swarm and loaded, the swarm carries on.
  const t = setup(-0.55);
  t.m.restore(JSON.parse(JSON.stringify(s.m.save())));
  assert.equal(t.m.swarms.length, 1);
  s.m.update(M.locusts.seconds / 2 + 0.01);
  assert.equal(s.m.swarms.length, 0);
  assert.equal(f.growth, 0);
  assert.equal(g.growth, 0);
  assert.equal(f.stock, 5);
  assert.equal(out.growth, 0.9);
  assert.ok(s.list.includes(f), 'the farm itself still stands');
  s.m.update(M.locusts.prayDelay + 0.1);
  assert.equal(s.eco.res.belief, b0 - M.locusts.cost + M.locusts.belief);
  assert.ok(M.locusts.belief > M.locusts.cost);
});

test('waking the volcano: rumbles, erupts at once even early on, and the terror pays back when the lava stops', () => {
  const s = setup(-0.8);
  const v = new VolcanoCycle(1);
  v.allowErupt = () => false; // too early for lava by the usual rules
  s.setVolcano(v);
  // Not while it already stirs.
  v.phase = 'smoking';
  assert.equal(s.m.cast('volcano'), false);
  v.phase = 'dormant';
  const b0 = s.eco.res.belief;
  assert.equal(s.m.cast('volcano'), true);
  assert.equal(v.phase, 'smoking');
  assert.equal(v.rumbling, true);
  assert.equal(s.m.cast('volcano'), false, 'only once at a time');
  v.update(M.volcano.rumble + 0.1); s.m.update(0.1);
  assert.equal(v.phase, 'erupting');
  v.update(VOLCANO.eruptSecs); s.m.update(0.1);
  assert.equal(v.phase, 'cooling');
  assert.equal(v.forced, false);
  s.m.update(0.1);
  assert.equal(s.eco.res.belief, b0 - M.volcano.cost + M.volcano.belief);
  // Its own cycle carries on afterwards as before.
  v.update(VOLCANO.coolSecs);
  assert.equal(v.phase, 'dormant');
  // No volcano: refused.
  const t = setup(-0.8);
  assert.equal(t.m.cast('volcano'), false);
});

test('a woken volcano saves and loads safely, and old saves without the flag still load', () => {
  const v = new VolcanoCycle(5);
  assert.equal(v.wake(12), true);
  assert.equal(v.wake(12), false);
  const old = new VolcanoCycle(5, { x: 0, z: 0, phase: 'smoking', remaining: 40, cycle: 2, warningVersion: 2 });
  assert.equal(old.forced, false);
  assert.equal(old.remaining, 40);
  // A stale flag on a dormant mountain is ignored.
  assert.equal(new VolcanoCycle(5, { x: 0, z: 0, phase: 'dormant', remaining: 40, cycle: 2, forced: true }).forced, false);
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  const placed = new Volcano(w);
  placed.state.phase = 'dormant';
  assert.equal(placed.state.wake(12), true);
  const saved = JSON.parse(JSON.stringify(placed.save()));
  assert.equal(saved.forced, true);
  const again = new Volcano(w, saved);
  assert.equal(again.state.phase, 'smoking');
  assert.equal(again.state.forced, true);
  again.state.allowErupt = () => false;
  again.update(13);
  assert.equal(again.state.phase, 'erupting');
});

test('miracle state from a save without it, or a damaged one, loads cleanly', () => {
  const s = setup(0);
  s.m.restore(undefined);
  s.m.restore({ cd: { quake: 'x', healrain: -4, harvest: 1e9 }, rainbow: NaN, swarms: [{ x: 1 }], prayers: [null], volcano: 7 });
  assert.equal(s.m.cooldown.quake, 0);
  assert.equal(s.m.cooldown.harvest, M.harvest.cooldown);
  assert.equal(s.m.rainbowT, 0);
  assert.equal(s.m.swarms.length, 0);
  assert.deepEqual(new Miracles(s.eco, s.devotion, s.m.hooks).save(), {});
});

test('the first miracle of each path brings a first-time tip', () => {
  const quiet: TipState = { islander: -1, group: 0, devotion: 'Devoted', dead: 0, graves: 0, pyre: false, altar: false, ancestorNight: false, swimming: false };
  const shown: string[] = [];
  const tips = new FirstTips(null, (k) => shown.push(k));
  tips.seen.add('devotion');
  tips.poll({ ...quiet, loveMiracle: true }, { tutorial: false, busy: false, popups: 'all' }, 0);
  tips.closed(1);
  tips.poll({ ...quiet, fearMiracle: true }, { tutorial: false, busy: false, popups: 'all' }, 100);
  assert.deepEqual(shown, ['loveMiracle', 'fearMiracle']);
});
