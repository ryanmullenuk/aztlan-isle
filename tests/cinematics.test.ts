import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cinematics, CINEMATIC, SHOTS, type CameraPose, type CinematicEnd } from '../src/render/Cinematics';
import { CameraRig } from '../src/render/CameraRig';
import { RENDER } from '../src/config';
import { PHOTO_FILTERS, applyMatrix, filterCss, filterMatrix, tintAlpha } from '../src/ui/photoFilters';

const HOME: CameraPose = { x: 5, z: -3, dist: 60, yaw: 0.4, tilt: 2 };
const rigAt = (p: CameraPose = HOME) => ({ goal: { ...p }, cur: { ...p }, scripted: false, maxDist: 300 });
/** Run for some seconds at 60 frames a second. */
const run = (c: Cinematics, secs: number, each?: () => void) => {
  for (let t = 0; t < secs; t += 1 / 60) { c.update(1 / 60); each?.(); }
};

test('a cinematic flies to the subject, drifts round it, and hands the view back exactly', () => {
  const rig = rigAt(), log: string[] = [];
  const c = new Cinematics(rig, { onStart: (k) => log.push(`start ${k}`), onEnd: (k, how) => log.push(`end ${k} ${how}`) });
  let ended: CinematicEnd | null = null;
  assert.equal(c.play('temple', { x: 40, z: 20, radius: 4 }, { onEnd: (how) => { ended = how; } }), true);
  assert.equal(c.active, 'temple');
  assert.equal(rig.scripted, true);
  // No jump on the first frame: the move starts from where the camera is.
  c.update(1 / 60);
  assert.ok(Math.hypot(rig.cur.x - HOME.x, rig.cur.z - HOME.z) < 0.01);
  // Smooth all the way: no frame moves the aim more than a small step.
  let last = { ...rig.cur }, worst = 0, sawSubject = false, yawMin = Infinity, yawMax = -Infinity;
  run(c, 30, () => {
    worst = Math.max(worst, Math.hypot(rig.cur.x - last.x, rig.cur.z - last.z));
    if (c.presence === 1) {
      assert.ok(Math.hypot(rig.cur.x - 40, rig.cur.z - 20) < 1e-6);
      sawSubject = true;
      assert.ok(rig.cur.dist <= SHOTS.temple.dist + 0.01 && rig.cur.dist >= SHOTS.temple.dist * SHOTS.temple.push - 0.01);
      assert.ok(Math.abs(rig.cur.tilt - SHOTS.temple.tilt) < 1e-6);
      yawMin = Math.min(yawMin, rig.cur.yaw); yawMax = Math.max(yawMax, rig.cur.yaw);
    }
    // The rig's own easing has nothing to add: aim and camera agree while it plays.
    if (c.playing) assert.deepEqual(rig.goal, rig.cur);
    last = { ...rig.cur };
  });
  assert.ok(sawSubject, 'held on the subject');
  assert.ok(worst < 1.2, `largest step ${worst}`);
  // A slow orbit while it holds, centred on the way the player was facing.
  assert.ok(yawMax - yawMin > 0.1 && yawMin > HOME.yaw - SHOTS.temple.orbit && yawMax < HOME.yaw + SHOTS.temple.orbit);
  assert.equal(c.playing, false);
  assert.deepEqual(rig.goal, HOME);
  assert.deepEqual(rig.cur, HOME);
  assert.equal(rig.scripted, false);
  assert.equal(ended, 'done');
  assert.deepEqual(log, ['start temple', 'end temple done']);
});

test('skipping restores the player\'s aim at once and never leaves the cinematic state behind', () => {
  const rig = rigAt(), log: string[] = [];
  const c = new Cinematics(rig, { onStart: () => log.push('start'), onEnd: (_k, how) => log.push(how) });
  c.play('wedding', { x: -30, z: 12 });
  run(c, 3);
  assert.notDeepEqual(rig.goal, HOME);
  assert.equal(c.skip(), true);
  assert.deepEqual(rig.goal, HOME);
  assert.equal(c.playing, false);
  assert.equal(c.presence, 0);
  assert.equal(rig.scripted, false);
  // Nothing more is done to the camera afterwards (the player's drag owns it now).
  rig.goal.x = 99;
  run(c, 2);
  assert.equal(rig.goal.x, 99);
  assert.equal(c.skip(), false);
  assert.deepEqual(log, ['start', 'skipped']);
});

