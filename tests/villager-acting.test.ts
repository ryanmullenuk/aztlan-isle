import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BI, BONES, type BoneName } from '../src/entities/glbPeople';
import { RIGS } from '../src/entities/islanderModels';
import { makeIslander } from '../src/entities/Islander';
import { ISLANDER } from '../src/config';
import {
  applyGesture, applyLook, blankPlan, blankState, bodyScale, easeActing, fidgetFor, headYaw, planActing, reach, swing, tradeCloth, type Gesture,
} from '../src/entities/IslanderActing';

const joint = Object.fromEntries(BONES.map((b) => [b, new THREE.Vector3(...RIGS.m.joint[b])])) as Record<BoneName, THREE.Vector3>;
const model = {
  joint,
  len: { upper: joint.upper_armL.distanceTo(joint.forearmL), fore: joint.forearmL.distanceTo(joint.handL), thigh: 0.22, shin: 0.17, hand: 0.18 },
};
/** The skeleton standing in its bind pose: every bone frame upright at its joint. */
const bind = () => BONES.map((b) => new THREE.Matrix4().makeTranslation(joint[b].x, joint[b].y, joint[b].z));
const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
const person = (id: number, x = 0, z = 0, o: Record<string, unknown> = {}) => Object.assign(makeIslander(id, 'A', 'm', x, z, () => 0.5), { heading: 0, ...o });
const world = (o: Record<string, unknown> = {}) => ({ clock: 0, afraid: false, mournAt: null, ...o });

test('each trade wears its own cloth; children, warriors and those without a trade keep the painted red', () => {
  const seen = new Set<number>();
  for (const role of ['builder', 'woodcutter', 'miner', 'gatherer', 'farmer', 'priest', 'fisher', 'butcher', 'smoker', 'mason', 'merchant', 'firemaker'] as const) {
    const c = tradeCloth({ role, child: false });
    assert.ok(c > 0, `${role} has a cloth colour`);
    seen.add(c);
  }
  assert.equal(seen.size, 12, 'no two trades share a colour');
  assert.equal(tradeCloth({ role: 'idle', child: false }), 0);
  assert.equal(tradeCloth({ role: 'farmer', child: true }), 0);
  assert.equal(tradeCloth({ role: 'warrior', child: false, warrior: 'jaguar' }), 0);
});

test('grown-ups differ a little in height; children are clearly smaller and grow until they come of age', () => {
  const sizes = Array.from({ length: 60 }, (_, k) => bodyScale({ id: k + 1, child: false }));
  assert.ok(Math.min(...sizes) >= 0.95 && Math.max(...sizes) <= 1.05);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 0.06, 'a real spread of heights');
  assert.equal(bodyScale({ id: 5, child: false }), bodyScale({ id: 5, child: false }), 'and always the same for one islander');
  assert.equal(bodyScale({ id: 5, child: true, age: 0 }), ISLANDER.childScale);
  const nearly = bodyScale({ id: 5, child: true, age: 1e9 });
  assert.ok(nearly > ISLANDER.childScale + 0.1 && nearly < 0.9, 'still plainly a child the day before coming of age');
});

test('frightened: on the move they run looking back; standing they cower; warriors and those sheltering do not', () => {
  const w = world({ afraid: true }), plan = blankPlan();
  assert.equal(planActing(plan, person(4, 0, 0, { anim: 'run', speed: 2 }), 'run', 'run', w, null, false).clip, 'run_look_back');
  assert.equal(planActing(plan, person(4, 0, 0, { anim: 'walk', speed: 1 }), 'walk', 'walk', w, null, false).clip, 'run_look_back');
  const still = planActing(plan, person(4), 'idle', 'idle', w, null, false);
  assert.equal(still.clip, 'sad_idle');
  assert.equal(still.gesture, 'cower');
  assert.equal(planActing(plan, person(4, 0, 0, { warrior: 'jaguar' }), null, 'guard', w, null, false).gesture, 'none');
  assert.equal(planActing(plan, person(4, 0, 0, { safe: true }), 'idle', 'idle', w, null, false).gesture, 'none');
  // Hands full: they keep hold of the load.
  assert.equal(planActing(plan, person(4, 0, 0, { anim: 'carry', carry: { kind: 'log', res: 'wood', n: 1 } }), null, 'carry', w, null, false).clip, undefined);
});

