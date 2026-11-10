import { BoxPart } from '../core/geo';
import { Livery, text, arcText, badge, bothSides } from './Livery';

/** Detailed Osaka emergency vehicles: patrol car, pumper and high-roof ambulance, with their printed lettering. */

const GLASS = 0x18222c, TRIM = 0x1b1d21, LAMP = 0xfff3cf, TAIL = 0xff1a1a;
const SILVER = 0xb9bec6, RED = 0xd3191c, BEACON = 0xff2a1a, WHITE = 0xf4f4f1, SEAM_RED = 0x8f1012;
const PLATE = 0xf5f5ee, INK = '#15171a';

/** Mirror a part to both sides of the car. */
function pair(parts: BoxPart[], p: BoxPart) {
  parts.push(p, { ...p, pos: [-p.pos[0], p.pos[1], p.pos[2]] });
}

// ---------------------------------------------------------------- patrol car
/** Three-box saloon in black and white with a red roof bar on a white pedestal. Returns the roof height. */
export function patrolCarParts(parts: BoxPart[], W: number, L: number, wheel: number): number {
  const h = L / 2, black = 0x121315, white = 0xf2f2f2;
  parts.push(
    { size: [W, 0.37, L], pos: [0, 0.475, 0], color: black }, // sills, bumpers, lower doors
    { size: [W, 0.27, L - 0.06], pos: [0, 0.795, 0], color: white }, // shoulder
    { size: [W * 0.96, 0.07, 1.3], pos: [0, 0.945, 1.78], color: white, rot: [0.04, 0, 0] }, // bonnet
    { size: [W * 0.95, 0.07, 0.72], pos: [0, 0.95, -2.07], color: white }, // boot lid
    { size: [W * 0.86, 0.03, 0.1], pos: [0, 0.965, 1.15], color: TRIM }, // cowl
    // cabin
    { size: [W * 0.86, 0.46, 1.5], pos: [0, 1.16, -0.3], color: GLASS },
    { size: [W * 0.85, 0.24, 0.42], pos: [0, 1.05, 0.64], color: GLASS },
    { size: [W * 0.84, 0.24, 0.42], pos: [0, 1.05, -1.24], color: GLASS },
    { size: [W * 0.87, 0.07, 1.56], pos: [0, 1.42, -0.3], color: white },
    { size: [W * 0.84, 0.06, 0.86], pos: [0, 1.19, 0.8], color: GLASS, rot: [0.59, 0, 0] },
    { size: [W * 0.82, 0.06, 0.84], pos: [0, 1.2, -1.4], color: GLASS, rot: [-0.56, 0, 0] },
    { size: [W * 0.875, 0.46, 0.09], pos: [0, 1.16, -0.12], color: TRIM }, // B pillar
    { size: [W * 0.875, 0.03, 1.5], pos: [0, 0.94, -0.3], color: SILVER }, // belt-line moulding
    // roof beacon: white pedestal, red bar with a chrome centre
    { size: [0.95, 0.15, 0.55], pos: [0, 1.53, -0.2], color: white },
    { size: [0.8, 0.06, 0.4], pos: [0, 1.63, -0.2], color: white },
    { size: [1.2, 0.13, 0.3], pos: [0, 1.72, -0.2], color: BEACON, glow: 3.2 },
    { size: [0.16, 0.14, 0.32], pos: [0, 1.72, -0.2], color: SILVER },
    // nose
    { size: [W * 0.4, 0.15, 0.08], pos: [0, 0.78, h - 0.02], color: 0x08090a },
    { size: [W * 0.42, 0.025, 0.09], pos: [0, 0.865, h - 0.02], color: SILVER },
    { size: [W * 0.42, 0.02, 0.09], pos: [0, 0.78, h - 0.02], color: SILVER },
    { size: [0.08, 0.08, 0.1], pos: [0, 0.8, h - 0.01], color: SILVER }, // emblem
    { size: [W * 0.62, 0.1, 0.08], pos: [0, 0.4, h + 0.01], color: 0x050506 },
    { size: [0.34, 0.17, 0.03], pos: [0, 0.56, h + 0.02], color: PLATE },
    // tail
    { size: [W * 0.3, 0.03, 0.08], pos: [0, 0.9, -h + 0.02], color: SILVER },
    { size: [0.34, 0.17, 0.03], pos: [0, 0.5, -h - 0.02], color: PLATE },
    { size: [W * 0.7, 0.05, 0.06], pos: [0, 0.33, -h], color: 0x050506 },
  );
  pair(parts, { size: [0.07, 0.075, 0.86], pos: [W * 0.425, 1.19, 0.8], color: white, rot: [0.59, 0, 0] }); // A pillars
  pair(parts, { size: [0.1, 0.075, 0.84], pos: [W * 0.415, 1.2, -1.4], color: white, rot: [-0.56, 0, 0] }); // C pillars
  pair(parts, { size: [0.44, 0.12, 0.08], pos: [W / 2 - 0.27, 0.8, h - 0.02], color: LAMP, glow: 3 });
  pair(parts, { size: [0.12, 0.05, 0.09], pos: [W / 2 - 0.12, 0.72, h - 0.02], color: 0xffa62b, glow: 1.6 }); // indicators
  pair(parts, { size: [0.1, 0.07, 0.1], pos: [0.2, 0.74, h], color: BEACON, glow: 2.6 }); // grille flashers
  pair(parts, { size: [0.14, 0.07, 0.08], pos: [W / 2 - 0.28, 0.42, h + 0.01], color: LAMP, glow: 2 }); // fog lamps
  pair(parts, { size: [0.46, 0.15, 0.08], pos: [W / 2 - 0.27, 0.8, -h + 0.02], color: TAIL, glow: 1.6 });
  pair(parts, { size: [0.12, 0.1, 0.09], pos: [W / 2 - 0.56, 0.8, -h + 0.02], color: 0xf0f0f0, glow: 1.2 }); // reversing lamps
  pair(parts, { size: [0.07, 0.07, 0.1], pos: [W / 2 - 0.4, 0.32, -h + 0.02], color: SILVER }); // exhausts
  pair(parts, { size: [0.16, 0.1, 0.1], pos: [W / 2 + 0.08, 1.0, 0.72], color: white }); // mirrors
  pair(parts, { size: [0.03, 0.03, 0.13], pos: [W / 2 + 0.005, 0.905, 0.08], color: SILVER }); // door handles
  pair(parts, { size: [0.03, 0.03, 0.13], pos: [W / 2 + 0.005, 0.905, -0.95], color: SILVER });
  for (const z of [0.95, -0.1, -1.12]) parts.push({ size: [W + 0.01, 0.56, 0.018], pos: [0, 0.63, z], color: 0x2a2c30 }); // door shut lines
  for (const s of [-1, 1]) parts.push({ size: [W + 0.014, 0.4, wheel + 0.1], pos: [0, 0.5, s * L * 0.3], color: 0x0a0a0b }); // wheel arches
  return 1.455;
}

