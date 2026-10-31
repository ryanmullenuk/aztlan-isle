import type { World } from '../world/World';
import type { PathOptions } from './Pathfinder';
import type { PathJob, PathWorldSnapshot } from './pathWorker';

type Point = { x: number; z: number };

/**
 * The game's side of the background route-finder: keeps its copy of the island up to date and
 * hands searches over, calling back with each route. If workers aren't available (or the worker
 * fails), `ok` turns false and the game goes on finding routes itself, as before.
 */
export class PathWorkerClient {
  ok = true;
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, (path: Point[] | null) => void>();
  /** When each waiting search was sent (performance.now), to notice a worker that has gone quiet. */
  private sent = new Map<number, number>();
  private seen = '';
  private wearSent = 0;

  constructor(private world: World) {
    try {
      this.worker = new Worker(new URL('./pathWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ results: { id: number; path: Point[] | null }[] }>) => {
        for (const r of e.data.results) {
          const done = this.waiting.get(r.id);
          this.waiting.delete(r.id);
          this.sent.delete(r.id);
          done?.(r.path);
        }
      };
      this.worker.onerror = () => this.fail();
    } catch {
      this.fail();
    }
  }

  get busy(): number {
    return this.waiting.size;
  }

  /** Send the island again when it has changed (and every few seconds, for worn paths). */
  sync(now: number): void {
    if (!this.worker || !this.ok) return;
    // No answer in 5 seconds: the worker isn't working here. Find routes in the game instead.
    const t = performance.now();
    for (const at of this.sent.values()) if (t - at > 5000) return this.fail();
    const w = this.world, key = `${w.version}:${w.navigationVersion}:${w.passableBuildings.size}:${w.doorways.size}`;
    if (key === this.seen && now - this.wearSent < 8) return;
    this.seen = key;
    this.wearSent = now;
    const snapshot: PathWorldSnapshot = {
      layer: w.layer.slice(), bridge: w.bridge.slice(), occ: w.occ.slice(), riverY: w.riverY.slice(), forest: w.forest.slice(),
      wear: w.wear.slice(), path: w.path.slice(), blockRock: w.blockRock.slice(), blockFixed: w.blockFixed.slice(),
      passable: [...w.passableBuildings], doorways: [...w.doorways],
    };
    const transfer = [snapshot.layer, snapshot.bridge, snapshot.occ, snapshot.riverY, snapshot.forest, snapshot.wear, snapshot.path, snapshot.blockRock, snapshot.blockFixed].map((a) => a.buffer);
    this.worker.postMessage({ world: snapshot }, transfer);
  }

  find(sx: number, sz: number, tx: number, tz: number, opts: PathOptions, done: (path: Point[] | null) => void): void {
    if (!this.worker) return done(null);
    const id = this.next++;
    this.waiting.set(id, done);
    this.sent.set(id, performance.now());
    const { avoid, ...rest } = opts;
    const job: PathJob = { id, sx, sz, tx, tz, opts: { ...rest, avoid: avoid ? [...avoid] : undefined } };
    this.worker.postMessage({ jobs: [job] });
  }

  private fail(): void {
    this.ok = false;
    this.worker?.terminate();
    this.worker = null;
    // Anyone still waiting is answered "no route" and simply asks again (the game searches itself now).
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    this.sent.clear();
    for (const done of waiting) done(null);
  }
}
