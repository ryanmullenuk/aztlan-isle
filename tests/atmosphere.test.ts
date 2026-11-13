import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DAY_KEYS, WORLD } from '../src/config';
import { generateIsland } from '../src/world/generator';
import { World } from '../src/world/World';
import { Lighting, atmosphereAt } from '../src/render/Lighting';
import { Atmosphere, MIST_COUNT, mistSpots } from '../src/render/Atmosphere';
import { SHAFT_COUNT, shaftAxis } from '../src/render/LightShafts';
import { FireLights, flicker } from '../src/buildings/FireLights';

const island = (): World => {
  const w = new World();
  generateIsland(w, WORLD.islandSeed, 'classic', 3);
  return w;
};

test('the day has a golden hour at each end, a blue hour beside the night, and a moonlit night', () => {
  const L = new Lighting(new THREE.Scene(), 1024), at = new THREE.Vector3();
  const sample = (t: number) => {
    L.update(t, at, 40);
    return { ...L.state, sun: L.sun.color.clone(), hemi: L.hemi.color.clone(), sunI: L.sun.intensity, fog: L.state.fog.clone() };
  };
  const noon = sample(0.4), evening = sample(0.78), morning = sample(0.215), dusk = sample(0.845), night = sample(0);
  assert.ok(noon.golden < 0.01 && noon.dusk === 0 && noon.moon === 0, 'midday is plain daylight');
  assert.ok(evening.golden > 0.6 && morning.golden > 0.6, `golden hour ${evening.golden} ${morning.golden}`);
  // Golden light is redder than midday's; the blue hour's sky bounce is bluer than the night's.
  assert.ok(evening.sun.b / evening.sun.r < noon.sun.b / noon.sun.r - 0.2);
  assert.ok(dusk.dusk > 0.6 && dusk.golden < 0.05, `blue hour ${dusk.dusk}`);
  assert.ok(dusk.hemi.b > dusk.hemi.r * 1.5 && dusk.fog.b > dusk.fog.r * 1.3, 'dusk is blue');
  // Night: lit by the moon, cool, and far from black.
  assert.ok(night.moon > 0.99 && night.golden === 0 && night.dusk === 0);
  assert.ok(night.sun.b > night.sun.r && night.sunI > 1.2 && L.hemi.intensity > 0.8, 'moonlight to see by');
  // No jumps anywhere in the day: light and haze change smoothly from one moment to the next.
  let prev = sample(0);
  for (let t = 0.002; t <= 1; t += 0.002) {
    const s = sample(t);
    assert.ok(Math.abs(s.sunI - prev.sunI) < 0.12, `sunlight jumps at ${t}`);
    assert.ok(Math.abs(s.fog.r - prev.fog.r) + Math.abs(s.fog.b - prev.fog.b) < 0.08, `haze jumps at ${t}`);
    for (const k of ['golden', 'dusk', 'mist', 'shafts', 'moon'] as const) {
      assert.ok(s[k] >= 0 && s[k] <= 1, `${k} out of range at ${t}`);
      assert.ok(Math.abs(s[k] - prev[k]) < 0.12, `${k} jumps at ${t}`);
    }
    prev = s;
  }
  assert.equal(Lighting.current, L.state);
});

test('mist lies at dawn and burns off; shafts want a low, unclouded sun', () => {
  const elevAt = (t: number) => {
    const i = DAY_KEYS.findIndex((k, j) => j < DAY_KEYS.length - 1 && t >= k.t && t <= DAY_KEYS[j + 1].t);
    const a = DAY_KEYS[i], b = DAY_KEYS[i + 1];
    return a.elev + ((b.elev - a.elev) * (t - a.t)) / (b.t - a.t);
  };
  const at = (t: number, oc = 0) => atmosphereAt(t, elevAt(t), oc);
  assert.ok(at(0.2).mist > 0.95, 'thick at sunrise');
  assert.ok(at(0.1).mist > 0.1 && at(0.1).mist < 0.35, 'a thin veil before dawn');
  assert.ok(at(0.3).mist < at(0.24).mist && at(0.38).mist === 0, 'burnt off by mid-morning');
  assert.equal(at(0.5).mist, 0);
  assert.equal(at(0.7).mist, 0);
  assert.ok(at(0.2, 1).mist < 0.25, 'rain clears it');
  assert.ok(at(0.22).shafts > 0.6 && at(0.78).shafts > 0.4, 'shafts morning and evening');
  assert.ok(at(0.4).shafts < 0.02 && at(0).shafts === 0 && at(0.22, 1).shafts === 0, 'none at noon, at night or under cloud');
  // Shafts never lie flat along the ground, whatever the sun does.
  for (const y of [-0.2, 0, 0.1, 0.5, 1]) {
    const a = shaftAxis(new THREE.Vector3(0.6, y, -0.4).normalize());
    assert.ok(Math.abs(a.length() - 1) < 1e-6 && a.y > 0.55 && a.y < 0.92, `axis ${a.y}`);
  }
});

