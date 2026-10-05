import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WakeTrails } from '../src/entities/Wake';

/** Sail a boat north at `speed` for `seconds`, recording its wake every frame. */
function sail(w: WakeTrails, boat: { x: number; z: number; heading: number; speed: number }, seconds: number, s = 1) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    boat.z += boat.speed * dt;
    w.record(boat, 0.75, 0.24, 1, s);
    w.update(dt);
  }
}

test('a boat under way leaves a V of foam arms spreading wider behind it, and a trail at the stern', () => {
  const w = new WakeTrails();
  const boat = { x: 0, z: 0, heading: 0, speed: 2.6 };
  sail(w, boat, 2);
  assert.equal(w.count, 1);
  const g = w.mesh.geometry;
  const pos = g.getAttribute('position').array as Float32Array, info = g.getAttribute('aWake').array as Float32Array;
  const drawn = g.drawRange.count;
  assert.ok(drawn > 100, `triangles drawn (${drawn})`);
  // Arms (kind 0): the older the foam, the further it sits out to the side.
  let nearSpread = 0, farSpread = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    if (info[i * 4 + 3] !== 0 || info[i * 4 + 2] === 0) continue;
    const age = info[i * 4 + 1], out = Math.abs(pos[i * 3]);
    if (age < 0.05) nearSpread = Math.max(nearSpread, out);
    if (age > 0.4 && age < 0.5) farSpread = Math.max(farSpread, out);
  }
  assert.ok(farSpread > nearSpread * 2, `arms open into a V (${nearSpread.toFixed(2)} → ${farSpread.toFixed(2)})`);
  assert.ok(Array.from(pos.slice(0, (g.index!.array as Uint32Array).reduce((m, v, k) => (k < drawn ? Math.max(m, v) : m), 0) * 3 + 3)).every(Number.isFinite));
});

test('a stopped boat lays no new foam, its wake fades out, and the trail is dropped', () => {
  const w = new WakeTrails();
  const boat = { x: 0, z: 0, heading: 0, speed: 2.6 };
  sail(w, boat, 1);
  boat.speed = 0;
  for (let t = 0; t < 10; t += 1 / 30) {
    w.record(boat, 0.75, 0.24, 1, 0);
    w.update(1 / 30);
  }
  assert.equal(w.mesh.geometry.drawRange.count, 0, 'nothing left to draw');
  // Once the boat is gone altogether, its trail is forgotten.
  for (let t = 0; t < 3; t += 1 / 30) w.update(1 / 30);
  assert.equal(w.count, 0);
});
