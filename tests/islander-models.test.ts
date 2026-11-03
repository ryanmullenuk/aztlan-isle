import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipFor } from '../src/entities/IslanderRig';
import { RIGS, paintFor } from '../src/entities/islanderModels';
import type { BoneName } from '../src/entities/glbPeople';

const person = (o: Record<string, unknown> = {}): any => ({ id: 4, anim: 'idle', animT: 0, gender: 'm', task: null, carry: null, hidden: false, sleeping: false, floorY: null,
  condition: 'well', injured: 0, happy: 0.6, hunger: 0.8, rest: 0.8, child: false, warrior: null, speed: 0, ...o });

test('standing about plays the idle; with needs and nothing to do, the sad idle', () => {
  assert.equal(clipFor(person()), 'idle');
  assert.equal(clipFor(person({ hunger: 0.1 })), 'sad_idle');
  assert.equal(clipFor(person({ happy: 0.2 })), 'sad_idle');
  // Busy at a task (waiting at work), not sad.
  assert.equal(clipFor(person({ happy: 0.2, task: { kind: 'farm' } })), 'idle');
});

test('standing about, islanders now and then look round, talk with their hands or chat', () => {
  const seen = new Set(Array.from({ length: 400 }, (_, k) => clipFor(person({ animT: k * 0.3 * 20 }))));
  for (const c of ['idle', 'talk', 'turn', 'chat']) assert.ok(seen.has(c as any), `${c} in ${[...seen].join()}`);
  // Warriors drill with their fists between watches; children tumble at play.
  const drills = Array.from({ length: 200 }, (_, k) => clipFor(person({ warrior: 'jaguar', animT: k * 2 }))).filter((c) => c === 'punch').length;
  assert.ok(drills > 5 && drills < 100, `drills now and then (${drills}/200)`);
});

test('dancing at the fires (several dances in turn), sometimes when very happy, and often under fireworks', () => {
  const dances = new Set(Array.from({ length: 30 }, (_, k) => clipFor(person({ anim: 'dance', animT: k * 14 }))));
  assert.ok(dances.size >= 4 && [...dances].every((d) => ['twerk', 'dance_long', 'arms_dance', 'dance_sway', 'spin'].includes(d!)), [...dances].join());
  const happy = Array.from({ length: 200 }, (_, k) => clipFor(person({ happy: 0.95, animT: k * 3 }))).filter((c) => c === 'twerk' || c === 'spin').length;
  assert.ok(happy > 5 && happy < 80, `very happy islanders dance now and then (${happy}/200)`);
  const party = Array.from({ length: 60 }, (_, k) => clipFor(person({ id: k, animT: k }), true)).filter((c) => c === 'twerk' || c === 'arms_dance').length;
  assert.ok(party > 15, `many dance while fireworks light the sky (${party}/60)`);
});

test('the sick and hurt limp, the badly mauled crawl, the frightened run looking back', () => {
  assert.equal(clipFor(person({ anim: 'walk', condition: 'sick' })), 'injured_run');
  assert.equal(clipFor(person({ anim: 'walk', condition: 'mauled', injured: 100 })), 'zombie_crawl');
  assert.equal(clipFor(person({ anim: 'walk', condition: 'mauled', injured: 0 })), 'injured_run');
  assert.equal(clipFor(person({ anim: 'run', task: { kind: 'flee' } })), 'run_look_back');
  assert.equal(clipFor(person({ anim: 'run', task: { kind: 'hall' } })), 'run_look_back');
  assert.equal(clipFor(person({ anim: 'run' })), 'run');
  assert.equal(clipFor(person({ anim: 'run', child: true })), 'jog');
  // Empty-handed walkers walk in the model's own walk; tools and loads in hand stay procedural.
  assert.equal(clipFor(person({ anim: 'walk', tool: 'none' })), 'walk');
  assert.equal(clipFor(person({ anim: 'walk', tool: 'axe' })), null);
  assert.equal(clipFor(person({ anim: 'chop' })), null);
  assert.equal(clipFor(person({ anim: 'run', carry: { kind: 'log' } })), null);
  assert.equal(clipFor(person({ sleeping: true })), null);
});

test('the body is coloured by part: hair, face, belt, skirt, soles', () => {
  const J = Object.fromEntries(Object.entries(RIGS.m.joint).map(([k, v]) => [k, new THREE.Vector3(...v)])) as Record<BoneName, THREE.Vector3>;
  const at = (x: number, y: number, z: number, bone: string, n = [0, 0, 1]) => paintFor(new THREE.Vector3(x, y, z), new THREE.Vector3(...n), bone, J, 0.25);
  assert.equal(at(0, 1.5, 0.25, 'Head').color, 'skin');
  assert.equal(at(0, 1.85, 0, 'Head').hair, true);
  assert.equal(at(0, 1.75, 0, 'Head').color, 0xe2382b);
  assert.equal(at(0, 1.5, -0.2, 'Head').hair, true);
  assert.equal(at(0.1, 0.81, 0.22, 'Spine').color, 0x1f7f6c);
  assert.equal(at(0.2, 0.01, 0.1, 'LeftFoot').color, 0x6b3a1d);
  assert.equal(at(0.23, 1.1, 0.1, 'LeftShoulder').color, 0xe2382b);
  // The shoulder bones also carry the upper chest, which stays tunic.
  assert.equal(at(0.15, 1.02, 0.2, 'LeftShoulder').color, 0xf4c78f);
  assert.equal(at(0.1, 1.0, -0.2, 'Spine2', [0, 0, -1]).color, 0xf4c78f);
});

test('texels are read as skin (to tint by tone), hair (to grey), or cloth', async () => {
  const { texelKind } = await import('../src/entities/islanderModels');
  const srgb = (h: number) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255] as [number, number, number];
  assert.equal(texelKind(...srgb(0xd9813f)), 'skin');
  assert.equal(texelKind(...srgb(0xc47a48)), 'skin');
  assert.equal(texelKind(...srgb(0x2b201b)), 'hair');
  assert.equal(texelKind(...srgb(0xf4c78f)), 'other', 'cream cloth');
  assert.equal(texelKind(...srgb(0xe2382b)), 'other', 'red cloth');
  assert.equal(texelKind(...srgb(0x1f7f6c)), 'other', 'teal belt');
});
