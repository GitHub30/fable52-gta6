import * as THREE from 'three';

const MAX = 400;
const TRACERS = 12;

/** One pooled point-sprite system for sparks, smoke and pickup sparkles. */
export class Effects {
  private pos = new Float32Array(MAX * 3);
  private colr = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private next = 0;
  private points: THREE.Points;
  private tracerPos = new Float32Array(TRACERS * 6);
  private tracerLife = new Float32Array(TRACERS);
  private tracerNext = 0;
  private tracers: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.colr, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * 300.0 / max(1.0, -mv.z); }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC, smoothstep(0.5, 0.15, d) * vA); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, fog: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, gravity: number, grow: number) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.colr[i * 3] = r; this.colr[i * 3 + 1] = g; this.colr[i * 3 + 2] = b;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = gravity;
    this.grow[i] = grow;
  }

  sparks(x: number, y: number, z: number, n: number) {
    for (let k = 0; k < n; k++)
      this.emit(x, y, z, (Math.random() - 0.5) * 9, Math.random() * 5 + 1, (Math.random() - 0.5) * 9, 0.3 + Math.random() * 0.4, 0.12, 3, 2, 0.6, 14, 0);
  }
  smoke(x: number, y: number, z: number, dark: number) {
    const c = 0.5 - dark * 0.4;
    this.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, 1.4 + Math.random(), (Math.random() - 0.5) * 0.6, 1.6, 0.5, c, c, c, -0.3, 1.2);
  }
  sparkle(x: number, y: number, z: number, r: number, g: number, b: number, n = 14) {
    for (let k = 0; k < n; k++)
      this.emit(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 5, (Math.random() - 0.5) * 4, 0.7 + Math.random() * 0.5, 0.2, r, g, b, 5, 0);
  }
  explosion(x: number, y: number, z: number) {
    const r = () => Math.random() - 0.5;
    for (let k = 0; k < 46; k++)
      this.emit(x, y, z, r() * 20, Math.random() * 12 + 2, r() * 20, 0.45 + Math.random() * 0.6, 1.2 + Math.random() * 1.4, 4, 1.4 + Math.random() * 1.4, 0.3, 10, 2.5);
    for (let k = 0; k < 16; k++)
      this.emit(x + r() * 3, y + 0.5, z + r() * 3, r() * 3, 2 + Math.random() * 4, r() * 3, 1.8 + Math.random() * 1.2, 2.4, 0.16, 0.16, 0.16, -0.4, 3.5);
  }
  dust(x: number, z: number) {
    this.emit(x, 0.2, z, (Math.random() - 0.5) * 1.5, 0.6, (Math.random() - 0.5) * 1.5, 0.8, 0.45, 0.75, 0.72, 0.66, 0, 1.5);
  }

  /** Short-lived bullet streak from a to b. */
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const i = this.tracerNext;
    this.tracerNext = (i + 1) % TRACERS;
    this.tracerPos.set([x0, y0, z0, x1, y1, z1], i * 6);
    this.tracerLife[i] = 0.07;
    this.sparks(x1, y1, z1, 3);
  }

  update(dt: number) {
    for (let i = 0; i < TRACERS; i++) {
      if (this.tracerLife[i] <= 0) continue;
      if ((this.tracerLife[i] -= dt) <= 0) this.tracerPos.fill(0, i * 6, i * 6 + 6);
    }
    this.tracers.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6) * 0.8;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}
