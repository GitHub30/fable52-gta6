"""Bake the two running lines of the Osaka Loop Line through the map into public/osaka/tracks.json.

Source: OpenStreetMap via the Overpass API  (c) OpenStreetMap contributors, ODbL.
The main-line ways are stitched end to end into one polyline per track, in the direction of travel.

Output: [{"name": ..., "pts": [x, z, ...], "bridge": [[first, last], ...]}, ...] in local metres
(x = east, z = south), the same frame as map.json. `bridge` lists the point ranges that are on a
bridge or viaduct, where the track must not follow the ground.
Run:  python tools/fetch_tracks.py        (the raw download is cached in tools/.cache)
"""
import json, math, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'osaka', 'tracks.json')
CACHE = os.path.join(ROOT, 'tools', '.cache', 'osm_rails.json')

# must match tools/fetch_osaka.py
S, W, N, E = 34.6435, 135.5010, 34.6560, 135.5180
LAT0, LON0 = (S + N) / 2, (W + E) / 2
M_LAT = 110920.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
HX, HZ = (E - W) / 2 * M_LON, (N - S) / 2 * M_LAT
MARGIN = 90  # trains appear and vanish this far outside the map
QUERY = f'[out:json][timeout:60];(way["railway"="rail"]({S},{W},{N},{E}););out body;>;out skel qt;'


def fetch():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding='utf-8'))
    body = urllib.parse.urlencode({'data': QUERY}).encode()
    for attempt in range(4):
        for host in ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']:
            try:
                req = urllib.request.Request(host, data=body, headers={'User-Agent': 'open-world-map-baker/1.0'})
                raw = urllib.request.urlopen(req, timeout=120).read()
                if raw[:1] == b'{':
                    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
                    open(CACHE, 'wb').write(raw)
                    return json.loads(raw)
            except Exception as ex:  # noqa
                print('overpass', host, ex)
        time.sleep(5 + attempt * 10)
    raise RuntimeError('Overpass unavailable')


def main():
    osm = fetch()
    nodes = {e['id']: ((e['lon'] - LON0) * M_LON, -(e['lat'] - LAT0) * M_LAT) for e in osm['elements'] if e['type'] == 'node'}
    # running lines only: sidings, yard tracks and crossovers carry a `service` tag
    ways = [e for e in osm['elements'] if e['type'] == 'way' and '環状線' in e.get('tags', {}).get('name', '') and 'service' not in e['tags']]
    by_start = {w['nodes'][0]: w for w in ways}
    ends = {w['nodes'][-1] for w in ways}
    tracks = []
    for first in [w for w in ways if w['nodes'][0] not in ends]:  # a chain starts where no other way ends
        ids, flags, w = [], [], first
        while w:
            raised = bool(w['tags'].get('bridge')) and w['tags']['bridge'] != 'no'
            new = w['nodes'] if not ids else w['nodes'][1:]
            ids += new
            flags += [raised] * len(new)
            w = by_start.get(w['nodes'][-1])
        pts = [nodes[i] for i in ids]
        keep = [k for k, p in enumerate(pts) if abs(p[0]) < HX + MARGIN and abs(p[1]) < HZ + MARGIN]
        if len(keep) < 2:
            continue
        a, b = keep[0], keep[-1]
        pts, flags = pts[a:b + 1], flags[a:b + 1]
        bridge, k = [], 0
        while k < len(flags):
            if flags[k]:
                j = k
                while j + 1 < len(flags) and flags[j + 1]:
                    j += 1
                bridge.append([max(0, k - 1), j])
                k = j + 1
            else:
                k += 1
        length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        east = pts[-1][0] > pts[0][0]
        # the outer loop runs clockwise, which is westbound through Tennoji
        tracks.append({'name': '大阪環状線 ' + ('内回り' if east else '外回り'), 'len': length,
                       'pts': [round(v, 1) for p in pts for v in p], 'bridge': bridge})
    tracks.sort(key=lambda t: -t['len'])
    tracks = tracks[:2]
    for t in tracks:
        print(t['name'], f"{t.pop('len'):.0f} m", len(t['pts']) // 2, 'points', 'bridges', t['bridge'])
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(tracks, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
