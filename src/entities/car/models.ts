import { CarDef, CarBuilder, Paint, Rig, FIN, curve, rect, circle, poly, SANS, GOTHIC } from './CarKit';
import { Body, sectOf, wheel, wheelWell, seat, cockpit, mirror, lampStrip, flankStrip, flankX, sideBand, topBand, sillBand, windowCut, arch, seam, plate, WheelSpec } from './parts';

/** The road cars: liftback, luxury minivan, patrol saloon, high-roof ambulance and rescue tender. */

const BLACK = '#0a0a0b', DARK = 0x17181b;
const LAMP = 0xfff3d8, TAIL = 0xff1a14, AMBER = 0xffa62b, BEACON = 0xff2a1a;
/** Soft shadow under the waist that gives the flanks some shape even in flat light. */
const flankShade = (p: Paint, z0: number, len: number, y0: number, y1: number) =>
  p.shade(rect(z0, 0, len, y1), p.grad(0, y0, 0, y1, [[0, 'rgba(0,0,0,0.3)'], [0.4, 'rgba(0,0,0,0.06)'], [1, 'rgba(0,0,0,0)']]));

// ------------------------------------------------------------------ liftback (Prius, and the taxi built on it)
function prius(taxi: boolean): CarDef {
  const B: Body = {
    z0: -2.3, z1: 2.3, crown: 0.05, tuck: 0.035,
    top: curve([[-2.3, 0.98], [-2.12, 1.05], [-1.7, 1.17], [-1.0, 1.36], [-0.35, 1.43], [0.2, 1.34], [1.05, 0.95], [1.5, 0.87], [2.0, 0.78], [2.24, 0.7], [2.3, 0.64]]),
    belt: curve([[-2.3, 0.9], [-2.0, 1.0], [-1.0, 0.98], [0.9, 0.9], [1.05, 0.88], [1.5, 0.8], [2.0, 0.71], [2.3, 0.58]]),
    halfW: curve([[-2.3, 0.66], [-2.2, 0.78], [-2.0, 0.85], [-1.4, 0.885], [0, 0.89], [1.4, 0.885], [2.0, 0.84], [2.2, 0.76], [2.3, 0.62]]),
    roofW: curve([[-2.3, 0.6], [-2.0, 0.66], [-1.5, 0.62], [-0.3, 0.6], [0.3, 0.62], [1.05, 0.74], [1.5, 0.76], [2.0, 0.72], [2.3, 0.55]]),
    floor: curve([[-2.3, 0.36], [-2.1, 0.3], [-1.7, 0.2], [1.8, 0.2], [2.15, 0.24], [2.3, 0.3]]),
  };
  const sect = sectOf(B);
  const FA = 1.42, RA = -1.33, D = 0.68, TX = 0.775, AR = 0.385;
  const W: WheelSpec = { d: D, w: 0.215, rim: 0.48, style: 'twin' };
  const rig = new Rig();
  const spins = [[TX, FA], [-TX, FA], [TX, RA], [-TX, RA]].map(([x, z]) => rig.wheel([x, D / 2, z], D, z > 0));
  const FD = 0.98, MD = -0.1, RD = -0.98; // door edges
  const dFL = rig.door([0.855, 0.6, FD], 'swing', 1, 'front', 1.15), dFR = rig.door([-0.855, 0.6, FD], 'swing', -1, 'driver', 1.15);
  const dRL = rig.door([0.86, 0.6, MD], 'swing', 1, 'rear', 1.1), dRR = rig.door([-0.86, 0.6, MD], 'swing', -1, 'rear', 1.1);
  rig.seat = [-0.37, 0.4, 0.02];
  rig.driver = rig.bone(rig.seat);
  const noseZ = (x: number) => 0.07 * (1 - (x / 0.62) ** 2), tailZ = (x: number) => 0.05 * (1 - (x / 0.66) ** 2);

  return {
    key: 'prius', rig,
    extent: { z0: -2.34, z1: 2.34, hw: 0.92, h: 1.5, mirror: true },
    paint(p: Paint) {
      // --- flank
      p.view('L');
      p.put(rect(-2.4, 0, 4.8, 1.5), '#ffffff', FIN.metallic, true);
      flankShade(p, -2.4, 4.8, 0.2, 0.75);
      p.put(sillBand(sect, -2.3, 2.3, 0.085), BLACK, FIN.plastic);
      windowCut(p, sideBand(sect, -1.76, 0.95, 0.03, 0.055));
      p.put(sideBand(sect, 0.66, 0.97, 0.0, 0.02), '#0b0c0e', FIN.gloss); // mirror patch ahead of the door glass
      p.put(rect(-0.17, 0.93, 0.13, 0.48), '#0b0c0e', FIN.gloss); // B pillar
      p.put(sideBand(sect, -1.13, -1.0, 0.0, 0.03), '#0b0c0e', FIN.gloss); // rear door frame, hiding its handle
      p.line(sideBand(sect, -1.76, 0.95, 0.015, 0.04), 0.012, '#15171a', FIN.gloss);
      arch(p, FA, D / 2, AR, 0.035);
      arch(p, RA, D / 2, AR, 0.035);
      seam(p, [[FD, 0.3], [FD, 0.9]]);
      seam(p, [[MD, 0.3], [MD, 1.36]]);
      seam(p, [[RD, 0.72], [RD + 0.02, 1.0], [RD - 0.05, 1.12]]);
      seam(p, [[FD, 0.3], [RD + 0.06, 0.3]]);
      p.line(rect(0.02, 0.84, 0.17, 0.035, 0.015), 0.006, 'rgba(0,0,0,0.7)'); // flush handle
      p.line(rect(-1.92, 0.78, 0.17, 0.17, 0.035), 0.006, 'rgba(0,0,0,0.7)'); // filler flap
      p.put(poly([[2.3, 0.56], [2.02, 0.665], [1.86, 0.725], [1.9, 0.745], [2.3, 0.63]]), '#14171b', FIN.lens); // head lamp wraps round
      p.put(poly([[-2.3, 0.84], [-1.98, 0.9], [-1.86, 0.955], [-1.98, 0.965], [-2.3, 0.93]]), '#5d0b0f', FIN.lens);
      // --- from above
      p.view('top');
      p.put(rect(-2.4, -1, 4.8, 2), '#ffffff', FIN.metallic, true);
      p.put(rect(1.02, -0.8, 0.1, 1.6), BLACK, FIN.plastic); // scuttle
      windowCut(p, topBand(sect, 0.24, 1.04, 0.05));
      windowCut(p, topBand(sect, -1.8, -0.98, 0.06));
      seam(p, [[1.12, 0.76], [1.7, 0.73], [2.16, 0.6], [2.22, 0], [2.16, -0.6], [1.7, -0.73], [1.12, -0.76]]);
      seam(p, [[-0.94, 0.56], [-0.94, -0.56]]);
      p.put(rect(-2.3, -0.62, 0.2, 1.24), '#0b0c0e', FIN.gloss); // tail spoiler lip
      // --- nose
      p.view('front');
      p.put(rect(-1, 0, 2, 1.5), '#ffffff', FIN.metallic, true);
      p.put(poly([[-0.62, 0.61], [0.62, 0.61], [0.5, 0.545], [-0.5, 0.545]]), '#101216', FIN.lens);
      p.put(rect(-0.54, 0.285, 1.08, 0.17, 0.035), '#060607', FIN.plastic);
      for (let k = 0; k < 4; k++) p.put(rect(-0.5, 0.305 + k * 0.038, 1.0, 0.012), '#1d1f22', FIN.plastic);
      p.put(circle(0, 0.625, 0.022), '#c9ccd0', FIN.chrome);
      plate(p, 0, 0.445, 'なにわ 330', 'さ', '26-08');
      // --- tail
      p.view('rear');
      p.put(rect(-1, 0, 2, 1.5), '#ffffff', FIN.metallic, true);
      p.put(rect(-0.68, 0.835, 1.36, 0.075, 0.02), '#5d0b0f', FIN.lens);
      p.put(rect(-0.6, 0.72, 1.2, 0.115, 0.02), '#0b0c0e', FIN.gloss);
      p.text('PRIUS', 0, 0.775, 0.045, '#c5c8cc', { spread: 0.15, weight: 700 });
      p.put(rect(-0.7, 0.34, 1.4, 0.2, 0.03), BLACK, FIN.plastic);
      for (const s of [-1, 1]) p.put(rect(s * 0.5 - 0.07, 0.4, 0.14, 0.03), '#8f1014', FIN.lens);
      plate(p, 0, 0.62, 'なにわ 330', 'さ', '26-08');
    },
    build(b: CarBuilder, color: number) {
      b.hull({
        z0: B.z0, z1: B.z1, sect, color, breaks: [FD, MD, RD],
        doors: [{ za: MD, zb: FD, side: 1, bone: dFL }, { za: MD, zb: FD, side: -1, bone: dFR }, { za: RD, zb: MD, side: 1, bone: dRL }, { za: RD, zb: MD, side: -1, bone: dRR }],
        glassSide: [-1.82, 1.0], glassTop: [[0.2, 1.08], [-1.86, -0.94]], cabin: [-1.9, 1.02],
        glass: (z, top) => (z < MD ? [0x0b1014, 0.74] : top ? [0x1c2a31, 0.36] : [0x17232b, 0.42]),
        capFront: { bulge: noseZ }, capRear: { bulge: tailZ },
      });
      spins.forEach((bone, i) => {
        const x = i % 2 ? -TX : TX, z = i < 2 ? FA : RA, side = i % 2 ? -1 : 1;
        wheel(b, [x, D / 2, z], side, bone, W);
        wheelWell(b, side, [side * 0.87, D / 2, z], AR, 0.34);
      });
      // cabin
      b.box([1.64, 0.03, 3.0], [0, 0.25, -0.4], { color: 0x101113, fin: 'fabric' });
      b.box([1.6, 0.66, 0.03], [0, 0.58, 1.03], { color: 0x101113, fin: 'plastic' });
      b.box([1.5, 0.75, 0.03], [0, 0.63, -1.24], { color: 0x101113, fin: 'fabric', rot: [-0.2, 0, 0] });
      b.box([1.3, 0.03, 0.74], [0, 0.9, -1.6], { color: 0x101113, fin: 'fabric' }); // luggage cover
      b.box([0.22, 0.2, 1.0], [0, 0.4, 0.2], { color: DARK, fin: 'plastic', round: 0.4 }); // centre console
      for (const s of [-1, 1]) seat(b, s * 0.37, 0.4, 0.02, 0x202226);
      b.box([1.32, 0.15, 0.5], [0, 0.42, -0.84], { color: 0x202226, fin: 'fabric', round: 0.7 });
      b.box([1.32, 0.6, 0.14], [0, 0.76, -1.12], { color: 0x202226, fin: 'fabric', round: 0.7, rot: [-0.24, 0, 0] });
      cockpit(b, { seat: rig.seat, dashZ: 0.8, dashY: 0.8, hw: 0.76, driver: rig.driver });
      // exterior fittings
      mirror(b, 1, [flankX(sect, 0.82, 0.95), 0.96, 0.82], dFL, color);
      mirror(b, -1, [-flankX(sect, 0.82, 0.95), 0.96, 0.82], dFR, color);
      for (const s of [-1, 1]) {
        b.box([0.52, 0.014, 0.022], [s * 0.2 - 0.06, 0.975, 0.99], { color: 0x09090a, fin: 'plastic', rot: [0, 0.1, -0.03] }); // wipers
        lampStrip(b, s * 0.2, s * 0.56, 0.578, (x) => B.z1 + noseZ(x) - noseZ(0.6) + 0.004, [0.026, 0.012], LAMP, 3.2);
        flankStrip(b, sect, s, 2.28, 1.92, (z) => 0.6 + (2.3 - z) * 0.33, [0.022, 0.012], LAMP, 2.6);
        flankStrip(b, sect, s, -2.28, -1.9, (z) => 0.885 + (z + 2.3) * 0.16, [0.03, 0.012], TAIL, 1.8);
      }
      lampStrip(b, -0.64, 0.64, 0.872, (x) => B.z0 - tailZ(x) + tailZ(0.66) - 0.004, [0.028, 0.012], TAIL, 1.9, 8);
      b.box([0.05, 0.045, 0.16], [0, B.top(-1.05) + 0.015, -1.05], { color, fin: 'paint', round: 0.9 }); // aerial fin
      if (taxi) {
        b.box([0.34, 0.13, 0.13], [0, 1.5, -0.3], { color: 0xfff4b8, fin: 'lens', glow: 2.2, round: 0.5 });
        b.box([0.2, 0.03, 0.1], [0, 1.43, -0.3], { color: 0x0b0c0e, fin: 'plastic' });
      }
    },
  };
}

