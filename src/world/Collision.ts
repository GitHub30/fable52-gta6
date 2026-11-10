/** Static world collision: extruded polygons (building footprints, props) in a uniform spatial hash. */
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  top: number; // absolute height of the top (y)
}
interface Poly {
  pts: Float32Array; // x,z pairs, counter-clockwise (positive shoelace area in x-z)
  top: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  mark: number;
}

const CELL = 38;
const key = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);

function contains(p: Poly, x: number, z: number) {
  const a = p.pts, n = a.length;
  let c = false;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const zi = a[i + 1], zj = a[j + 1];
    if (zi > z !== zj > z && x < ((a[j] - a[i]) * (z - zi)) / (zj - zi) + a[i]) c = !c;
  }
  return c;
}

export class CollisionWorld {
  private cells = new Map<number, Poly[]>();
  private stamp = 0;
  count = 0;

  add(b: Box) {
    this.addPoly([b.x0, b.z0, b.x1, b.z0, b.x1, b.z1, b.x0, b.z1], b.top);
  }

  /** `pts` must be counter-clockwise in x-z (positive shoelace area). */
  addPoly(pts: ArrayLike<number>, top: number) {
    const a = Float32Array.from(pts);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < a.length; i += 2) {
      x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]);
      z0 = Math.min(z0, a[i + 1]); z1 = Math.max(z1, a[i + 1]);
    }
    const p: Poly = { pts: a, top, x0, z0, x1, z1, mark: 0 };
    this.count++;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = key(cx, cz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(p);
      }
  }

  /**
   * Push a circle out of every polygon it overlaps. Mutates `p` and returns the
   * summed push normal in `out` (zero if no contact). `y` is the circle's feet
   * height — polygons whose top is below that are ignored.
   */
  resolveCircle(p: { x: number; z: number }, r: number, y: number, out: { x: number; z: number }): boolean {
    out.x = 0;
    out.z = 0;
    let hit = false;
    const stamp = ++this.stamp;
    const cx0 = Math.floor((p.x - r) / CELL), cx1 = Math.floor((p.x + r) / CELL);
    const cz0 = Math.floor((p.z - r) / CELL), cz1 = Math.floor((p.z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells.get(key(cx, cz));
        if (!list) continue;
        for (let q = 0; q < list.length; q++) {
          const poly = list[q];
          if (poly.mark === stamp) continue;
          poly.mark = stamp;
          if (y >= poly.top || p.x < poly.x0 - r || p.x > poly.x1 + r || p.z < poly.z0 - r || p.z > poly.z1 + r) continue;
          const a = poly.pts, n = a.length;
          if (contains(poly, p.x, p.z)) {
            // centre is inside: leave through the nearest edge
            let best = Infinity, bx = 0, bz = 0, bnx = 0, bnz = 0;
            for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
              const ex = a[i] - a[j], ez = a[i + 1] - a[j + 1];
              const len2 = ex * ex + ez * ez;
              if (len2 < 1e-6) continue;
              const t = Math.max(0, Math.min(1, ((p.x - a[j]) * ex + (p.z - a[j + 1]) * ez) / len2));
              const qx = a[j] + ex * t, qz = a[j + 1] + ez * t;
              const d2 = (p.x - qx) ** 2 + (p.z - qz) ** 2;
              if (d2 < best) {
                const len = Math.sqrt(len2);
                best = d2; bx = qx; bz = qz; bnx = ez / len; bnz = -ex / len;
              }
            }
            if (best < Infinity) {
              p.x = bx + bnx * r;
              p.z = bz + bnz * r;
              out.x += bnx;
              out.z += bnz;
              hit = true;
            }
            continue;
          }
          for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
            const ex = a[i] - a[j], ez = a[i + 1] - a[j + 1];
            const len2 = ex * ex + ez * ez;
            if (len2 < 1e-6) continue;
            const t = Math.max(0, Math.min(1, ((p.x - a[j]) * ex + (p.z - a[j + 1]) * ez) / len2));
            let dx = p.x - (a[j] + ex * t), dz = p.z - (a[j + 1] + ez * t);
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r || d2 < 1e-10) continue;
            const d = Math.sqrt(d2);
            dx /= d;
            dz /= d;
            p.x += dx * (r - d);
            p.z += dz * (r - d);
            out.x += dx;
            out.z += dz;
            hit = true;
          }
        }
      }
    if (hit) {
      const l = Math.hypot(out.x, out.z);
      if (l > 1e-6) { out.x /= l; out.z /= l; }
    }
    return hit;
  }

  /** Highest polygon top at (x,z) that is not above `y` (0 if none): lets aircraft land on roofs. */
  topBelow(x: number, z: number, y: number): number {
    const list = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let top = 0;
    if (list)
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.top <= y && b.top > top && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && contains(b, x, z)) top = b.top;
      }
    return top;
  }

  /** True if the point is inside (or within `margin` of) a polygon taller than `y`. */
  pointBlocked(x: number, y: number, z: number, margin = 0): boolean {
    const cx0 = Math.floor((x - margin) / CELL), cx1 = Math.floor((x + margin) / CELL);
    const cz0 = Math.floor((z - margin) / CELL), cz1 = Math.floor((z + margin) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells.get(key(cx, cz));
        if (!list) continue;
        for (let q = 0; q < list.length; q++) {
          const b = list[q];
          if (y >= b.top || x < b.x0 - margin || x > b.x1 + margin || z < b.z0 - margin || z > b.z1 + margin) continue;
          if (contains(b, x, z)) return true;
          if (margin <= 0) continue;
          const a = b.pts, n = a.length;
          for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
            const ex = a[i] - a[j], ez = a[i + 1] - a[j + 1];
            const len2 = ex * ex + ez * ez || 1;
            const t = Math.max(0, Math.min(1, ((x - a[j]) * ex + (z - a[j + 1]) * ez) / len2));
            if ((x - a[j] - ex * t) ** 2 + (z - a[j + 1] - ez * t) ** 2 < margin * margin) return true;
          }
        }
      }
    return false;
  }
}
