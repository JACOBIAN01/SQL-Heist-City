import { describe, expect, it } from 'vitest';
import { parseKitManifest } from './kitManifest';

const valid = () => ({
  version: 1,
  layerSize: 512,
  layers: ['brick', 'interior1'],
  interiorLayers: ['interior1'],
  files: { geometry: 'kit.glb', layers: 'kit-layers.webp', decals: 'kit-decals.webp' },
  pieces: {
    Brick_Plain_3: {
      tris: 6,
      min: [-1, 0, -0.2],
      size: [2, 3, 0.2],
      decal: false,
      layers: ['brick'],
    },
  },
});

describe('parseKitManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseKitManifest(valid());
    expect(m.pieces.Brick_Plain_3?.size).toEqual([2, 3, 0.2]);
  });

  it.each([
    ['an unknown version', (m: ReturnType<typeof valid>) => ({ ...m, version: 2 })],
    ['no pieces', (m: ReturnType<typeof valid>) => ({ ...m, pieces: {} })],
    [
      'an interior layer that is not a layer',
      (m: ReturnType<typeof valid>) => ({ ...m, interiorLayers: ['x'] }),
    ],
    [
      'a piece using an unknown layer',
      (m: ReturnType<typeof valid>) => ({
        ...m,
        pieces: { P: { ...m.pieces.Brick_Plain_3, layers: ['glass'] } },
      }),
    ],
    [
      'a piece with a bad size',
      (m: ReturnType<typeof valid>) => ({
        ...m,
        pieces: { P: { ...m.pieces.Brick_Plain_3, size: [2, 3] } },
      }),
    ],
    [
      'missing file names',
      (m: ReturnType<typeof valid>) => ({ ...m, files: { geometry: 'kit.glb' } }),
    ],
  ])('rejects %s', (_, change) => {
    expect(() => parseKitManifest(change(valid()))).toThrow(/kit\.json/);
  });

  it('rejects something that is not an object', () => {
    expect(() => parseKitManifest(null)).toThrow(/kit\.json/);
  });
});
