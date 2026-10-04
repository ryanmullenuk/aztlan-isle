import { Islander } from '../entities/Islander';
import { SpatialHash } from '../world/SpatialHash';

const moving = (i: Islander) => !i.sleeping && (i.anim === 'walk' || i.anim === 'run' || i.anim === 'carry');
const directions = [0, 0.65, -0.65, 1.15, -1.15, Math.PI / 2, -Math.PI / 2, 2.2, -2.2, Math.PI]
  .map(angle => ({ cos: Math.cos(angle), sin: Math.sin(angle) }));
// Calls are synchronous. Reuse neighbour records instead of allocating them for
// every walker on every frame; each neighbour's velocity is calculated just once.
const neighbours: { x: number; z: number; vx: number; vz: number; radius2: number }[] = [];
/** Anticipate collisions; consistently pass on the right, or yield in tight passages. */
export function avoidCrowd(a: Islander, dx: number, dz: number, speed: number, grid: SpatialHash<Islander>, canStep: (x: number, z: number) => boolean): { x: number; z: number } {
  const length = Math.hypot(dx, dz);
  if (length < 0.001 || speed <= 0) return { x: 0, z: 0 };
  const fx = dx / length, fz = dz / length;
  let count = 0;
  grid.query(a.x, a.z, 2.6, b => {
    if (b === a || b.hidden || Math.abs(a.y - b.y) >= 0.5) return;
    const n = neighbours[count] ?? (neighbours[count] = { x: 0, z: 0, vx: 0, vz: 0, radius2: 0 });
    count++;
    const bv = moving(b) ? Math.max(0, b.speed) : 0;
    n.x = b.x - a.x; n.z = b.z - a.z;
    n.vx = Math.sin(b.heading) * bv; n.vz = Math.cos(b.heading) * bv;
    const radius = 0.32 * (a.child && b.child ? 0.75 : 1);
    n.radius2 = radius * radius;
  });
  // A blocked walker needs room to step fully sideways or retreat, rather than
  // testing only forward directions forever against the same neighbours.
  const limit = a.stuck > 0.75 ? directions.length : 5;
  const near = Math.min(0.12, length / speed), far = Math.min(0.3, length / speed);
  for (let direction = 0; direction < limit; direction++) {
    const { cos, sin } = directions[direction];
    const vx = (fx * cos + fz * sin) * speed;
    const vz = (fz * cos - fx * sin) * speed;
    if (!canStep(a.x + vx * near, a.z + vz * near) || !canStep(a.x + vx * far, a.z + vz * far)) continue;
    let safe = true;
    for (let k = 0; k < count; k++) {
      const n = neighbours[k];
      const rx = vx - n.vx, rz = vz - n.vz;
      const vv = rx * rx + rz * rz;
      const dot = n.x * rx + n.z * rz;
      const t = Math.max(0, Math.min(0.8, dot / (vv || 1)));
      const sx = n.x - rx * t, sz = n.z - rz * t;
      // Allow separating from an existing overlap; the fallback resolves its remainder.
      if (sx * sx + sz * sz < n.radius2 && !(t === 0 && dot <= 0)) { safe = false; break; }
    }
    if (safe) return { x: vx, z: vz };
  }
  return { x: 0, z: 0 };
}
