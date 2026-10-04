import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CityKit, piecesFromScene } from './CityKit';
import { parseKitManifest, type KitManifest } from './kitManifest';
import { createKitMaterials, layersTexture } from './kitMaterials';

const materials = () => createKitMaterials(layersTexture(new Uint8Array(16), 2, 1), new Texture());

/** A piece stored like the build writes it: int16-normalised positions, de-quantised by the node scale. */
function quantisedPiece(name: string): Group {
  const node = new Group();
  node.name = name;
  node.scale.setScalar(2);
  node.position.set(0, 1, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Int16Array([32767, 0, 0, 0, 32767, 0, 0, 0, 32767]), 3, true),
  );
  geometry.setAttribute('_layer', new BufferAttribute(new Uint8Array([3, 3, 3]), 1));
  node.add(new Mesh(geometry, new MeshStandardMaterial({ name: 'kit' })));
  const decal = new BufferGeometry();
  decal.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  node.add(new Mesh(decal, new MeshStandardMaterial({ name: 'decal' })));
  return node;
}

const manifest = (ids: string[]): KitManifest =>
  parseKitManifest({
    version: 1,
    layerSize: 2,
    layers: ['brick', 'interior1'],
    interiorLayers: ['interior1'],
    files: { geometry: 'kit.glb', layers: 'l.webp', decals: 'd.webp' },
    pieces: Object.fromEntries(
      ids.map((id) => [
        id,
        { tris: 1, min: [0, 0, 0], size: [1, 1, 1], decal: true, layers: ['brick'] },
      ]),
    ),
  });

describe('piecesFromScene', () => {
  it('bakes the de-quantising node transform into float geometry, split by material', () => {
    const scene = new Group();
    scene.add(quantisedPiece('P'));
    const p = piecesFromScene(scene).get('P');
    const pos = p?.opaque?.getAttribute('position');
    expect(pos?.array).toBeInstanceOf(Float32Array);
    expect(pos?.getX(0)).toBeCloseTo(2);
    expect(pos?.getY(0)).toBeCloseTo(1);
    expect(pos?.getY(1)).toBeCloseTo(3);
    expect(p?.opaque?.getAttribute('_layer').getX(0)).toBe(3);
    expect(p?.decal).toBeDefined();
  });
});

describe('CityKit', () => {
  const scene = new Group();
  scene.add(quantisedPiece('A'), quantisedPiece('B'));
  const kit = new CityKit(manifest(['A', 'B']), piecesFromScene(scene), materials());

  it('hands out pieces by id with the shared materials', () => {
    expect(kit.pieceIds).toEqual(['A', 'B']);
    const piece = kit.createPiece('A');
    const meshes: Mesh[] = [];
    piece.traverse((n: Object3D) => (n as Mesh).isMesh && meshes.push(n as Mesh));
    expect(meshes.map((m) => m.material)).toEqual([kit.materials.opaque, kit.materials.decal]);
    expect(meshes[0]?.castShadow).toBe(true);
    expect(meshes[1]?.castShadow).toBe(false);
  });

  it('shares geometry between copies of a piece (merging happens later, per chunk)', () => {
    const a = kit.createPiece('A').children[0] as Mesh;
    const b = kit.createPiece('A').children[0] as Mesh;
    expect(a.geometry).toBe(b.geometry);
  });

  it('knows layer indices and refuses unknown ids', () => {
    expect(kit.layer('interior1')).toBe(1);
    expect(() => kit.layer('glass')).toThrow(/layer/);
    expect(() => kit.createPiece('Nope')).toThrow(/Nope/);
    expect(kit.has('Nope')).toBe(false);
  });

  it('refuses a manifest that names a piece the geometry lacks', () => {
    expect(() => new CityKit(manifest(['A', 'C']), piecesFromScene(scene), materials())).toThrow(
      /C/,
    );
  });
});

describe('the built kit in client/public/city', () => {
  // jsdom gives import.meta.url an http scheme, so resolve from this file's directory instead.
  const dir = join(__dirname, '../../../public/city/');
  const real = parseKitManifest(JSON.parse(readFileSync(`${dir}kit.json`, 'utf8')));

  it('stays inside the 3 MB texture + geometry budget (docs/city-kit.md)', () => {
    const files = ['kit.json', real.files.geometry, real.files.layers, real.files.decals];
    const bytes = files.reduce((sum, f) => sum + statSync(dir + f).size, 0);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it('loads as one glb whose pieces match the manifest', async () => {
    const buffer = readFileSync(dir + real.files.geometry);
    // Copy into this realm's ArrayBuffer: the loader checks `instanceof ArrayBuffer`, and Node's
    // Buffer memory comes from a different realm under jsdom.
    const data = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(data).set(buffer);
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const kit = new CityKit(real, piecesFromScene(gltf.scene), materials());
    expect(kit.pieceIds.length).toBeGreaterThanOrEqual(50);
    // Spot check: a 2 m × 3 m brick wall comes out 2 m wide and 3 m tall after de-quantising.
    const wall = kit.geometry('Brick_Plain_3').opaque;
    wall?.computeBoundingBox();
    const box = wall?.boundingBox;
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeCloseTo(2, 1);
    expect((box?.max.y ?? 0) - (box?.min.y ?? 0)).toBeCloseTo(3, 1);
    // Streets carry their markings as a separate decal part.
    expect(kit.geometry('Street_4WayIntersection').decal).toBeDefined();
    expect(kit.info('Street_4WayIntersection').decal).toBe(true);
  });

  it('keeps the triangle count of the whole kit small', () => {
    const tris = Object.values(real.pieces).reduce((sum, p) => sum + p.tris, 0);
    expect(tris).toBeLessThan(15_000);
  });
});