test('at a funeral those gathered by the grave grieve: heads bowed, now and then wiping their eyes', () => {
  const plan = blankPlan(), seen = new Set<Gesture>();
  for (let k = 0; k < 200; k++) {
    const p = planActing(plan, person(4, 1, 1), 'idle', 'idle', world({ clock: k * 0.5, mournAt: { x: 0, z: 0 } }), null, false);
    assert.equal(p.clip, 'sad_idle');
    seen.add(p.gesture);
  }
  assert.deepEqual([...seen].sort(), ['mourn', 'weep']);
  // Far from the grave, or busy with a task, life goes on.
  assert.equal(planActing(plan, person(4, 30, 0), 'idle', 'idle', world({ mournAt: { x: 0, z: 0 } }), null, false).clip, undefined);
  // Called to prayer there: most stand grieving, one in three kneels in the prayer's own pose.
  assert.equal(planActing(plan, person(4, 1, 0, { anim: 'pray' }), null, 'pray', world({ mournAt: { x: 0, z: 0 } }), null, false).clip, 'sad_idle');
  assert.equal(planActing(plan, person(6, 1, 0, { anim: 'pray' }), null, 'pray', world({ mournAt: { x: 0, z: 0 } }), null, false).clip, undefined);
});

test('two with nothing to do face one another and take turns: one speaks, the other listens', () => {
  const a = person(4, 0, 0), b = person(9, 0.8, 0), pa = blankPlan(), pb = blankPlan();
  let aSpoke = 0, bSpoke = 0;
  for (let k = 0; k < 120; k++) {
    const w = world({ clock: k * 0.5 });
    planActing(pa, a, 'idle', 'idle', w, b, true);
    planActing(pb, b, 'idle', 'idle', w, a, true);
    assert.ok(pa.face && pb.face && pa.look && pb.look, 'both turn to the other');
    const sa = pa.clip === 'talk' || pa.clip === 'chat', sb = pb.clip === 'talk' || pb.clip === 'chat';
    assert.notEqual(sa, sb, 'exactly one of them is speaking');
    assert.equal(sa ? pb.gesture : pa.gesture, 'listen');
    aSpoke += +sa; bSpoke += +sb;
  }
  assert.ok(aSpoke > 30 && bSpoke > 30, 'each has their say');
  // Not with a passer-by, nor when the other has their eye on someone else, nor when downcast.
  assert.equal(planActing(pa, a, 'idle', 'idle', world(), person(9, 0.8, 0, { anim: 'walk', speed: 1 }), true).face, false);
  assert.equal(planActing(pa, a, 'idle', 'idle', world(), b, false).face, false);
  assert.equal(planActing(pa, person(4, 0, 0, { happy: 0.1 }), 'sad_idle', 'idle', world(), b, true).face, false);
});

test('two children chase each other round a ring, opposite one another, and end up where they began', () => {
  const a = person(4, 0, 0, { child: true }), b = person(9, 1, 0, { child: true });
  const pa = blankPlan(), pb = blankPlan(), sa = blankState(), sb = blankState();
  let chased = 0, clapped = 0, far = 0;
  for (let k = 0; k < 17 * 60 * 2; k++) {
    const w = world({ clock: k / 60 });
    planActing(pa, a, 'idle', 'idle', w, b, true);
    planActing(pb, b, 'idle', 'idle', w, a, true);
    assert.equal(pa.chase, pb.chase, 'they play the same game');
    easeActing(sa, pa, a, 1 / 60);
    easeActing(sb, pb, b, 1 / 60);
    if (pa.chase) {
      chased++;
      assert.equal(pa.clip, 'jog');
      // Where each is drawn: across the ring from the other, never straying far from their own spot.
      const ax = a.x + sa.ox, az = a.z + sa.oz, bx = b.x + sb.ox, bz = b.z + sb.oz;
      far = Math.max(far, Math.hypot(sa.ox, sa.oz));
      assert.ok(Math.hypot(ax - bx, az - bz) > 0.6, 'they never run through each other');
    } else if (pa.gesture === 'clap') {
      clapped++;
      assert.ok(Math.hypot(sa.ox, sa.oz) < 0.25, 'back on their own spot soon after the chase');
    }
  }
  assert.ok(chased > 300 && clapped > 200, 'both games are played');
  assert.ok(far > 0.8 && far < 1.05, `they run right round the ring (${far.toFixed(2)})`);
  // A child skips along rather than walking.
  const skip = planActing(pa, person(4, 0, 0, { child: true, anim: 'walk', speed: 1 }), 'walk', 'walk', world(), null, false);
  assert.equal(skip.clip, 'jog');
  assert.ok(skip.hop > 0);
});