/** Carpet, bulkheads and the seats of an ordinary saloon. */
function saloonCabin(b: CarBuilder, rig: Rig, o: { hw: number; floorY: number; fire: number; back: number; frontZ: number; rearZ: number; dashZ: number; dashY: number; color?: number }) {
  const c = o.color ?? 0x202226;
  b.box([o.hw * 2, 0.03, o.fire - o.back + 0.7], [0, o.floorY, (o.fire + o.back) / 2 - 0.3], { color: 0x101113, fin: 'fabric' });
  b.box([o.hw * 2, 0.7, 0.03], [0, o.floorY + 0.35, o.fire], { color: 0x101113, fin: 'plastic' });
  b.box([o.hw * 1.9, 0.8, 0.03], [0, o.floorY + 0.4, o.back], { color: 0x101113, fin: 'fabric', rot: [-0.2, 0, 0] });
  b.box([0.22, 0.2, 1.0], [0, o.floorY + 0.15, o.frontZ + 0.2], { color: DARK, fin: 'plastic', round: 0.4 });
  for (const s of [-1, 1]) seat(b, s * Math.abs(rig.seat[0]), rig.seat[1], o.frontZ, c);
  b.box([o.hw * 1.7, 0.15, 0.5], [0, rig.seat[1] + 0.02, o.rearZ], { color: c, fin: 'fabric', round: 0.7 });
  b.box([o.hw * 1.7, 0.6, 0.14], [0, rig.seat[1] + 0.36, o.rearZ - 0.28], { color: c, fin: 'fabric', round: 0.7, rot: [-0.24, 0, 0] });
  cockpit(b, { seat: rig.seat, dashZ: o.dashZ, dashY: o.dashY, hw: o.hw - 0.06, driver: rig.driver });
}

