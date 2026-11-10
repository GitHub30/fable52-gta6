import { BoxPart } from '../core/geo';
import { Livery, text, sakura, bothSides } from './Livery';

/** JGSDF Type 16 Maneuver Combat Vehicle: 8x8 wedge-nosed hull and a separate turret with the 105 mm rifled gun. */

const OD = 0x4c5439, CAMO = 0x353c2b, SHADOW = 0x23271d, STEEL = 0x2a2d28, TYRE = 0x121212, HUB = 0x3c4232;
const LAMP = 0xfff3cf, AMBER = 0xffa62b, TAIL = 0xff1a1a;
const ALONG_Z: [number, number, number] = [0, Math.PI / 2, 0];
const UPRIGHT: [number, number, number] = [0, 0, Math.PI / 2];

/** Turret ring centre in hull space, and the gun's muzzle distance / height measured from it. */
export const MCV_TURRET_AT: [number, number, number] = [0, 2.0, -0.7];
export const MCV_MUZZLE = { reach: 6.9, height: 0.45 };
const AXLES = [2.75, 1.15, -0.95, -2.45];

function pair(parts: BoxPart[], p: BoxPart) {
  const rot = p.rot ? ([p.rot[0], -p.rot[1], -p.rot[2]] as [number, number, number]) : undefined;
  parts.push(p, { ...p, pos: [-p.pos[0], p.pos[1], p.pos[2]], rot });
}