test('standing about, each islander fidgets now and then in their own time; the tired yawn, the hungry rub their bellies', () => {
  const seen = new Set<Gesture>();
  let busy = 0, together = 0;
  for (let k = 0; k < 4000; k++) {
    const f = fidgetFor({ id: 4, child: false, rest: 0.8, hunger: 0.8, tool: 'none' }, k * 0.25);
    const g = fidgetFor({ id: 5, child: false, rest: 0.8, hunger: 0.8, tool: 'none' }, k * 0.25);
    seen.add(f);
    busy += +(f !== 'none');
    together += +(f !== 'none' && f === g);
  }
  for (const g of ['stretch', 'brow', 'scratch', 'hips'] as const) assert.ok(seen.has(g), `${g} turns up`);
  assert.ok(busy > 200 && busy < 1600, `mostly still, sometimes fidgeting (${busy} of 4000)`);
  assert.ok(together < busy * 0.3, 'two islanders are not in step');
  const tired = new Set(Array.from({ length: 2000 }, (_, k) => fidgetFor({ id: 4, child: false, rest: 0.1, hunger: 0.8, tool: 'none' }, k * 0.25)));
  const hungry = new Set(Array.from({ length: 2000 }, (_, k) => fidgetFor({ id: 4, child: false, rest: 0.8, hunger: 0.1, tool: 'none' }, k * 0.25)));
  assert.ok(tired.has('yawn') && hungry.has('belly'));
  // With a tool in the hand, nothing that needs both arms.
  const armed = new Set(Array.from({ length: 4000 }, (_, k) => fidgetFor({ id: 4, child: false, rest: 0.8, hunger: 0.8, tool: 'axe' }, k * 0.25)));
  assert.ok(!armed.has('stretch') && !armed.has('hips'));
  // The plan carries it; the walking and the working never fidget.
  const plan = blankPlan();
  const got = new Set(Array.from({ length: 400 }, (_, k) => planActing(plan, person(4), 'idle', 'idle', world({ clock: k * 0.25 }), null, false).gesture));
  assert.ok(got.size > 2);
  assert.equal(planActing(plan, person(4, 0, 0, { anim: 'chop' }), null, 'chop', world({ clock: 3 }), null, false).gesture, 'none');
});

test('heads turn to a passer-by, eased and no further than a neck allows', () => {
  const plan = blankPlan(), st = blankState(), me = person(4);
  const passer = person(9, 1.5, 0.2, { anim: 'walk', speed: 1.1 });
  planActing(plan, me, 'idle', 'idle', world(), passer, false);
  assert.ok(plan.look && !plan.face);
  let W = bind();
  applyLook(W, st, plan, me.x, me.z, me.heading, 1 / 60);
  assert.ok(headYaw(W) > 0 && headYaw(W) < 0.2, 'the first frame only begins the turn');
  for (let k = 0; k < 120; k++) { W = bind(); applyLook(W, st, plan, me.x, me.z, me.heading, 1 / 60); }
  assert.ok(headYaw(W) > 1.0 && headYaw(W) < 1.2, `turned toward them, to the neck's limit (${headYaw(W).toFixed(2)})`);
  assert.ok(at(W[BI.head]).distanceTo(joint.head) < 0.05, 'the head stays on the neck');
  // Someone standing still further off is not stared at.
  assert.equal(planActing(plan, me, 'idle', 'idle', world({ clock: 5.3 }), person(9, 2, 0), false).look, false);
});