// ------------------------------------------------------------------ luxury minivan (Alphard)
function alphard(): CarDef {
  const B: Body = {
    z0: -2.5, z1: 2.5, crown: 0.06, tuck: 0.03, re: 0.07,
    top: curve([[-2.5, 1.8], [-2.42, 1.87], [-2.0, 1.9], [0, 1.93], [0.75, 1.87], [1.0, 1.7], [1.55, 1.24], [2.0, 1.16], [2.42, 1.08], [2.5, 1.0]]),
    belt: curve([[-2.5, 1.2], [-1.0, 1.2], [1.2, 1.16], [1.55, 1.12], [2.0, 1.06], [2.5, 0.94]]),
    halfW: curve([[-2.5, 0.8], [-2.4, 0.89], [-2.1, 0.92], [0, 0.925], [1.9, 0.92], [2.3, 0.88], [2.42, 0.83], [2.5, 0.74]]),
    roofW: curve([[-2.5, 0.68], [-2.2, 0.74], [0.6, 0.74], [1.55, 0.8], [2.2, 0.78], [2.5, 0.66]]),
    floor: curve([[-2.5, 0.34], [-2.2, 0.24], [2.2, 0.24], [2.5, 0.3]]),
  };
  const sect = sectOf(B);
  const FA = 1.5, RA = -1.5, D = 0.74, TX = 0.8, AR = 0.42;
  const W: WheelSpec = { d: D, w: 0.235, rim: 0.48, style: 'alloy' };
  const rig = new Rig();
  const spins = [[TX, FA], [-TX, FA], [TX, RA], [-TX, RA]].map(([x, z]) => rig.wheel([x, D / 2, z], D, z > 0));
  const FD = 1.05, MD = 0.1, RD = -1.05;
  const dFL = rig.door([0.89, 0.7, FD], 'swing', 1, 'front', 1.15), dFR = rig.door([-0.89, 0.7, FD], 'swing', -1, 'driver', 1.15);
  const dRL = rig.door([0.89, 0.7, MD], 'slide', 1, 'rear', 1.0), dRR = rig.door([-0.89, 0.7, MD], 'slide', -1, 'rear', 1.0);
  const gate = rig.door([0, 1.84, -2.5], 'lift', 0, 'hatch', 1.4);
  rig.seat = [-0.42, 0.62, 0.55];
  rig.driver = rig.bone(rig.seat);
  const noseZ = (x: number) => 0.06 * (1 - (x / 0.74) ** 2), tailZ = (x: number) => 0.04 * (1 - (x / 0.8) ** 2);

  return {
    key: 'alphard', rig,
    extent: { z0: -2.54, z1: 2.54, hw: 0.95, h: 1.98, mirror: true },
    paint(p: Paint) {
      p.view('L');
      p.put(rect(-2.6, 0, 5.2, 2), '#ffffff', FIN.metallic, true);
      flankShade(p, -2.6, 5.2, 0.24, 0.9);
      p.put(sillBand(sect, -2.5, 2.5, 0.07), BLACK, FIN.plastic);
      p.put(rect(-1.05, 0.33, 2.55, 0.03), '#d3d6d9', FIN.chrome);
      windowCut(p, sideBand(sect, -2.32, 1.5, 0.035, 0.065));
      p.put(sideBand(sect, 1.2, 1.52, 0.0, 0.02), '#0b0c0e', FIN.gloss);
      p.put(rect(MD - 0.09, 1.2, 0.17, 0.7), '#0b0c0e', FIN.gloss); // B pillar
      p.put(rect(RD - 0.08, 1.2, 0.15, 0.7), '#0b0c0e', FIN.gloss); // C pillar
      p.put(sideBand(sect, -2.5, -2.2, 0.0, 0.0), '#0b0c0e', FIN.gloss); // D pillar
      p.line(sideBand(sect, -2.32, 1.5, 0.012, 0.045), 0.02, '#d3d6d9', FIN.chrome);
      arch(p, FA, D / 2, AR);
      arch(p, RA, D / 2, AR);
      seam(p, [[FD, 0.34], [FD, 1.14]]);
      seam(p, [[MD, 0.34], [MD, 1.86]]);
      seam(p, [[RD, 0.82], [RD, 1.86]]);
      seam(p, [[FD, 0.34], [RD + 0.1, 0.34]]);
      seam(p, [[RD, 1.1], [-2.2, 1.1]], 0.02); // slide rail
      p.put(rect(0.3, 1.02, 0.2, 0.04, 0.02), '#d3d6d9', FIN.chrome);
      p.put(rect(-0.15, 1.02, 0.2, 0.04, 0.02), '#d3d6d9', FIN.chrome);
      p.line(rect(-2.1, 0.95, 0.18, 0.18, 0.03), 0.006, 'rgba(0,0,0,0.7)');
      p.put(poly([[2.5, 0.92], [2.1, 1.02], [1.95, 1.07], [2.1, 1.09], [2.5, 1.0]]), '#14171b', FIN.lens);
      p.put(poly([[-2.5, 1.07], [-2.14, 1.09], [-2.1, 1.16], [-2.5, 1.19]]), '#5d0b0f', FIN.lens);
      p.view('top');
      p.put(rect(-2.6, -1, 5.2, 2), '#ffffff', FIN.metallic, true);
      p.put(rect(1.5, -0.86, 0.1, 1.72), BLACK, FIN.plastic);
      windowCut(p, topBand(sect, 0.8, 1.53, 0.06));
      seam(p, [[1.62, 0.8], [2.2, 0.78], [2.42, 0.6], [2.44, 0], [2.42, -0.6], [2.2, -0.78], [1.62, -0.8]]);
      p.put(rect(-0.75, -0.42, 1.25, 0.84, 0.06), '#0b0c0e', FIN.gloss); // twin moonroof
      p.put(rect(-0.14, -0.42, 0.06, 0.84), '#17191c', FIN.plastic);
      p.view('front');
      p.put(rect(-1, 0, 2, 2), '#ffffff', FIN.metallic, true);
      p.put(poly([[-0.74, 0.97], [0.74, 0.97], [0.7, 0.5], [0.56, 0.3], [-0.56, 0.3], [-0.7, 0.5]]), '#08090a', FIN.gloss);
      for (let r = 0; r < 9; r++)
        for (let k = -9; k <= 9; k++) {
          const x = (k + (r % 2) * 0.5) * 0.074, y = 0.36 + r * 0.066;
          if (Math.abs(x) < 0.68 - Math.max(0, 0.5 - y) * 0.7) p.put(rect(x - 0.026, y, 0.052, 0.022, 0.006), '#c3c6ca', FIN.chrome);
        }
      p.put(circle(0, 0.86, 0.05), '#d3d6d9', FIN.chrome);
      p.put(circle(0, 0.86, 0.034), '#101113', FIN.gloss);
      for (const s of [-1, 1]) p.put(poly([[s * 0.74, 0.97], [s * 0.3, 0.97], [s * 0.34, 0.925], [s * 0.74, 0.9]]), '#14171b', FIN.lens);
      plate(p, 0, 0.44, 'なにわ 300', 'ろ', '88-01');
      p.view('rear');
      p.put(rect(-1, 0, 2, 2), '#ffffff', FIN.metallic, true);
      windowCut(p, rect(-0.7, 1.26, 1.4, 0.5, 0.06));
      p.put(rect(-0.82, 1.09, 1.64, 0.1, 0.03), '#5d0b0f', FIN.lens);
      p.put(rect(-0.4, 1.1, 0.8, 0.08, 0.02), '#2a0607', FIN.lens);
      p.text('ALPHARD', 0, 1.14, 0.04, '#d8dadd', { spread: 0.1 });
      for (const s of [-1, 1]) {
        p.put(poly([[s * 0.82, 1.09], [s * 0.7, 1.09], [s * 0.76, 0.92], [s * 0.82, 0.9]]), '#5d0b0f', FIN.lens);
        p.put(rect(s * 0.74 - 0.02, 0.44, 0.04, 0.3, 0.01), '#8f1014', FIN.lens);
      }
      seam(p, [[-0.8, 0.64], [0.8, 0.64]]);
      p.put(rect(-0.78, 0.36, 1.56, 0.03), '#d3d6d9', FIN.chrome);
      plate(p, 0, 0.86, 'なにわ 300', 'ろ', '88-01');
    },
    build(b: CarBuilder, color: number) {
      b.hull({
        z0: B.z0, z1: B.z1, sect, color, breaks: [FD, MD, RD],
        doors: [{ za: MD, zb: FD, side: 1, bone: dFL }, { za: MD, zb: FD, side: -1, bone: dFR }, { za: RD, zb: MD, side: 1, bone: dRL }, { za: RD, zb: MD, side: -1, bone: dRR }],
        glassSide: [-2.38, 1.54], glassTop: [[0.76, 1.58]], cabin: [-2.48, 1.5], trim: 0x2a2623, headliner: 0xb9b2a4,
        glass: (z, top) => (z < MD ? [0x090d10, 0.8] : top ? [0x1c2a31, 0.36] : [0x17232b, 0.42]),
        capFront: { bulge: noseZ }, capRear: { bulge: tailZ, glass: true, inner: true, door: { bone: gate, yMin: 0.64 } },
      });
      spins.forEach((bone, i) => {
        const side = i % 2 ? -1 : 1, z = i < 2 ? FA : RA;
        wheel(b, [side * TX, D / 2, z], side, bone, W);
        wheelWell(b, side, [side * 0.9, D / 2, z], AR, 0.36);
      });
      const tan = 0x6b5a48;
      b.box([1.72, 0.03, 4.3], [0, 0.4, -0.35], { color: 0x15130f, fin: 'fabric' });
      b.box([1.7, 0.8, 0.03], [0, 0.78, 1.52], { color: 0x101113, fin: 'plastic' });
      b.box([0.26, 0.24, 0.9], [0, 0.55, 0.7], { color: DARK, fin: 'plastic', round: 0.4 });
      for (const s of [-1, 1]) {
        seat(b, s * 0.42, 0.62, 0.55, tan, 0.54);
        seat(b, s * 0.42, 0.62, -0.5, tan, 0.56);
      }
      b.box([1.5, 0.15, 0.5], [0, 0.64, -1.5], { color: tan, fin: 'fabric', round: 0.7 });
      b.box([1.5, 0.62, 0.14], [0, 1.0, -1.78], { color: tan, fin: 'fabric', round: 0.7, rot: [-0.18, 0, 0] });
      cockpit(b, { seat: rig.seat, dashZ: 1.28, dashY: 1.02, hw: 0.82, driver: rig.driver });
      mirror(b, 1, [flankX(sect, 0.98, 1.2), 1.24, 0.98], dFL, color, [0.22, 0.15, 0.1]);
      mirror(b, -1, [-flankX(sect, 0.98, 1.2), 1.24, 0.98], dFR, color, [0.22, 0.15, 0.1]);
      for (const s of [-1, 1]) {
        b.box([0.6, 0.014, 0.022], [s * 0.24 - 0.08, 1.26, 1.5], { color: 0x09090a, fin: 'plastic', rot: [0, 0.08, -0.03] });
        lampStrip(b, s * 0.32, s * 0.7, 0.948, (x) => B.z1 + noseZ(x) - noseZ(0.72) + 0.004, [0.03, 0.012], LAMP, 3.2);
        flankStrip(b, sect, s, 2.48, 2.12, (z) => 0.955 + (2.5 - z) * 0.3, [0.026, 0.012], LAMP, 2.6);
        b.box([0.03, 0.24, 0.014], [s * 0.66, 0.55, B.z1 + noseZ(0.66) - noseZ(0.72) + 0.006], { color: LAMP, fin: 'lens', glow: 2.6 });
        flankStrip(b, sect, s, -2.48, -2.14, () => 1.09, [0.03, 0.012], TAIL, 1.8);
      }
      lampStrip(b, -0.8, -0.42, 1.14, (x) => B.z0 - tailZ(x) + tailZ(0.8) - 0.004, [0.036, 0.012], TAIL, 1.9, 3);
      lampStrip(b, 0.42, 0.8, 1.14, (x) => B.z0 - tailZ(x) + tailZ(0.8) - 0.004, [0.036, 0.012], TAIL, 1.9, 3);
      b.box([1.36, 0.04, 0.3], [0, 1.89, -2.44], { color, fin: 'paint', round: 0.6, bone: gate, rot: [-0.12, 0, 0] });
    },
  };
}

