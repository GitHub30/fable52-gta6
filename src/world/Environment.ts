import * as THREE from 'three';
import { clamp, damp, lerp } from '../config';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog';
export const WEATHER_LABEL: Record<Weather, string> = { clear: '晴れ', cloudy: '曇り', rain: '雨', fog: '霧' };
const WEATHERS: Weather[] = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'rain', 'fog'];

const C = (h: number) => new THREE.Color(h);
const DAY_TOP = C(0x2f77d0), DAY_HOR = C(0xb9d8f0);
const DUSK_TOP = C(0x3a3f7c), DUSK_HOR = C(0xff9a5a);
const NIGHT_TOP = C(0x04060d), NIGHT_HOR = C(0x141c30);
const GREY = C(0x8d949c);
const NIGHT_AMBIENT = C(0x5a6a9a);
const WHITE = C(0xffffff);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Day/night cycle, weather, sky dome, sun/moon light with a shadow frustum that follows the player. */
export class Environment {
  time = 9; // hours
  dayLength = 720; // real seconds per in-game day
  weather: Weather = 'clear';
  private weatherTimer = 150;
  overcast = 0;
  rain = 0;
  fogAmt = 0;
  night = 0;
  day = 1;

  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6b6557, 1);
  readonly sky: THREE.Mesh;
  private skyUniforms = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(1, 1, 1) },
    stars: { value: 0 },
  };
  private rainMesh: THREE.LineSegments;
  private rainPos: Float32Array;
  private readonly RAIN_N = 1400;
  private fog = new THREE.Fog(0xffffff, 120, 900);
  private top = new THREE.Color();
  private hor = new THREE.Color();
  private sunDir = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    scene.fog = this.fog;
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    const sc = s.shadow.camera;
    sc.left = sc.bottom = -75;
    sc.right = sc.top = 75;
    sc.near = 1;
    sc.far = 420;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.06;
    scene.add(s, s.target, this.hemi);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(2500, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float stars;
          varying vec3 vDir;
          float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            vec3 col = mix(horizon, top, pow(h, 0.55));
            float s = max(dot(d, sunDir), 0.0);
            col += sunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
            vec3 g = floor(d * 220.0);
            float st = step(0.9975, hash(g)) * stars * smoothstep(0.02, 0.3, d.y);
            col += vec3(st);
            if (d.y < 0.0) col = mix(horizon, horizon * 0.6, clamp(-d.y * 4.0, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.rainPos = new Float32Array(this.RAIN_N * 6);
    for (let i = 0; i < this.RAIN_N; i++) this.resetDrop(i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaec4d8, transparent: true, opacity: 0.45, fog: false }));
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);
  }

  private resetDrop(i: number, anywhere: boolean) {
    const x = (Math.random() - 0.5) * 44, z = (Math.random() - 0.5) * 44;
    const y = anywhere ? Math.random() * 26 : 26;
    const p = this.rainPos;
    p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
    p[i * 6 + 3] = x + 0.12; p[i * 6 + 4] = y - 0.9; p[i * 6 + 5] = z;
  }

  setWeather(w: Weather) {
    this.weather = w;
    this.weatherTimer = 120 + Math.random() * 180;
  }

  get clock() {
    const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    this.time = (this.time + (dt * 24) / this.dayLength) % 24;
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) this.setWeather(WEATHERS[Math.floor(Math.random() * WEATHERS.length)]);
    const w = this.weather;
    this.overcast = damp(this.overcast, w === 'clear' ? 0 : w === 'cloudy' ? 0.7 : 1, 0.35, dt);
    this.rain = damp(this.rain, w === 'rain' ? 1 : 0, 0.4, dt);
    this.fogAmt = damp(this.fogAmt, w === 'fog' ? 1 : w === 'rain' ? 0.35 : 0, 0.3, dt);

    // sun path: rises 06:00, sets 18:00
    const a = ((this.time - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(a);
    this.day = smooth(-0.08, 0.22, elev);
    this.night = 1 - smooth(-0.12, 0.1, elev);
    const dusk = clamp(1 - Math.abs(elev) / 0.32, 0, 1) * (1 - this.overcast * 0.8);

    this.top.copy(NIGHT_TOP).lerp(DAY_TOP, this.day).lerp(DUSK_TOP, dusk * 0.6);
    this.hor.copy(NIGHT_HOR).lerp(DAY_HOR, this.day).lerp(DUSK_HOR, dusk * 0.85);
    const greyLevel = lerp(0.08, 1, this.day);
    const grey = GREY.clone().multiplyScalar(greyLevel);
    this.top.lerp(grey.clone().multiplyScalar(0.8), this.overcast * 0.85);
    this.hor.lerp(grey, this.overcast * 0.85);
    this.skyUniforms.top.value.copy(this.top);
    this.skyUniforms.horizon.value.copy(this.hor);
    this.skyUniforms.stars.value = this.night * (1 - this.overcast);

    const up = elev >= 0;
    this.sunDir.set(Math.cos(a) * 0.85, Math.abs(elev) + 0.12, 0.42).normalize();
    if (!up) this.sunDir.x *= -1;
    this.skyUniforms.sunDir.value.copy(this.sunDir);
    const disc = up ? 1 - this.overcast : 0.35 * (1 - this.overcast);
    this.skyUniforms.sunColor.value.setRGB(1, lerp(0.75, 0.97, this.day), lerp(0.5, 0.9, this.day)).multiplyScalar(disc);
    if (!up) this.skyUniforms.sunColor.value.setRGB(0.75, 0.82, 1).multiplyScalar(disc);

    const sunPower = up ? smooth(0, 0.25, elev) * 3.2 * (1 - this.overcast * 0.75) : 0.28 * (1 - this.overcast * 0.6) * smooth(0.02, 0.2, -elev);
    this.sun.intensity = sunPower;
    this.sun.color.setRGB(1, up ? lerp(0.7, 0.96, smooth(0, 0.5, elev)) : 0.86, up ? lerp(0.45, 0.9, smooth(0, 0.5, elev)) : 1);
    // snap the shadow frustum to texel-ish steps to avoid shimmering
    const fx = Math.round(focus.x / 2) * 2, fz = Math.round(focus.z / 2) * 2;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 200, this.sunDir.y * 200, fz + this.sunDir.z * 200);

    this.hemi.intensity = lerp(0.62, 1.75, this.day) * (1 - this.overcast * 0.25 * this.day);
    this.hemi.color.copy(this.top).lerp(WHITE, 0.72).lerp(NIGHT_AMBIENT, this.night * 0.8);
    this.hemi.groundColor.setRGB(0.6, 0.57, 0.52).multiplyScalar(lerp(0.55, 1, this.day));

    this.fog.color.copy(this.hor);
    this.fog.near = lerp(350, 12, this.fogAmt);
    this.fog.far = lerp(2600, 170, this.fogAmt);

    this.sky.position.copy(camera.position);

    const raining = this.rain > 0.03;
    this.rainMesh.visible = raining;
    if (raining) {
      (this.rainMesh.material as THREE.LineBasicMaterial).opacity = 0.5 * this.rain;
      const p = this.rainPos, fall = 38 * dt;
      for (let i = 0; i < this.RAIN_N; i++) {
        p[i * 6 + 1] -= fall;
        p[i * 6 + 4] -= fall;
        if (p[i * 6 + 4] < -2) this.resetDrop(i, false);
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
      this.rainMesh.position.set(camera.position.x, camera.position.y - 8, camera.position.z);
    }
  }

  /** Tyre grip multiplier for the current weather. */
  get grip() {
    return 1 - this.rain * 0.35;
  }
}
