import { BoxPart } from '../core/geo';
import { Livery, text, roundel, bothSides } from './Livery';

/** JASDF UH-60J rescue helicopter (about 3/4 scale): sea camouflage, external tanks, nose radar, wheeled gear. */

const NAVY = 0x35506e, SEA = 0x6490ae, DARK = 0x14171b, GLASS = 0x10181f, GREY = 0x6d737b, TYRE = 0x0e0e10;
const ALONG_Z: [number, number, number] = [0, Math.PI / 2, 0]; // turns an X-axis cylinder to lie nose-to-tail

export const ROTOR_AT: [number, number, number] = [0, 3.36, 0.6];
export const TAIL_ROTOR_AT: [number, number, number] = [-0.3, 4.0, -8.32];

function pair(parts: BoxPart[], p: BoxPart) {
  const rot = p.rot ? ([p.rot[0], -p.rot[1], -p.rot[2]] as [number, number, number]) : undefined;
  parts.push(p, { ...p, pos: [-p.pos[0], p.pos[1], p.pos[2]], rot });
}

export function uh60jBody(): BoxPart[] {
  const parts: BoxPart[] = [
    // cabin and belly
    { size: [2.0, 1.5, 4.4], pos: [0, 1.5, 0.4], color: NAVY },
    { size: [1.9, 0.24, 4.2], pos: [0, 0.74, 0.4], color: SEA },
    // nose: cockpit floor block, sloped chin, radar and FLIR turret
    { size: [1.86, 0.85, 1.1], pos: [0, 1.18, 3.1], color: NAVY },
    { size: [1.6, 0.6, 0.8], pos: [0, 1.05, 3.85], color: NAVY, rot: [0.25, 0, 0] },
    { size: [1.5, 0.22, 1.5], pos: [0, 0.74, 3.3], color: SEA },
    { size: [0.55, 0.5, 0.5], pos: [0, 1.0, 4.4], color: DARK, cyl: true, rot: ALONG_Z },
    { size: [0.3, 0.36, 0.36], pos: [0, 1.0, 4.72], color: 0x24272c, cyl: true, rot: ALONG_Z },
    { size: [0.36, 0.34, 0.34], pos: [-0.45, 0.6, 3.9], color: DARK, cyl: true },
    { size: [0.1, 0.1, 0.1], pos: [0.5, 0.62, 3.95], color: 0xfff3cf, glow: 3 }, // landing light
    // cockpit glazing
    { size: [1.9, 0.5, 0.5], pos: [0, 1.76, 2.8], color: GLASS },
    { size: [1.74, 0.06, 1.08], pos: [0, 1.85, 3.2], color: GLASS, rot: [0.72, 0, 0] },
    { size: [0.08, 0.07, 1.08], pos: [0, 1.86, 3.21], color: NAVY, rot: [0.72, 0, 0] },
    { size: [1.4, 0.05, 0.4], pos: [0, 1.3, 3.72], color: GLASS, rot: [1.1, 0, 0] }, // chin windows
    { size: [2.02, 0.56, 0.78], pos: [0, 1.8, 2.12], color: GLASS }, // cockpit doors
    { size: [1.78, 0.08, 0.7], pos: [0, 2.26, 2.75], color: NAVY },
    // cabin windows and sliding-door track
    { size: [2.02, 0.42, 0.52], pos: [0, 1.76, 1.0], color: GLASS },
    { size: [2.02, 0.42, 0.52], pos: [0, 1.76, 0.3], color: GLASS },
    { size: [2.03, 0.04, 2.6], pos: [0, 2.08, 0.2], color: DARK },
    { size: [2.014, 1.2, 0.02], pos: [0, 1.5, 1.42], color: DARK },
    { size: [2.014, 1.2, 0.02], pos: [0, 1.5, -0.12], color: DARK },
    // camouflage patches
    { size: [2.012, 0.5, 1.2], pos: [0, 1.12, -1.05], color: SEA },
    { size: [2.012, 0.34, 1.0], pos: [0, 2.0, -1.2], color: SEA },
    { size: [1.872, 0.4, 0.7], pos: [0, 1.0, 3.2], color: SEA },
    // engine and transmission housing
    { size: [1.5, 0.56, 3.6], pos: [0, 2.5, 0.2], color: NAVY },
    { size: [1.0, 0.3, 1.6], pos: [0, 2.86, 0.5], color: NAVY },
    { size: [1.2, 0.3, 0.8], pos: [0, 2.45, 2.2], color: NAVY, rot: [0.45, 0, 0] },
    { size: [0.3, 0.4, 0.3], pos: [0, 3.1, 0.6], color: DARK, cyl: true, rot: [0, 0, Math.PI / 2] }, // mast
    { size: [0.5, 0.16, 0.5], pos: [0, 2.96, -1.3], color: DARK }, // APU exhaust
    // tail cone and boom
    { size: [1.6, 1.3, 1.5], pos: [0, 1.75, -2.4], color: NAVY },
    { size: [1.1, 0.95, 1.3], pos: [0, 1.95, -3.6], color: NAVY },
    { size: [0.62, 0.62, 4.0], pos: [0, 2.1, -6.0], color: NAVY },
    { size: [0.632, 0.3, 1.6], pos: [0, 2.2, -6.4], color: SEA },
    { size: [0.4, 0.14, 3.6], pos: [0, 2.46, -5.6], color: NAVY }, // drive-shaft cover
    // fin, stabilator
    { size: [0.3, 2.3, 0.95], pos: [0, 3.1, -7.95], color: NAVY, rot: [-0.42, 0, 0] },
    { size: [0.34, 0.5, 0.6], pos: [0, 4.02, -8.32], color: NAVY },
    { size: [2.9, 0.1, 0.95], pos: [0, 2.05, -7.8], color: NAVY },
    { size: [0.14, 0.08, 0.1], pos: [0, 4.3, -8.4], color: 0xff2a1a, glow: 3 }, // anti-collision light
    { size: [0.2, 0.1, 0.2], pos: [0, 3.06, -0.6], color: 0xff2a1a, glow: 3 },
    // tail wheel
    { size: [0.1, 1.0, 0.1], pos: [0, 0.95, -4.5], color: GREY, rot: [0.35, 0, 0] },
    { size: [0.16, 0.46, 0.46], pos: [0, 0.23, -4.7], color: TYRE, cyl: true },
    { size: [0.18, 0.2, 0.2], pos: [0, 0.23, -4.7], color: GREY, cyl: true },
    // rescue hoist above the right-hand door
    { size: [0.5, 0.1, 0.1], pos: [-1.2, 2.3, 1.3], color: GREY },
    { size: [0.24, 0.24, 0.36], pos: [-1.4, 2.26, 1.3], color: DARK },
  ];
  // engines: nacelle, intake, exhaust
  pair(parts, { size: [2.0, 0.62, 0.62], pos: [0.62, 2.52, -0.3], color: NAVY, cyl: true, rot: ALONG_Z });
  pair(parts, { size: [0.06, 0.46, 0.46], pos: [0.62, 2.52, 0.72], color: 0x050607, cyl: true, rot: ALONG_Z });
  pair(parts, { size: [0.5, 0.5, 0.5], pos: [0.66, 2.5, -1.45], color: DARK, cyl: true, rot: ALONG_Z });
  // main gear: drag beam, shock strut, wheel
  pair(parts, { size: [0.5, 0.12, 0.16], pos: [1.15, 0.86, 1.6], color: GREY });
  pair(parts, { size: [0.1, 1.2, 0.1], pos: [1.34, 1.3, 1.6], color: GREY });
  pair(parts, { size: [0.26, 0.72, 0.72], pos: [1.38, 0.36, 1.6], color: TYRE, cyl: true });
  pair(parts, { size: [0.28, 0.34, 0.34], pos: [1.38, 0.36, 1.6], color: GREY, cyl: true });
  // external stores support: stub wing, brace, long-range tank with a pale underside
  pair(parts, { size: [1.3, 0.1, 0.7], pos: [1.5, 2.16, 0.9], color: NAVY });
  pair(parts, { size: [1.0, 0.07, 0.12], pos: [1.42, 1.72, 0.9], color: NAVY, rot: [0, 0, 0.75] });
  pair(parts, { size: [3.0, 0.64, 0.64], pos: [1.95, 1.82, 0.9], color: SEA, cyl: true, rot: ALONG_Z });
  pair(parts, { size: [0.5, 0.44, 0.44], pos: [1.95, 1.82, 2.6], color: SEA, cyl: true, rot: ALONG_Z });
  pair(parts, { size: [0.5, 0.4, 0.4], pos: [1.95, 1.82, -0.8], color: SEA, cyl: true, rot: ALONG_Z });
  pair(parts, { size: [0.5, 0.2, 2.9], pos: [1.95, 2.06, 0.9], color: NAVY });
  pair(parts, { size: [0.1, 0.2, 0.3], pos: [1.95, 2.02, 0.9], color: DARK });
  // navigation lights on the stabilator tips
  parts.push({ size: [0.06, 0.08, 0.14], pos: [1.46, 2.05, -7.8], color: 0xff2a1a, glow: 3 });
  parts.push({ size: [0.06, 0.08, 0.14], pos: [-1.46, 2.05, -7.8], color: 0x2bff6a, glow: 3 });
  return parts;
}

