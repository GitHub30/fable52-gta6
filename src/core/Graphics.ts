import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SunShadows } from './Shadows';
import { setModelDetail, ModelDetail } from './geo';
import type { Environment } from '../world/Environment';
import type { City } from '../world/City';

export type GraphicsLevel = 'low' | 'high' | 'ultra';
export const GRAPHICS_LEVELS: GraphicsLevel[] = ['low', 'high', 'ultra'];
export const GRAPHICS_LABEL: Record<GraphicsLevel, string> = { low: 'ローポリ', high: '高精細', ultra: '最高' };

interface Preset {
  detail: ModelDetail; // model tessellation (see geo.ts)
  pixelRatio: number; // upper bound; the display's own ratio still caps it
  shadow: number; // sun shadow map size (per cascade when there are cascades)
  cascades: number[] | null; // far edge of each shadow cascade in metres; null = one map around the player
  post: boolean; // HDR pipeline: MSAA + bloom
  ao: number; // ambient occlusion resolution scale, 0 = off (needs post)
  reflections: boolean; // sky reflected in paint and metal
}
const PRESETS: Record<GraphicsLevel, Preset> = {
  low: { detail: 0, pixelRatio: 1, shadow: 1024, cascades: null, post: false, ao: 0, reflections: false },
  high: { detail: 1, pixelRatio: 1.25, shadow: 2048, cascades: [22, 80, 280], post: true, ao: 0.5, reflections: true },
  ultra: { detail: 2, pixelRatio: 2, shadow: 2048, cascades: [16, 52, 170, 520], post: true, ao: 1, reflections: true },
};

/**
 * Ambient occlusion: darkens creases and contact lines (under cars, where walls meet the pavement) that the
 * single hemisphere light leaves flat. It reads the depth the scene pass has already written instead of drawing
 * the scene a second time, and can run below the frame's resolution.
 */
class AoPass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, private resolution: number) {
    // a placeholder depth texture tells the pass not to render its own depth and normals
    super(scene, camera, 1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1, thickness: 1, scale: 1.8, samples: resolution < 1 ? 8 : 16 });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
  }
  override setSize(w: number, h: number) {
    super.setSize(Math.max(1, Math.round(w * this.resolution)), Math.max(1, Math.round(h * this.resolution)));
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, dt: number, mask: boolean) {
    const depth = readBuffer.depthTexture;
    this.gtaoMaterial.uniforms.tDepth.value = depth;
    this.pdMaterial.uniforms.tDepth.value = depth;
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }
}
/** Resolution scale steps used when the frame rate cannot be held. */
const SCALE_STEPS = [1, 0.85, 0.7, 0.55];
const KEY = 'velabay.graphics'; // the game's former name: kept so existing settings survive the rename

/** Graphics quality: presets, the optional post-processing chain, sky reflections and adaptive resolution. */
export class Graphics {
  level: GraphicsLevel;
  private step = 0;
  private w = 1;
  private h = 1;
  private composer: EffectComposer | null = null;
  private shadows: SunShadows | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene: THREE.Scene | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envT = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private env: Environment,
    private city: City,
  ) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* storage unavailable */
    }
    this.level = GRAPHICS_LEVELS.includes(saved as GraphicsLevel) ? (saved as GraphicsLevel) : 'high';
    this.apply(this.level, false);
  }

  private get preset() {
    return PRESETS[this.level];
  }
  get pixelRatio() {
    return Math.min(window.devicePixelRatio, this.preset.pixelRatio) * SCALE_STEPS[this.step];
  }

  apply(level: GraphicsLevel, persist = true) {
    this.level = level;
    this.step = 0;
    const p = this.preset;
    if (persist)
      try {
        localStorage.setItem(KEY, level);
      } catch {
        /* storage unavailable */
      }
    setModelDetail(p.detail);
    this.city.setDetail(p.detail);

    const shadow = this.env.sun.shadow;
    if (shadow.mapSize.x !== p.shadow) {
      shadow.mapSize.set(p.shadow, p.shadow);
      shadow.map?.dispose();
      shadow.map = null as any;
    }

    this.shadows?.dispose();
    this.shadows = p.cascades ? new SunShadows(this.scene, this.camera, this.env.sun, p.cascades, p.shadow) : null;

    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose();
      this.composer.dispose();
      this.composer = null;
    }
    if (p.post) {
      const target = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, samples: 4, depthTexture: p.ao ? new THREE.DepthTexture(this.w, this.h) : null });
      const c = (this.composer = new EffectComposer(this.renderer, target));
      c.addPass(new RenderPass(this.scene, this.camera));
      if (p.ao) c.addPass(new AoPass(this.scene, this.camera, p.ao));
      // lamps, beacons and the sun bloom; sunlit paint stays just under the threshold
      c.addPass(new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 0.32, 0.55, 1.0));
      c.addPass(new OutputPass());
    }

    if (!p.reflections) {
      this.scene.environment = null;
      this.envTarget?.dispose();
      this.envTarget = null;
    } else this.envT = 0; // refresh on the next frame
    this.resize(this.w, this.h);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
  }

  /** Drop the render resolution one step (the frame rate is too low). Returns false at the floor. */
  stepDown() {
    if (this.step >= SCALE_STEPS.length - 1) return false;
    this.step++;
    this.resize(this.w, this.h);
    return true;
  }

  /** The sky changes slowly, so its reflection is re-captured only every few seconds. */
  private updateReflections(dt: number) {
    if (!this.preset.reflections || (this.envT -= dt) > 0) return;
    this.envT = 4;
    this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
    if (!this.envScene) {
      this.envScene = new THREE.Scene();
      const dome = new THREE.Mesh(this.env.sky.geometry, this.env.sky.material);
      dome.frustumCulled = false;
      this.envScene.add(dome);
    }
    const next = this.pmrem.fromScene(this.envScene, 0, 1, 6000);
    this.envTarget?.dispose();
    this.envTarget = next;
    this.scene.environment = next.texture;
    this.scene.environmentIntensity = 0.5;
  }

  render(dt: number) {
    this.updateReflections(dt);
    this.shadows?.update();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
