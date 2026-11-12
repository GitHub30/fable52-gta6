import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

type Lit = THREE.Material & { defines?: Record<string, unknown> };
interface Saved {
  compile?: THREE.Material['onBeforeCompile']; // the material's own shader patch, if it had one
  key?: THREE.Material['customProgramCacheKey'];
}
const isLit = (m: THREE.Material) =>
  (m as any).isMeshStandardMaterial || (m as any).isMeshLambertMaterial || (m as any).isMeshPhongMaterial || (m as any).isMeshToonMaterial;

/**
 * Cascaded sun shadows: the view is cut into slices by distance and each slice gets its own shadow map, so the
 * ground at the player's feet has centimetre texels while buildings hundreds of metres away still cast shadows.
 *
 * The cascades are separate lights standing in for `sun`, which is hidden while they are active; its colour,
 * intensity and direction are copied across every frame, so Environment keeps driving the one light it knows.
 * Every lit material has to know about the cascades (otherwise it would add all of them up), so the scene is
 * swept each frame for materials not yet seen.
 *
 * The same sweep keeps cars and people out of the last cascade: they are by far the heaviest casters (skinned,
 * tens of thousands of triangles each), that cascade covers hundreds of them, and at its texel size their
 * shadows would be blobs anyway. Buildings and trees cast into every cascade.
 */
export class SunShadows {
  private csm: CSM;
  private saved = new Map<THREE.Material, Saved>();
  private projX = 0;
  private projY = 0;
  private dir = new THREE.Vector3();
  private movers = new Set<THREE.Object3D>(); // skinned casters, switched off beyond `moverRange`
  private moverRange2: number;

  /** @param splits far edge of each cascade in metres from the camera, nearest first */
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
    splits: number[],
    private mapSize: number,
  ) {
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: splits.length,
      maxFar: splits[splits.length - 1],
      mode: 'custom',
      customSplitsCallback: (_n, _near, far, breaks) => {
        for (const s of splits) breaks.push(Math.min(1, s / far));
      },
      shadowMapSize: mapSize,
      lightIntensity: sun.intensity,
      lightNear: 1,
      lightFar: 1400,
      lightMargin: 420, // casters behind the slice: a 300 m tower under a low sun throws a long shadow
    });
    this.moverRange2 = (splits.length > 1 ? splits[splits.length - 2] * 1.15 : Infinity) ** 2;
    this.csm.fade = true; // blend across the cascade seams instead of switching
    sun.visible = false;
  }

  /** Shadow acne scales with the texel size, so each cascade gets a bias to match its own resolution. */
  private fit() {
    this.csm.updateFrustums();
    for (const l of this.csm.lights) {
      const cam = l.shadow.camera;
      const texel = (cam.right - cam.left) / this.mapSize;
      l.shadow.normalBias = Math.max(0.02, texel * 1.2);
      l.shadow.bias = -(0.03 + texel * 1.5) / (cam.far - cam.near);
    }
  }

  private adopt(m: Lit) {
    if (this.saved.has(m) || !isLit(m)) return;
    const s: Saved = {};
    if (Object.hasOwn(m, 'onBeforeCompile')) s.compile = m.onBeforeCompile;
    if (Object.hasOwn(m, 'customProgramCacheKey')) s.key = m.customProgramCacheKey;
    this.saved.set(m, s);
    const own = m.onBeforeCompile;
    const ownKey = m.customProgramCacheKey();
    this.csm.setupMaterial(m);
    const cascades = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      own.call(m, shader, renderer);
      cascades.call(m, shader, renderer);
    };
    // the default key is the hook's source text, which is now the same wrapper for every material
    m.customProgramCacheKey = () => ownKey;
    m.needsUpdate = true;
  }

  update() {
    const cam = this.camera, e = cam.projectionMatrix.elements;
    cam.updateMatrixWorld();
    if (e[0] !== this.projX || e[5] !== this.projY) {
      this.projX = e[0];
      this.projY = e[5];
      this.fit();
    }
    const eye = cam.matrixWorld.elements, far2 = this.moverRange2, movers = this.movers;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && (o.castShadow || movers.has(o))) {
        movers.add(o);
        const p = o.matrixWorld.elements;
        o.castShadow = (p[12] - eye[12]) ** 2 + (p[13] - eye[13]) ** 2 + (p[14] - eye[14]) ** 2 < far2;
      }
      if (Array.isArray(m)) for (const k of m) this.adopt(k);
      else this.adopt(m);
    });
    const sun = this.sun;
    this.csm.lightDirection.copy(this.dir.subVectors(sun.target.position, sun.position).normalize());
    for (const l of this.csm.lights) {
      l.intensity = sun.intensity;
      l.color.copy(sun.color);
    }
    this.csm.update();
  }

  dispose() {
    this.csm.remove();
    for (const l of this.csm.lights) l.dispose();
    this.csm.dispose(); // strips the cascade defines and hooks from every material
    for (const [m, s] of this.saved) {
      if (s.compile) m.onBeforeCompile = s.compile;
      if (s.key) m.customProgramCacheKey = s.key;
      else delete (m as Partial<THREE.Material>).customProgramCacheKey;
    }
    this.saved.clear();
    for (const o of this.movers) o.castShadow = true;
    this.movers.clear();
    this.sun.visible = true;
  }
}
