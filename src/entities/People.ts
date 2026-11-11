import * as THREE from 'three';

/**
 * Photo-scanned people baked by tools/build_people.py: a skinned mesh in three levels of detail, a colour
 * atlas projected from the reference photographs, a clothing mask and an 18-bone rest skeleton.
 */
export type PersonName = 'man' | 'woman';

export interface PersonBone {
  name: string;
  parent: number;
  pos: [number, number, number];
}

export interface PersonAsset {
  name: PersonName;
  /** Stature in metres. */
  height: number;
  bones: PersonBone[];
  /** Where a cap sits on the head: centre z, height, half width, half depth. */
  crown: [number, number, number, number];
  /** Where things lie in the atlas, for painting a uniform over it (see policeOverlay). */
  paint: Paint;
  /** Finest first. */
  lods: THREE.BufferGeometry[];
  map: THREE.Texture;
  /** R = top, G = bottoms. */
  mask: THREE.Texture;
  /** Typical linear brightness of the top and the bottoms in the atlas; recolouring keeps the folds relative to it. */
  ref: [number, number];
}

interface Paint {
  /** Per part: x, y, width, height of its chart in atlas pixels, and the world height of its first row. */
  charts: Record<string, [number, number, number, number, number]>;
  pxPerM: number;
  /** World heights of the shoulder line and the waist. */
  shoulder: number;
  waist: number;
  /** Half width and superellipse exponent of the chest's cross-section. */
  chest: [number, number];
}

interface Meta {
  paint: Paint;
  height: number;
  posScale: number;
  ref: [number, number];
  crown: [number, number, number, number];
  bones: PersonBone[];
  lods: { verts: number; tris: number; pos: number; nor: number; uv: number; si: number; sw: number; idx: number; wide: boolean }[];
}

const assets = new Map<PersonName, PersonAsset>();
const url = (f: string) => new URL('people/' + f, document.baseURI).href;

function texture(file: string, colour: boolean) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      url(file),
      (t) => {
        if (colour) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      () => reject(new Error('missing ' + file)),
    );
  });
}

async function loadPerson(name: PersonName): Promise<PersonAsset> {
  const [meta, bin, map, mask] = await Promise.all([
    fetch(url(name + '.json')).then((r) => r.json() as Promise<Meta>),
    fetch(url(name + '.bin')).then((r) => r.arrayBuffer()),
    texture(name + '.jpg', true),
    texture(name + '_mask.png', false),
  ]);
  const lods = meta.lods.map((l) => {
    const g = new THREE.BufferGeometry();
    const q = new Int16Array(bin, l.pos, l.verts * 3);
    const pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) pos[i] = q[i] / meta.posScale;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, l.nor, l.verts * 3), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(bin, l.uv, l.verts * 2), 2, true));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(new Uint8Array(bin, l.si, l.verts * 4)), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(bin, l.sw, l.verts * 4), 4, true));
    g.setIndex(new THREE.BufferAttribute(l.wide ? new Uint32Array(bin, l.idx, l.tris * 3) : new Uint16Array(bin, l.idx, l.tris * 3), 1));
    // limbs swing well outside the rest pose
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, meta.height / 2, 0), meta.height * 0.95);
    return g;
  });
  const lin = (v: number) => Math.pow(v, 2.2);
  return { name, height: meta.height, bones: meta.bones, crown: meta.crown, paint: meta.paint, lods, map, mask, ref: [lin(meta.ref[0]), lin(meta.ref[1])] };
}

/** Fetch both models. Must finish before the first Character is created. */
export async function loadPeople() {
  for (const p of await Promise.all([loadPerson('man'), loadPerson('woman')])) assets.set(p.name, p);
}

export function person(name: PersonName): PersonAsset {
  const a = assets.get(name);
  if (!a) throw new Error('people are not loaded yet');
  return a;
}

// one material per outfit; they all compile to the same program
const materials = new Map<string, THREE.MeshStandardMaterial>();
let blank: THREE.Texture | null = null;

/**
 * The person's material. `top` / `bottom` recolour the photographed clothes (undefined keeps them);
 * `overlay` is a texture in atlas space painted over everything (a uniform).
 */
