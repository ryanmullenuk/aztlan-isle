import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestBoard, REQUESTS } from '../src/economy/Requests';

test('a village that loves its god asks for things more often', () => {
  const asked = (pace: number) => {
    const isl: any = { id: 1, name: 'Tecu', home: -1, child: false, role: 'idle', happy: 0.5, sleeping: false };
    const w: any = { people: () => [isl], buildings: () => [], byId: () => undefined, canBuild: () => '', freeBeds: () => 0, sandbox: () => false, pace: () => pace };
    let n = 0;
    const b = new RequestBoard(w, () => 0.5, () => 0);
    b.onAsked = () => { n++; b.list = []; };
    for (let t = 0; t < REQUESTS.gap[1] * 4; t += 2) b.update(2);
    return n;
  };
  assert.ok(asked(2.5) > asked(1), `${asked(2.5)} vs ${asked(1)}`);
});