test('mist banks sit level over water and low ground, clear of the land under them', () => {
  const w = island(), spots = mistSpots(w);
  assert.ok(spots.length >= MIST_COUNT.medium, `only ${spots.length} banks`);
  assert.ok(spots.some((s) => s.on === 'water') && spots.some((s) => s.on === 'land'));
  for (const s of spots) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, d = s.r * (k % 2 ? 0.8 : 0.4);
      assert.ok(w.heightAt(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d) < s.y + 0.35, 'a bank cuts into the ground');
    }
    assert.ok(s.y < 6, 'mist on a mountainside');
  }
});

test('the atmosphere draws nothing by day, scales with the preset and holds still without motion', () => {
  const w = island(), L = new Lighting(new THREE.Scene(), 1024), at = new THREE.Vector3();
  const A = new Atmosphere(w, 'low') as any;
  assert.equal(A.mist.mesh.count, Math.min(A.mist.spots.length, MIST_COUNT.low));
  assert.ok(A.shafts.spots.length > SHAFT_COUNT.low, 'too few places for shafts');
  L.update(0.5, at, 40);
  A.update(0.1, L.state);
  assert.ok(!A.mist.mesh.visible && !A.shafts.mesh.visible, 'mist or shafts at midday');
  L.update(0.21, at, 40);
  A.update(0.1, L.state);
  assert.ok(A.mist.mesh.visible && A.shafts.mesh.visible, 'no mist or shafts at sunrise');
  const drift = A.mist.mat.uniforms.uDrift.value.clone();
  A.update(1, L.state, false);
  assert.ok(A.mist.mat.uniforms.uDrift.value.equals(drift), 'mist drifted with motion off');
  A.update(1, L.state, true);
  assert.ok(!A.mist.mat.uniforms.uDrift.value.equals(drift));
  A.setPreset('ultra');
  assert.ok(A.mist.mesh.count > MIST_COUNT.low && A.shafts.geo.instanceCount > SHAFT_COUNT.low);
  L.overcast = 1;
  L.update(0.21, at, 40);
  A.update(0.1, L.state);
  assert.ok(!A.shafts.mesh.visible, 'shafts under storm cloud');
});

test('flames flicker smoothly within bounds, and stand still on request', () => {
  let lo = 9, hi = 0, prev = flicker(0, 1.3);
  for (let t = 0; t < 120; t += 1 / 60) {
    const f = flicker(t, 1.3);
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
    assert.ok(Math.abs(f - prev) < 0.03, 'a strobe');
    prev = f;
  }
  assert.ok(lo > 0.55 && lo < 0.85 && hi > 1.12 && hi < 1.3, `flicker ${lo}..${hi}`);
  const F = new FireLights() as any, fire = [{ key: 'a', pos: new THREE.Vector3(0, 0.3, 0), ground: 0, big: true }];
  const seen = new Set<string>();
  for (let i = 0; i < 90; i++) {
    F.update(1 / 30, i / 30, 1, fire, new THREE.Vector3());
    seen.add(F.lights.find((l: any) => l.key === 'a').light.position.x.toFixed(3));
  }
  assert.ok(seen.size > 10, 'the flame never moves');
  F.still = true;
  const at = () => { const l = F.lights.find((x: any) => x.key === 'a').light; return [l.intensity, l.position.x, l.position.y]; };
  F.update(1 / 30, 5, 1, fire, new THREE.Vector3());
  const a = at();
  F.update(1 / 30, 5.4, 1, fire, new THREE.Vector3());
  assert.deepEqual(at(), a);
});
