/** One kit piece as the build pipeline measured it (tools/city/build-kit.mjs). */
export interface KitPiece {
  readonly tris: number;
  /** Bounding box corner and size in metres, in the piece's own frame (y up, facade face at z = 0). */
  readonly min: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  /** True if the piece has road markings (drawn with the decal material). */
  readonly decal: boolean;
  /** Texture-array layers the piece samples. */
  readonly layers: readonly string[];
}

/** kit.json: what kit.glb holds and how its textures are laid out. */
export interface KitManifest {
  readonly version: number;
  readonly layerSize: number;
  /** Texture-array layer ids, in layer order. */
  readonly layers: readonly string[];
  /** Layers a window's fake interior may use (the chunk builder varies them per window). */
  readonly interiorLayers: readonly string[];
  readonly files: { readonly geometry: string; readonly layers: string; readonly decals: string };
  readonly pieces: Readonly<Record<string, KitPiece>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');
const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && isFinite(n));

/** Checks kit.json before the game trusts it; throws with the first problem found. */
export function parseKitManifest(json: unknown): KitManifest {
  const fail = (what: string): never => {
    throw new Error(`kit.json: ${what}`);
  };
  if (!isRecord(json)) return fail('not an object');
  const { version, layerSize, layers, interiorLayers, files, pieces } = json;
  if (version !== 1) fail(`unsupported version ${String(version)}`);
  if (typeof layerSize !== 'number' || layerSize <= 0) fail('bad layerSize');
  if (!isStrings(layers) || layers.length === 0) return fail('bad layers');
  if (!isStrings(interiorLayers) || !interiorLayers.every((l) => layers.includes(l)))
    fail('interiorLayers must name known layers');
  if (
    !isRecord(files) ||
    typeof files.geometry !== 'string' ||
    typeof files.layers !== 'string' ||
    typeof files.decals !== 'string'
  )
    fail('bad files');
  if (!isRecord(pieces) || Object.keys(pieces).length === 0) return fail('no pieces');
  for (const [id, p] of Object.entries(pieces)) {
    if (!isRecord(p)) return fail(`piece ${id} is not an object`);
    if (typeof p.tris !== 'number' || !isVec3(p.min) || !isVec3(p.size))
      fail(`piece ${id} has bad tris/min/size`);
    if (typeof p.decal !== 'boolean') fail(`piece ${id} has bad decal`);
    if (!isStrings(p.layers) || !p.layers.every((l) => layers.includes(l)))
      fail(`piece ${id} uses an unknown layer`);
  }
  return json as unknown as KitManifest;
}
