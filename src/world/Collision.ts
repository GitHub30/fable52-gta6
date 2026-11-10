/** Static world collision: axis-aligned boxes in a uniform spatial hash. */
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  top: number; // height of the box top (y)
}

const CELL = 38;
const key = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);

export class CollisionWorld {
  private cells = new Map<number, Box[]>();
  count = 0;

  add(b: Box) {
    this.count++;
    const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
    const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = key(cx, cz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(b);
      }
  }

  /**
   * Push a circle out of every box it overlaps. Mutates `p` and returns the
   * summed push normal in `out` (zero if no contact). `y` is the circle's feet
   * height — boxes lower than that are ignored (lets things pass over low props).
   */
  resolveCircle(p: { x: number; z: number }, r: number, y: number, out: { x: number; z: number }): boolean {
    out.x = 0;
    out.z = 0;
    let hit = false;
    const cx0 = Math.floor((p.x - r) / CELL), cx1 = Math.floor((p.x + r) / CELL);
    const cz0 = Math.floor((p.z - r) / CELL), cz1 = Math.floor((p.z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells.get(key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (y >= b.top) continue;
          const nx = p.x < b.x0 ? b.x0 : p.x > b.x1 ? b.x1 : p.x;
          const nz = p.z < b.z0 ? b.z0 : p.z > b.z1 ? b.z1 : p.z;
          let dx = p.x - nx, dz = p.z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          hit = true;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            dx /= d;
            dz /= d;
            p.x += dx * (r - d);
            p.z += dz * (r - d);
            out.x += dx;
            out.z += dz;
          } else {
            // centre is inside the box: exit through the nearest face
            const l = p.x - b.x0, rr = b.x1 - p.x, n = p.z - b.z0, f = b.z1 - p.z;
            const m = Math.min(l, rr, n, f);
            if (m === l) { p.x = b.x0 - r; out.x -= 1; }
            else if (m === rr) { p.x = b.x1 + r; out.x += 1; }
            else if (m === n) { p.z = b.z0 - r; out.z -= 1; }
            else { p.z = b.z1 + r; out.z += 1; }
          }
        }
      }
    if (hit) {
      const l = Math.hypot(out.x, out.z);
      if (l > 1e-6) { out.x /= l; out.z /= l; }
    }
    return hit;
  }

  /** True if the point is inside a box (used by the camera and spawn checks). */
  pointBlocked(x: number, y: number, z: number, margin = 0): boolean {
    const list = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (y < b.top && x > b.x0 - margin && x < b.x1 + margin && z > b.z0 - margin && z < b.z1 + margin) return true;
    }
    return false;
  }
}
