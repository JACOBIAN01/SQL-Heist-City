import {
  DataArrayTexture,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector4,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export interface KitMaterials {
  /** Every opaque piece: one texture array, the layer chosen per vertex. */
  readonly opaque: MeshStandardMaterial;
  /** How strongly lit windows glow: 0 by day, 1 at night (see setNightGlow). */
  readonly nightGlow: { value: number };
  /** Road markings: cut out by alpha, drawn just above the asphalt. */
  readonly decal: MeshStandardMaterial;
}

/**
 * Wraps the decoded layer strip (layers stacked top to bottom, RGBA) as a
 * texture array. Each layer tiles on its own, so there is no atlas bleeding.
 */
export function layersTexture(
  pixels: Uint8Array | Uint8ClampedArray,
  size: number,
  count: number,
): DataArrayTexture {
  if (pixels.length !== size * size * 4 * count)
    throw new Error(`layer strip is ${pixels.length} bytes, expected ${size}x${size}x4x${count}`);
  const texture = new DataArrayTexture(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length),
    size,
    size,
    count,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Pattern: Flyweight — Why: two materials shared by every building, street and
 * chunk; a chunk merges its pieces per material, so a whole city block costs
 * two draw calls however many pieces it has.
 */
export function createKitMaterials(
  layers: DataArrayTexture,
  decals: Texture,
  litLayers: readonly number[] = [],
): KitMaterials {
  const opaque = new MeshStandardMaterial({ name: 'kit', roughness: 0.85, metalness: 0 });
  const nightGlow = { value: 0 };
  applyLayerSampling(opaque, layers, litLayers, nightGlow);
  decals.colorSpace = SRGBColorSpace;
  decals.flipY = false; // glTF UV convention
  decals.wrapS = decals.wrapT = RepeatWrapping;
  const decal = new MeshStandardMaterial({
    name: 'decal',
    map: decals,
    alphaTest: 0.5,
    roughness: 0.9,
    metalness: 0,
    // Markings sit 2 cm over the road; the offset keeps them from flickering far away.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  return { opaque, decal, nightGlow };
}

/** Lit windows glow at night: 0 (day) to 1 (night), from the sky state. */
export function setNightGlow(materials: KitMaterials, night: number): void {
  materials.nightGlow.value = Math.min(1, Math.max(0, night));
}

/** Up to this many layers can glow at night (the lit fake interiors). */
const MAX_LIT_LAYERS = 4;

/**
 * Shader hook: sample the texture array at (uv, layer) instead of a plain map,
 * and let the lit-interior layers glow by `nightGlow`. Exported for tests.
 */
export function applyLayerSampling(
  material: MeshStandardMaterial,
  layers: DataArrayTexture,
  litLayers: readonly number[] = [],
  nightGlow: { value: number } = { value: 0 },
): void {
  if (litLayers.length > MAX_LIT_LAYERS) throw new Error(`at most ${MAX_LIT_LAYERS} lit layers`);
  // Unused slots hold −1, which no layer index equals.
  const lit = [...litLayers, -1, -1, -1, -1].slice(0, MAX_LIT_LAYERS);
  const uniforms = {
    uKitLayers: { value: layers },
    uLitLayers: { value: new Vector4(...lit) },
    uNightGlow: nightGlow,
  };
  material.customProgramCacheKey = () => 'heist-city-kit';
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float _layer;\nvarying vec2 vKitUv;\nvarying float vKitLayer;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvKitUv = uv;\nvKitLayer = _layer;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform highp sampler2DArray uKitLayers;\nuniform vec4 uLitLayers;\nuniform float uNightGlow;\nvarying vec2 vKitUv;\nvarying float vKitLayer;',
      )
      .replace(
        '#include <map_fragment>',
        // Every vertex of a triangle has the same layer; rounding guards against interpolation noise.
        [
          'float kitLayer = floor(vKitLayer + 0.5);',
          'vec4 kitTex = texture(uKitLayers, vec3(vKitUv, kitLayer));',
          'diffuseColor *= kitTex;',
          'float kitLit = any(equal(vec4(kitLayer), uLitLayers)) ? 1.0 : 0.0;',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += kitTex.rgb * kitLit * uNightGlow;',
      );
  };
}