// ------------------------------------------------------------------ patrol saloon (Osaka Prefectural Police)
function patrol(): CarDef {
  const B: Body = {
    z0: -2.425, z1: 2.425, crown: 0.05, tuck: 0.035,
    top: curve([[-2.425, 0.96], [-2.3, 1.03], [-1.75, 1.07], [-1.0, 1.4], [-0.2, 1.455], [0.3, 1.39], [1.05, 0.98], [1.8, 0.89], [2.3, 0.77], [2.425, 0.7]]),
    belt: curve([[-2.425, 0.9], [-1.75, 0.99], [-1.0, 0.97], [0.9, 0.93], [1.05, 0.91], [1.8, 0.83], [2.425, 0.62]]),
    halfW: curve([[-2.425, 0.68], [-2.3, 0.8], [-2.0, 0.87], [-1.2, 0.895], [0, 0.9], [1.4, 0.895], [2.1, 0.85], [2.3, 0.78], [2.425, 0.64]]),
    roofW: curve([[-2.425, 0.62], [-1.9, 0.72], [-1.75, 0.7], [-1.0, 0.6], [0.3, 0.6], [1.05, 0.74], [1.8, 0.76], [2.425, 0.56]]),
    floor: curve([[-2.425, 0.36], [-2.15, 0.26], [-1.7, 0.2], [1.8, 0.2], [2.2, 0.24], [2.425, 0.3]]),
  };
  const sect = sectOf(B);
  const FA = 1.47, RA = -1.43, D = 0.68, TX = 0.78, AR = 0.39;
  const W: WheelSpec = { d: D, w: 0.215, rim: 0.43, style: 'alloy' };
  const rig = new Rig();
  const spins = [[TX, FA], [-TX, FA], [TX, RA], [-TX, RA]].map(([x, z]) => rig.wheel([x, D / 2, z], D, z > 0));
  const FD = 1.02, MD = -0.08, RD = -1.0;
  const dFL = rig.door([0.865, 0.6, FD], 'swing', 1, 'front', 1.15), dFR = rig.door([-0.865, 0.6, FD], 'swing', -1, 'driver', 1.15);
  const dRL = rig.door([0.87, 0.6, MD], 'swing', 1, 'rear', 1.1), dRR = rig.door([-0.87, 0.6, MD], 'swing', -1, 'rear', 1.1);
  rig.seat = [-0.38, 0.42, 0.05];
  rig.driver = rig.bone(rig.seat);
  const noseZ = (x: number) => 0.07 * (1 - (x / 0.64) ** 2), tailZ = (x: number) => 0.05 * (1 - (x / 0.68) ** 2);
  const split = curve([[-2.425, 0.79], [-1.5, 0.75], [1.5, 0.71], [2.425, 0.6]]); // where black meets white
  const WHITE = '#f2f2ef', PANDA = '#0e0f11';

  return {
    key: 'police', rig,
    extent: { z0: -2.47, z1: 2.47, hw: 0.93, h: 1.52, mirror: false },
    paint(p: Paint) {
      for (const v of ['L', 'R'] as const) {
        p.view(v);
        p.put(rect(-2.5, 0, 5, 1.6), WHITE, FIN.paint);
        p.put((c) => {
          c.moveTo(-2.5, 0);
          for (let k = 0; k <= 30; k++) c.lineTo(-2.5 + k / 6, split(-2.5 + k / 6));
          c.lineTo(2.5, 0);
          c.closePath();
        }, PANDA, FIN.paint);
        flankShade(p, -2.5, 5, 0.2, 0.7);
        windowCut(p, sideBand(sect, -1.52, 0.99, 0.03, 0.055));
        p.put(sideBand(sect, 0.72, 1.0, 0.0, 0.02), '#0b0c0e', FIN.gloss);
        p.put(rect(MD - 0.07, 0.95, 0.13, 0.5), '#0b0c0e', FIN.gloss);
        p.line(sideBand(sect, -1.52, 0.99, 0.012, 0.04), 0.014, '#cfd2d6', FIN.chrome);
        arch(p, FA, D / 2, AR);
        arch(p, RA, D / 2, AR);
        seam(p, [[FD, 0.3], [FD, 0.93]]);
        seam(p, [[MD, 0.3], [MD, 1.38]]);
        seam(p, [[RD, 0.74], [RD + 0.02, 1.0], [RD - 0.1, 1.2]]);
        seam(p, [[FD, 0.3], [RD + 0.06, 0.3]]);
        for (const z of [0.1, -0.86]) p.put(rect(z, 0.865, 0.16, 0.03, 0.012), '#cfd2d6', FIN.chrome);
        p.text('大阪府警', -0.06, 0.825, 0.105, '#15171a', { font: GOTHIC, weight: 900, spread: 0.42 });
        p.text('POLICE', -0.06, 0.5, 0.1, '#f2f2f2', { font: '"Arial Black","Arial",sans-serif', weight: 900, spread: 0.16 });
        p.put(poly([[2.425, 0.62], [2.1, 0.74], [1.9, 0.8], [1.95, 0.83], [2.425, 0.7]]), '#14171b', FIN.lens);
        p.put(poly([[-2.425, 0.74], [-2.05, 0.78], [-2.0, 0.9], [-2.425, 0.88]]), '#5d0b0f', FIN.lens);
      }
      p.view('top');
      p.put(rect(-2.5, -1, 5, 2), WHITE, FIN.paint);
      p.put(rect(1.03, -0.8, 0.09, 1.6), BLACK, FIN.plastic);
      windowCut(p, topBand(sect, 0.32, 1.05, 0.05));
      windowCut(p, topBand(sect, -1.7, -1.04, 0.06));
      seam(p, [[1.14, 0.76], [1.9, 0.74], [2.3, 0.6], [2.36, 0], [2.3, -0.6], [1.9, -0.74], [1.14, -0.76]]);
      seam(p, [[-1.76, 0.68], [-2.3, 0.66], [-2.36, 0], [-2.3, -0.66], [-1.76, -0.68], [-1.76, 0.68]]);
      p.view('front');
      p.put(rect(-1, 0, 2, 1.6), PANDA, FIN.paint);
      p.put(rect(-1, 0.66, 2, 1), WHITE, FIN.paint);
      p.put(poly([[-0.44, 0.65], [0.44, 0.65], [0.36, 0.48], [-0.36, 0.48]]), '#050506', FIN.gloss);
      p.line(poly([[-0.44, 0.65], [0.44, 0.65], [0.36, 0.48], [-0.36, 0.48]]), 0.014, '#cfd2d6', FIN.chrome);
      for (let k = 0; k < 4; k++) p.put(rect(-0.4, 0.5 + k * 0.038, 0.8, 0.008), '#3a3d42', FIN.chrome);
      p.put(circle(0, 0.575, 0.04), '#c9a227', FIN.chrome); // badge
      for (const s of [-1, 1]) p.put(poly([[s * 0.64, 0.66], [s * 0.46, 0.66], [s * 0.42, 0.56], [s * 0.64, 0.58]]), '#14171b', FIN.lens);
      p.put(rect(-0.56, 0.3, 1.12, 0.07, 0.02), '#050506', FIN.plastic);
      plate(p, 0, 0.42, '大阪 800', 'た', '11-10');
      p.view('rear');
      p.put(rect(-1, 0, 2, 1.6), PANDA, FIN.paint);
      p.put(rect(-1, 0.77, 2, 1), WHITE, FIN.paint);
      for (const s of [-1, 1]) {
        p.put(rect(s * 0.47 - 0.2, 0.72, 0.4, 0.13, 0.03), '#5d0b0f', FIN.lens);
        p.put(rect(s * 0.25 - 0.05, 0.74, 0.1, 0.09, 0.02), '#d9dbdd', FIN.lens);
      }
      p.text('大阪府警', 0, 0.9, 0.05, '#15171a', { font: GOTHIC, weight: 900, spread: 0.1 });
      p.put(rect(-0.6, 0.36, 1.2, 0.05, 0.02), '#050506', FIN.plastic);
      plate(p, 0, 0.56, '大阪 800', 'た', '11-10');
    },
    build(b: CarBuilder) {
      const color = 0xffffff, white = 0xf2f2ef;
      b.hull({
        z0: B.z0, z1: B.z1, sect, color, breaks: [FD, MD, RD],
        doors: [{ za: MD, zb: FD, side: 1, bone: dFL }, { za: MD, zb: FD, side: -1, bone: dFR }, { za: RD, zb: MD, side: 1, bone: dRL }, { za: RD, zb: MD, side: -1, bone: dRR }],
        glassSide: [-1.58, 1.04], glassTop: [[0.28, 1.1], [-1.76, -1.0]], cabin: [-1.7, 1.04],
        glass: (z, top) => (top ? [0x1c2a31, 0.36] : [0x17232b, 0.42]),
        capFront: { bulge: noseZ }, capRear: { bulge: tailZ },
      });
      spins.forEach((bone, i) => {
        const side = i % 2 ? -1 : 1, z = i < 2 ? FA : RA;
        wheel(b, [side * TX, D / 2, z], side, bone, W);
        wheelWell(b, side, [side * 0.88, D / 2, z], AR, 0.34);
      });
      saloonCabin(b, rig, { hw: 0.82, floorY: 0.25, fire: 1.04, back: -1.28, frontZ: 0.05, rearZ: -0.85, dashZ: 0.8, dashY: 0.82 });
      mirror(b, 1, [flankX(sect, 0.84, 0.97), 0.99, 0.84], dFL, white);
      mirror(b, -1, [-flankX(sect, 0.84, 0.97), 0.99, 0.84], dFR, white);
      // roof beacon: white pedestal, red bar with a chrome centre and a speaker ahead of it
      b.box([0.95, 0.1, 0.5], [0, 1.5, -0.2], { color: white, fin: 'paint', round: 0.5 });
      b.box([1.24, 0.13, 0.3], [0, 1.62, -0.2], { color: BEACON, fin: 'lens', glow: 3.2, round: 0.7 });
      b.box([0.16, 0.14, 0.32], [0, 1.62, -0.2], { color: 0xcfd2d6, fin: 'chrome' });
      b.box([0.2, 0.08, 0.14], [0, 1.6, 0.04], { color: 0x101113, fin: 'plastic', round: 0.5 });
      for (const s of [-1, 1]) {
        b.box([0.52, 0.014, 0.022], [s * 0.2 - 0.06, 1.005, 1.01], { color: 0x09090a, fin: 'plastic', rot: [0, 0.1, -0.03] });
        lampStrip(b, s * 0.46, s * 0.6, 0.615, (x) => B.z1 + noseZ(x) - noseZ(0.62) + 0.004, [0.05, 0.012], LAMP, 3.2, 2);
        flankStrip(b, sect, s, 2.4, 2.02, (z) => 0.66 + (2.425 - z) * 0.33, [0.03, 0.012], LAMP, 2.6);
        b.box([0.1, 0.06, 0.02], [s * 0.2, 0.56, B.z1 + noseZ(0.2) - noseZ(0.62) + 0.01], { color: BEACON, fin: 'lens', glow: 2.8 });
        lampStrip(b, s * 0.3, s * 0.64, 0.79, (x) => B.z0 - tailZ(x) + tailZ(0.66) - 0.004, [0.07, 0.012], TAIL, 1.8, 3);
      }
    },
  };
}

