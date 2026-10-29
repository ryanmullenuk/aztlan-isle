import { World } from '../world/World';

/** Binary min-heap keyed by f-score, storing cell indices. */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  clear(): void {
    this.items.length = 0;
    this.keys.length = 0;
  }
  push(item: number, key: number): void {
    const it = this.items, ks = this.keys;
    let i = it.length;
    it.push(item);
    ks.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= key) break;
      it[i] = it[p];
      ks[i] = ks[p];
      i = p;
    }
    it[i] = item;
    ks[i] = key;
  }
  pop(): number {
    const it = this.items, ks = this.keys;
    const top = it[0];
    const lastI = it.pop()!;
    const lastK = ks.pop()!;
    if (it.length > 0) {
      let i = 0;
      const n = it.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        let mk = lastK;
        if (l < n && ks[l] < mk) { m = l; mk = ks[l]; }
        if (r < n && ks[r] < mk) { m = r; mk = ks[r]; }
        if (m === i) break;
        it[i] = it[m];
        ks[i] = ks[m];
        i = m;
      }
      it[i] = lastI;
      ks[i] = lastK;
    }
    return top;
  }
}

export interface PathOptions {
  /** Building id whose cells may be entered (the destination building). */
  allowBuilding?: number;
  /** Accept any cell within this many cells of the goal. */
  goalRadius?: number;
  /** Water collection and firefighting must reach the goal, not a partial fallback route. */
  requireGoal?: boolean;
  maxIterations?: number;
  /** Captured livestock escorts may swim; bridges and dry land remain preferred. */
  allowWater?: boolean;
  /** Cells to steer round if there's any reasonable way (a jam of people): they cost extra. */
  avoid?: Set<number>;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];
/** Which way a building's door faces per rotation (as ROT_DIR in Buildings). */
const DOOR_DIR = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const ROCK_CLEARANCE = [[-.22,-.22],[.22,-.22],[-.22,.22],[.22,.22]];

/**
 * A* over the terrain grid. Walkers can climb or descend one contour layer per step,
 * prefer worn dirt paths, slow down in dense jungle and can wade shallow rivers.
 */
export class Pathfinder {
  /** CPU diagnostics; direct trips avoid allocating/searching the A* frontier. */
  readonly stats = { searches: 0, direct: 0 };
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap = new Heap();

  constructor(private world: World) {
    const n = world.N * world.N;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  walkable(i: number, allowBuilding = -1, allowWater = false): boolean {
    const w = this.world;
    if (i < 0 || i >= w.N * w.N) return false;
    if (w.layer[i] < 1 && !w.bridge[i] && !allowWater) return false;
    if (w.blocked(i)) return false;
    const occ = w.occ[i];
    if (occ !== 0 && occ - 1 !== allowBuilding && !w.passable(occ - 1)) return false;
    return true;
  }

  /**
   * Stepping between cells a and b (neighbours, or consecutive cells on a line): crossing in or out
   * of a building's footprint is only allowed at its doorway, the middle of its front edge.
   */
  crossOk(a: number, b: number): boolean {
    const w = this.world;
    const oa = w.occ[a], ob = w.occ[b];
    if (oa === ob) return true;
    return this.through(oa, a, b) && this.through(ob, b, a);
  }

  private through(o: number, inside: number, outside: number): boolean {
    if (o === 0) return true;
    const f = this.world.doorways.get(o - 1);
    if (!f) return true;
    const N = this.world.N;
    const ix = inside % N, iz = (inside / N) | 0, dx = outside % N - ix, dz = ((outside / N) | 0) - iz;
    const [fx, fz] = DOOR_DIR[f.rot];
    if (dx * fx + dz * fz <= 0) return false;
    // On the front row, within a cell of the middle.
    if (fz) return iz === (fz > 0 ? f.cz + f.d - 1 : f.cz) && Math.abs(ix + 0.5 - (f.cx + f.w / 2)) <= 1;
    return ix === (fx > 0 ? f.cx + f.w - 1 : f.cx) && Math.abs(iz + 0.5 - (f.cz + f.d / 2)) <= 1;
  }

  /** Validate a world-space segment using the same water, slope and corner rules as A*. */
  segmentClear(sx: number, sz: number, tx: number, tz: number, opts: PathOptions = {}): boolean {
    const w = this.world, allow = opts.allowBuilding ?? -1;
    let prev = w.cellIndexAt(sx, sz);
    if (!this.walkable(prev, allow, opts.allowWater)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(tx - sx, tz - sz) * 5));
    for (let s = 1; s <= steps; s++) {
      const x = sx + (tx - sx) * s / steps, z = sz + (tz - sz) * s / steps;
      const i = w.cellIndexAt(x, z);
      if (!this.walkable(i, allow, opts.allowWater)) return false;
      if (i !== prev) {
        if (!this.crossOk(prev, i)) return false;
        if (Math.abs(this.walkLayer(i, opts.allowWater) - this.walkLayer(prev, opts.allowWater)) > 1) return false;
        const ax = prev % w.N, az = (prev / w.N) | 0, bx = i % w.N, bz = (i / w.N) | 0;
        if (ax !== bx && az !== bz &&
            (!this.walkable(w.idx(ax, bz), allow, opts.allowWater) || !this.walkable(w.idx(bx, az), allow, opts.allowWater))) return false;
      }
      // Match the rock clearance used by route smoothing.
      for (const [ox, oz] of ROCK_CLEARANCE) {
        const c = w.cellIndexAt(x + ox, z + oz);
        if (c < 0 || w.blocked(c)) return false;
      }
      prev = i;
    }
    return true;
  }

