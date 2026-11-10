// World layout constants and small math helpers shared by every system.

export const N = 12; // blocks per side
export const BLOCK = 60; // block edge length (m)
export const ROAD = 16; // road width (m)
export const PITCH = BLOCK + ROAD;
export const HALF = (N * PITCH) / 2; // distance from origin to outer ring-road centre
export const CITY_EDGE = HALF + ROAD / 2;
export const WORLD_BOUND = CITY_EDGE + 48; // shoreline: nothing may go past this
export const CURB = 0.15;
export const LANE = 2.2; // lane centre offset from road centre
export const PARK_OFFSET = 6.6; // parked-car offset from road centre

/** World coordinate of road centre-line k (0..N). */
export const roadCoord = (k: number) => -HALF + k * PITCH;
/** Nearest road-line index to a coordinate. */
export const nearestRoad = (v: number) => Math.max(0, Math.min(N, Math.round((v + HALF) / PITCH)));
/** Block index containing coordinate (clamped). */
export const blockIndex = (v: number) => Math.max(0, Math.min(N - 1, Math.floor((v + HALF) / PITCH)));

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
export function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Deterministic PRNG so the city is identical on every load (needed for save/load). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
