import {
  DataArrayTexture,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export interface KitMaterials {
  /** Every opaque piece: one texture array, the layer chosen per vertex. */
  readonly opaque: MeshStandardMaterial;
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
export function createKitMaterials(layers: DataArrayTexture, decals: Texture): KitMaterials {
  const opaque = new MeshStandardMaterial({ name: 'kit', roughness: 0.85, metalness: 0 });
  applyLayerSampling(opaque, layers);
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
  return { opaque, decal };
}

/** Shader hook: sample the texture array at (uv, layer) instead of a plain map. Exported for tests. */
export function applyLayerSampling(material: MeshStandardMaterial, layers: DataArrayTexture): void {
  const uniforms = { uKitLayers: { value: layers } };
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
        '#include <common>\nuniform highp sampler2DArray uKitLayers;\nvarying vec2 vKitUv;\nvarying float vKitLayer;',
      )
      .replace(
        '#include <map_fragment>',
        // Every vertex of a triangle has the same layer; rounding guards against interpolation noise.
        'diffuseColor *= texture(uKitLayers, vec3(vKitUv, floor(vKitLayer + 0.5)));',
      );
  };
}