export function mcvHullParts(W: number, L: number, wheel: number): BoxPart[] {
  const h = L / 2;
  const parts: BoxPart[] = [
    { size: [W - 1.0, 0.7, L - 0.7], pos: [0, 0.95, -0.1], color: SHADOW }, // lower hull between the wheels
    { size: [W, 0.7, 5.2], pos: [0, 1.65, -1.4], color: OD }, // upper hull
    // wedge nose: glacis, filler under it, lower plate, lettering band
    { size: [W * 0.96, 0.5, 2.76], pos: [0, 1.48, 2.5], color: OD, rot: [0.2, 0, 0] },
    { size: [W * 0.96, 0.36, 2.7], pos: [0, 1.22, 2.55], color: OD },
    { size: [W * 0.9, 0.12, 0.95], pos: [0, 1.05, 3.6], color: CAMO, rot: [-0.785, 0, 0] },
    { size: [W * 0.96, 0.3, 0.12], pos: [0, 1.32, 3.9], color: OD },
    { size: [W * 0.7, 0.3, 0.5], pos: [0, 0.78, 3.2], color: SHADOW },
    // glacis details: driver's hatch and periscopes, engine louvres, trim-vane ribs
    { size: [0.66, 0.07, 0.66], pos: [-0.62, 1.93, 1.5], color: CAMO, rot: [0.2, 0, 0] },
    { size: [0.5, 0.1, 0.12], pos: [-0.62, 1.94, 1.9], color: STEEL, rot: [0.2, 0, 0] },
    { size: [0.9, 0.05, 1.1], pos: [0.55, 1.88, 1.7], color: STEEL, rot: [0.2, 0, 0] },
    { size: [W * 0.9, 0.03, 0.05], pos: [0, 1.66, 2.9], color: CAMO, rot: [0.2, 0, 0] },
    { size: [W * 0.9, 0.03, 0.05], pos: [0, 1.5, 3.7], color: CAMO, rot: [0.2, 0, 0] },
    // camouflage panels
    { size: [W + 0.012, 0.7, 1.5], pos: [0, 1.65, -3.2], color: CAMO },
    { size: [W + 0.012, 0.4, 1.3], pos: [0, 1.8, 0.4], color: CAMO },
    { size: [W * 0.6, 0.02, 2.0], pos: [0.4, 2.005, -3.0], color: CAMO },
    // side radiator grille (left) and stowage bins
    { size: [0.04, 0.56, 0.9], pos: [W / 2 + 0.01, 1.66, 0.55], color: STEEL },
    { size: [0.04, 0.4, 0.5], pos: [-W / 2 - 0.01, 1.7, 0.6], color: STEEL },
    // rear: plate, door, lamps, tow hooks
    { size: [W * 0.94, 1.0, 0.1], pos: [0, 1.4, -h + 0.02], color: CAMO },
    { size: [0.9, 0.9, 0.06], pos: [0, 1.45, -h - 0.04], color: OD },
    { size: [0.1, 0.06, 0.08], pos: [0.3, 1.45, -h - 0.08], color: STEEL },
    { size: [W * 0.9, 0.14, 0.2], pos: [0, 0.8, -h + 0.05], color: SHADOW },
    // roof stowage and engine deck behind the turret
    { size: [W * 0.8, 0.06, 1.0], pos: [0, 2.03, -3.3], color: STEEL },
  ];
  // armoured side panel seams
  for (const z of [-2.6, -1.3, 0.0]) parts.push({ size: [W + 0.014, 0.7, 0.03], pos: [0, 1.65, z], color: SHADOW });
  parts.push({ size: [W + 0.014, 0.03, 5.2], pos: [0, 1.32, -1.4], color: SHADOW });
  // lamp clusters on the nose corners
  pair(parts, { size: [0.36, 0.36, 0.14], pos: [W / 2 - 0.3, 1.0, 3.55], color: SHADOW });
  pair(parts, { size: [0.16, 0.1, 0.06], pos: [W / 2 - 0.34, 1.08, 3.64], color: LAMP, glow: 3 });
  pair(parts, { size: [0.16, 0.1, 0.06], pos: [W / 2 - 0.34, 0.93, 3.64], color: LAMP, glow: 2 });
  pair(parts, { size: [0.1, 0.1, 0.06], pos: [W / 2 - 0.18, 0.93, 3.64], color: AMBER, glow: 1.6 });
  pair(parts, { size: [0.06, 0.1, 0.1], pos: [W / 2 + 0.01, 1.2, 3.2], color: AMBER, glow: 1.4 });
  // mirrors on stalks
  pair(parts, { size: [0.04, 0.5, 0.04], pos: [W / 2 - 0.1, 2.0, 2.3], color: STEEL });
  pair(parts, { size: [0.22, 0.3, 0.04], pos: [W / 2 - 0.1, 2.3, 2.3], color: SHADOW });
  // rear lamps, mud flaps, tow hooks
  pair(parts, { size: [0.2, 0.12, 0.06], pos: [W / 2 - 0.3, 1.2, -h - 0.03], color: TAIL, glow: 1.6 });
  pair(parts, { size: [0.12, 0.12, 0.06], pos: [W / 2 - 0.5, 1.2, -h - 0.03], color: AMBER, glow: 1.4 });
  pair(parts, { size: [0.5, 0.5, 0.04], pos: [W / 2 - 0.28, 0.7, -h + 0.25], color: TYRE });
  pair(parts, { size: [0.1, 0.14, 0.16], pos: [0.6, 0.95, -h - 0.08], color: STEEL });
  pair(parts, { size: [0.1, 0.14, 0.16], pos: [0.6, 0.85, 3.42], color: STEEL });
  // crew steps between the second and third axles
  for (const y of [0.75, 1.0, 1.25]) pair(parts, { size: [0.05, 0.04, 0.4], pos: [W / 2 - 0.02, y, 0.1], color: STEEL });
  // eight wheels: chunky tyre, rim, hub with planetary cover
  for (const z of AXLES) {
    pair(parts, { size: [0.44, wheel, wheel], pos: [W / 2 - 0.24, wheel / 2, z], color: TYRE, cyl: true });
    pair(parts, { size: [0.46, wheel * 0.56, wheel * 0.56], pos: [W / 2 - 0.24, wheel / 2, z], color: HUB, cyl: true });
    pair(parts, { size: [0.5, wheel * 0.24, wheel * 0.24], pos: [W / 2 - 0.24, wheel / 2, z], color: SHADOW, cyl: true });
    pair(parts, { size: [0.3, 0.12, 0.12], pos: [W / 2 - 0.55, wheel / 2 + 0.1, z], color: STEEL }); // suspension arm
  }
  return parts;
}

