import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createBakedColourMaterial } from '../../render/bakedColourMaterial';

/** One furniture piece as built by tools/city/build-interior.mjs (interior.json). */
export interface InteriorPieceInfo {
  readonly id: string;
  readonly tris: number;
  /** Bounds in the game's frame: base at y = 0 (ceiling lights hang below it), front +z. */
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  /** Has lamp parts that light up at night. */
  readonly glow: boolean;
}

export interface InteriorManifest {
  readonly version: number;
  readonly pieces: readonly InteriorPieceInfo[];
}

/**
 * The bank furniture (Quaternius' House Pack, CC0): every piece shares one
 * material, so a furnished floor is cheap to draw.
 */
export interface InteriorKit {
  readonly pieceIds: readonly string[];
  readonly material: MeshStandardMaterial;
  /** 0 by day … 1 at night: lamps glow (set from the sky). */
  readonly nightGlow: { value: number };
  info(id: string): InteriorPieceInfo;
  has(id: string): boolean;
  /** A new mesh of the piece (sharing its geometry and the kit's material). */
  create(id: string): Mesh;
}

/** Wraps the loaded glb scene and its manifest. Exported for tests. */
export function interiorKitFrom(scene: Object3D, manifest: InteriorManifest): InteriorKit {
  const nightGlow = { value: 0 };
  const material = createBakedColourMaterial({
    name: 'interior',
    nightGlow,
    roughness: 0.7,
    metalness: 0,
    // Indoors the sun barely reaches; the bank's own lamps light the furniture.
    selfLight: 0.3,
  });
  const meshes = new Map<string, Mesh>();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const name = o.parent && o.parent !== scene ? o.parent.name : o.name;
    meshes.set(name, new Mesh(bakedGeometry(o), o.material));
  });
  const infos = new Map(manifest.pieces.map((p) => [p.id, p] as const));
  const pieceIds = manifest.pieces.map((p) => p.id).filter((id) => meshes.has(id));
  return {
    pieceIds,
    material,
    nightGlow,
    has: (id) => meshes.has(id) && infos.has(id),
    info(id) {
      const info = infos.get(id);
      if (!info) throw new Error(`no interior piece ${id}`);
      return info;
    },
    create(id) {
      const template = meshes.get(id);
      if (!template) throw new Error(`no interior piece ${id}`);
      const mesh = new Mesh(template.geometry, material);
      mesh.name = id;
      mesh.castShadow = false;
      mesh.receiveShadow = false; // indoors: lit by the bank's own lamps (selfLight)
      return mesh;
    },
  };
}

/** Downloads the furniture (~0.4 MB, loaded only when a bank interior is needed). */
export async function loadInteriorKit(baseUrl = '/interior/'): Promise<InteriorKit> {
  const [gltf, manifest] = await Promise.all([
    new GLTFLoader().loadAsync(`${baseUrl}interior.glb`),
    fetch(`${baseUrl}interior.json`).then((r) => {
      if (!r.ok) throw new Error(`interior.json: ${r.status}`);
      return r.json() as Promise<InteriorManifest>;
    }),
  ]);
  return interiorKitFrom(gltf.scene, manifest);
}

/**
 * The piece's geometry in metres. The file stores positions quantised (small
 * integers) with the scale on the node, so the node transform is baked in
 * here, once, into plain float positions every copy then shares.
 */
function bakedGeometry(mesh: Mesh): BufferGeometry {
  const source = mesh.geometry;
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    const a = attr as BufferAttribute;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new BufferAttribute(out, a.itemSize));
  }
  if (source.index) g.setIndex(source.index.clone());
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingSphere();
  return g;
}