test('a cinematic lets go the moment the player becomes busy', () => {
  const rig = rigAt();
  let busy = false, how = '';
  const c = new Cinematics(rig, { canPlay: () => !busy, onEnd: (_k, h) => { how = h; } });
  c.play('funeral', { x: 10, z: 10 });
  run(c, 2);
  busy = true;
  c.update(1 / 60);
  assert.equal(c.playing, false);
  assert.equal(how, 'skipped');
  assert.deepEqual(rig.goal, HOME);
});

test('one at a time, with a cooldown between them and a longer one for the same kind', () => {
  const rig = rigAt();
  const c = new Cinematics(rig);
  assert.equal(c.play('wedding', { x: 1, z: 1 }), true);
  assert.equal(c.play('raid', { x: 2, z: 2 }), false, 'never two at once');
  assert.equal(c.active, 'wedding');
  c.skip();
  assert.equal(c.play('raid', { x: 2, z: 2 }), false, 'cooling down');
  // Once-in-a-game moments are not held back by the cooldown.
  assert.equal(c.play('greatTemple', { x: 2, z: 2 }), true);
  c.skip();
  run(c, CINEMATIC.cooldown + 1);
  assert.equal(c.play('wedding', { x: 1, z: 1 }), false, 'the same kind waits longer');
  assert.equal(c.play('raid', { x: 2, z: 2 }), true);
  c.skip();
  run(c, SHOTS.wedding.again);
  assert.equal(c.play('wedding', { x: 1, z: 1 }), true);
});

test('never steals control: it waits for the player to finish, and gives up if they do not', () => {
  const rig = rigAt();
  let busy = true;
  const ends: string[] = [];
  const c = new Cinematics(rig, { canPlay: () => !busy });
  assert.equal(c.play('temple', { x: 9, z: 9 }, { onEnd: (h) => ends.push(h) }), true);
  run(c, 1);
  assert.equal(c.playing, false);
  assert.deepEqual(rig.goal, HOME, 'camera untouched while the player is busy');
  busy = false;
  c.update(1 / 60);
  assert.equal(c.active, 'temple');
  c.skip();
  // Busy for too long: dropped, and the caller is told.
  busy = true;
  assert.equal(c.play('wonder', { x: 9, z: 9 }, { onEnd: (h) => ends.push(h) }), true);
  run(c, CINEMATIC.patience + 0.5);
  busy = false;
  run(c, 1);
  assert.equal(c.playing, false);
  assert.deepEqual(ends, ['skipped', 'dropped']);
});

test('switched off (or reduce motion): nothing plays and the camera is left alone', () => {
  const rig = rigAt();
  let on = false;
  const c = new Cinematics(rig, { enabled: () => on });
  assert.equal(c.play('founding', { x: 9, z: 9 }), false);
  run(c, 1);
  assert.deepEqual(rig.cur, HOME);
  // Switched off part-way through one: back to the player's view.
  on = true;
  assert.equal(c.play('founding', { x: 9, z: 9 }), true);
  run(c, 2);
  on = false;
  c.update(1 / 60);
  assert.equal(c.playing, false);
  assert.deepEqual(rig.goal, HOME);
});

test('follows a moving subject and flies home when it goes away', () => {
  const rig = rigAt();
  const whale: { x: number; z: number } | null = { x: 50, z: 0 };
  let there = true, how = '';
  const c = new Cinematics(rig, { onEnd: (_k, h) => { how = h; } });
  c.play('whale', () => (there ? whale : null));
  run(c, 4, () => { whale!.x += 0.02; });
  assert.ok(Math.abs(rig.cur.x - whale!.x) < 0.5, 'tracking the whale');
  there = false;
  run(c, 4);
  assert.equal(c.playing, false, 'ended early');
  assert.equal(how, 'done');
  assert.deepEqual(rig.cur, HOME);
  // A subject that is already gone never starts.
  run(c, 600);
  assert.equal(c.play('whale', () => null), false);
});

