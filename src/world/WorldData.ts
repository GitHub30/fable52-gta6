/** Baked real-world map data (see tools/fetch_osaka.py): OpenStreetMap geometry + GSI elevation and aerial photo. */
export interface Edge {
  id: number;
  a: number; // node index at pts[0]
  b: number; // node index at the last point
  k: number; // class: 0 arterial, 1 secondary, 2 tertiary, 3 residential, 4 service, 5 pedestrian street, 6 footpath
  w: number; // width (m)
  car: boolean; // drivable
  ai: boolean; // used by ambient traffic
  oneway: boolean; // a -> b only
  pts: Float32Array; // x,z pairs
  len: number;
}
export interface WorldData {
  hx: number;
  hz: number;
  cell: number;
  nx: number;
  nz: number;
  dem: Uint16Array; // centimetres above the lowest point
  farScale: number;
  nodes: Float32Array;
  edges: Edge[];
  adj: number[][]; // edge ids touching each node
  buildings: { h: number; pts: Float32Array }[];
  green: Float32Array[];
  trees: Float32Array;
  ground: HTMLImageElement;
  far: HTMLImageElement;
}

const url = (name: string) => new URL('osaka/' + name, document.baseURI).href;
const dm = (a: number[]) => Float32Array.from(a, (v) => v / 10);
function image(name: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + name));
    img.src = url(name);
  });
}

export async function loadWorld(): Promise<WorldData> {
  const [raw, demBuf, ground, far] = await Promise.all([
    fetch(url('map.json')).then((r) => r.json()),
    fetch(url('dem.bin')).then((r) => r.arrayBuffer()),
    image('ground.jpg'),
    image('far.jpg'),
  ]);
  const nodes = dm(raw.nodes);
  const adj: number[][] = Array.from({ length: nodes.length / 2 }, () => []);
  const edges: Edge[] = raw.edges.map((e: any[], id: number) => {
    const pts = dm(e[7]);
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    adj[e[0]].push(id);
    if (e[1] !== e[0]) adj[e[1]].push(id);
    return { id, a: e[0], b: e[1], k: e[2], w: e[3] / 10, car: !!e[4], ai: !!e[5], oneway: !!e[6], pts, len };
  });
  return {
    hx: raw.hx, hz: raw.hz, cell: raw.cell, nx: raw.nx, nz: raw.nz,
    dem: new Uint16Array(demBuf),
    farScale: raw.farScale,
    nodes, edges, adj,
    buildings: raw.buildings.map((b: any[]) => ({ h: b[0] / 10, pts: dm(b[1]) })),
    green: raw.green.map(dm),
    trees: dm(raw.trees),
    ground, far,
  };
}

/** Bilinear terrain height in metres (clamped at the map edge, so it also works outside). */
export function terrainHeight(d: WorldData, x: number, z: number) {
  const u = Math.min(Math.max((x + d.hx) / d.cell, 0), d.nx - 1.001);
  const w = Math.min(Math.max((z + d.hz) / d.cell, 0), d.nz - 1.001);
  const i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j;
  const o = j * d.nx + i, m = d.dem;
  return ((m[o] * (1 - fu) + m[o + 1] * fu) * (1 - fw) + (m[o + d.nx] * (1 - fu) + m[o + d.nx + 1] * fu) * fw) * 0.01;
}