// ------------------------------------------------------------------ high-roof ambulance (Osaka Municipal Fire Department)
function ambulance(): CarDef {
  const B: Body = {
    z0: -2.8, z1: 2.8, crown: 0.06, tuck: 0.02, re: 0.09,
    top: curve([[-2.8, 2.36], [-2.7, 2.46], [-2.3, 2.5], [0.9, 2.5], [1.3, 2.42], [1.72, 2.0], [2.3, 1.24], [2.62, 1.14], [2.8, 1.02]]),
    belt: curve([[-2.8, 1.26], [1.9, 1.26], [2.3, 1.2], [2.8, 0.98]]),
    halfW: curve([[-2.8, 0.9], [-2.7, 0.955], [-2.4, 0.975], [2.0, 0.975], [2.5, 0.95], [2.7, 0.9], [2.8, 0.82]]),
    roofW: curve([[-2.8, 0.8], [-2.5, 0.86], [1.3, 0.86], [1.72, 0.8], [2.3, 0.84], [2.8, 0.72]]),
    floor: curve([[-2.8, 0.46], [-2.5, 0.36], [2.4, 0.36], [2.8, 0.42]]),
  };
  const sect = sectOf(B);
  const FA = 1.95, RA = -1.25, D = 0.78, TX = 0.85, AR = 0.45;
  const W: WheelSpec = { d: D, w: 0.21, rim: 0.42, style: 'steel' };
  const rig = new Rig();
  const spins = [[TX, FA], [-TX, FA], [TX, RA], [-TX, RA]].map(([x, z]) => rig.wheel([x, D / 2, z], D, z > 0));
  const FD = 2.25, MD = 1.05, SD = 0.95, SE = -0.3; // cab door, then the sliding door on the kerb side
  const dFL = rig.door([0.95, 0.8, FD], 'swing', 1, 'front', 1.15), dFR = rig.door([-0.95, 0.8, FD], 'swing', -1, 'driver', 1.15);
  const dS = rig.door([0.95, 0.8, SD], 'slide', 1, 'rear', 1.15);
  const gate = rig.door([0, 2.32, -2.8], 'lift', 0, 'hatch', 1.45);
  rig.seat = [-0.45, 0.82, 1.45];
  rig.driver = rig.bone(rig.seat);
  const noseZ = (x: number) => 0.06 * (1 - (x / 0.82) ** 2), tailZ = (x: number) => 0.03 * (1 - (x / 0.9) ** 2);
  const WHITE = '#f3f3f0', BLUE = '#1f3fae', INK = '#15171a';
  const shield = (p: Paint, z: number, y: number, s: number) => {
    p.put(poly([[z - s * 0.4, y + s * 0.5], [z + s * 0.4, y + s * 0.5], [z + s * 0.4, y - s * 0.1], [z, y - s * 0.5], [z - s * 0.4, y - s * 0.1]]), '#1b3f9c', FIN.paint);
    p.line(poly([[z - s * 0.4, y + s * 0.5], [z + s * 0.4, y + s * 0.5], [z + s * 0.4, y - s * 0.1], [z, y - s * 0.5], [z - s * 0.4, y - s * 0.1]]), s * 0.07, '#f2c21a');
    p.line(poly([[z - s * 0.2, y + s * 0.3], [z + s * 0.2, y - s * 0.12]], false), s * 0.07, '#f2c21a');
    p.line(poly([[z + s * 0.2, y + s * 0.3], [z - s * 0.2, y - s * 0.12]], false), s * 0.07, '#f2c21a');
  };

  return {
    key: 'ambulance', rig,
    extent: { z0: -2.84, z1: 2.86, hw: 1.0, h: 2.56, mirror: false },
    paint(p: Paint) {
      for (const v of ['L', 'R'] as const) {
        const dir = v === 'L' ? 1 : -1; // lettering reads from the left of the picture, whichever way the van faces
        p.view(v);
        p.put(rect(-2.9, 0, 5.8, 2.6), WHITE, FIN.paint);
        flankShade(p, -2.9, 5.8, 0.36, 1.0);
        p.put(sillBand(sect, -2.8, 2.8, 0.06), '#b9bcc0', FIN.plastic);
        for (const y of [1.17, 1.215]) p.put(rect(-2.8, y, 5.4, 0.018), '#c3c6ca', FIN.paint);
        windowCut(p, sideBand(sect, 1.14, 2.22, 0.07, 0.08, 1.95));
        for (const [z, w] of [[-0.2, 1.05], [-1.38, 1.02], [-2.5, 0.98]] as [number, number][]) windowCut(p, rect(z, 1.34, w, 0.6, 0.07));
        arch(p, FA, D / 2, AR);
        arch(p, RA, D / 2, AR);
        seam(p, [[FD, 0.84], [FD, 1.24]]);
        seam(p, [[MD, 0.42], [MD, 2.02], [1.75, 2.02]]);
        if (v === 'L') {
          seam(p, [[SD, 0.42], [SD, 2.02], [SE, 2.02], [SE, 0.42]]);
          seam(p, [[SE, 1.28], [-1.6, 1.28]], 0.02);
          p.put(rect(0.72, 1.06, 0.05, 0.16, 0.02), '#cfd2d6', FIN.chrome);
        }
        p.put(rect(1.2, 1.12, 0.17, 0.035, 0.015), '#cfd2d6', FIN.chrome);
        p.text('OSAKA FIRE DEPT. AMBULANCE', -0.75, 2.17, 0.105, BLUE, { weight: 700, maxW: 3.4 });
        p.text('大阪市消防局', -0.78, 0.99, 0.15, INK, { font: GOTHIC, weight: 900, spread: 0.26 });
        shield(p, 1.62 + dir * 0.2, 1.0, 0.2);
        p.text('A 350', 1.62 - dir * 0.13, 0.99, 0.1, '#d3191c', { weight: 700 });
        p.put(rect(-2.6, 0.92, 0.36, 0.11, 0.01), '#f08a1c', FIN.paint);
        p.put(poly([[2.8, 0.86], [2.5, 0.9], [2.42, 1.04], [2.8, 1.0]]), '#d9dcdf', FIN.lens);
        p.put(rect(-2.8, 0.9, 0.08, 0.42), '#8f1014', FIN.lens);
      }
      p.view('top');
      p.put(rect(-2.9, -1.05, 5.8, 2.1), WHITE, FIN.paint);
      p.put(rect(2.26, -0.88, 0.1, 1.76), BLACK, FIN.plastic);
      windowCut(p, topBand(sect, 1.76, 2.3, 0.07));
      seam(p, [[2.4, 0.84], [2.74, 0.7], [2.76, 0], [2.74, -0.7], [2.4, -0.84]]);
      p.view('front');
      p.put(rect(-1.05, 0, 2.1, 2.6), WHITE, FIN.paint);
      p.put(rect(-0.52, 0.85, 1.04, 0.13, 0.03), '#111214', FIN.plastic);
      for (const y of [0.87, 0.905, 0.94]) p.put(rect(-0.5, y, 1.0, 0.016), '#d3d6d9', FIN.chrome);
      p.put(circle(0, 0.915, 0.055), '#d8dadd', FIN.chrome);
      for (const s of [-1, 1]) {
        p.put(rect(s * 0.67 - 0.14, 0.84, 0.28, 0.15, 0.03), '#d9dcdf', FIN.lens);
        p.put(circle(s * 0.62, 0.52, 0.045), '#d9dcdf', FIN.lens);
      }
      p.put(rect(-0.5, 0.47, 1.0, 0.1, 0.02), '#111214', FIN.plastic);
      p.put(rect(-0.82, 0.42, 1.64, 0.03), '#b9bcc0', FIN.plastic);
      plate(p, 0.24, 0.66, 'なにわ 800', 'す', '72-58');
      p.view('rear');
      p.put(rect(-1.05, 0, 2.1, 2.6), WHITE, FIN.paint);
      windowCut(p, rect(-0.74, 1.38, 1.48, 0.6, 0.07));
      p.text('AMBULANCE', 0, 2.16, 0.13, BLUE, { weight: 700, maxW: 1.5 });
      p.text('大阪市消防局', 0, 1.15, 0.12, INK, { font: GOTHIC, weight: 900, spread: 0.2 });
      for (const s of [-1, 1]) {
        p.put(rect(s * 0.85 - 0.05, 0.9, 0.1, 0.44, 0.02), '#8f1014', FIN.lens);
        p.put(rect(s * 0.85 - 0.05, 1.36, 0.1, 0.12, 0.02), '#c27616', FIN.lens);
      }
      seam(p, [[-0.86, 0.66], [0.86, 0.66]]);
      p.put(rect(-0.9, 0.44, 1.8, 0.14, 0.02), '#c9ccd0', FIN.steel);
      p.put(rect(-0.2, 0.84, 0.4, 0.04, 0.02), '#cfd2d6', FIN.chrome);
      plate(p, 0, 0.74, 'なにわ 800', 'す', '72-58');
    },
    build(b: CarBuilder) {
      const color = 0xffffff, white = 0xf3f3f0;
      b.hull({
        z0: B.z0, z1: B.z1, sect, color, breaks: [FD, MD, SD, SE],
        doors: [{ za: MD, zb: FD, side: 1, bone: dFL }, { za: MD, zb: FD, side: -1, bone: dFR }, { za: SE, zb: SD, side: 1, bone: dS }],
        glassSide: [-2.6, 2.26], glassTop: [[1.72, 2.34]], cabin: [-2.76, 2.3], trim: 0x8d9296, headliner: 0xd6d6d0,
        glass: (z, top) => (z < 1.0 ? [0x070a0d, 0.82] : top ? [0x1c2a31, 0.36] : [0x17232b, 0.42]),
        capFront: { bulge: noseZ }, capRear: { bulge: tailZ, glass: true, inner: true, door: { bone: gate, yMin: 0.68 } },
      });
      spins.forEach((bone, i) => {
        const side = i % 2 ? -1 : 1, z = i < 2 ? FA : RA;
        wheel(b, [side * TX, D / 2, z], side, bone, W);
        wheelWell(b, side, [side * 0.95, D / 2, z], AR, 0.36);
      });
      // cab, partition, then the treatment room with its stretcher and attendant's bench
      b.box([1.84, 0.03, 5.3], [0, 0.52, -0.2], { color: 0x8a8f94, fin: 'plastic' });
      b.box([1.8, 0.9, 0.03], [0, 0.95, 2.32], { color: 0x101113, fin: 'plastic' });
      b.box([1.8, 1.5, 0.04], [0, 1.28, 1.0], { color: 0xc9ccd0, fin: 'plastic' });
      for (const s of [-1, 1]) seat(b, s * 0.45, 0.82, 1.45, 0x2a2d33, 0.5);
      cockpit(b, { seat: rig.seat, dashZ: 2.08, dashY: 1.12, hw: 0.86, driver: rig.driver });
      b.box([0.56, 0.06, 1.95], [0.28, 0.98, -1.25], { color: 0xd8dadd, fin: 'steel', round: 0.4 });
      b.box([0.5, 0.1, 1.85], [0.28, 1.06, -1.25], { color: 0xe0762a, fin: 'fabric', round: 0.7 });
      b.box([0.44, 0.1, 0.4], [0.28, 1.16, -0.5], { color: 0xf1f1ee, fin: 'fabric', round: 0.8 });
      for (const z of [-0.4, -2.1]) b.box([0.5, 0.42, 0.04], [0.28, 0.76, z], { color: 0xb9bcc0, fin: 'steel' });
      b.box([0.42, 0.42, 1.7], [-0.66, 0.74, -1.3], { color: 0x2f4a78, fin: 'fabric', round: 0.3 });
      b.box([0.1, 0.5, 1.7], [-0.86, 1.2, -1.3], { color: 0x2f4a78, fin: 'fabric', round: 0.5 });
      mirror(b, 1, [flankX(sect, 2.1, 1.4), 1.48, 2.1], dFL, 0xd8dadd, [0.12, 0.25, 0.1]);
      mirror(b, -1, [-flankX(sect, 2.1, 1.4), 1.48, 2.1], dFR, 0xd8dadd, [0.12, 0.25, 0.1]);
      // beacons: the wide lens across the roof front and one on each rear corner
      const slope = Math.atan2(B.top(1.25) - B.top(1.65), 0.4);
      b.box([1.56, 0.12, 0.62], [0, (B.top(1.25) + B.top(1.65)) / 2 + 0.03, 1.45], { color: BEACON, fin: 'lens', glow: 2.6, round: 0.8, rot: [slope, 0, 0] });
      b.box([1.56, 0.1, 0.4], [0, 2.53, 0.95], { color: BEACON, fin: 'lens', glow: 2.6, round: 0.8 });
      b.box([1.64, 0.03, 1.1], [0, 2.47, 1.2], { color: 0x101113, fin: 'plastic', rot: [slope * 0.5, 0, 0] });
      for (const s of [-1, 1]) {
        b.box([0.44, 0.17, 0.66], [s * 0.6, 2.53, -2.4], { color: BEACON, fin: 'lens', glow: 2.6, round: 0.8, bone: 0 });
        b.box([0.7, 0.014, 0.022], [s * 0.3 - 0.1, 1.27, 2.3], { color: 0x09090a, fin: 'plastic', rot: [0, 0.06, -0.03] });
        b.box([0.24, 0.1, 0.014], [s * 0.67, 0.915, B.z1 + noseZ(0.67) - noseZ(0.8) + 0.006], { color: LAMP, fin: 'lens', glow: 3 });
        b.box([0.12, 0.07, 0.02], [s * 0.3, 0.915, B.z1 + noseZ(0.3) - noseZ(0.8) + 0.012], { color: BEACON, fin: 'lens', glow: 2.8 });
        b.box([0.07, 0.3, 0.014], [s * 0.85, 1.12, B.z0 - 0.006], { color: TAIL, fin: 'lens', glow: 1.8, bone: gate });
        b.box([0.07, 0.09, 0.014], [s * 0.85, 1.42, B.z0 - 0.006], { color: AMBER, fin: 'lens', glow: 1.5, bone: gate });
      }
      b.box([1.86, 0.12, 0.16], [0, 0.5, -2.86], { color: 0xc9ccd0, fin: 'steel', round: 0.3 }); // step bumper
    },
  };
}

