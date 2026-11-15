import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD } from '../src/config';
import { generateIsland } from '../src/world/generator';
import { World } from '../src/world/World';
import { Seabed } from '../src/entities/Seabed';
import { Coral } from '../src/entities/Coral';
import { STARFISH, habitatMaterial } from '../src/entities/Habitat';
import { StarfishCrawl } from '../src/entities/StarfishCrawl';
import { OCTOPUS, Octopuses, crawlPace, jetPulse, octoGait } from '../src/entities/Octopuses';
import { SEA_SURFACE } from '../src/water/Water';

const island = () => { const w = new World(); generateIsland(w, WORLD.islandSeed, 'classic', 3); return w; };
const starMeshes = (g: THREE.Group) => g.children.filter((o) => /-star$/.test(o.name)) as THREE.InstancedMesh[];

test('starfish creep slowly over the sand: near home, on the seabed, a few set off per frame', () => {
  const w = island();
  for (const [what, group, crawl] of [(() => { const s = new Seabed(w); return ['seabed', s.group, s.stars] as const; })(), (() => { const c = new Coral(w); return ['coral', c.group, c.stars] as const; })()]) {
    const meshes = starMeshes(group);
    assert.ok(meshes.length > 0 && crawl.size > 5, `${what} has ${crawl.size} starfish`);
    const homes = meshes.map((m) => Array.from({ length: m.count }, (_, i) => StarfishCrawl.positionAt(m, i, 0)));
    const p = new THREE.Vector3(), prev = new THREE.Vector3();
    let most = 0, moved = 0, fastest = 0, total = 0;
    const dt = 1 / 30;
    for (let f = 1; f <= 30 * 90; f++) {
      const now = f * dt, n = crawl.update(now);
      most = Math.max(most, n); total += n;
      if (f % 15) continue;
      meshes.forEach((m, k) => { for (let i = 0; i < m.count; i++) {
        StarfishCrawl.positionAt(m, i, now, p);
        StarfishCrawl.positionAt(m, i, now - dt, prev);
        const home = homes[k][i], d = Math.hypot(p.x - home.x, p.z - home.z);
        assert.ok(d <= STARFISH.roam + 1e-3, `${what} starfish strayed ${d.toFixed(2)} from home`);
        assert.ok(Math.abs(p.y - (w.heightAt(p.x, p.z) - 0.02)) < 0.06, `${what} starfish left the seabed`);
        fastest = Math.max(fastest, Math.hypot(p.x - prev.x, p.z - prev.z) / dt);
      } });
    }
    meshes.forEach((m, k) => { for (let i = 0; i < m.count; i++) {
      const at = StarfishCrawl.positionAt(m, i, 90, p);
      if (at.distanceTo(homes[k][i]) > 0.02) moved++;
      assert.ok(w.isSeaAt(at.x, at.z) && w.heightAt(at.x, at.z) <= -0.35, 'still on the open shelf');
      assert.ok(m.boundingSphere!.containsPoint(at), 'inside the bounds its mesh is culled by');
    } });
    assert.ok(most <= STARFISH.budget, `${most} set off in one frame`);
    assert.ok(total > crawl.size, 'they keep setting off');
    assert.ok(moved > crawl.size * 0.6, `only ${moved} of ${crawl.size} moved`);
    assert.ok(fastest > 0.01 && fastest < STARFISH.speed * 1.6, `creeping at ${fastest.toFixed(3)}`);
  }
});