test('gestures bend the arms without stretching them, and the hand reaches where it is sent', () => {
  const W = bind();
  reach(W, model, 'R', BI.chest, -0.035, -0.15, 0.2, -1, -0.6, -0.3, 1);
  const want = new THREE.Vector3(-0.035, -0.15, 0.2).add(joint.chest);
  assert.ok(at(W[BI.handR]).distanceTo(want) < 1e-6, 'the wrist is at the point');
  assert.ok(Math.abs(at(W[BI.upper_armR]).distanceTo(at(W[BI.forearmR])) - model.len.upper) < 1e-6);
  assert.ok(Math.abs(at(W[BI.forearmR]).distanceTo(at(W[BI.handR])) - model.len.fore) < 1e-6);
  for (const g of ['cower', 'mourn', 'weep', 'listen', 'stretch', 'brow', 'scratch', 'hips', 'belly', 'yawn', 'clap', 'cheer'] as const) {
    for (let k = 0; k < 20; k++) {
      const B = bind();
      applyGesture(B, model, g, 1, k * 0.37, 7);
      for (const s of ['L', 'R'] as const) {
        assert.ok(Math.abs(at(B[BI[`upper_arm${s}`]]).distanceTo(at(B[BI[`forearm${s}`]])) - model.len.upper) < 0.01, `${g}: upper arm keeps its length`);
        assert.ok(Math.abs(at(B[BI[`forearm${s}`]]).distanceTo(at(B[BI[`hand${s}`]])) - model.len.fore) < 0.01, `${g}: forearm keeps its length`);
      }
      for (const m of B) for (const e of m.elements) assert.ok(Number.isFinite(e), `${g}: a sound skeleton`);
      // Feet and hips are never moved by a gesture.
      assert.ok(at(B[BI.footL]).distanceTo(joint.footL) < 1e-9 && at(B[BI.hips]).distanceTo(joint.hips) < 1e-9);
    }
  }
  // Cowering brings both hands up beside the head; grieving bows it.
  const C = bind();
  applyGesture(C, model, 'cower', 1, 0, 7);
  assert.ok(at(C[BI.handL]).y > joint.neck.y && at(C[BI.handR]).y > joint.neck.y);
  const M = bind();
  applyGesture(M, model, 'mourn', 1, 0, 7);
  assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(M[BI.head]).y < -0.25, 'the head hangs');
});

test('turning a bone carries everything that hangs from it, about its own joint', () => {
  const W = bind();
  swing(W, BI.upper_armL, 1, 0, 0, -Math.PI / 2);
  assert.ok(at(W[BI.upper_armL]).distanceTo(joint.upper_armL) < 1e-9, 'the shoulder joint stays put');
  assert.ok(at(W[BI.handL]).z > joint.handL.z + 0.25, 'the arm swings forward');
  assert.ok(Math.abs(at(W[BI.handL]).distanceTo(at(W[BI.upper_armL])) - joint.handL.distanceTo(joint.upper_armL)) < 1e-9);
  assert.ok(at(W[BI.handR]).distanceTo(joint.handR) < 1e-9, 'and the other arm is left alone');
});

test('a gesture fades out before the next fades in, and the body turns smoothly to face a friend', () => {
  const st = blankState(), plan = blankPlan(), me = { x: 0, z: 0, heading: 0 };
  plan.gesture = 'brow';
  easeActing(st, plan, me, 1 / 60);
  for (let k = 0; k < 40; k++) easeActing(st, plan, me, 1 / 60);
  assert.equal(st.gesture, 'brow');
  assert.equal(st.g, 1);
  plan.gesture = 'hips';
  easeActing(st, plan, me, 1 / 60);
  assert.equal(st.gesture, 'brow', 'still the old one, fading');
  assert.ok(st.g < 1 && st.g > 0.8);
  for (let k = 0; k < 60; k++) easeActing(st, plan, me, 1 / 60);
  assert.equal(st.gesture, 'hips');
  assert.equal(st.g, 1);
  plan.gesture = 'none'; plan.face = plan.look = true; plan.lookX = 1; plan.lookZ = 0;
  easeActing(st, plan, me, 1 / 60);
  assert.ok(st.yaw > 0 && st.yaw < 0.2, 'the turn begins gently');
  for (let k = 0; k < 200; k++) easeActing(st, plan, me, 1 / 60);
  assert.ok(Math.abs(st.yaw - Math.PI / 2) < 0.01, 'and ends facing them');
});