export function patrolCarLivery(W: number, L: number): Livery {
  const x = W / 2 + 0.016, h = L / 2;
  return {
    labels: [
      { px: [1000, 120], draw: text('大阪府警', INK, { spread: true }) },
      { px: [640, 110], draw: text('POLICE', '#f2f2f2', { latin: true }) },
      { px: [520, 110], draw: text('大阪府警', INK) },
    ],
    decals: [
      ...bothSides(0, x, 0.79, -0.1, [1.7, 0.2]),
      ...bothSides(1, x, 0.49, -0.1, [0.95, 0.165]),
      { label: 2, face: '-z', pos: [0, 0.79, -h + 0.016], size: [0.52, 0.11] },
    ],
  };
}

// ---------------------------------------------------------------- ambulance
/** High-roof van ambulance: white body, long side windows, red beacons moulded into the roof front and rear corners. */
export function ambulanceParts(parts: BoxPart[], W: number, L: number): number {
  const h = L / 2, grey = 0xc9ccd2;
  parts.push(
    { size: [W, 0.95, L], pos: [0, 0.78, 0], color: WHITE },
    { size: [W * 0.98, 0.76, L * 0.84], pos: [0, 1.63, -0.42], color: WHITE },
    { size: [W * 0.94, 0.42, L * 0.78], pos: [0, 2.2, -0.52], color: WHITE }, // high roof
    { size: [W * 0.9, 0.3, 0.5], pos: [0, 2.1, 1.7], color: WHITE, rot: [0.5, 0, 0] }, // roof front fairing
    // windscreen and its filler
    { size: [W * 0.92, 0.07, 0.96], pos: [0, 1.63, 2.26], color: GLASS, rot: [0.66, 0, 0] },
    { size: [W * 0.92, 0.4, 0.4], pos: [0, 1.46, 2.06], color: GLASS },
    { size: [W * 0.5, 0.02, 0.5], pos: [0, 1.3, 2.52], color: TRIM }, // wiper cowl
    // side glass: cab door, then the long treatment-room windows
    { size: [W + 0.01, 0.5, 0.95], pos: [0, 1.62, 1.38], color: GLASS },
    { size: [W + 0.01, 0.5, 2.9], pos: [0, 1.66, -1.0], color: GLASS },
    { size: [W + 0.02, 0.5, 0.09], pos: [0, 1.66, -0.2], color: WHITE },
    { size: [W + 0.02, 0.5, 0.09], pos: [0, 1.66, -1.4], color: WHITE },
    // pale waist stripes
    { size: [W + 0.016, 0.025, L * 0.9], pos: [0, 1.3, -0.1], color: grey },
    { size: [W + 0.016, 0.025, L * 0.9], pos: [0, 1.35, -0.1], color: grey },
    // beacons: sloped lens on the roof front with a flat top section
    { size: [W * 0.82, 0.14, 0.62], pos: [0, 2.276, 1.796], color: BEACON, glow: 2.6, rot: [0.5, 0, 0] },
    { size: [W * 0.82, 0.12, 0.42], pos: [0, 2.44, 1.36], color: BEACON, glow: 2.6 },
    { size: [W * 0.86, 0.04, 0.5], pos: [0, 2.4, 1.36], color: TRIM },
    // nose: chrome grille, emblem, flashers, bumper intake, plate
    { size: [W * 0.66, 0.16, 0.08], pos: [0, 1.04, h + 0.01], color: TRIM },
    { size: [W * 0.66, 0.03, 0.1], pos: [0, 1.12, h + 0.01], color: SILVER },
    { size: [W * 0.66, 0.03, 0.1], pos: [0, 0.97, h + 0.01], color: SILVER },
    { size: [0.14, 0.14, 0.1], pos: [0, 1.24, h + 0.01], color: SILVER },
    { size: [W * 0.7, 0.16, 0.08], pos: [0, 0.56, h + 0.01], color: TRIM },
    { size: [W * 0.66, 0.025, 0.1], pos: [0, 0.56, h + 0.01], color: 0x6b6f76 },
    { size: [0.4, 0.2, 0.03], pos: [0.45, 0.42, h + 0.02], color: PLATE },
    // tail: door glass, split line, handle, step bumper, plate
    { size: [W * 0.78, 0.62, 0.08], pos: [0, 1.66, -h - 0.01], color: GLASS },
    { size: [0.02, 1.1, 0.09], pos: [0, 1.82, -h - 0.012], color: 0x9a9da3 },
    { size: [0.3, 0.05, 0.06], pos: [0, 0.82, -h - 0.02], color: SILVER },
    { size: [W, 0.16, 0.2], pos: [0, 0.44, -h - 0.06], color: SILVER },
    { size: [0.4, 0.2, 0.03], pos: [0, 0.66, -h - 0.02], color: PLATE },
  );
  pair(parts, { size: [0.46, 0.2, 0.7], pos: [W / 2 - 0.36, 2.48, -h + 0.72], color: BEACON, glow: 2.6 }); // rear corner beacons
  pair(parts, { size: [0.44, 0.22, 0.08], pos: [W / 2 - 0.28, 1.02, h + 0.01], color: LAMP, glow: 3 });
  pair(parts, { size: [0.1, 0.22, 0.09], pos: [W / 2 - 0.06, 1.02, h], color: 0xffa62b, glow: 1.5 });
  pair(parts, { size: [0.18, 0.12, 0.1], pos: [0.3, 1.04, h + 0.03], color: BEACON, glow: 2.6 }); // grille flashers
  pair(parts, { size: [0.14, 0.12, 0.08], pos: [W / 2 - 0.3, 0.56, h + 0.02], color: LAMP, glow: 2 }); // fog lamps
  pair(parts, { size: [0.14, 0.55, 0.08], pos: [W / 2 - 0.1, 1.05, -h - 0.01], color: TAIL, glow: 1.6 });
  pair(parts, { size: [0.14, 0.14, 0.09], pos: [W / 2 - 0.1, 1.42, -h - 0.01], color: 0xffa62b, glow: 1.4 });
  // chrome door mirrors on black arms
  pair(parts, { size: [0.14, 0.05, 0.05], pos: [W / 2 + 0.06, 1.42, 1.92], color: TRIM });
  pair(parts, { size: [0.1, 0.26, 0.16], pos: [W / 2 + 0.16, 1.5, 1.94], color: SILVER });
  // handles and shut lines
  pair(parts, { size: [0.03, 0.04, 0.16], pos: [W / 2 + 0.005, 1.2, 0.98], color: SILVER });
  pair(parts, { size: [0.03, 0.14, 0.05], pos: [W / 2 + 0.005, 1.1, 0.42], color: SILVER });
  for (const z of [1.9, 0.82, 0.3, -1.8]) parts.push({ size: [W + 0.01, 0.84, 0.018], pos: [0, 0.83, z], color: 0x9a9da3 });
  parts.push({ size: [W + 0.012, 0.03, 2.1], pos: [0, 0.62, -0.75], color: 0x9a9da3 }); // sliding-door rail
  return 2.6;
}