test('photo lens: zoom, roll and free pitch ease in, and the game view comes back exactly', () => {
  const world = { heightAt: () => 0, N: 100 } as any;
  const rig = new CameraRig(1.5, world);
  rig.jumpTo(0, 0, 40, 0);
  rig.update(0.016);
  const pitch0 = rig.pitch;
  assert.equal(rig.camera.fov, RENDER.fov);
  rig.lens = { fov: 60, roll: 20, pitch: null };
  for (let i = 0; i < 240; i++) rig.update(1 / 60);
  assert.ok(Math.abs(rig.camera.fov - 60) < 0.01);
  assert.ok(Math.abs(rig.pitch - pitch0) < 1e-9, 'pitch untouched until the angle slider is used');
  // Rolled: the camera's up vector is no longer upright.
  assert.ok(Math.abs(rig.camera.matrixWorld.elements[4]) > 0.2 || Math.abs(rig.camera.matrixWorld.elements[6]) > 0.2);
  rig.lens.pitch = 8;
  for (let i = 0; i < 240; i++) rig.update(1 / 60);
  assert.ok(Math.abs(rig.pitchDegrees - 8) < 0.05);
  assert.ok(rig.camera.position.y >= 0.8, 'kept above the ground');
  rig.lens = null;
  for (let i = 0; i < 600; i++) rig.update(1 / 60);
  assert.equal(rig.camera.fov, RENDER.fov);
  assert.equal(rig.pitch, pitch0);
  assert.ok(Math.abs(rig.camera.matrixWorld.elements[4]) < 1e-6, 'level again');
});

test('photo filters: preview CSS and the saved picture\'s colour matrix agree', () => {
  const by = (id: string) => PHOTO_FILTERS.find((f) => f.id === id)!;
  assert.deepEqual(PHOTO_FILTERS.map((f) => f.id), ['none', 'warm', 'cool', 'vivid', 'sepia', 'noir']);
  assert.equal(filterCss(by('none'), 1), '');
  assert.equal(filterMatrix(by('none'), 1), null);
  assert.equal(filterCss(by('vivid'), 1), 'saturate(1.45) contrast(1.12)');
  // Strength 0 is no filter at all; half strength is half-way to it.
  assert.equal(filterCss(by('sepia'), 0), '');
  assert.equal(filterCss(by('noir'), 0.5), 'saturate(0.5) contrast(1.15) brightness(0.98)');
  assert.equal(tintAlpha(by('warm'), 0.5), by('warm').tint!.alpha / 2);
  assert.equal(tintAlpha(by('noir'), 1), 0);
  // Noir: every pixel comes out grey; mid-grey stays near mid-grey; alpha is untouched.
  const px = new Uint8ClampedArray([200, 40, 40, 255, 128, 128, 128, 77, 0, 255, 0, 255]);
  applyMatrix(px, filterMatrix(by('noir'), 1)!);
  for (let i = 0; i < px.length; i += 4) assert.ok(Math.abs(px[i] - px[i + 1]) <= 1 && Math.abs(px[i + 1] - px[i + 2]) <= 1);
  assert.ok(Math.abs(px[4] - 123) <= 2);
  assert.equal(px[7], 77);
  // Vivid: more colourful, and greys stay grey.
  const v = new Uint8ClampedArray([180, 90, 90, 255, 100, 100, 100, 255]);
  applyMatrix(v, filterMatrix(by('vivid'), 1)!);
  assert.ok(v[0] - v[1] > 90);
  assert.ok(Math.abs(v[4] - v[5]) <= 1 && Math.abs(v[5] - v[6]) <= 1);
  // A weak filter is close to the original.
  const w = new Uint8ClampedArray([180, 90, 60, 255]);
  applyMatrix(w, filterMatrix(by('sepia'), 0.02)!);
  assert.ok(Math.abs(w[0] - 180) <= 3 && Math.abs(w[1] - 90) <= 3 && Math.abs(w[2] - 60) <= 3);
});
