import { MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';

export interface BakedColourOptions {
  readonly name: string;
  /** 0 by day … 1 at night: lamp vertices (`_glow`) light up with it. */
  readonly nightGlow: { value: number };
  readonly roughness: number;
  readonly metalness: number;
  /** Lights the colours a little by themselves (indoor pieces the sun never reaches). */
  readonly selfLight?: number;
}

/**
 * The material for models whose colours are baked into their vertices (cars,
 * furniture): faces are flat (the files store no normals) and lamp vertices,
 * flagged `_glow`, shine a little by day and properly at night.
 * Pattern: Flyweight — Why: a street of cars or a bank full of furniture is
 * one compiled program and one material; only transforms differ.
 */
export function createBakedColourMaterial(o: BakedColourOptions): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name: o.name,
    vertexColors: true,
    flatShading: true,
    roughness: o.roughness,
    metalness: o.metalness,
  });
  material.customProgramCacheKey = () => `heist-baked-${o.name}`;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uNightGlow = o.nightGlow;
    shader.uniforms.uSelfLight = { value: o.selfLight ?? 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float _glow;\nvarying float vGlow;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = _glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uNightGlow;\nuniform float uSelfLight;\nvarying float vGlow;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        // Bloom catches the lamps at night.
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (vGlow * (0.2 + 2.5 * uNightGlow) + uSelfLight);',
      );
  };
  return material;
}
