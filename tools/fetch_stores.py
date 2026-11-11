"""Bake the real locations of chain stores inside the map into public/osaka/stores.json.

Source: OpenStreetMap via the Overpass API  (c) OpenStreetMap contributors, ODbL.
Only street-level branches are kept (basement and upper-floor branches have no shopfront on the street),
and only chains the game knows how to draw (see BRANDS; the kinds match SPECS in src/world/Stores.ts).

Output: [[kind, x, z, branch], ...] in local metres (x = east, z = south), the same frame as map.json.
Run:  python tools/fetch_stores.py        (the raw download is cached in tools/.cache)
"""
import json, math, os, re, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'osaka', 'stores.json')
CACHE = os.path.join(ROOT, 'tools', '.cache', 'osm_shops.json')

# must match tools/fetch_osaka.py
S, W, N, E = 34.6435, 135.5010, 34.6560, 135.5180
LAT0, LON0 = (S + N) / 2, (W + E) / 2
M_LAT = 110920.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
HX, HZ = (E - W) / 2 * M_LON, (N - S) / 2 * M_LAT

# brand or name (lower case; spaces, hyphens and middle dots removed) -> kind; the longest match wins
BRANDS = {
    # convenience stores and fast food
    'マクドナルド': 'mcd', "mcdonald's": 'mcd', 'mcdonalds': 'mcd',
    'セブンイレブン': 'seven', '7eleven': 'seven',
    'ファミリーマート': 'famima', 'familymart': 'famima',
    'ローソンストア100': 'lawson100', 'lawsonstore100': 'lawson100',
    'ローソン': 'lawson', 'lawson': 'lawson',
    'デイリーヤマザキ': 'daily', 'dailyyamazaki': 'daily',
    'モスバーガー': 'mos',
    # rice bowls, set meals, noodles
    '吉野家': 'yoshinoya', '松屋': 'matsuya', 'なか卯': 'nakau', 'やよい軒': 'yayoi', '丸亀製麺': 'marugame',
    '餃子の王将': 'ohsho', '大阪王将': 'osakaohsho', '天下一品': 'tenichi', '一風堂': 'ippudo',
    '串かつだるま': 'daruma', 'びっくりドンキー': 'donkey',
    # cafes
    'スターバックス': 'starbucks', 'starbucks': 'starbucks', 'ドトール': 'doutor', 'タリーズ': 'tullys', 'サンマルクカフェ': 'stmarc',
    # supermarkets, discount and drug stores
    'スーパー玉出': 'tamade', '成城石井': 'seijo', 'ドンキホーテ': 'donki', 'ダイソー': 'daiso',
    'スギ薬局': 'sugi', 'ココカラファイン': 'cocokara', 'マツモトキヨシ': 'matsukiyo', 'コクミン': 'kokumin', 'ダイコクドラッグ': 'daikoku',
    # banks and the post office
    '三菱ufj銀行': 'mufg', 'りそな銀行': 'resona', 'みずほ銀行': 'mizuho', '三井住友銀行': 'smbc', '関西みらい銀行': 'kansaimirai',
    '日本郵便': 'post', '郵便局': 'post',
}
# things that carry a brand name without being a shopfront
NOT_A_SHOP = {'atm', 'parking', 'parking_space', 'parking_entrance', 'bicycle_rental', 'bicycle_parking', 'vending_machine'}
QUERY = (f'[out:json][timeout:90];(nwr["shop"]({S},{W},{N},{E});'
         f'nwr["amenity"~"restaurant|fast_food|cafe|bank|post_office|pharmacy|pub|bar"]({S},{W},{N},{E}););out center tags;')


def fetch():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding='utf-8'))
    body = urllib.parse.urlencode({'data': QUERY}).encode()
    for attempt in range(5):
        for host in ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']:
            try:
                req = urllib.request.Request(host, data=body, headers={'User-Agent': 'open-world-map-baker/1.0'})
                raw = urllib.request.urlopen(req, timeout=150).read()
                if raw[:1] == b'{':
                    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
                    open(CACHE, 'wb').write(raw)
                    return json.loads(raw)
            except Exception as ex:  # noqa
                print('overpass', host, ex)
        time.sleep(5 + attempt * 10)
    raise RuntimeError('Overpass unavailable')


def kind_of(tags):
    if tags.get('amenity') in NOT_A_SHOP or not (tags.get('shop') or tags.get('amenity')):
        return None
    label = tags.get('brand') or tags.get('name') or ''
    if tags.get('amenity') == 'post_office':
        label = label or '郵便局'
    key = re.sub(r'[\s　・\-‐]', '', label).lower()
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
    print(len(out), 'stores', dict(sorted(count.items(), key=lambda kv: -kv[1])))


if __name__ == '__main__':
    main()