export function personMaterial(a: PersonAsset, top?: number, bottom?: number, overlay?: THREE.Texture) {
  const key = `${a.name}_${top ?? 'x'}_${bottom ?? 'x'}_${overlay ? overlay.id : 'x'}`;
  let m = materials.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ map: a.map, roughness: 0.82, metalness: 0 });
  const tint = (c: number | undefined) => {
    const col = new THREE.Color(c ?? 0);
    return new THREE.Vector4(col.r, col.g, col.b, c === undefined ? 0 : 1);
  };
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    blank.needsUpdate = true;
  }
  const uniforms = {
    pMask: { value: a.mask },
    pOver: { value: overlay ?? blank },
    pTop: { value: tint(top) },
    pBottom: { value: tint(bottom) },
    pRef: { value: new THREE.Vector2(a.ref[0], a.ref[1]) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D pMask;\nuniform sampler2D pOver;\nuniform vec4 pTop;\nuniform vec4 pBottom;\nuniform vec2 pRef;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // recolour the cloth but keep its folds and weave: brightness relative to the cloth's own average
          vec4 pm = texture2D( pMask, vMapUv );
          float pl = dot( diffuseColor.rgb, vec3( 0.3333 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, pTop.rgb * min( pl / pRef.x, 2.2 ), pm.r * pTop.a );
          diffuseColor.rgb = mix( diffuseColor.rgb, pBottom.rgb * min( pl / pRef.y, 2.2 ), pm.g * pBottom.a );
          // a painted uniform on top, still catching a little of the shading underneath
          vec4 po = texture2D( pOver, vMapUv );
          diffuseColor.rgb = mix( diffuseColor.rgb, po.rgb * ( 0.86 + 0.3 * pl ), po.a );
        }`,
      );
  };
  m.customProgramCacheKey = () => 'person';
  materials.set(key, m);
  return m;
}

const overlays = new Map<string, THREE.Texture>();

/**
 * Osaka Prefectural Police summer uniform painted in atlas space: a navy vest over the (recoloured, light blue)
 * shirt with 大阪府警 / POLICE across the back and on the left breast, a belt, long navy trousers and black shoes.
 * Lettering is drawn flat and then wrapped column by column, so it reads straight on the curved chest and back.
 */
export function policeOverlay(a: PersonAsset): THREE.Texture {
  const hit = overlays.get(a.name);
  if (hit) return hit;
  const img = a.map.image as { width: number; height: number };
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext('2d')!;
  const P = a.paint, k = P.pxPerM;
  const [tx, ty, tw, th] = P.charts.trunk;
  const yAt = (chart: number[], world: number) => chart[1] + (chart[4] - world) * k;
  const NAVY = '#1c2238', BLACK = '#0d0e12';

  // vest: shoulders to waist all the way round, open at the collar
  const vTop = yAt(P.charts.trunk, P.shoulder + 0.012), vBot = yAt(P.charts.trunk, P.waist + 0.02);
  g.fillStyle = NAVY;
  g.fillRect(tx - 8, vTop, tw + 16, vBot - vTop);
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.ellipse(tx + tw / 2, vTop, tw * 0.085, 0.1 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // seams and pockets, so the vest does not read as a plain block
  g.strokeStyle = 'rgba(8,10,20,0.55)';
  g.lineWidth = 3;
  g.strokeRect(tx + tw * 0.56, yAt(P.charts.trunk, P.waist + 0.2), tw * 0.1, 0.12 * k);
  g.strokeRect(tx + tw * 0.34, yAt(P.charts.trunk, P.waist + 0.2), tw * 0.1, 0.12 * k);
  g.beginPath();
  g.moveTo(tx + tw / 2, vTop + 0.1 * k);
  g.lineTo(tx + tw / 2, vBot);
  g.stroke();
  // belt
  g.fillStyle = BLACK;
  g.fillRect(tx - 8, yAt(P.charts.trunk, P.waist + 0.035), tw + 16, 0.045 * k);
  // trousers: the rest of the trunk below the belt, and the legs down to the shoes
  g.fillStyle = NAVY;
  g.fillRect(tx - 8, vBot, tw + 16, ty + th + 8 - vBot);
  for (const name of ['legL', 'legR']) {
    const c = P.charts[name];
    const shoe = yAt(c, 0.105);
    g.fillStyle = NAVY;
    g.fillRect(c[0] - 8, c[1] - 8, c[2] + 16, shoe - c[1] + 8);
    g.fillStyle = BLACK;
    g.fillRect(c[0] - 8, shoe, c[2] + 16, c[1] + c[3] + 8 - shoe);
  }

  // lettering
  const label = (widthM: number) => {
    const s = document.createElement('canvas');
    s.width = 512;
    s.height = 236;
    const c = s.getContext('2d')!;
    c.fillStyle = '#f4f5f7';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '900 104px "Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif';
    c.fillText('大阪府警', 256, 66, 480);
    c.font = '900 90px Arial, Helvetica, sans-serif';
    // letter-spaced by hand so POLICE spans the same width as the kanji
    const word = 'POLICE', span = 420;
    for (let i = 0; i < word.length; i++) c.fillText(word[i], 256 - span / 2 + (span * (i + 0.5)) / word.length, 174);
    return { s, widthM, heightM: (widthM * s.height) / s.width };
  };
  const [half, exp] = P.chest;
  /** Wrap a flat label onto the trunk chart: `centre` is its middle in metres across the body, as its reader sees it. */
  const wrap = (L: ReturnType<typeof label>, back: boolean, centre: number, topWorld: number) => {
    const y = yAt(P.charts.trunk, topWorld), h = L.heightM * k;
    for (let i = 0; i < tw; i++) {
      const phi = ((i + 0.5) / tw) * Math.PI * 2, sn = Math.sin(phi), cs = Math.cos(phi);
      if (back ? cs < 0.15 : cs > -0.15) continue;
      const x = half * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / exp); // metres towards the figure's left
      const u = ((back ? -x : x) - centre) / L.widthM + 0.5; // 0..1 across the label
      if (u < 0 || u >= 1) continue;
      g.drawImage(L.s, u * L.s.width, 0, 1, L.s.height, tx + i, y, 1.5, h);
    }
  };
  wrap(label(0.23), true, 0, P.shoulder - 0.075);
  // the breast patch sits on the wearer's left, which is the reader's right
  wrap(label(0.088), false, 0.075, P.shoulder - 0.125);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  overlays.set(a.name, t);
  return t;
}
