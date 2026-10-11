/** Uniform grid bucketing for fast neighbour queries (boids, fleeing animals, AI lookups). */
export class SpatialHash<T extends { x: number; z: number }> {
  private cells = new Map<number, T[]>();
  private active: T[][] = [];
  constructor(private size: number) {}

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  clear(): void {
    for (const v of this.active) v.length = 0;
    this.active.length = 0;
  }

  insert(o: T): void {
    const k = this.key(Math.floor(o.x / this.size), Math.floor(o.z / this.size));
    const b = this.cells.get(k);
    if (b) {
      if (b.length === 0) this.active.push(b);
      b.push(o);
    } else {
      const bucket = [o];
      this.cells.set(k, bucket);
      this.active.push(bucket);
    }
  }

  /** Calls fn for each item within radius r of (x, z). */
  query(x: number, z: number, r: number, fn: (o: T, d2: number) => void): void {
    const s = this.size;
    const x0 = Math.floor((x - r) / s), x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s), z1 = Math.floor((z + r) / s);
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.cells.get(this.key(cx, cz));
        if (!b) continue;
        for (const o of b) {
          const d2 = (o.x - x) ** 2 + (o.z - z) ** 2;
          if (d2 <= r2) fn(o, d2);
        }
      }
    }
  }
}
