import { describe, expect, it } from 'vitest';
import { DataArrayTexture, SRGBColorSpace, Texture } from 'three';
import { createKitMaterials, layersTexture, setNightGlow } from './kitMaterials';

/** Runs the material's shader hook on a minimal fake shader and returns what it produced. */
function compile(material: { onBeforeCompile: (s: never, r: never) => void }) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <emissivemap_fragment>',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe('layersTexture', () => {
  it('wraps a stacked RGBA strip as an sRGB texture array that tiles', () => {
    const t = layersTexture(new Uint8Array(4 * 4 * 4 * 3), 4, 3);
    expect(t).toBeInstanceOf(DataArrayTexture);
    expect(t.image.depth).toBe(3);
    expect(t.image.width).toBe(4);
    expect(t.colorSpace).toBe(SRGBColorSpace);
    expect(t.generateMipmaps).toBe(true);
  });

  it('refuses a strip of the wrong size (e.g. RGB instead of RGBA)', () => {
    expect(() => layersTexture(new Uint8Array(4 * 4 * 3 * 3), 4, 3)).toThrow(/expected/);
  });
});

describe('createKitMaterials', () => {
  const layers = layersTexture(new Uint8Array(4 * 4 * 4), 4, 1);
  const { opaque, decal } = createKitMaterials(layers, new Texture());

  it('samples the texture array at the per-vertex layer instead of a plain map', () => {
    const shader = compile(opaque);
    expect(shader.uniforms.uKitLayers?.value).toBe(layers);
    expect(shader.vertexShader).toContain('attribute float _layer');
    expect(shader.vertexShader).toContain('vKitLayer = _layer');
    expect(shader.fragmentShader).toContain('sampler2DArray uKitLayers');
    expect(shader.fragmentShader).toContain('texture(uKitLayers, vec3(vKitUv, kitLayer))');
    expect(shader.fragmentShader).toContain('float kitLayer = floor(vKitLayer + 0.5);');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
  });

  it('compiles one shared program for every kit mesh', () => {
    const other = createKitMaterials(layers, new Texture()).opaque;
    expect(opaque.customProgramCacheKey()).toBe(other.customProgramCacheKey());
  });

  it('cuts decals out by alpha and draws them over the road', () => {
    expect(decal.alphaTest).toBeGreaterThan(0);
    expect(decal.polygonOffset).toBe(true);
    expect(decal.polygonOffsetFactor).toBeLessThan(0);
    expect(decal.map?.flipY).toBe(false);
  });
});

describe('night glow', () => {
  const layers = layersTexture(new Uint8Array(4 * 4 * 4), 4, 1);

  it('lets only the lit interior layers glow, by the night factor', () => {
    const kit = createKitMaterials(layers, new Texture(), [13, 14]);
    const shader = compile(kit.opaque);
    const lit = shader.uniforms.uLitLayers?.value as { x: number; y: number; z: number; w: number };
    expect([lit.x, lit.y, lit.z, lit.w]).toEqual([13, 14, -1, -1]);
    expect(shader.fragmentShader).toContain(
      'totalEmissiveRadiance += kitTex.rgb * kitLit * uNightGlow',
    );
    setNightGlow(kit, 0.7);
    expect((shader.uniforms.uNightGlow as { value: number }).value).toBe(0.7);
    setNightGlow(kit, 3);
    expect(kit.nightGlow.value).toBe(1);
  });

  it('refuses more lit layers than the shader has slots for', () => {
    expect(() => createKitMaterials(layers, new Texture(), [1, 2, 3, 4, 5])).toThrow(/lit layers/);
  });
});