/** Four-blade main rotor with hub, centred on its own origin. */
export function uh60jRotor(): BoxPart[] {
  const parts: BoxPart[] = [
    { size: [0.9, 0.2, 0.9], pos: [0, 0, 0], color: DARK },
    { size: [0.5, 0.16, 0.5], pos: [0, 0.16, 0], color: GREY },
  ];
  const R = 5.9;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
    const rot: [number, number, number] = [0, -a, 0];
    parts.push({ size: [R - 0.5, 0.05, 0.42], pos: [c * (R / 2 + 0.25), 0.02, s * (R / 2 + 0.25)], color: 0x1c1f24, rot });
    parts.push({ size: [0.5, 0.055, 0.44], pos: [c * (R - 0.25), 0.02, s * (R - 0.25)], color: 0x8d9299, rot }); // swept tip cap
    parts.push({ size: [0.6, 0.12, 0.16], pos: [c * 0.7, 0, s * 0.7], color: GREY, rot });
  }
  return parts;
}

/** Four-blade tail rotor spinning about X, with red and yellow warning bands at the tips. */
export function uh60jTailRotor(): BoxPart[] {
  const parts: BoxPart[] = [{ size: [0.16, 0.26, 0.26], pos: [0, 0, 0], color: DARK, cyl: true }];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
    const rot: [number, number, number] = [a, 0, 0];
    const at = (r: number): [number, number, number] => [0, c * r, s * r];
    parts.push({ size: [0.05, 1.1, 0.2], pos: at(0.6), color: 0x1c1f24, rot });
    parts.push({ size: [0.056, 0.14, 0.204], pos: at(0.82), color: 0xd3191c, rot });
    parts.push({ size: [0.056, 0.14, 0.204], pos: at(1.06), color: 0xf2c21a, rot });
  }
  return parts;
}

export function uh60jLivery(): Livery {
  const white = '#e9edf0';
  return {
    labels: [
      { px: [1000, 170], draw: text('航空自衛隊', white, { spread: true }) },
      { px: [700, 130], draw: text('48-4580', white, { latin: true, weight: 700 }) },
      { px: [300, 130], draw: text('580', white, { latin: true, weight: 700 }) },
      { px: [200, 200], draw: roundel() },
      { px: [520, 110], draw: text('RESCUE', '#f2c21a', { latin: true }) },
    ],
    decals: [
      ...bothSides(0, 1.018, 1.14, 0.55, [1.5, 0.26]),
      ...bothSides(1, 0.328, 2.02, -5.2, [1.0, 0.19]),
      ...bothSides(2, 1.018, 1.3, 2.25, [0.5, 0.22]),
      ...bothSides(3, 0.568, 1.95, -3.6, [0.5, 0.5]),
      ...bothSides(4, 0.948, 1.3, 3.1, [0.62, 0.13]),
    ],
  };
}
