"""Bake the real locations of chain stores inside the map into public/osaka/stores.json.

Source: OpenStreetMap via the Overpass API  (c) OpenStreetMap contributors, ODbL.
Only street-level shops are kept (basement and upper-floor branches have no shopfront on the street).

Output: [[kind, x, z, branch], ...] in local metres (x = east, z = south), the same frame as map.json.
Run:  python tools/fetch_stores.py        (the raw download is cached in tools/.cache)
"""
import json, math, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'osaka', 'stores.json')
CACHE = os.path.join(ROOT, 'tools', '.cache', 'osm_stores.json')

# must match tools/fetch_osaka.py
S, W, N, E = 34.6435, 135.5010, 34.6560, 135.5180
LAT0, LON0 = (S + N) / 2, (W + E) / 2
M_LAT = 110920.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
HX, HZ = (E - W) / 2 * M_LON, (N - S) / 2 * M_LAT

# brand tag (lower case, spaces and hyphens removed) -> kind; the longest match wins
BRANDS = {
    'マクドナルド': 'mcd', "mcdonald's": 'mcd', 'mcdonalds': 'mcd',
    'セブンイレブン': 'seven', '7eleven': 'seven',
    'ファミリーマート': 'famima', 'familymart': 'famima',
    'ローソンストア100': 'lawson100', 'lawsonstore100': 'lawson100',
    'ローソン': 'lawson', 'lawson': 'lawson',
}
PATTERN = 'マクドナルド|McDonald|セブン-イレブン|セブンイレブン|7-Eleven|ファミリーマート|FamilyMart|ローソン|Lawson'
QUERY = f'[out:json][timeout:60];(nwr["brand"~"{PATTERN}",i]({S},{W},{N},{E});nwr["name"~"{PATTERN}",i]({S},{W},{N},{E}););out center tags;'


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


def kind_of(tags):
    if tags.get('shop') != 'convenience' and tags.get('amenity') != 'fast_food':
        return None  # ATMs, bike-share docks and the like that merely carry the brand name
    key = (tags.get('brand') or tags.get('name') or '').lower().replace(' ', '').replace('-', '')
    hits = [b for b in BRANDS if b in key]
    return BRANDS[max(hits, key=len)] if hits else None


def main():
    out = []
    for e in fetch()['elements']:
        tags = e.get('tags', {})
        kind = kind_of(tags)
        if not kind or tags.get('level', '0').strip() not in ('0', ''):
            continue
        lat, lon = (e['lat'], e['lon']) if 'lat' in e else (e['center']['lat'], e['center']['lon'])
        x, z = (lon - LON0) * M_LON, -(lat - LAT0) * M_LAT
        if abs(x) > HX - 20 or abs(z) > HZ - 20:
            continue
        out.append([kind, round(x, 1), round(z, 1), tags.get('branch', '')])
    out.sort(key=lambda s: (s[0], s[1], s[2]))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    count = {}
    for s in out:
        count[s[0]] = count.get(s[0], 0) + 1
    print(len(out), 'stores', count)


if __name__ == '__main__':
    main()
