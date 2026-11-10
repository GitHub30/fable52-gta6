"""Download and bake real-world data for the Tsutenkaku / Tennoji map.

Sources (attribution is shown in-game and in the README):
  - OpenStreetMap via the Overpass API  (c) OpenStreetMap contributors, ODbL
  - GSI Japan tiles (cyberjapandata.gsi.go.jp): seamless aerial photo, 5 m elevation (dem5a)

Outputs into public/osaka/:
  map.json    roads (graph), buildings, parks, water, rails, trees  (local metres, x = east, z = south)
  dem.bin     uint16 little-endian height grid in centimetres above the lowest point
  ground.jpg  aerial photo of the playable area
  far.jpg     low-resolution aerial photo of the surroundings

Run:  python tools/fetch_osaka.py        (raw downloads are cached in tools/.cache)
"""
import io, json, math, os, sys, time, hashlib, random
import numpy as np
import requests
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'osaka')
CACHE = os.path.join(ROOT, 'tools', '.cache')
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)
UA = {'User-Agent': 'open-world-map-baker/1.0'}

# playable area: Shin-Imamiya / Shinsekai in the west to Shitennoji / Tennoji station in the east
S, W, N, E = 34.6435, 135.5010, 34.6560, 135.5180
LAT0, LON0 = (S + N) / 2, (W + E) / 2
M_LAT = 110920.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
HX = (E - W) / 2 * M_LON  # half extents in metres
HZ = (N - S) / 2 * M_LAT
CELL = 4.0  # DEM grid spacing


def to_local(lat, lon):
    return (lon - LON0) * M_LON, -(lat - LAT0) * M_LAT


def cached(name, fetch):
    p = os.path.join(CACHE, name)
    if os.path.exists(p):
        return open(p, 'rb').read()
    data = fetch()
    open(p, 'wb').write(data)
    return data


def http(url, **kw):
    for attempt in range(4):
        r = requests.get(url, headers=UA, timeout=120, **kw)
        if r.status_code == 200:
            return r.content
        if r.status_code == 404:
            return b''
        time.sleep(3 + attempt * 4)
    raise RuntimeError(f'{url} -> {r.status_code}')