/** Turret centred on its ring (origin), gun pointing along +Z. */
export function mcvTurretParts(): BoxPart[] {
  const parts: BoxPart[] = [
    { size: [1.5, 0.12, 1.5], pos: [0, 0.03, 0], color: SHADOW }, // ring
    { size: [2.2, 0.72, 3.0], pos: [0, 0.45, -0.2], color: OD },
    { size: [1.9, 0.45, 0.9], pos: [0, 0.5, 1.6], color: OD, rot: [0.55, 0, 0] }, // sloped front roof
    { size: [1.7, 0.4, 0.7], pos: [0, 0.3, 1.55], color: CAMO },
    { size: [2.0, 0.6, 0.8], pos: [0, 0.47, -2.0], color: CAMO }, // bustle
    { size: [2.1, 0.36, 0.4], pos: [0, 0.42, -2.55], color: STEEL }, // rear basket
    { size: [2.1, 0.03, 0.44], pos: [0, 0.62, -2.55], color: SHADOW },
    // mantlet and the 105 mm rifled gun: sleeve, fume extractor, barrel, perforated muzzle brake
    { size: [0.86, 0.56, 0.5], pos: [0, 0.45, 2.0], color: CAMO },
    { size: [1.0, 0.36, 0.36], pos: [0, 0.45, 2.7], color: OD, cyl: true, rot: ALONG_Z },
    { size: [4.7, 0.24, 0.24], pos: [0, 0.45, 4.45], color: STEEL, cyl: true, rot: ALONG_Z },
    { size: [0.9, 0.36, 0.36], pos: [0, 0.45, 3.9], color: OD, cyl: true, rot: ALONG_Z },
    { size: [0.8, 0.3, 0.3], pos: [0, 0.45, 6.4], color: 0x1a1c18, cyl: true, rot: ALONG_Z },
    { size: [0.1, 0.33, 0.33], pos: [0, 0.45, 6.82], color: STEEL, cyl: true, rot: ALONG_Z },
    { size: [0.06, 0.18, 0.18], pos: [0, 0.45, 6.86], color: 0x050505, cyl: true, rot: ALONG_Z }, // bore
    { size: [0.2, 0.2, 0.3], pos: [0.36, 0.5, 2.2], color: 0x050505, cyl: true, rot: ALONG_Z }, // coaxial MG port
    // roof: hatches, commander's panoramic sight, gunner's sight, remote weapon station
    { size: [0.08, 0.62, 0.62], pos: [-0.5, 0.84, -0.6], color: CAMO, cyl: true, rot: UPRIGHT },
    { size: [0.08, 0.62, 0.62], pos: [0.5, 0.84, -0.9], color: CAMO, cyl: true, rot: UPRIGHT },
    { size: [0.42, 0.4, 0.42], pos: [0.55, 1.02, 0.3], color: STEEL },
    { size: [0.3, 0.2, 0.04], pos: [0.55, 1.06, 0.52], color: 0x10181f },
    { size: [0.5, 0.26, 0.6], pos: [-0.6, 0.94, 0.5], color: CAMO },
    { size: [0.3, 0.14, 0.04], pos: [-0.6, 0.96, 0.81], color: 0x10181f },
    { size: [0.12, 0.5, 0.12], pos: [-0.1, 1.06, -0.3], color: STEEL },
    { size: [0.34, 0.26, 0.8], pos: [-0.1, 1.42, -0.2], color: STEEL },
    { size: [0.06, 0.06, 0.9], pos: [-0.1, 1.45, 0.6], color: 0x101010 },
    { size: [0.2, 0.22, 0.3], pos: [0.14, 1.36, -0.3], color: CAMO }, // ammunition box
    // antennas
    { size: [0.03, 1.9, 0.03], pos: [0.95, 1.7, -2.2], color: 0x101010, rot: [-0.25, 0, 0] },
    { size: [0.03, 1.9, 0.03], pos: [-0.95, 1.7, -2.2], color: 0x101010, rot: [-0.25, 0, 0] },
    { size: [0.1, 0.2, 0.1], pos: [0.95, 0.85, -2.0], color: STEEL },
    { size: [0.1, 0.2, 0.1], pos: [-0.95, 0.85, -2.0], color: STEEL },
  ];
  // leaning side armour modules, smoke dischargers
  pair(parts, { size: [0.24, 0.6, 2.7], pos: [1.17, 0.45, -0.3], color: CAMO, rot: [0, 0, 0.22] });
  pair(parts, { size: [0.3, 0.5, 0.9], pos: [1.0, 0.45, 1.3], color: OD, rot: [0, 0.5, 0.22] });
  for (let k = 0; k < 4; k++) pair(parts, { size: [0.1, 0.1, 0.24], pos: [0.86 + k * 0.03, 0.9, -1.3 + k * 0.14], color: STEEL, rot: [-0.5, 0.5, 0] });
  return parts;
}

export function mcvLivery(W: number, L: number): Livery {
  const white = '#eef0ea';
  return {
    labels: [
      { px: [1000, 170], draw: text('陸上自衛隊', white, { spread: true }) },
      { px: [560, 130], draw: text('26-7978', white, { latin: true, weight: 700 }) },
      { px: [140, 140], draw: sakura(white) },
      { px: [700, 140], draw: text('陸上自衛隊', white) },
    ],
    decals: [
      ...bothSides(0, W / 2 + 0.02, 1.62, -1.35, [2.2, 0.3]),
      { label: 1, face: '+z', pos: [-0.72, 1.32, L / 2 - 0.022], size: [0.62, 0.15] },
      { label: 2, face: '+z', pos: [-0.22, 1.32, L / 2 - 0.022], size: [0.17, 0.17] },
      { label: 3, face: '+z', pos: [0.5, 1.32, L / 2 - 0.022], size: [0.85, 0.17] },
      { label: 3, face: '-z', pos: [0, 1.72, -L / 2 - 0.085], size: [0.9, 0.18] },
    ],
  };
}