test('starfish: one stretch runs smoothly from the matrix, the model swap keeps each mesh its own instances, refits start afresh', () => {
  const w = island(), s = new Seabed(w), meshes = starMeshes(s.group), m = meshes[0];
  for (let f = 1; f <= 600; f++) s.stars.update(f / 30);
  // Between two frames nobody jumps, whether setting off, creeping or stopping.
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let f = 601; f <= 1500; f++) {
    const before = meshes.map((k) => Array.from({ length: k.count }, (_, i) => StarfishCrawl.positionAt(k, i, (f - 1) / 30).clone()));
    s.stars.update(f / 30);
    meshes.forEach((k, j) => { for (let i = 0; i < k.count; i++) assert.ok(StarfishCrawl.positionAt(k, i, f / 30, a).distanceTo(before[j][i]) < 0.004, 'a starfish jumped'); });
  }
  // The artist's model arriving: same per-instance data on every mesh, the new shape shared.
  const crawlAttr = m.geometry.getAttribute('aCrawl'), other = meshes[1].geometry.getAttribute('aCrawl');
  assert.notEqual(crawlAttr, other, 'each mesh has its own stretches');
  const model = new THREE.CircleGeometry(0.13, 5).rotateX(-Math.PI / 2);
  s.stars.setGeometry(model);
  assert.equal(m.geometry.getAttribute('aCrawl'), crawlAttr);
  assert.equal(meshes[1].geometry.getAttribute('aCrawl'), other);
  assert.equal(m.geometry.getAttribute('position'), model.getAttribute('position'));
  assert.equal((m.geometry.getAttribute('aStar') as THREE.InstancedBufferAttribute).count, m.instanceMatrix.count);
  // A refit (terrain edit, detail level) puts everyone back on a fresh list: no stale stretches.
  s.setPreset('low'); s.setPreset('ultra');
  s.stars.update(51);
  m.geometry.getAttribute('aCrawl').array.forEach((v, i) => { if (i % 4 < 3 && i < m.count * 4) assert.ok(Math.abs(v) <= STARFISH.step[1]); });
  for (let i = 0; i < m.count; i++) { StarfishCrawl.positionAt(m, i, 51, a); m.getMatrixAt(i, new THREE.Matrix4()); assert.ok(Math.abs(a.y - (w.heightAt(a.x, a.z) - 0.02)) < 0.06); }
  void b;
});

test('only the starfish material carries the crawl and arm wave', () => {
  const compile = (mat: THREE.MeshStandardMaterial) => { const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }; mat.onBeforeCompile(sh as any, {} as any); return sh.vertexShader; };
  const plain = compile(habitatMaterial(true)), star = compile(habitatMaterial(true, true));
  assert.ok(!plain.includes('aCrawl') && !plain.includes('starWave'));
  assert.ok(star.includes('attribute vec4 aCrawl') && star.includes('starWave') && star.includes('worldPosition.xyz+=habitatCrawl'));
  assert.notEqual(habitatMaterial(true).customProgramCacheKey(), habitatMaterial(true, true).customProgramCacheKey());
  const c = new Coral(island());
  for (const o of c.group.children) assert.equal(((o as THREE.Mesh).material as THREE.Material).customProgramCacheKey().endsWith('-star'), o.name === 'habitat-star', o.name);
});