# ---------------------------------------------------------------- tiles
def px(lat, lon, z):
    n = 256 * 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def mosaic(layer, ext, z, s, w, n, e, mode):
    """Stitch tiles covering the box and crop exactly to it."""
    x0, y0 = px(n, w, z)
    x1, y1 = px(s, e, z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    img = Image.new(mode, ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            url = f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{tx}/{ty}.{ext}'
            data = cached(f'{layer}_{z}_{tx}_{ty}.{ext}', lambda: http(url))
            if data:
                img.paste(Image.open(io.BytesIO(data)).convert(mode), ((tx - tx0) * 256, (ty - ty0) * 256))
    return img.crop((round(x0 - tx0 * 256), round(y0 - ty0 * 256), round(x1 - tx0 * 256), round(y1 - ty0 * 256)))


def bake_photos():
    g = mosaic('seamlessphoto', 'jpg', 18, S, W, N, E, 'RGB')
    scale = min(1.0, 4096 / max(g.size))
    if scale < 1:
        g = g.resize((round(g.width * scale), round(g.height * scale)), Image.LANCZOS)
    g.save(os.path.join(OUT, 'ground.jpg'), quality=84)
    # surroundings: 3x the playable extent in every direction
    k = 3.0
    f = mosaic('seamlessphoto', 'jpg', 15, LAT0 - (N - S) / 2 * k, LON0 - (E - W) / 2 * k, LAT0 + (N - S) / 2 * k, LON0 + (E - W) / 2 * k, 'RGB')
    f.save(os.path.join(OUT, 'far.jpg'), quality=80)
    print('photos', g.size, f.size)
    return k


def bake_dem():
    """GSI elevation PNG: h = (R*65536 + G*256 + B) * 0.01 m, (128,0,0) = no data."""
    z = 15
    m = 0.0006  # margin so bilinear sampling at the edge has data
    img = mosaic('dem5a_png', 'png', z, S - m, W - m, N + m, E + m, 'RGB')
    a = np.asarray(img).astype(np.int64)
    v = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h = np.where(v < 2 ** 23, v, v - 2 ** 24) * 0.01
    nodata = v == 2 ** 23
    h[nodata] = np.nan
    # fill gaps (water, missing survey) from neighbours
    for _ in range(60):
        if not np.isnan(h).any():
            break
        pad = np.pad(h, 1, mode='edge')
        stack = np.stack([pad[1:-1, :-2], pad[1:-1, 2:], pad[:-2, 1:-1], pad[2:, 1:-1]])
        mean = np.nanmean(stack, axis=0)
        h = np.where(np.isnan(h), mean, h)
    h = np.nan_to_num(h, nan=float(np.nanmin(h)))
    # resample to a regular local grid
    nx, nz = int(2 * HX / CELL) + 1, int(2 * HZ / CELL) + 1
    lat_top, lat_bot, lon_l, lon_r = N + m, S - m, W - m, E + m
    xs = np.linspace(-HX, HX, nx)
    zs = np.linspace(-HZ, HZ, nz)
    lon = LON0 + xs / M_LON
    lat = LAT0 - zs / M_LAT
    u = (lon - lon_l) / (lon_r - lon_l) * (h.shape[1] - 1)
    w_ = (lat_top - lat) / (lat_top - lat_bot) * (h.shape[0] - 1)
    u0 = np.clip(np.floor(u).astype(int), 0, h.shape[1] - 2)
    w0 = np.clip(np.floor(w_).astype(int), 0, h.shape[0] - 2)
    fu, fw = (u - u0)[None, :], (w_ - w0)[:, None]
    grid = (h[np.ix_(w0, u0)] * (1 - fu) * (1 - fw) + h[np.ix_(w0, u0 + 1)] * fu * (1 - fw)
            + h[np.ix_(w0 + 1, u0)] * (1 - fu) * fw + h[np.ix_(w0 + 1, u0 + 1)] * fu * fw)
    # light smoothing: the survey is noisy at 5 m
    for _ in range(2):
        p = np.pad(grid, 1, mode='edge')
        grid = (p[1:-1, 1:-1] * 4 + p[1:-1, :-2] + p[1:-1, 2:] + p[:-2, 1:-1] + p[2:, 1:-1]) / 8
    return grid, nx, nz


# ---------------------------------------------------------------- OSM
def fetch_osm():
    q = f"""[out:json][timeout:120];
(
  way["highway"]({S},{W},{N},{E});
  way["building"]({S},{W},{N},{E});
  relation["building"]["type"="multipolygon"]({S},{W},{N},{E});
  way["leisure"~"^(park|garden|pitch|playground)$"]({S},{W},{N},{E});
  way["landuse"~"^(grass|forest|cemetery|religious|recreation_ground)$"]({S},{W},{N},{E});
  way["natural"~"^(water|wood|scrub)$"]({S},{W},{N},{E});
  relation["natural"="water"]({S},{W},{N},{E});
  way["railway"~"^(rail|subway|tram|light_rail)$"]({S},{W},{N},{E});
  node["natural"="tree"]({S},{W},{N},{E});
);
out body; >; out skel qt;"""

    def get():
        for host in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
            try:
                r = requests.post(host, data={'data': q}, headers=UA, timeout=180)
                if r.status_code == 200 and r.content[:1] == b'{':
                    return r.content
                print('overpass', host, r.status_code)
            except Exception as ex:  # noqa
                print('overpass', host, ex)
            time.sleep(5)
        raise RuntimeError('Overpass unavailable')

    return json.loads(cached('osm_' + hashlib.md5(q.encode()).hexdigest()[:8] + '.json', get))


ROAD_CLASS = {  # class id, default width (m), cars allowed, AI traffic allowed
    'trunk': (0, 18, 1, 1), 'primary': (0, 16, 1, 1), 'secondary': (1, 12, 1, 1), 'tertiary': (2, 9, 1, 1),
    'trunk_link': (2, 7, 1, 1), 'primary_link': (2, 7, 1, 1), 'secondary_link': (2, 7, 1, 1), 'tertiary_link': (2, 6, 1, 1),
    'unclassified': (3, 6, 1, 0), 'residential': (3, 5.5, 1, 0), 'living_street': (3, 5, 1, 0), 'service': (4, 4, 1, 0),
    'pedestrian': (5, 6, 0, 0), 'footway': (6, 2.4, 0, 0), 'path': (6, 2.2, 0, 0), 'steps': (6, 2.4, 0, 0), 'cycleway': (6, 2.4, 0, 0),
}


def area2(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def clean_ring(pts):
    out = []
    for q in pts:
        if not out or math.hypot(q[0] - out[-1][0], q[1] - out[-1][1]) > 0.3:
            out.append(q)
    if len(out) > 1 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 0.3:
        out.pop()
    if len(out) < 3:
        return None
    if area2(out) < 0:
        out.reverse()
    return out


def inside(p):
    return abs(p[0]) <= HX and abs(p[1]) <= HZ


def pip(x, z, ring):
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def main():
    osm = fetch_osm()
    nodes = {e['id']: to_local(e['lat'], e['lon']) for e in osm['elements'] if e['type'] == 'node'}
    ways = {e['id']: e for e in osm['elements'] if e['type'] == 'way'}
    rels = [e for e in osm['elements'] if e['type'] == 'relation']
    rng = random.Random(7)

    grid, nx, nz = bake_dem()

    def height(x, z):
        u = min(max((x + HX) / CELL, 0), nx - 1.001)
        w_ = min(max((z + HZ) / CELL, 0), nz - 1.001)
        i, j = int(u), int(w_)
        fu, fw = u - i, w_ - j
        return (grid[j, i] * (1 - fu) * (1 - fw) + grid[j, i + 1] * fu * (1 - fw) + grid[j + 1, i] * (1 - fu) * fw + grid[j + 1, i + 1] * fu * fw)

    # ---- buildings
    buildings = []

    def add_building(ring, tags, osm_id):
        ring = clean_ring(ring)
        if not ring:
            return
        a = area2(ring) / 2
        cx = sum(p[0] for p in ring) / len(ring)
        cz = sum(p[1] for p in ring) / len(ring)
        if a < 12 or not inside((cx, cz)):
            return
        if tags.get('building') in ('roof', 'carport') or tags.get('location') == 'underground' or str(tags.get('layer', '0')).startswith('-'):
            return
        h = None
        try:
            if 'height' in tags:
                h = float(str(tags['height']).replace('m', '').strip())
            elif 'building:levels' in tags:
                h = float(tags['building:levels']) * 3.3 + 1.5
        except ValueError:
            h = None
        if h is None:
            r = random.Random(osm_id)
            # unmapped heights: this part of Osaka is mostly two to five storeys
            if a < 70: h = r.uniform(5.5, 8)
            elif a < 160: h = r.uniform(6.5, 10)
            elif a < 400: h = r.uniform(8, 15)
            elif a < 1500: h = r.uniform(10, 22)
            else: h = r.uniform(12, 26)
        buildings.append({'h': round(min(h, 320), 1), 'p': ring, 'a': a, 'name': tags.get('name', ''), 'c': (cx, cz)})

    for w in ways.values():
        t = w.get('tags', {})
        if 'building' in t and len(w['nodes']) >= 4 and w['nodes'][0] == w['nodes'][-1]:
            add_building([nodes[n] for n in w['nodes'] if n in nodes], t, w['id'])
    for r in rels:
        t = r.get('tags', {})
        if 'building' in t:
            for m in r['members']:
                w = ways.get(m['ref']) if m['type'] == 'way' and m.get('role') in ('outer', '') else None
                if w and len(w['nodes']) >= 4 and w['nodes'][0] == w['nodes'][-1]:
                    add_building([nodes[n] for n in w['nodes'] if n in nodes], t, r['id'] * 1000 + m['ref'] % 1000)

    # ---- roads: split ways into graph edges at shared nodes
    use = {}
    road_ways = []
    for w in ways.values():
        t = w.get('tags', {})
        hw = t.get('highway')
        if hw not in ROAD_CLASS or t.get('tunnel') in ('yes', 'building_passage') and hw in ('footway', 'steps'):
            continue
        if t.get('tunnel') == 'yes' or str(t.get('layer', '0')).startswith('-') or t.get('indoor') == 'yes' or t.get('area') == 'yes':
            continue
        if t.get('access') in ('private', 'no') and hw == 'service':
            continue
        cls, width, car, ai = ROAD_CLASS[hw]
        try:
            lanes = int(str(t.get('lanes', '0')).split(';')[0])
        except ValueError:
            lanes = 0
        if lanes and car:
            width = max(width if lanes >= 2 else 4, lanes * 3.1 + 1.2)
        ids = [n for n in w['nodes'] if n in nodes]
        ow = t.get('oneway')
        if ow == '-1':
            ids.reverse()
        oneway = 1 if ow in ('yes', '-1', '1') or t.get('junction') == 'roundabout' else 0
        bridge = 1 if t.get('bridge') and t.get('bridge') != 'no' else 0
        road_ways.append((ids, cls, round(width, 1), car, ai, oneway, bridge, t.get('name', '')))
        for k, n in enumerate(ids):
            use[n] = use.get(n, 0) + (2 if k in (0, len(ids) - 1) else 1)

    node_index, node_list, edges = {}, [], []

    def nid(n):
        if n not in node_index:
            node_index[n] = len(node_list)
            node_list.append(nodes[n])
        return node_index[n]

    for ids, cls, width, car, ai, oneway, bridge, name in road_ways:
        start = 0
        for k in range(1, len(ids)):
            if use[ids[k]] > 1 or k == len(ids) - 1:
                seg = ids[start:k + 1]
                start = k
                pts = [nodes[n] for n in seg]
                # keep only the part inside the map (with a small margin)
                keep = [abs(p[0]) <= HX - 4 and abs(p[1]) <= HZ - 4 for p in pts]
                run = []
                for i, ok in enumerate(keep + [False]):
                    if ok:
                        run.append(i)
                    elif run:
                        if len(run) >= 2:
                            edges.append({'a': nid(seg[run[0]]), 'b': nid(seg[run[-1]]), 'k': cls, 'w': width, 'car': car, 'ai': ai, 'o': oneway,
                                          'br': bridge, 'p': [pts[i] for i in run]})
                        run = []

    # ---- burn bridges into the terrain as embankments (the survey shows the cutting below them)
    for e in edges:
        if not e['br'] or len(e['p']) < 2:
            continue
        p = e['p']
        h0, h1 = height(*p[0]), height(*p[-1])
        total = sum(math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1)) or 1
        run = 0.0
        half = e['w'] / 2 + 3
        for i in range(len(p) - 1):
            seg = math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1])
            steps = max(1, int(seg / 2))
            for s in range(steps + 1):
                f = s / steps
                x, z = p[i][0] + (p[i + 1][0] - p[i][0]) * f, p[i][1] + (p[i + 1][1] - p[i][1]) * f
                hh = h0 + (h1 - h0) * (run + seg * f) / total
                i0, i1 = int((x - half + HX) / CELL), int((x + half + HX) / CELL) + 1
                j0, j1 = int((z - half + HZ) / CELL), int((z + half + HZ) / CELL) + 1
                for jj in range(max(0, j0), min(nz, j1 + 1)):
                    for ii in range(max(0, i0), min(nx, i1 + 1)):
                        grid[jj, ii] = max(grid[jj, ii], hh)
            run += seg

    # ---- drop buildings that sit on a carriageway (station decks, mapping offsets)
    cell = 24.0
    index = {}
    for bi, b in enumerate(buildings):
        xs = [q[0] for q in b['p']]
        zs = [q[1] for q in b['p']]
        b['bb'] = (min(xs), min(zs), max(xs), max(zs))
        for cx in range(int(b['bb'][0] // cell), int(b['bb'][2] // cell) + 1):
            for cz in range(int(b['bb'][1] // cell), int(b['bb'][3] // cell) + 1):
                index.setdefault((cx, cz), []).append(bi)
    dropped = set()
    for e in edges:
        if not e['car']:
            continue
        half = e['w'] / 2 * (0.8 if e['ai'] else 0.45)
        p = e['p']
        for i in range(len(p) - 1):
            dx, dz = p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]
            seg = math.hypot(dx, dz)
            if seg < 0.01:
                continue
            nxn, nzn = -dz / seg, dx / seg
            for s in range(int(seg / 2.5) + 1):
                f = min(1.0, s * 2.5 / seg)
                for off in (-half, 0, half):
                    x, z = p[i][0] + dx * f + nxn * off, p[i][1] + dz * f + nzn * off
                    for bi in index.get((int(x // cell), int(z // cell)), []):
                        b = buildings[bi]
                        if bi not in dropped and b['bb'][0] <= x <= b['bb'][2] and b['bb'][1] <= z <= b['bb'][3] and pip(x, z, b['p']):
                            dropped.add(bi)
    kept = [b for i, b in enumerate(buildings) if i not in dropped]

    # ---- areas, rails, trees
    def rings(pred):
        out = []
        for w in ways.values():
            t = w.get('tags', {})
            if pred(t) and len(w['nodes']) >= 4 and w['nodes'][0] == w['nodes'][-1]:
                r = clean_ring([nodes[n] for n in w['nodes'] if n in nodes])
                if r and any(inside(q) for q in r):
                    out.append(r)
        return out

    green = rings(lambda t: t.get('leisure') in ('park', 'garden', 'pitch', 'playground') or t.get('landuse') in ('grass', 'forest', 'cemetery', 'religious', 'recreation_ground') or t.get('natural') in ('wood', 'scrub'))
    water = rings(lambda t: t.get('natural') == 'water')
    for r in rels:
        if r.get('tags', {}).get('natural') == 'water':
            for m in r['members']:
                w = ways.get(m['ref']) if m['type'] == 'way' and m.get('role') == 'outer' else None
                if w and len(w['nodes']) >= 4 and w['nodes'][0] == w['nodes'][-1]:
                    rr = clean_ring([nodes[n] for n in w['nodes'] if n in nodes])
                    if rr:
                        water.append(rr)
    rails = []
    for w in ways.values():
        t = w.get('tags', {})
        if t.get('railway') in ('rail', 'subway', 'tram', 'light_rail') and t.get('tunnel') != 'yes' and not str(t.get('layer', '0')).startswith('-'):
            pts = [nodes[n] for n in w['nodes'] if n in nodes and inside(nodes[n])]
            if len(pts) >= 2:
                rails.append(pts)
    trees = [to_local(e['lat'], e['lon']) for e in osm['elements'] if e['type'] == 'node' and e.get('tags', {}).get('natural') == 'tree']
    trees = [t for t in trees if inside(t)]

    # ---- write
    base = float(grid.min())
    dem = np.clip(np.round((grid - base) * 100), 0, 65535).astype('<u2')
    dem.tofile(os.path.join(OUT, 'dem.bin'))
    far_k = bake_photos()

    def flat(pts):
        return [round(v * 10) for q in pts for v in q]  # decimetres

    data = {
        'hx': round(HX, 1), 'hz': round(HZ, 1), 'cell': CELL, 'nx': nx, 'nz': nz, 'base': round(base, 2), 'farScale': far_k,
        'origin': [LAT0, LON0], 'mLat': M_LAT, 'mLon': round(M_LON, 2),
        'nodes': flat(node_list),
        'edges': [[e['a'], e['b'], e['k'], round(e['w'] * 10), e['car'], e['ai'], e['o'], flat(e['p'])] for e in edges],
        'buildings': [[round(b['h'] * 10), flat(b['p'])] for b in kept],
        'named': [[b['name'], round(b['c'][0]), round(b['c'][1]), b['h'], round(b['a'])] for b in kept if b['name'] and b['a'] > 600],
        'green': [flat(r) for r in green], 'water': [flat(r) for r in water], 'rails': [flat(r) for r in rails], 'trees': flat(trees),
    }
    with open(os.path.join(OUT, 'map.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'extent {2 * HX:.0f} x {2 * HZ:.0f} m, dem {nx}x{nz}, height range {grid.min():.1f}..{grid.max():.1f} m')
    print(f'nodes {len(node_list)}, edges {len(edges)} (ai {sum(e["ai"] for e in edges)}, car {sum(e["car"] for e in edges)}), '
          f'buildings {len(kept)} (dropped {len(dropped)}), green {len(green)}, water {len(water)}, rails {len(rails)}, trees {len(trees)}')
    for n in sorted(data['named'], key=lambda q: -q[3])[:25]:
        print('  ', n)
    print('map.json', os.path.getsize(os.path.join(OUT, 'map.json')) // 1024, 'KB')


if __name__ == '__main__':
    main()
