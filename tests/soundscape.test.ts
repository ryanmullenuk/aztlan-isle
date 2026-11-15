import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio/Audio';
import { Soundscape, type SoundWorld } from '../src/audio/Soundscape';
import type { Flung } from '../src/entities/GodHand';

const flung = (mode: Flung['mode'], extra: Partial<Flung> = {}): Flung => ({ mode, rx: 0, rz: 0, vx: 0, vy: 0, vz: 0, t: 0, wx: 0, wz: 0, ...extra });

test('the soundscape hears throws, swimmers, a shark, the pyre and the spirits', () => {
  const isl: { x: number; z: number; flung?: Flung } = { x: 1, z: 2, flung: flung('held') };
  const graves = { pyreAt: null as { x: number; z: number } | null, flame: 0 };
  const ghosts = { shown: 0, spots: () => [{ x: 10, z: 0 }, { x: 12, z: 0 }] };
  const blood = { spawned: 0, lastAt: { x: 0, z: 0 } };
  const world: SoundWorld = {
    colony: { list: [isl] },
    buildings: { fountains: (out = []) => { out.length = 0; out.push({ x: 3, z: 4, n: 6 }); return out; } },
    passings: { graves }, ancestors: { ghosts }, blood,
  };
  const heard: string[] = [];
  const s = new Soundscape(world, (n) => heard.push(n), () => 0.5);
  s.update(0.016);
  assert.deepEqual(s.fountains, [{ x: 3, z: 4, n: 6 }]);
  isl.flung!.mode = 'air';
  s.update(0.016);
  assert.ok(heard.includes('whoosh'));
  isl.flung = flung('bathe', { wade: true });
  s.update(0.016);
  isl.flung = flung('bathe', { stroke: true });
  s.update(0.016);
  assert.ok(heard.includes('wadein'));
  for (let k = 0; k < 200; k++) s.update(0.016);
  assert.ok(heard.includes('stroke'));
  blood.spawned = 1; blood.lastAt = { x: 5, z: 5 };
  s.update(0.016);
  assert.ok(heard.includes('sharktake'));
  graves.pyreAt = { x: 0, z: 0 }; graves.flame = 0.1;
  s.update(0.016);
  assert.ok(heard.includes('pyrelight') && s.pyre?.flame === 0.1);
  ghosts.shown = 0.01; s.update(0.016);
  ghosts.shown = 0.2; s.update(0.016);
  assert.ok(heard.includes('ghostin'));
  assert.equal(s.ghosts?.x, 11);
  ghosts.shown = 1; s.update(0.016);
  ghosts.shown = 0.8; s.update(0.016);
  assert.ok(heard.includes('ghostout'));
  // Each one-shot fires once per happening.
  assert.equal(heard.filter((n) => n === 'sharktake').length, 1);
  assert.equal(heard.filter((n) => n === 'pyrelight').length, 1);
});

test('the new sounds are silent and harmless before the audio is unlocked', () => {
  const a = new AudioEngine();
  a.watch({});
  for (const n of ['whoosh', 'wadein', 'stroke', 'paddle', 'sharktake', 'pyrelight', 'ghostin', 'ghostout']) a.sfx(n, 0, 0);
  a.update(0.016);
  assert.equal(a.ready, false);
});