  /** Only short, flat, open trips: keep A* for forests, paths, rivers and water escorts. */
  private direct(sx: number, sz: number, tx: number, tz: number, opts: PathOptions): boolean {
    if (opts.allowWater || opts.avoid?.size || Math.hypot(tx - sx, tz - sz) > 12) return false;
    const w = this.world, [ax,az] = w.cellOf(sx,sz), [bx,bz] = w.cellOf(tx,tz);
    const layer = w.layer[w.idx(ax,az)];
    for (let z = Math.min(az,bz) - 1; z <= Math.max(az,bz) + 1; z++) {
      for (let x = Math.min(ax,bx) - 1; x <= Math.max(ax,bx) + 1; x++) {
        if (!w.inBounds(x,z)) return false;
        const i = w.idx(x,z);
        if (!this.walkable(i, opts.allowBuilding) || w.layer[i] !== layer || w.bridge[i] ||
            !Number.isNaN(w.riverY[i]) || w.forest[i] > .05 || w.wear[i] > .05 || w.path[i]) return false;
      }
    }
    return this.segmentClear(sx,sz,tx,tz,opts);
  }

  /** Layer for walking purposes (bridge decks count as shore level). */
  private walkLayer(i: number, allowWater = false): number {
    const w = this.world;
    return w.bridge[i] || allowWater ? Math.max(1, w.layer[i]) : w.layer[i];
  }

  private stepCost(from: number, to: number, base: number, allowWater = false): number {
    const w = this.world;
    const dl = Math.abs(this.walkLayer(to, allowWater) - this.walkLayer(from, allowWater));
    if (dl > 1) return -1;
    let c = base;
    if (dl === 1) c += 0.9;
    c *= 1 + w.forest[to] * 0.9;
    if (!w.bridge[to] && w.layer[to] < 1) c *= 8;
    else if (!w.bridge[to] && !Number.isNaN(w.riverY[to])) c *= 4;
    // Worn paths are preferred.
    c *= 1 - w.wear[to] * 0.45;
    // Stone paths are strongly preferred.
    if (w.path[to]) c *= w.path[to] === 1 ? 0.5 : 0.7;
    return c;
  }