export function ambulanceLivery(W: number, L: number): Livery {
  const x = W / 2 + 0.016, h = L / 2;
  return {
    labels: [
      { px: [1000, 150], draw: text('大阪市消防局', INK) },
      { px: [480, 150], draw: badge('A 350', '#d3191c') },
      { px: [1000, 64], draw: text('OSAKA FIRE DEPT. AMBULANCE', '#1d2f6b', { latin: true }) },
    ],
    decals: [
      ...bothSides(0, x, 1.02, -0.75, [1.75, 0.26]),
      ...bothSides(1, x, 1.0, 1.36, [0.74, 0.23]),
      ...bothSides(2, W * 0.47 + 0.014, 2.2, -0.7, [2.5, 0.16]),
      { label: 0, face: '-z', pos: [0, 1.12, -h - 0.014], size: [1.25, 0.19] },
    ],
  };
}

// ---------------------------------------------------------------- pumper
/** Rescue pumper: cab-over crew cab with a roof light bar, pump panel, equipment body, roof ladder, chevron tail. */
export function fireTruckParts(parts: BoxPart[], W: number, L: number): number {
  const h = L / 2;
  const cabZ = h - 1.25, bodyLen = L - 2.7, bodyZ = -h + bodyLen / 2;
  const pumpZ = bodyZ + bodyLen / 2 - 0.55;
  parts.push(
    { size: [W * 0.86, 0.36, L - 0.3], pos: [0, 0.62, 0], color: TRIM }, // chassis
    // crew cab
    { size: [W, 1.9, 2.5], pos: [0, 1.5, cabZ], color: RED },
    { size: [W * 0.92, 0.46, 1.9], pos: [0, 2.68, cabZ - 0.25], color: RED },
    { size: [W * 0.94, 0.05, 0.3], pos: [0, 2.37, h + 0.1], color: TRIM }, // sun visor
    { size: [W * 0.92, 0.9, 0.08], pos: [0, 1.86, h + 0.01], color: GLASS }, // windscreen
    { size: [0.04, 0.9, 0.09], pos: [0, 1.86, h + 0.012], color: 0x0c0d0f },
    { size: [W + 0.02, 0.62, 0.86], pos: [0, 1.92, cabZ + 0.72], color: GLASS },
    { size: [W + 0.02, 0.56, 0.74], pos: [0, 1.95, cabZ - 0.5], color: GLASS },
    { size: [W + 0.03, 0.04, 0.9], pos: [0, 2.26, cabZ + 0.72], color: SILVER }, // rain guards
    { size: [W + 0.03, 0.04, 0.78], pos: [0, 2.26, cabZ - 0.5], color: SILVER },
    // light bar with a chrome centre
    { size: [W * 0.78, 0.2, 0.44], pos: [0, 3.0, cabZ + 0.35], color: BEACON, glow: 2.6 },
    { size: [0.4, 0.21, 0.46], pos: [0, 3.0, cabZ + 0.35], color: SILVER },
    { size: [W * 0.8, 0.04, 0.5], pos: [0, 2.9, cabZ + 0.35], color: TRIM },
    // nose: black panel with grille, bumper with lamps, tow guard and plate
    { size: [W * 0.9, 0.3, 0.06], pos: [0, 1.22, h + 0.01], color: TRIM },
    { size: [W * 0.4, 0.1, 0.08], pos: [0, 1.2, h + 0.02], color: SILVER },
    { size: [0.14, 0.14, 0.1], pos: [0, 1.5, h + 0.01], color: SILVER },
    { size: [W + 0.06, 0.34, 0.34], pos: [0, 0.66, h + 0.05], color: RED },
    { size: [W * 0.46, 0.24, 0.3], pos: [0, 0.6, h + 0.32], color: SILVER },
    { size: [0.44, 0.22, 0.03], pos: [0, 0.6, h + 0.48], color: PLATE },
    // equipment body, rails, pump panel
    { size: [W, 2.35, bodyLen], pos: [0, 1.73, bodyZ], color: RED },
    { size: [W + 0.03, 0.07, bodyLen - 0.1], pos: [0, 2.72, bodyZ], color: SILVER },
    { size: [W + 0.03, 0.07, bodyLen - 0.1], pos: [0, 1.2, bodyZ], color: SILVER },
    { size: [W + 0.03, 1.18, 0.95], pos: [0, 1.96, pumpZ], color: 0x8d9299 },
    { size: [W + 0.1, 0.06, 1.0], pos: [0, 1.3, pumpZ], color: SILVER }, // pump step
    { size: [W + 0.08, 0.3, 0.9], pos: [0, 0.85, -h + 0.5], color: SILVER }, // rear side step
    { size: [W + 0.012, 1.45, 0.02], pos: [0, 1.96, pumpZ - 0.5], color: SEAM_RED },
    { size: [W + 0.012, 1.45, 0.02], pos: [0, 1.96, -h + 0.15], color: SEAM_RED },
    // roof deck: hose trays, spot lamp, ladder
    { size: [0.24, 0.2, bodyLen - 0.8], pos: [W / 2 - 0.22, 3.0, bodyZ], color: SILVER },
    { size: [0.24, 0.2, bodyLen - 0.8], pos: [-W / 2 + 0.22, 3.0, bodyZ], color: SILVER },
    { size: [0.06, 0.4, 0.06], pos: [W / 2 - 0.3, 3.1, pumpZ + 0.35], color: SILVER },
    { size: [0.2, 0.2, 0.14], pos: [W / 2 - 0.3, 3.36, pumpZ + 0.37], color: TRIM },
    { size: [0.16, 0.16, 0.04], pos: [W / 2 - 0.3, 3.36, pumpZ + 0.45], color: LAMP, glow: 2 },
    // tail: roller shutter with slats, chrome step
    { size: [W * 0.56, 1.7, 0.08], pos: [0, 1.9, -h - 0.01], color: 0xb01518 },
    { size: [W, 0.2, 0.3], pos: [0, 0.6, -h - 0.1], color: SILVER },
    { size: [0.44, 0.22, 0.03], pos: [0.7, 1.02, -h - 0.02], color: PLATE },
  );
  for (let k = 0; k < 7; k++) parts.push({ size: [W * 0.56, 0.015, 0.09], pos: [0, 1.2 + k * 0.2, -h - 0.012], color: SEAM_RED });
  // pump panel: gauges, valves, outlets
  for (let k = 0; k < 3; k++) {
    const z = pumpZ - 0.27 + k * 0.27;
    parts.push({ size: [W + 0.04, 0.2, 0.2], pos: [0, 2.32, z], color: TRIM }, { size: [W + 0.05, 0.14, 0.14], pos: [0, 2.32, z], color: WHITE });
  }
  for (const dz of [-0.24, 0.24]) {
    parts.push({ size: [W + 0.08, 0.12, 0.12], pos: [0, 1.96, pumpZ + dz], color: RED });
    parts.push({ size: [W + 0.12, 0.18, 0.18], pos: [0, 1.6, pumpZ + dz], color: SILVER, cyl: true });
  }
  parts.push({ size: [W + 0.06, 0.1, 0.3], pos: [0, 1.96, pumpZ], color: TRIM });
  // cab details
  for (const dz of [1.18, 0.1, -1.1]) parts.push({ size: [W + 0.012, 1.5, 0.02], pos: [0, 1.4, cabZ + dz], color: SEAM_RED });
  pair(parts, { size: [0.03, 0.035, 0.18], pos: [W / 2 + 0.005, 1.585, cabZ + 0.28], color: TRIM });
  pair(parts, { size: [0.03, 0.035, 0.18], pos: [W / 2 + 0.005, 1.585, cabZ - 0.92], color: TRIM });
  pair(parts, { size: [0.08, 0.05, 0.75], pos: [W / 2 + 0.04, 0.6, cabZ + 0.85], color: SILVER }); // cab steps
  pair(parts, { size: [0.22, 0.05, 0.05], pos: [W / 2 + 0.1, 2.2, h - 0.05], color: TRIM }); // mirror arms
  pair(parts, { size: [0.08, 0.46, 0.2], pos: [W / 2 + 0.22, 2.0, h - 0.02], color: TRIM });
  pair(parts, { size: [0.2, 0.14, 0.1], pos: [W / 2 - 0.3, 1.3, h + 0.03], color: BEACON, glow: 2.6 }); // flashers
  pair(parts, { size: [0.4, 0.18, 0.08], pos: [W / 2 - 0.3, 0.68, h + 0.23], color: LAMP, glow: 3 });
  pair(parts, { size: [0.12, 0.1, 0.08], pos: [W / 2 - 0.06, 0.92, h + 0.2], color: 0xffa62b, glow: 1.5 });
  pair(parts, { size: [0.4, 0.14, 0.4], pos: [W / 2 - 0.3, 2.97, bodyZ + bodyLen / 2 - 0.4], color: BEACON, glow: 2.6 });
  pair(parts, { size: [0.3, 0.2, 0.08], pos: [W / 2 - 0.25, 1.0, -h - 0.01], color: TAIL, glow: 1.6 });
  pair(parts, { size: [0.14, 0.2, 0.09], pos: [W / 2 - 0.5, 1.0, -h - 0.01], color: 0xffa62b, glow: 1.4 });
  pair(parts, { size: [0.05, 2.0, 0.05], pos: [W / 2 - 0.1, 1.9, -h - 0.05], color: SILVER }); // grab rails
  pair(parts, { size: [0.3, 0.12, 0.1], pos: [W / 2 - 0.22, 2.75, -h - 0.02], color: BEACON, glow: 2.6 });
  for (let k = 0; k < 6; k++)
    parts.push({ size: [W / 6 - 0.02, 0.22, 0.08], pos: [-W / 2 + (k + 0.5) * (W / 6), 0.8, -h - 0.02], color: k % 2 ? RED : 0xf2c21a });
  // roof ladder
  const ly = 3.14;
  pair(parts, { size: [0.07, 0.07, bodyLen - 0.6], pos: [0.42, ly, bodyZ], color: SILVER });
  for (let k = 0; k < 10; k++) parts.push({ size: [0.84, 0.05, 0.05], pos: [0, ly, bodyZ - (bodyLen - 1) / 2 + (k * (bodyLen - 1)) / 9], color: SILVER });
  parts.push({ size: [0.9, 0.08, 0.08], pos: [0, 3.02, bodyZ + 1.4], color: TRIM });
  return 3.2;
}

export function fireTruckLivery(W: number, L: number): Livery {
  const x = W / 2 + 0.016, h = L / 2;
  const cabZ = h - 1.25, bodyLen = L - 2.7, bodyZ = -h + bodyLen / 2;
  const panelZ = bodyZ - 0.5;
  return {
    labels: [
      { px: [1000, 130], draw: text('大阪市消防局', '#ffffff') },
      { px: [480, 130], draw: badge('R 63', '#ffffff') },
      { px: [1000, 320], draw: arcText('OSAKA', '#ffffff') },
      { px: [520, 120], draw: text('RESCUE', '#ffffff', { latin: true }) },
    ],
    decals: [
      ...bothSides(0, x, 1.18, cabZ + 0.05, [1.85, 0.24]),
      ...bothSides(1, x, 1.44, cabZ + 0.64, [0.74, 0.2]),
      ...bothSides(2, x, 2.24, panelZ, [2.3, 0.74]),
      ...bothSides(3, x, 1.56, panelZ, [1.25, 0.29]),
      { label: 0, face: '-z', pos: [0, 2.5, -h - 0.062], size: [1.2, 0.156] },
    ],
  };
}
