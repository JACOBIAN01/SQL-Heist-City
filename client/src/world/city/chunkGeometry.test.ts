import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BANK_LAYOUTS, mapById } from '@heist/shared';
import { CityKit, piecesFromScene } from './CityKit';
import { buildCityArt } from './CityRenderer';
import { buildChunkGeometry } from './chunkGeometry';
import { parseKitManifest } from './kitManifest';
import { createKitMaterials, layersTexture } from './kitMaterials';
import type { ChunkPlan } from './plan';

const materials = () =>
  createKitMaterials(layersTexture(new Uint8Array(16 * 4), 2, 4), new Texture());

/** A kit with one 1-triangle piece facing +z (a window, sampling interior1) and one decal. */
function tinyKit(): CityKit {
  const scene = new Group();
  const piece = new Group();
  piece.name = 'P';
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
  g.setAttribute('_layer', new BufferAttribute(new Float32Array([1, 1, 0]), 1));
  piece.add(new Mesh(g, new MeshStandardMaterial({ name: 'kit' })));
  const d = new BufferGeometry();
  d.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  d.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  piece.add(new Mesh(d, new MeshStandardMaterial({ name: 'decal' })));
  scene.add(piece);
  const manifest = parseKitManifest({
    version: 1,
    layerSize: 2,
    layers: ['asphalt', 'interior1', 'interior2', 'concrete'],
    interiorLayers: ['interior1', 'interior2'],
    files: { geometry: 'g', layers: 'l', decals: 'd' },
    pieces: { P: { tris: 1, min: [0, 0, 0], size: [1, 1, 0], decal: true, layers: ['interior1'] } },
  });
  return new CityKit(manifest, piecesFromScene(scene), materials());
}

const plan = (over: Partial<ChunkPlan>): ChunkPlan => ({
  id: 'c',
  bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
  placements: [],
  ground: [],
  walls: [],
  ...over,
});

const vec = (g: BufferGeometry, name: string, i: number) =>
  new Vector3().fromBufferAttribute(g.getAttribute(name) as BufferAttribute, i);

/** The direction a triangle faces from its winding (counter-clockwise = front). */
function faceNormal(g: BufferGeometry, t: number): Vector3 {
  const idx = g.getIndex();
  const [a, b, c] = [0, 1, 2].map((k) => vec(g, 'position', idx?.getX(t * 3 + k) ?? 0)) as [
    Vector3,
    Vector3,
    Vector3,
  ];
  return b.sub(a).cross(c.sub(a)).normalize();
}

describe('buildChunkGeometry', () => {
  const kit = tinyKit();

  it('moves and turns pieces into place, normals with them', () => {
    const g = buildChunkGeometry(
      kit,
      plan({ placements: [{ piece: 'P', x: 5, y: 3, z: 2, turn: 1 }] }),
    );
    // Turn 1 faces the piece east: its local +x runs north (−z), its normal points +x.
    expect(vec(g.opaque, 'position', 1).toArray()).toEqual([5, 3, 1]);
    expect(
      vec(g.opaque, 'normal', 0)
        .toArray()
        .map((v) => Math.round(v)),
    ).toEqual([1, 0, 0]);
    expect(g.triangles).toBe(2); // the piece's triangle and its decal's
    expect(g.decal).toBeDefined();
  });

  it('swaps the window’s fake interior for the one the plan chose, and nothing else', () => {
    const g = buildChunkGeometry(
      kit,
      plan({ placements: [{ piece: 'P', x: 0, y: 0, z: 0, turn: 0, interior: 'interior2' }] }),
    );
    expect(Array.from(g.opaque.getAttribute('_layer').array)).toEqual([2, 2, 0]);
  });

  it('builds ground facing up and walls facing their normal, with world-space UVs', () => {
    const g = buildChunkGeometry(
      kit,
      plan({
        ground: [
          { rect: { minX: 0, maxX: 6, minZ: 0, maxZ: 3 }, y: 0.15, layer: 'concrete', tile: 3 },
        ],
        walls: [
          {
            from: { x: 0, z: 0 },
            to: { x: 4, z: 0 },
            bottom: 0,
            top: 0.15,
            layer: 'concrete',
            tile: 3,
          },
        ],
      }),
    ).opaque;
    expect(faceNormal(g, 0).y).toBeCloseTo(1);
    expect(faceNormal(g, 1).y).toBeCloseTo(1);
    expect(faceNormal(g, 2).z).toBeCloseTo(1); // walking east, the kerb faces south
    expect(vec(g, 'normal', 4).z).toBeCloseTo(1);
    expect(vec(g, 'uv', 2).x).toBeCloseTo(2); // 6 m over 3 m tiles
    expect(Array.from(g.getAttribute('_layer').array).every((l) => l === 3)).toBe(true);
  });
});

describe('buildCityArt with the real kit', () => {
  it('draws every block in at most two draw calls', async () => {
    const dir = join(__dirname, '../../../public/city/');
    const manifest = parseKitManifest(JSON.parse(readFileSync(`${dir}kit.json`, 'utf8')));
    const file = readFileSync(dir + manifest.files.geometry);
    const data = new ArrayBuffer(file.byteLength);
    new Uint8Array(data).set(file);
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const kit = new CityKit(manifest, piecesFromScene(gltf.scene), materials());
    const city = mapById('city')?.city;
    if (!city) throw new Error('no city');
    const { root, stats } = buildCityArt(kit, city, BANK_LAYOUTS);
    expect(stats.chunks).toBe(25);
    expect(stats.drawCalls).toBeLessThanOrEqual(50);
    expect(root.getObjectByName('chunk-0-0')?.userData.bounds).toBeDefined();
    expect(stats.triangles).toBeLessThan(1_000_000);
  });
});
