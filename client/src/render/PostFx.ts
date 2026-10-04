import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** high: bloom + FXAA · fxaa: FXAA only · off: plain render (the screen's MSAA does the edges). */
export type FxLevel = 'high' | 'fxaa' | 'off';

/** Only light brighter than this blooms: the sun, lit windows at night, muzzle flashes. */
const BLOOM_THRESHOLD = 0.82;
const BLOOM_RADIUS = 0.45;
const BLOOM_DAY = 0.22;
const BLOOM_NIGHT = 0.75;
/** Bloom is soft anyway; blurring at half resolution costs a quarter as much. */
const BLOOM_SCALE = 0.5;

/** Bloom strength for a night factor (0 day … 1 night): stronger after dark, when the windows glow. */
export function bloomStrength(night: number): number {
  const n = Math.min(1, Math.max(0, night));
  return BLOOM_DAY + (BLOOM_NIGHT - BLOOM_DAY) * n;
}

/**
 * The post-processing chain: scene → bloom → tone/colour output → FXAA.
 * Each level drops the most expensive pass first, so the FrameBudget can
 * step down without the picture changing character.
 * Pattern: Chain of Responsibility (render passes, each handing its image to
 * the next) — Why: effects can be added, removed or reordered per quality
 * level without touching the render loop.
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly fxaa: FXAAPass;
  private levelNow: FxLevel = 'high';

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), BLOOM_DAY, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
  }

  get level(): FxLevel {
    return this.levelNow;
  }

  setLevel(level: FxLevel): void {
    this.levelNow = level;
    this.bloom.enabled = level === 'high';
    this.fxaa.enabled = level !== 'off';
  }

  /** Call after the renderer is resized. */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width * BLOOM_SCALE, height * BLOOM_SCALE);
  }

  setNight(night: number): void {
    this.bloom.strength = bloomStrength(night);
  }

  render(scene: Scene, camera: Camera): void {
    if (this.levelNow === 'off') this.renderer.render(scene, camera);
    else this.composer.render();
  }
}

/** One step down the quality ladder, or undefined at the bottom. */
export function lowerLevel(level: FxLevel): FxLevel | undefined {
  return level === 'high' ? 'fxaa' : level === 'fxaa' ? 'off' : undefined;
}

/**
 * Watches frame times and says when to drop a quality level: when the
 * average over a few seconds stays above budget (60 fps = 16.7 ms, with a
 * little slack). Single spikes (a chunk being built, a GC) do not count.
 */
export class FrameBudget {
  private sum = 0;
  private count = 0;
  private elapsed = 0;

  constructor(
    private readonly budgetMs = 18,
    /** How long a stretch to average over, ms. */
    private readonly windowMs = 3000,
  ) {}

  /** Feed one frame; true when the last window was over budget (then a new window starts). */
  push(frameMs: number): boolean {
    this.sum += frameMs;
    this.count++;
    this.elapsed += frameMs;
    if (this.elapsed < this.windowMs) return false;
    const over = this.sum / this.count > this.budgetMs;
    this.sum = this.count = this.elapsed = 0;
    return over;
  }
}
