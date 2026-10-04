import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  TextureLoader,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseKitManifest, type KitManifest, type KitPiece } from './kitManifest';
import { createKitMaterials, layersTexture, type KitMaterials } from './kitMaterials';

/** A piece's geometry split by material, in the piece's own frame (float attributes). */
export interface PieceGeometry {
  readonly opaque?: BufferGeometry;
  readonly decal?: BufferGeometry;
}

/**
 * The loaded city kit: ~65 modular pieces sharing two materials.
 * Pattern: Repository — Why: the city builder asks for pieces by id and never
 * deals with files, glTF node layout or quantised attributes.
 */
export class CityKit {
  private readonly layerIndex: ReadonlyMap<string, number>;

  constructor(
    readonly manifest: KitManifest,
    private readonly geometries: ReadonlyMap<string, PieceGeometry>,
    readonly materials: KitMaterials,
  ) {
    this.layerIndex = new Map(manifest.layers.map((id, i) => [id, i]));
    for (const id of Object.keys(manifest.pieces))
      if (!geometries.has(id)) throw new Error(`kit.glb has no piece ${id}`);
  }

  get pieceIds(): readonly string[] {
    return Object.keys(this.manifest.pieces);
  }

  has(id: string): boolean {
    return this.geometries.has(id) && id in this.manifest.pieces;
  }

  info(id: string): KitPiece {
    const piece = this.manifest.pieces[id];
    if (!piece) throw new Error(`unknown kit piece ${id}`);
    return piece;
  }

  geometry(id: string): PieceGeometry {
    const g = this.geometries.get(id);
    if (!g) throw new Error(`unknown kit piece ${id}`);
    return g;
  }

  /** Index of a texture-array layer (e.g. to vary a window's fake interior). */
  layer(id: string): number {
    const i = this.layerIndex.get(id);
    if (i === undefined) throw new Error(`unknown kit layer ${id}`);
    return i;
  }

  /** A standalone, unmerged piece (one or two meshes). For previews and one-off props. */
  createPiece(id: string): Object3D {
    const g = this.geometry(id);
    const group = new Group();
    group.name = id;
    if (g.opaque) group.add(this.mesh(g.opaque, this.materials.opaque));
    if (g.decal) group.add(this.mesh(g.decal, this.materials.decal));
    return group;
  }

  private mesh(geometry: BufferGeometry, material: Material): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = material === this.materials.opaque;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * Reads every piece out of the loaded kit scene. Every piece is authored at
 * the origin, but the glTF stores positions quantised (int16, with the
 * de-quantising scale and offset on the piece's node), so each geometry is
 * baked to plain floats with that node transform applied: merging later is
 * then a simple matrix multiply.
 */
export function piecesFromScene(scene: Object3D): Map<string, PieceGeometry> {
  scene.updateMatrixWorld(true);
  const toScene = scene.matrixWorld.clone().invert();
  const out = new Map<string, PieceGeometry>();
  for (const node of scene.children) {
    const parts: { opaque?: BufferGeometry; decal?: BufferGeometry } = {};
    node.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const kind = (mesh.material as Material).name === 'decal' ? 'decal' : 'opaque';
      const geometry = toFloat(mesh.geometry);
      geometry.applyMatrix4(toScene.clone().multiply(mesh.matrixWorld));
      parts[kind] = geometry;
    });
    out.set(node.name, parts);
  }
  return out;
}

/** Copies a geometry with every attribute as non-normalised float32 (de-quantised). */
function toFloat(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    const a = attr as BufferAttribute;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    geometry.setAttribute(name, new BufferAttribute(out, a.itemSize));
  }
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Decodes an image to RGBA bytes (rows top first, which is the glTF UV convention). */
async function imagePixels(
  url: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data, width: bitmap.width, height: bitmap.height };
}

/** Downloads the kit (≈1 MB: geometry, one layer strip, one decal sheet) and makes it ready to place. */
export async function loadCityKit(baseUrl = '/city/'): Promise<CityKit> {
  const manifest = parseKitManifest(await (await fetch(`${baseUrl}kit.json`)).json());
  const [gltf, strip, decals] = await Promise.all([
    new GLTFLoader().loadAsync(baseUrl + manifest.files.geometry),
    imagePixels(baseUrl + manifest.files.layers),
    new TextureLoader().loadAsync(baseUrl + manifest.files.decals),
  ]);
  const layers = layersTexture(strip.data, manifest.layerSize, manifest.layers.length);
  return new CityKit(manifest, piecesFromScene(gltf.scene), createKitMaterials(layers, decals));
}