  /** Returns world-space waypoints from start to goal (inclusive), or null. */
  find(sx: number, sz: number, tx: number, tz: number, opts: PathOptions = {}): { x: number; z: number }[] | null {
    const w = this.world;
    const N = w.N;
    const [scx, scz] = w.cellOf(sx, sz);
    const [tcx, tcz] = w.cellOf(tx, tz);
    if (!w.inBounds(scx, scz) || !w.inBounds(tcx, tcz)) return null;
    if (this.direct(sx,sz,tx,tz,opts)) {
      this.stats.direct++;
      return [{ x: sx, z: sz }, { x: tx, z: tz }];
    }
    this.stats.searches++;
    const start = scz * N + scx;
    const allow = opts.allowBuilding ?? -1;
    const gr = opts.goalRadius ?? 0;
    const maxIt = opts.maxIterations ?? 30000;
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.from[start] = -1;
    const h = (cx: number, cz: number) => Math.hypot(cx - tcx, cz - tcz) * 0.75;
    heap.push(start, h(scx, scz));
    let found = -1;
    let best = start, bestH = h(scx, scz);
    let it = 0;
    while (heap.size > 0 && it++ < maxIt) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const cx = cur % N, cz = (cur / N) | 0;
      const dGoal = Math.max(Math.abs(cx - tcx), Math.abs(cz - tcz));
      if (dGoal <= gr) {
        found = cur;
        break;
      }
      const hh = h(cx, cz);
      if (hh < bestH) {
        bestH = hh;
        best = cur;
      }
      for (const [dx, dz, base] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (this.closed[ni] === gen) continue;
        if (!this.walkable(ni, allow, opts.allowWater)) continue;
        // No corner cutting past unwalkable cells.
        if (dx !== 0 && dz !== 0) {
          if (!this.walkable(cz * N + nx, allow, opts.allowWater) || !this.walkable(nz * N + cx, allow, opts.allowWater)) continue;
        }
        if (!this.crossOk(cur, ni)) continue;
        let sc = this.stepCost(cur, ni, base, opts.allowWater);
        if (sc < 0) continue;
        if (opts.avoid?.has(ni)) sc += 6;
        const ng = this.g[cur] + sc;
        if (this.stamp[ni] !== gen || ng < this.g[ni]) {
          this.stamp[ni] = gen;
          this.g[ni] = ng;
          this.from[ni] = cur;
          heap.push(ni, ng + h(nx, nz));
        }
      }
    }
    if (found < 0) {
      if (opts.requireGoal) return null;
      // Unreachable: go as close as we can if that's meaningfully closer.
      if (bestH > 6 || best === start) return null;
      found = best;
    }
    const cells: number[] = [];
    for (let c = found; c !== -1; c = this.from[c]) cells.push(c);
    cells.reverse();
    // Keep crossing waypoints: smoothing must not cut off a preferred bridge through water.
    const pts = opts.allowWater ? cells.map(i => ({ x: w.centerX(i % N), z: w.centerZ((i / N) | 0) })) : this.smooth(cells, allow);
    // Replace the final waypoint with the exact goal when it lies inside the goal cell.
    if (found === tcz * N + tcx) pts[pts.length - 1] = { x: tx, z: tz };
    return pts;
  }

  /** String-pull the cell path using straight-line walkability checks. */
  private smooth(cells: number[], allow: number): { x: number; z: number }[] {
    const w = this.world;
    const N = w.N;
    const pt = (i: number) => ({ x: w.centerX(i % N), z: w.centerZ((i / N) | 0) });
    if (cells.length <= 2) return cells.map(pt);
    const out: { x: number; z: number }[] = [pt(cells[0])];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.clearLine(cells[anchor], cells[i], allow)) {
        out.push(pt(cells[i - 1]));
        anchor = i - 1;
      }
    }
    out.push(pt(cells[cells.length - 1]));
    return out;
  }

  private clearLine(a: number, b: number, allow: number): boolean {
    const w = this.world;
    const N = w.N;
    const ax = a % N, az = (a / N) | 0, bx = b % N, bz = (b / N) | 0;
    const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2);
    if (steps > 24) return false;
    if (!this.segmentClear(w.centerX(ax), w.centerZ(az), w.centerX(bx), w.centerZ(bz), { allowBuilding: allow })) return false;
    let prev = a;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.round(ax + (bx - ax) * t), cz = Math.round(az + (bz - az) * t);
      const i = cz * N + cx;
      if (i === prev) continue;
      // Keep jungle detours where paths exist: don't cut across forest if the path is worn.
      if (w.forest[i] > 0.6 && w.wear[prev] > 0.4) return false;
      prev = i;
    }
    return true;
  }
}
