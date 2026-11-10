import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { setModelDetail, ModelDetail } from './geo';
import type { Environment } from '../world/Environment';
import type { City } from '../world/City';

export type GraphicsLevel = 'low' | 'high' | 'ultra';
export const GRAPHICS_LEVELS: GraphicsLevel[] = ['low', 'high', 'ultra'];
export const GRAPHICS_LABEL: Record<GraphicsLevel, string> = { low: 'ローポリ', high: '高精細', ultra: '最高' };

interface Preset {
  detail: ModelDetail; // model tessellation (see geo.ts)
  pixelRatio: number; // upper bound; the display's own ratio still caps it
  shadow: number; // sun shadow map size
  post: boolean; // HDR pipeline: MSAA + bloom
  reflections: boolean; // sky reflected in paint and metal
}
const PRESETS: Record<GraphicsLevel, Preset> = {
  low: { detail: 0, pixelRatio: 1, shadow: 1024, post: false, reflections: false },
  high: { detail: 1, pixelRatio: 1.25, shadow: 2048, post: true, reflections: true },
  ultra: { detail: 2, pixelRatio: 2, shadow: 4096, post: true, reflections: true },
};
/** Resolution scale steps used when the frame rate cannot be held. */
const SCALE_STEPS = [1, 0.85, 0.7, 0.55];
const KEY = 'velabay.graphics';

/** Graphics quality: presets, the optional post-processing chain, sky reflections and adaptive resolution. */
export class Graphics {
  level: GraphicsLevel;
  private step = 0;
  private w = 1;
  private h = 1;
  private composer: EffectComposer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene: THREE.Scene | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envT = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
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

    if (p.post && !this.composer) {
      const target = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, samples: 4 });
      const c = (this.composer = new EffectComposer(this.renderer, target));
      c.addPass(new RenderPass(this.scene, this.camera));
      // lamps, beacons and the sun bloom; sunlit paint stays just under the threshold
      c.addPass(new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 0.32, 0.55, 1.0));
      c.addPass(new OutputPass());
    } else if (!p.post && this.composer) {
      this.composer.dispose();
      this.composer = null;
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
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