test('octopus: short moves are crawled, long ones swum; the jet surges and glides', () => {
  assert.equal(octoGait(0.8), 'crawl');
  assert.equal(octoGait(OCTOPUS.crawlMax + 0.5), 'swim');
  let sum = 0, pace = 0, lo = 9, hi = 0;
  for (let k = 0; k < 1000; k++) { const v = jetPulse(k / 1000); sum += v; pace += crawlPace(k / 100); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(Math.abs(sum / 1000 - 1) < 0.06, `jet averages ${sum / 1000}`);
  assert.ok(Math.abs(pace / 1000 - 1) < 0.1);
  assert.ok(hi > 1.8 && lo < 0.6 && jetPulse(0.19) > jetPulse(0.9), 'a surge, then a glide');
  assert.ok(Math.abs(jetPulse(0.9999) - jetPulse(0)) < 0.01, 'strokes join up');

  const w = island(), octos = new Octopuses(w), o = octos.list[0];
  assert.ok(o, 'an octopus lives in the shallows');
  // Somewhere in the shallows close by, and somewhere further off.
  const spot = (from: number, to: number) => { for (let a = 0; a < 40; a++) for (let r = from; r <= to; r += 0.2) { const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r; if (octos.shallows(x, z)) return { x, z }; } throw new Error('no spot'); };
  const near = spot(0.8, 1.6), far = spot(3.2, 6);
  octos.go(o, near.x, near.z);
  assert.equal(o.state, 'crawl');
  o.legs = 1;
  let high = 0, top = 0;
  for (let f = 0; f < 30 * 6; f++) { octos.update(1 / 30, []); if (o.state !== 'crawl') break; high = Math.max(high, o.y - w.heightAt(o.x, o.z)); top = Math.max(top, o.vel); }
  assert.ok(high < 0.12, `crawls low on the sand (${high.toFixed(2)})`);
  assert.ok(top > 0.05 && top < OCTOPUS.crawl * 2, `crawls slowly (${top.toFixed(2)})`);
  octos.go(o, far.x, far.z);
  assert.equal(o.state, 'swim');
});

test('octopus: gathers way gently, lifts off and settles softly, never snaps round or leaves the shallows, and still jets off in ink', () => {
  const w = island(), octos = new Octopuses(w), dt = 1 / 30;
  const turnOf = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const seen = new Set<string>();
  let lifted = 0;
  for (let f = 0; f < 30 * 240; f++) {
    const before = octos.list.map((o) => ({ h: o.heading, v: o.vel, y: o.y, x: o.x, z: o.z, state: o.state }));
    // Now and then something comes by.
    if (f % 1500 === 900) for (const o of octos.list) octos.startle(o, o.x + 1, o.z);
    octos.update(dt, []);
    octos.list.forEach((o, k) => {
      const b = before[k];
      seen.add(o.state);
      assert.ok(octos.shallows(o.x, o.z), 'left the shallows');
      assert.ok(o.y <= Math.max(SEA_SURFACE - OCTOPUS.under, w.heightAt(o.x, o.z) + 0.02) + 1e-6 && o.y >= w.heightAt(o.x, o.z) - 1e-6, 'out of the water or under the sand');
      assert.ok(turnOf(o.heading, b.h) <= OCTOPUS.turn.dash * dt + 1e-6, 'snapped round');
      if (o.state !== 'dash' && b.state !== 'dash') assert.ok(turnOf(o.heading, b.h) <= OCTOPUS.turn.swim * dt + 1e-6, `turned too sharply: ${(turnOf(o.heading, b.h) / dt).toFixed(2)} (${b.state} -> ${o.state}, ${o.timer.toFixed(2)})`);
      assert.ok(Math.abs(o.vel - b.v) < (o.state === 'dash' ? 0.5 : 0.16), `speed jumped ${b.v.toFixed(2)} -> ${o.vel.toFixed(2)} (${b.state} -> ${o.state})`);
      assert.ok(Math.abs(o.y - b.y) < (o.state === 'dash' ? 0.09 : 0.04), `height jumped (${b.state} -> ${o.state})`);
      assert.ok(Math.hypot(o.x - b.x, o.z - b.z) <= OCTOPUS.dash * 2.1 * dt + 1e-6);
      if (o.state === 'swim') lifted = Math.max(lifted, o.lift);
    });
  }
  for (const s of ['rest', 'crawl', 'swim', 'dash']) assert.ok(seen.has(s), `never seen to ${s}`);
  assert.ok(lifted > OCTOPUS.swimLift * 0.8, 'swims up off the sand');

  // Tapped at rest: off at once in ink, body swinging round after it, and back to rest afterwards.
  const o = octos.list[0], kids = octos.group.children.length;
  for (let f = 0; f < 3000 && o.state !== 'rest'; f++) octos.update(dt, []);
  const from = { x: o.x + Math.sin(o.heading) * 2, z: o.z + Math.cos(o.heading) * 2 }, h0 = o.heading, d0 = Math.hypot(o.x - from.x, o.z - from.z);
  octos.update(dt, [from]);
  assert.equal(o.state, 'dash');
  assert.equal(octos.group.children.length, kids + 1, 'a puff of ink');
  assert.ok(turnOf(o.heading, h0) < 0.4, 'no snap on the first frame');
  for (let f = 0; f < 30; f++) octos.update(dt, []);
  assert.ok(Math.hypot(o.x - from.x, o.z - from.z) > d0 + 0.3 || !octos.shallows(o.x + (o.x - from.x), o.z + (o.z - from.z)), 'jets away');
  for (let f = 0; f < 30 * 6; f++) octos.update(dt, []);
  assert.notEqual(o.state, 'dash');
});
