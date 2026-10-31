/// <reference lib="webworker" />
import { World } from '../world/World';
import { Pathfinder, type PathOptions } from './Pathfinder';

/**
 * Route-finding in the background: a copy of the island's walkability (sent whenever terrain or
 * obstacles change) and the same Pathfinder the game uses. Long searches run here so a burst of
 * them (a storm sending everyone home) never stalls a frame.
 */
const world = new World();
const pf = new Pathfinder(world);

export interface PathWorldSnapshot {
  layer: Int8Array; bridge: Uint8Array; occ: Int32Array; riverY: Float32Array; forest: Float32Array;
  wear: Float32Array; path: Uint8Array; blockRock: Uint8Array; blockFixed: Uint8Array;
  passable: number[]; doorways: [number, { cx: number; cz: number; w: number; d: number; rot: number }][];
}
export interface PathJob { id: number; sx: number; sz: number; tx: number; tz: number; opts: Omit<PathOptions, 'avoid'> & { avoid?: number[] } }
export type PathMessage = { world: PathWorldSnapshot } | { jobs: PathJob[] };

self.onmessage = (e: MessageEvent<PathMessage>) => {
  const m = e.data;
  if ('world' in m) {
    const s = m.world;
    world.layer.set(s.layer); world.bridge.set(s.bridge); world.occ.set(s.occ); world.riverY.set(s.riverY);
    world.forest.set(s.forest); world.wear.set(s.wear); world.path.set(s.path);
    world.blockRock.set(s.blockRock); world.blockFixed.set(s.blockFixed);
    world.passableBuildings = new Set(s.passable);
    world.doorways = new Map(s.doorways);
    return;
  }
  const results = m.jobs.map((j) => ({
    id: j.id,
    path: pf.find(j.sx, j.sz, j.tx, j.tz, { ...j.opts, avoid: j.opts.avoid ? new Set(j.opts.avoid) : undefined }),
  }));
  (self as unknown as Worker).postMessage({ results });
};
