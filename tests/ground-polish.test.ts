import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { Terrain } from '../src/terrain/Terrain';
import { GrassTufts, grassMaterial } from '../src/vegetation/GrassTufts';
import { Wildflowers } from '../src/vegetation/Wildflowers';
import { GROUND_FX, NEUTRAL, SEASON_LOOKS, TRAMPLERS, clearGroundSeason, groundSeason, seasonLook, seasonPhase, setGroundSeason, setTramplers } from '../src/terrain/groundFx';
import { TIME } from '../src/config';

/** Set the ground to the middle of a season (0 spring … 3 winter). */
function mid(season: number): void {
  const days = (season + 0.5) * TIME.daysPerSeason;
  setGroundSeason(Math.floor(days), days % 1);
}

function island(): World {
  const w = new World(5);
  generateIsland(w);
  return w;
}

test('each season holds its look through its middle and eases into the next', () => {
  for (let s = 0; s < 4; s++) assert.deepEqual(seasonLook(s + 0.5), SEASON_LOOKS[s]);
  // At the turn of the season the look is halfway, and the year wraps from winter to spring.
  const turn = seasonLook(4), again = seasonLook(0);
  assert.deepEqual(turn, again);
  assert.ok(Math.abs(turn.flowers - (SEASON_LOOKS[3].flowers + SEASON_LOOKS[0].flowers) / 2) < 1e-9);
  // Flowers thick in spring, sparse in winter; grass driest in winter, leaves down in autumn.
  assert.ok(SEASON_LOOKS[0].flowers > SEASON_LOOKS[1].flowers && SEASON_LOOKS[1].flowers > SEASON_LOOKS[2].flowers && SEASON_LOOKS[2].flowers > SEASON_LOOKS[3].flowers);
  assert.ok(SEASON_LOOKS[3].dry > SEASON_LOOKS[2].dry && SEASON_LOOKS[2].leaf === 1);
  assert.equal(seasonPhase(0, 0), 0);
  assert.equal(Math.floor(seasonPhase(TIME.daysPerSeason * 3, 0.5)), 3);
  assert.ok(seasonPhase(TIME.daysPerSeason * 4, 0) < 1e-9);
});

test('the season reaches the ground and grass through shared uniforms, and can be cleared', () => {
  const w = island();
  const t = new Terrain(w, 2);
  assert.equal(t.uniforms.uSeasonTint, GROUND_FX.uSeasonTint);
  assert.equal(GROUND_FX.uGroundWear.value, t.wearTex);
  setGroundSeason(TIME.daysPerSeason * 2 + 1, 0.5);
  assert.ok(GROUND_FX.uSeasonTint.value.x > 1.1 && GROUND_FX.uSeasonK.value.y > 0.9, 'autumn: golden, leaves down');
  clearGroundSeason();
  assert.equal(groundSeason.look, NEUTRAL);
  assert.deepEqual(GROUND_FX.uSeasonTint.value.toArray(), [1, 1, 1]);
});

test('the nearest walkers bend the grass, hidden and far ones do not', () => {
  const walkers = Array.from({ length: 20 }, (_, k) => ({ x: k, z: 0, hidden: k === 0 }));
  setTramplers({ x: 0, z: 0 }, [walkers.slice(0, 10), walkers.slice(10), [{ x: 500, z: 0 }]]);
  const u = GROUND_FX.uTramplers.value;
  assert.equal(u.length, TRAMPLERS);
  assert.deepEqual(u.map((v) => v.x), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(u.every((v) => v.w > 0));
  setTramplers({ x: 0, z: 0 }, [[{ x: 2, z: 1, reach: 0.7 }]]);
  assert.equal(u[0].w, 0.7);
  assert.ok(u.slice(1).every((v) => v.w === 0));
  setTramplers({ x: 0, z: 0 }, []);
  assert.ok(u.every((v) => v.w === 0));
});

test('grass has its own material, sharing the ground uniforms', () => {
  const grass = new GrassTufts({ N: 2, seed: 1, half: 1 } as any, 1);
  const mat = (grass.group.children[0] as any).material;
  assert.equal(mat, grassMaterial());
  const shader: any = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <opaque_fragment>' };
  mat.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uTramplers, GROUND_FX.uTramplers);
  assert.ok(shader.vertexShader.includes(`uTramplers[${TRAMPLERS}]`) && shader.vertexShader.includes('uGroundWear'));
  assert.ok(shader.fragmentShader.includes('uSeasonTint'));
});

test('worn ground is drawn with a faint skirt, leaving the wear itself alone', () => {
  const w = island();
  const t = new Terrain(w, 2) as any;
  const [cx, cz] = w.cellOf(w.meadow.x, w.meadow.z);
  const i = w.idx(cx, cz);
  const before = w.wear.slice();
  before[i] = 1;
  w.wear[i] = 1;
  t.updateWear();
  assert.deepEqual(w.wear, before);
  assert.equal(t.wearData[i * 4], 255);
  const beside = t.wearData[(i + 1) * 4], far = t.wearData[(i + 3) * 4];
  assert.ok(beside > 0 && beside < 60, `skirt ${beside}`);
  assert.equal(far, 0);
});

test('wildflowers are thick in spring and sparse in winter, a few chunks at a time', () => {
  clearGroundSeason();
  const w = island();
  const f = new Wildflowers(w, 1) as any;
  const shown = () => f.chunks.reduce((n: number, c: any) => n + (c.key.match(/1/g)?.length ?? 0), 0);
  const usual = shown();
  assert.ok(usual > 0 && usual <= f.count);
  // The butterflies' blooms are the usual scatter, whatever the season.
  const blooms = f.blooms().length;
  const settle = () => { for (let k = 0; k < 80; k++) f.refresh(); };
  mid(0);
  const built = f.chunks.filter((c: any) => c.mesh).map((c: any) => c.mesh);
  f.refresh();
  const remade = f.chunks.filter((c: any) => c.mesh && !built.includes(c.mesh)).length;
  assert.ok(remade > 0 && remade <= 2, `${remade} chunks re-made in one refresh`);
  settle();
  const spring = shown();
  mid(3);
  settle();
  const winter = shown();
  assert.ok(spring > usual * 1.15, `spring ${spring} against the usual ${usual}`);
  assert.ok(winter < usual * 0.75, `winter ${winter} against the usual ${usual}`);
  assert.equal(f.blooms().length, blooms);
  clearGroundSeason();
});
