import * as THREE from 'three';

/** Printed lettering for emergency vehicles: one canvas atlas and one quad mesh per vehicle kind. */

type Face = '+x' | '-x' | '+z' | '-z';
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
interface Label {
  px: [number, number]; // size in the atlas
  draw: Draw;
}
export interface Decal {
  label: number;
  face: Face;
  pos: [number, number, number]; // centre, already on the surface
  size: [number, number]; // metres: width, height
}
export interface Livery {
  labels: Label[];
  decals: Decal[];
}

const FONT = '"Yu Gothic","YuGothic","Meiryo","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP",sans-serif';
const LATIN = '"Arial Black","Arial","Helvetica",sans-serif';

/** Text fitted into w x h. `spread` gives every character an equal cell (the widely spaced door lettering). */
export function text(str: string, color: string, opts: { spread?: boolean; latin?: boolean; weight?: number } = {}): Draw {
  return (ctx, w, h) => {
    const px = h * 0.86;
    ctx.font = `${opts.weight ?? 900} ${px}px ${opts.latin ? LATIN : FONT}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    if (opts.spread) {
      const chars = [...str], cell = w / chars.length;
      chars.forEach((ch, i) => ctx.fillText(ch, cell * (i + 0.5), h / 2, cell * 0.92));
    } else ctx.fillText(str, w / 2, h / 2, w * 0.96);
  };
}

/** Letters set along a shallow arch, like the body lettering of a pumper. */
export function arcText(str: string, color: string): Draw {
  return (ctx, w, h) => {
    const px = h * 0.56, R = w * 0.9, span = 0.74;
    ctx.font = `900 ${px}px ${LATIN}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const chars = [...str];
    chars.forEach((ch, i) => {
      const a = (i / (chars.length - 1) - 0.5) * span;
      ctx.save();
      ctx.translate(w / 2, R + px * 0.6);
      ctx.rotate(a);
      ctx.fillText(ch, 0, -R);
      ctx.restore();
    });
  };
}

/** Shield badge followed by a unit number ("R 63", "A 350"). */
export function badge(unit: string, color: string): Draw {
  return (ctx, w, h) => {
    const s = h * 0.92, x = h * 0.08, y = h * 0.04;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + s * 0.8, y);
    ctx.lineTo(x + s * 0.8, y + s * 0.62);
    ctx.quadraticCurveTo(x + s * 0.8, y + s * 0.9, x + s * 0.4, y + s);
    ctx.quadraticCurveTo(x, y + s * 0.9, x, y + s * 0.62);
    ctx.closePath();
    ctx.fillStyle = '#1b3f9c';
    ctx.fill();
    ctx.lineWidth = s * 0.06;
    ctx.strokeStyle = '#f2c21a';
    ctx.stroke();
    // simple channel-marker motif
    ctx.strokeStyle = '#f2c21a';
    ctx.lineWidth = s * 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.2, y + s * 0.18);
    ctx.lineTo(x + s * 0.6, y + s * 0.6);
    ctx.moveTo(x + s * 0.6, y + s * 0.18);
    ctx.lineTo(x + s * 0.2, y + s * 0.6);
    ctx.moveTo(x + s * 0.4, y + s * 0.14);
    ctx.lineTo(x + s * 0.4, y + s * 0.8);
    ctx.stroke();
    ctx.font = `700 ${h * 0.7}px ${LATIN}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(unit, h * 1.05, h * 0.52, w - h * 1.1);
  };
}

/** Hinomaru: red disc with a thin white outline. */
export function roundel(): Draw {
  return (ctx, w, h) => {
    const r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r * 0.96, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f4f1';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r * 0.84, 0, Math.PI * 2);
    ctx.fillStyle = '#c8102e';
    ctx.fill();
  };
}

/** Five-petal cherry blossom, the JGSDF mark painted beside the registration number. */
export function sakura(color: string): Draw {
  return (ctx, w, h) => {
    const r = Math.min(w, h) / 2;
    ctx.fillStyle = color;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * r * 0.5, h / 2 + Math.sin(a) * r * 0.5, r * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  };
}

const AXES: Record<Face, { n: [number, number, number]; r: [number, number, number] }> = {
  // r = up x n: the viewer's right-hand direction when facing the surface from outside
  '+x': { n: [1, 0, 0], r: [0, 0, -1] },
  '-x': { n: [-1, 0, 0], r: [0, 0, 1] },
  '+z': { n: [0, 0, 1], r: [1, 0, 0] },
  '-z': { n: [0, 0, -1], r: [-1, 0, 0] },
};

const PAD = 8, ATLAS_W = 1024;

export function buildLivery(l: Livery): THREE.Mesh {
  const tops: number[] = [];
  let H = PAD;
  for (const lb of l.labels) {
    tops.push(H);
    H += lb.px[1] + PAD;
  }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  l.labels.forEach((lb, i) => {
    ctx.save();
    ctx.translate(PAD, tops[i]);
    lb.draw(ctx, lb.px[0], lb.px[1]);
    ctx.restore();
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const d of l.decals) {
    const { n, r } = AXES[d.face];
    const lb = l.labels[d.label];
    const u0 = PAD / ATLAS_W, u1 = (PAD + lb.px[0]) / ATLAS_W;
    const v1 = 1 - tops[d.label] / H, v0 = 1 - (tops[d.label] + lb.px[1]) / H;
    const hw = d.size[0] / 2, hh = d.size[1] / 2;
    const base = pos.length / 3;
    for (const [sr, su, u, v] of [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) {
      pos.push(d.pos[0] + r[0] * hw * sr, d.pos[1] + hh * su, d.pos[2] + r[2] * hw * sr);
      nor.push(n[0], n[1], n[2]);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 0.5, metalness: 0.1,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 1;
  return mesh;
}

/** The same decal on both flanks of the vehicle. */
export function bothSides(label: number, halfWidth: number, y: number, z: number, size: [number, number]): Decal[] {
  return [
    { label, face: '+x', pos: [halfWidth, y, z], size },
    { label, face: '-x', pos: [-halfWidth, y, z], size },
  ];
}