// ------------------------------------------------------------------ rescue tender (Osaka Municipal Fire Department, headquarters rescue)
function rescueTruck(): CarDef {
  const RED = '#c9151b', red = 0xc9151b, SILVER = 0xc9ccd0;
  const cab: Body = {
    z0: 1.42, z1: 3.8, crown: 0.05, tuck: 0.02, re: 0.1, rb: 0.08,
    top: curve([[1.42, 2.62], [3.45, 2.62], [3.7, 2.55], [3.8, 2.42]]),
    belt: () => 1.62,
    halfW: curve([[1.42, 1.12], [1.5, 1.15], [3.5, 1.15], [3.72, 1.1], [3.8, 1.02]]),
    roofW: () => 1.04,
    floor: () => 0.82,
  };
  const box: Body = {
    z0: -3.8, z1: 1.3, crown: 0.03, tuck: 0.004, re: 0.05, rb: 0.04,
    top: () => 3.0, belt: () => 2.0,
    halfW: curve([[-3.8, 1.13], [-3.72, 1.175], [1.22, 1.175], [1.3, 1.13]]),
    roofW: () => 1.12, floor: () => 0.94,
  };
  const cs = sectOf(cab), bs = sectOf(box);
  const FA = 2.85, RA = -1.75, D = 1.02, AR = 0.6;
  const rig = new Rig();
  const spins = [[1.0, FA], [-1.0, FA], [0.98, RA], [-0.98, RA]].map(([x, z]) => rig.wheel([x, D / 2, z], D, z > 0));
  const FD = 3.62, MD = 2.6, RD = 1.56;
  const dFL = rig.door([1.13, 1.2, FD], 'swing', 1, 'front', 1.2), dFR = rig.door([-1.13, 1.2, FD], 'swing', -1, 'driver', 1.2);
  const dRL = rig.door([1.14, 1.2, MD], 'swing', 1, 'rear', 1.15), dRR = rig.door([-1.14, 1.2, MD], 'swing', -1, 'rear', 1.15);
  rig.seat = [-0.62, 1.25, 3.0];
  rig.driver = rig.bone(rig.seat);
  const noseZ = (x: number) => 0.05 * (1 - (x / 1.02) ** 2);
  /** White wing sweeping up towards the tail, as on the real appliance. */
  const wing: (c: CanvasRenderingContext2D) => void = (c) => {
    c.moveTo(0.05, 1.62);
    c.bezierCurveTo(-0.5, 1.9, -1.2, 2.36, -2.55, 2.54);
    c.bezierCurveTo(-2.38, 2.24, -2.34, 2.02, -2.46, 1.8);
    c.bezierCurveTo(-1.6, 1.66, -0.8, 1.62, 0.05, 1.62);
    c.closePath();
  };
  const shutter = (p: Paint, a: number, y: number, w: number, h: number) => {
    p.put(rect(a - 0.03, y - 0.03, w + 0.06, h + 0.06, 0.02), '#c3c6ca', FIN.steel);
    p.put(rect(a, y, w, h), RED, FIN.paint);
    for (let k = 1; k * 0.075 < h; k++) p.put(rect(a, y + k * 0.075, w, 0.008), 'rgba(70,0,0,0.55)');
  };

  return {
    key: 'firetruck', rig,
    extent: { z0: -3.84, z1: 3.86, hw: 1.2, h: 3.06, mirror: false },
    paint(p: Paint) {
      for (const v of ['L', 'R'] as const) {
        const dir = v === 'L' ? 1 : -1;
        p.view(v);
        p.put(rect(-3.9, 0, 7.8, 3.1), RED, FIN.paint);
        // equipment body: roller shutters between bright rails, the wing and the lettering
        shutter(p, 0.22, 1.2, 0.96, 1.58);
        shutter(p, -2.62, 1.2, 2.72, 1.58);
        shutter(p, -3.72, 1.2, 0.98, 1.58);
        for (const y of [1.1, 2.83]) p.put(rect(-3.8, y, 5.1, 0.05), '#c3c6ca', FIN.steel);
        p.put(wing, '#f4f4f1', FIN.paint);
        p.text('ADVANCED SUPER RESCUE', -1.26, 2.66, 0.085, '#ffffff', { weight: 700, maxW: 2.5 });
        p.text('Osaka Fire Dept.', -1.55, 1.98, 0.15, '#c9151b', { weight: 700, italic: true, maxW: 1.6 });
        p.text('本部特別高度救助隊', -1.26, 1.42, 0.14, '#ffffff', { font: GOTHIC, weight: 900, spread: 0.24 });
        arch(p, RA, D / 2, AR + 0.04, 0.05);
        // cab: door glass, door shut lines, station markings
        windowCut(p, poly([[3.56, 1.7], [3.5, 2.3], [2.74, 2.3], [2.74, 1.7]]));
        windowCut(p, rect(1.7, 1.7, 0.8, 0.6, 0.05));
        arch(p, FA, D / 2, AR);
        seam(p, [[FD, 1.15], [FD, 2.4], [RD, 2.4], [RD, 0.86]]);
        seam(p, [[MD, 1.1], [MD, 2.4]]);
        for (const z of [2.75, 1.7]) p.put(rect(z, 1.55, 0.18, 0.04, 0.015), '#101113', FIN.plastic);
        p.put(rect(1.9, 2.42, 0.4, 0.17, 0.01), '#f4f4f1', FIN.paint);
        p.text('本部', 2.1, 2.5, 0.1, '#15171a', { font: GOTHIC, weight: 900 });
        p.text('大阪市消防局', 3.1, 1.5, 0.075, '#ffffff', { font: GOTHIC, weight: 900, spread: 0.125 });
        p.put(poly([[3.1 + dir * 0.36 - 0.07, 1.4], [3.1 + dir * 0.36 + 0.07, 1.4], [3.1 + dir * 0.36 + 0.07, 1.3], [3.1 + dir * 0.36, 1.24], [3.1 + dir * 0.36 - 0.07, 1.3]]), '#1b3f9c', FIN.paint);
        p.line(poly([[3.1 + dir * 0.36 - 0.07, 1.4], [3.1 + dir * 0.36 + 0.07, 1.4], [3.1 + dir * 0.36 + 0.07, 1.3], [3.1 + dir * 0.36, 1.24], [3.1 + dir * 0.36 - 0.07, 1.3]]), 0.012, '#f2c21a');
        p.text('ASR10', 3.1 - dir * 0.1, 1.32, 0.075, '#ffffff', { weight: 700 });
        p.text('大阪市消防局', 2.08, 1.3, 0.075, '#ffffff', { font: GOTHIC, weight: 900, spread: 0.125 });
      }
      p.view('top');
      p.put(rect(-3.9, -1.25, 7.8, 2.5), RED, FIN.paint);
      p.put(rect(-3.7, -1.0, 4.9, 2.0, 0.03), '#b5b9bd', FIN.steel); // roof deck
      for (let k = 0; k < 24; k++) p.put(rect(-3.7 + k * 0.2, -1.0, 0.012, 2.0), 'rgba(0,0,0,0.25)');
      p.view('front');
      p.put(rect(-1.25, 0, 2.5, 3.1), RED, FIN.paint);
      windowCut(p, rect(-0.96, 1.66, 1.92, 0.68, 0.07), 0.05);
      p.put(rect(-1.02, 1.42, 2.04, 0.2, 0.02), '#0c0d0f', FIN.plastic);
      p.put(rect(-0.62, 1.12, 1.24, 0.26, 0.04), '#0c0d0f', FIN.plastic);
      for (let k = 0; k < 5; k++) p.put(rect(-0.58, 1.145 + k * 0.045, 1.16, 0.02), '#d3d6d9', FIN.chrome);
      p.put(circle(0, 1.25, 0.08), '#d8dadd', FIN.chrome);
      p.put(circle(0, 1.25, 0.05), '#b9151b', FIN.paint);
      plate(p, 0, 0.95, '大阪 800', 'す', '14-69', { big: true });
      p.view('rear');
      p.put(rect(-1.25, 0, 2.5, 3.1), RED, FIN.paint);
      shutter(p, -0.66, 1.3, 1.32, 1.5);
      for (const s of [-1, 1])
        for (let k = 0; k < 4; k++) {
          const x = s * (0.72 + k * 0.11);
          p.put(poly([[x, 0.95], [x + s * 0.055, 0.95], [x + s * 0.165, 1.2], [x + s * 0.11, 1.2]]), '#f2c21a', FIN.paint);
        }
      p.text('大阪市消防局', 0, 2.9, 0.07, '#ffffff', { font: GOTHIC, weight: 900, spread: 0.12 });
      plate(p, 0, 1.1, '大阪 800', 'す', '14-69', { big: true });
    },
    build(b: CarBuilder) {
      const color = 0xffffff;
      b.hull({
        z0: cab.z0, z1: cab.z1, sect: cs, color, breaks: [FD, MD, RD],
        doors: [{ za: MD, zb: FD, side: 1, bone: dFL }, { za: MD, zb: FD, side: -1, bone: dFR }, { za: RD, zb: MD, side: 1, bone: dRL }, { za: RD, zb: MD, side: -1, bone: dRR }],
        glassSide: [1.6, 3.64], cabin: [1.46, 3.78], trim: 0x2a2c30, headliner: 0x9a9da0,
        glass: () => [0x17232b, 0.42],
        capFront: { bulge: noseZ, glass: true, inner: true }, capRear: { plain: red },
      });
      b.hull({ z0: box.z0, z1: box.z1, sect: bs, color, capFront: { plain: red }, density: 0.5 });
      spins.forEach((bone, i) => {
        const side = i % 2 ? -1 : 1, front = i < 2;
        wheel(b, [side * (front ? 1.0 : 0.98), D / 2, front ? FA : RA], side, bone, { d: D, w: 0.27, rim: 0.57, style: 'truck', dual: !front });
        wheelWell(b, side, [side * 1.14, D / 2, front ? FA : RA], AR, front ? 0.42 : 0.66);
      });
      // chassis, tanks and lockers under the body
      b.box([0.9, 0.3, 7.3], [0, 0.72, 0], { color: 0x141516, fin: 'plastic' });
      b.box([2.1, 0.16, 0.2], [0, 0.6, RA], { color: 0x141516, fin: 'plastic', cyl: true });
      b.box([1.9, 0.14, 0.14], [0, 0.56, FA], { color: 0x141516, fin: 'plastic', cyl: true });
      for (const s of [-1, 1]) {
        b.box([0.34, 0.44, 1.5], [s * 0.98, 0.72, 0.4], { color: red, fin: 'paint', round: 0.2 });
        b.box([0.36, 0.05, 1.56], [s * 0.99, 0.96, 0.4], { color: SILVER, fin: 'steel' });
        b.box([0.34, 0.4, 1.3], [s * 0.98, 0.74, -3.05], { color: red, fin: 'paint', round: 0.2 });
        b.box([0.3, 0.05, 0.8], [s * 1.05, 0.62, 3.2], { color: SILVER, fin: 'steel' }); // cab steps
        b.box([0.3, 0.05, 0.7], [s * 1.05, 0.62, 2.05], { color: SILVER, fin: 'steel' });
      }
      // nose: bright bumper with the lamps, winch fairlead, flashers and mirrors
      b.box([2.36, 0.3, 0.28], [0, 0.66, 3.92], { color: SILVER, fin: 'steel', round: 0.3 });
      b.box([0.5, 0.2, 0.16], [0, 0.6, 4.08], { color: 0x9a9da0, fin: 'steel', round: 0.3 });
      for (const s of [-1, 1]) {
        b.box([0.36, 0.16, 0.03], [s * 0.86, 0.68, 4.065], { color: LAMP, fin: 'lens', glow: 3 });
        b.box([0.12, 0.1, 0.03], [s * 1.1, 0.68, 4.05], { color: AMBER, fin: 'lens', glow: 1.6 });
        b.box([0.2, 0.12, 0.04], [s * 0.82, 1.25, 3.82 + noseZ(0.82) - noseZ(1.0) + 0.01], { color: BEACON, fin: 'lens', glow: 2.8 });
        b.box([0.04, 0.04, 0.5], [s * 1.2, 2.3, 3.9], { color: 0x101113, fin: 'plastic', rot: [0, s * 0.5, 0] });
        b.box([0.07, 0.42, 0.2], [s * 1.32, 2.05, 3.98], { color: 0x101113, fin: 'plastic', round: 0.5 });
        b.box([0.04, 0.6, 0.04], [s * 1.32, 2.0, 3.98], { color: 0x101113, fin: 'plastic' });
        b.box([0.9, 0.016, 0.03], [s * 0.45 - 0.1, 1.66, 3.86], { color: 0x09090a, fin: 'plastic', rot: [0, 0, -0.04] });
      }
      // roof fairing with the red light housing
      b.box([2.0, 0.34, 1.8], [0, 2.76, 2.45], { color: red, fin: 'paint', round: 0.5 });
      b.box([1.6, 0.16, 0.5], [0, 2.94, 3.0], { color: BEACON, fin: 'lens', glow: 2.6, round: 0.8 });
      b.box([0.5, 0.24, 0.04], [0, 2.76, 3.36], { color: 0xf4f4f1, fin: 'paint' });
      b.box([0.4, 0.06, 0.5], [0, 2.94, 2.3], { color: 0x101113, fin: 'plastic', round: 0.5 });
      // cab interior
      b.box([2.16, 0.03, 2.3], [0, 0.92, 2.62], { color: 0x101113, fin: 'fabric' });
      for (const s of [-1, 1]) seat(b, s * 0.62, 1.25, 3.0, 0x25282d, 0.56);
      b.box([1.9, 0.16, 0.5], [0, 1.27, 1.95], { color: 0x25282d, fin: 'fabric', round: 0.7 });
      b.box([1.9, 0.62, 0.14], [0, 1.64, 1.68], { color: 0x25282d, fin: 'fabric', round: 0.7, rot: [-0.1, 0, 0] });
      cockpit(b, { seat: rig.seat, dashZ: 3.5, dashY: 1.52, hw: 1.04, driver: rig.driver });
      // roof deck: ladder, rails, floodlights and beacons
      for (const s of [-1, 1]) {
        b.box([0.05, 0.05, 4.6], [s * 1.08, 3.16, -1.3], { color: SILVER, fin: 'steel' });
        for (let k = 0; k < 6; k++) b.box([0.04, 0.14, 0.04], [s * 1.08, 3.08, -3.5 + k * 0.88], { color: SILVER, fin: 'steel' });
        b.box([0.05, 0.06, 3.6], [s * 0.3 + 0.3, 3.3, -1.3], { color: 0xdcdee0, fin: 'steel' });
        b.box([0.3, 0.12, 0.3], [s * 0.9, 3.08, 1.0], { color: BEACON, fin: 'lens', glow: 2.6, round: 0.6 });
        b.box([0.3, 0.12, 0.08], [s * 0.86, 2.86, -3.83], { color: BEACON, fin: 'lens', glow: 2.6 });
        b.box([0.28, 0.2, 0.04], [s * 0.9, 1.06, -3.83], { color: TAIL, fin: 'lens', glow: 1.7 });
        b.box([0.05, 1.9, 0.05], [s * 0.78, 2.0, -3.86], { color: SILVER, fin: 'steel' }); // rear ladder
        b.box([0.05, 1.9, 0.05], [s * 1.04, 2.0, -3.86], { color: SILVER, fin: 'steel' });
        for (let k = 0; k < 6; k++) b.box([0.26, 0.03, 0.04], [s * 0.91, 1.2 + k * 0.3, -3.86], { color: SILVER, fin: 'steel' });
      }
      for (let k = 0; k < 12; k++) b.box([0.34, 0.035, 0.035], [0.3, 3.3, -3.0 + k * 0.31], { color: 0xdcdee0, fin: 'steel' });
      b.box([0.5, 0.3, 0.5], [-0.6, 3.16, -2.6], { color: SILVER, fin: 'steel', round: 0.2 });
      b.box([2.3, 0.08, 0.36], [0, 0.86, -3.96], { color: SILVER, fin: 'steel' }); // rear step
    },
  };
}

// ------------------------------------------------------------------ registry
export type CarKind = 'prius' | 'taxi' | 'alphard' | 'police' | 'ambulance' | 'firetruck';
const makers: Partial<Record<CarKind, () => CarDef>> = {
  prius: () => prius(false),
  taxi: () => prius(true),
  alphard,
  police: patrol,
  ambulance,
  firetruck: rescueTruck,
};
const defs = new Map<string, CarDef | null>();
/** The model of a vehicle kind, or null for kinds that are still built from boxes (the 16式). */
export function carDef(kind: string): CarDef | null {
  let d = defs.get(kind);
  if (d === undefined) {
    d = makers[kind as CarKind]?.() ?? null;
    defs.set(kind, d);
  }
  return d;
}
