import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import sharp from 'sharp';

// usage: node build-kit.mjs <kit dir (has Exports/ and Textures/)> <out dir>
// Turns the Downtown City MegaKit into kit.glb (geometry only), kit.json (manifest),
// kit-layers.webp (every tiling texture, stacked: one texture-array layer each) and
// kit-decals.webp (road markings, with alpha). See docs/city-kit.md.
const [, , kitDir, outDir] = process.argv;
if (!kitDir || !outDir) throw new Error('usage: node build-kit.mjs <kit dir> <out dir>');
const PIECES_DIR = `${kitDir}/Exports/glTF (Godot)`;
const TEX = `${kitDir}/Textures`;
const LAYER_SIZE = 512;
const DECAL_SIZE = 1024;
const WEBP_QUALITY = 80;

/**
 * The light pieces the city grammar uses (~65 of 153). The pre-built buildings
 * (18k–45k triangles, 12 materials each) and the heaviest window variants stay out.
 */
const PIECES = [
  // streets and sidewalks
  'Street_2Lane',
  'Street_2Lane_noSidewalk',
  'Street_4Lane',
  'Street_4Lane_noSidewalk',
  'Street_4WayIntersection',
  'Street_TIntersection',
  'Street_Asphalt_6x6',
  'Street_Asphalt_9x9',
  'Sidewalk_Straight_3m',
  'Sidewalk_Corner_Round_3m',
  'Sidewalk_NoCurb_3m',
  'Sidewalk_Planter',
  // road markings
  'Decal_Crosswalk',
  'Decal_Crosswalk_Wide',
  'Decal_BrokenLine_Straight',
  'Decal_DoubleYellow_Straight',
  'Decal_ArrowStraight',
  'Decal_Stop',
  // brick facades
  'Brick_Plain_3',
  'Brick_Plain_1',
  'Brick_BottomTrim',
  'Brick_TopTrim',
  'Brick_Corner_Plain',
  'Brick_TopTrim_Corner',
  'Brick_Window_Square_Single',
  'Brick_Window_Trim_Single',
  'Brick_Inset',
  'Brick_Inset_Window',
  'Brick_Column_Small',
  'Brick_CornerColumn_Center',
  // metal / glass facades
  'Metal_Plain_3',
  'Metal_Plain_1',
  'Metal_FullWindow',
  'Metal_Window_Half',
  'Metal_FirstFloor_Window',
  'Metal_FirstFloor_Wall',
  'Metal_Column_Center',
  // painted trim facades
  'Trim_Plain_3',
  'Trim_Corner',
  'Trim_Window',
  'Trim_FirstFloor_Wall',
  'Trim_FirstFloor_Window_001',
  'Trim_Column_Center',
  // cornices (roof edges)
  'Cornice_Brick_Center',
  'Cornice_Brick_90Angle_L',
  'Cornice_Brick_90Angle_R',
  'Cornice_Metal_Center',
  'Cornice_Metal_90Angle_L',
  'Cornice_Metal_90Angle_R',
  'Cornice_Trim_Center',
  'Cornice_Trim_90Angle_L',
  'Cornice_Trim_90Angle_R',
  // entrances
  'DoorFrame_Metal_Single',
  'Door_2',
  'Entrance_Concrete_2x1',
  'Stairs_Entrance_Concrete',
  // roofs and interiors (banks)
  'Roof_4x4',
  'Roof_2x2',
  'Floor_4x4',
  'Floor_2x2',
  'Brick_InteriorWall_3',
  'Stairs_Rails_Metal',
  // props
  'Prop_ACUnit',
  'Prop_Bollard',
  'Prop_ManholeCover',
  'Prop_Planter_Single',
];

/**
 * Texture-array layers. The kit's colour variants (pale brick, dark and green trim)
 * share one texture and were tinted by the engine; here each becomes its own
 * pre-tinted layer. AO (the R channel of the ORM map) is baked into the colour,
 * since normal and ORM maps are not shipped.
 */
const LAYERS = [
  { id: 'brick', src: 'T_RedBrick_BaseColor', orm: 'T_RedBrick_ORM' },
  { id: 'brickPale', src: 'T_RedBrick_BaseColor', orm: 'T_RedBrick_ORM', tint: 'pale' },
  { id: 'trim', src: 'T_Trim_BaseColor', orm: 'T_Trim_ORM' },
  { id: 'trimDark', src: 'T_Trim_BaseColor', orm: 'T_Trim_ORM', tint: [0.32, 0.33, 0.35] },
  { id: 'trimGreen', src: 'T_Trim_BaseColor', orm: 'T_Trim_ORM', tint: [0.35, 0.55, 0.42] },
  { id: 'metal', src: 'T_MetalConcrete_BaseColor', orm: 'T_MetalConcrete_ORM' },
  { id: 'concrete', src: 'T_Concrete_BaseColor', orm: 'T_Concrete_ORM' },
  { id: 'plaster', src: 'T_Concrete_BaseColor', tint: [1.25, 1.22, 1.15] },
  { id: 'asphalt', src: 'T_Concrete_Asphalt_BaseColor', orm: 'T_Concrete_ORM' },
  { id: 'marble', src: 'T_MarbleFloor_BaseColor', orm: 'T_MarbleFloor_ORM' },
  { id: 'slate', src: 'T_RoofSlate_BaseColor', orm: 'T_RoofSlate_ORM' },
  { id: 'ornaments', src: 'T_Ornaments_BaseColor', orm: 'T_Ornaments_ORM' },
  { id: 'dirt', src: 'T_Dirt_BaseColor', orm: 'T_Dirt_ORM' },
  { id: 'interior1', src: 'T_lit_interior_1' },
  { id: 'interior2', src: 'T_lit_interior_2' },
  { id: 'interiorDark', src: 'T_dark_interior' },
];
const LAYER_INDEX = new Map(LAYERS.map((l, i) => [l.id, i]));

/** Kit material → layer. `null` drops the primitive; `'decal'` goes to the decal material. */
const MATERIAL_LAYER = {
  MI_RedBrick: 'brick',
  MI_RedBrick_Pale: 'brickPale',
  MI_InteriorWall: 'plaster',
  MI_Trim: 'trim',
  MI_Trim_Dark: 'trimDark',
  MI_Trim_Green: 'trimGreen',
  MI_Trim_MetalConcrete: 'metal',
  MI_Concrete: 'concrete',
  MI_InteriorRoof: 'concrete',
  MI_Asphalt: 'asphalt',
  MI_InteriorFloor: 'marble',
  MI_Roof_Slate: 'slate',
  MI_Ornaments: 'ornaments',
  MI_Dirt: 'dirt',
  MI_FakeInterior: 'interior1',
  // A dark see-through pane in front of the fake interior: the interior alone reads as a window.
  MI_Glass: null,
  MI_StreetDecals: 'decal',
};

// ---------------------------------------------------------------- textures
async function layerPixels(layer) {
  let image = sharp(`${TEX}/${layer.src}.png`).removeAlpha().resize(LAYER_SIZE, LAYER_SIZE);
  const rgb = await image.raw().toBuffer();
  if (layer.orm) {
    const orm = await sharp(`${TEX}/${layer.orm}.png`)
      .removeAlpha()
      .resize(LAYER_SIZE, LAYER_SIZE)
      .raw()
      .toBuffer();
    for (let i = 0; i < rgb.length; i += 3) {
      const ao = orm[i] / 255;
      for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(rgb[i + c] * ao);
    }
  }
  if (layer.tint === 'pale') {
    // Painted brick: mostly white, keeping the mortar lines and a hint of the brick.
    for (let i = 0; i < rgb.length; i += 3) {
      const lum = 0.3 * rgb[i] + 0.59 * rgb[i + 1] + 0.11 * rgb[i + 2];
      const v = Math.min(255, 70 + lum * 1.9);
      rgb[i] = Math.min(255, v * 1.0);
      rgb[i + 1] = Math.min(255, v * 0.95);
      rgb[i + 2] = Math.min(255, v * 0.88);
    }
  } else if (Array.isArray(layer.tint)) {
    for (let i = 0; i < rgb.length; i += 3)
      for (let c = 0; c < 3; c++)
        rgb[i + c] = Math.min(255, Math.round(rgb[i + c] * layer.tint[c]));
  }
  return rgb;
}

async function buildTextures() {
  // Layers stacked top to bottom: the decoded image is then exactly the data a texture array wants.
  const strip = Buffer.alloc(LAYER_SIZE * LAYER_SIZE * 3 * LAYERS.length);
  for (const [i, layer] of LAYERS.entries())
    (await layerPixels(layer)).copy(strip, i * LAYER_SIZE * LAYER_SIZE * 3);
  await sharp(strip, {
    raw: { width: LAYER_SIZE, height: LAYER_SIZE * LAYERS.length, channels: 3 },
  })
    .webp({ quality: WEBP_QUALITY })
    .toFile(`${outDir}/kit-layers.webp`);
  await sharp(`${TEX}/T_Street_Decals.png`)
    .resize(DECAL_SIZE, DECAL_SIZE)
    .webp({ quality: WEBP_QUALITY, alphaQuality: 90 })
    .toFile(`${outDir}/kit-decals.webp`);
}

// ---------------------------------------------------------------- geometry
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const out = new Document();
const buffer = out.createBuffer();
const outScene = out.createScene('kit');
const materials = {
  opaque: out.createMaterial('kit').setRoughnessFactor(0.85).setMetallicFactor(0),
  decal: out
    .createMaterial('decal')
    .setAlphaMode('MASK')
    .setRoughnessFactor(0.9)
    .setMetallicFactor(0),
};

const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const transformDir = (m, n) => {
  const v = [
    m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
    m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
    m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
  ];
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
};

/** Flattens a piece's nodes into at most two primitives (opaque with a layer per vertex, and decals). */
async function buildPiece(name) {
  const doc = await io.read(`${PIECES_DIR}/${name}.gltf`);
  const groups = {
    opaque: { pos: [], nrm: [], uv: [], layer: [], idx: [] },
    decal: { pos: [], nrm: [], uv: [], layer: [], idx: [] },
  };
  const layersUsed = new Set();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? '';
      if (!(matName in MATERIAL_LAYER)) throw new Error(`${name}: unmapped material ${matName}`);
      const target = MATERIAL_LAYER[matName];
      if (target === null) continue;
      const g = target === 'decal' ? groups.decal : groups.opaque;
      const layer = target === 'decal' ? 0 : LAYER_INDEX.get(target);
      if (target !== 'decal') layersUsed.add(target);
      const P = prim.getAttribute('POSITION');
      const N = prim.getAttribute('NORMAL');
      const T = prim.getAttribute('TEXCOORD_0');
      const base = g.pos.length / 3;
      // getElement fills the array it is given; one per attribute so a 3-value read never leaks into a 2-value one.
      const [p3, n3, t2] = [[], [], []];
      for (let i = 0; i < P.getCount(); i++) {
        g.pos.push(...transformPoint(world, P.getElement(i, p3)));
        g.nrm.push(...transformDir(world, N.getElement(i, n3)));
        g.uv.push(...(T ? T.getElement(i, t2) : [0, 0]));
        g.layer.push(layer);
      }
      const I = prim.getIndices();
      const count = I ? I.getCount() : P.getCount();
      for (let i = 0; i < count; i++) g.idx.push(base + (I ? I.getScalar(i) : i));
    }
  }
  const mesh = out.createMesh(name);
  let tris = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [kind, g] of Object.entries(groups)) {
    if (!g.idx.length) continue;
    tris += g.idx.length / 3;
    for (let i = 0; i < g.pos.length; i++) {
      min[i % 3] = Math.min(min[i % 3], g.pos[i]);
      max[i % 3] = Math.max(max[i % 3], g.pos[i]);
    }
    const acc = (type, arr) => out.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = out
      .createPrimitive()
      .setMaterial(materials[kind])
      .setAttribute('POSITION', acc('VEC3', new Float32Array(g.pos)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.nrm)))
      .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)))
      .setIndices(acc('SCALAR', new Uint16Array(g.idx)));
    // Custom attribute: which texture-array layer each vertex samples (three.js names it `_layer`).
    if (kind === 'opaque') prim.setAttribute('_LAYER', acc('SCALAR', new Uint8Array(g.layer)));
    mesh.addPrimitive(prim);
  }
  outScene.addChild(out.createNode(name).setMesh(mesh));
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    id: name,
    tris,
    min: min.map(r2),
    size: max.map((v, i) => r2(v - min[i])),
    decal: groups.decal.idx.length > 0,
    layers: [...layersUsed].sort(),
  };
}

mkdirSync(outDir, { recursive: true });
const pieces = [];
for (const name of PIECES) pieces.push(await buildPiece(name));
await out.transform(
  weld(),
  dedup(),
  // The materials carry no textures (the game binds its own), so UVs look unused: keep them.
  prune({ keepAttributes: true }),
  // Only positions and normals: tiling UVs run far outside 0–1, and quantising them would move
  // their scale into a texture transform, which the game's array texture does not use.
  quantize({ pattern: /^(POSITION|NORMAL)$/, quantizeNormal: 8, quantizePosition: 14 }),
);
writeFileSync(`${outDir}/kit.glb`, await io.writeBinary(out));
await buildTextures();

const manifest = {
  version: 1,
  source: 'Quaternius Downtown City MegaKit [Standard] (CC0)',
  layerSize: LAYER_SIZE,
  layers: LAYERS.map((l) => l.id),
  interiorLayers: ['interior1', 'interior2', 'interiorDark'],
  files: { geometry: 'kit.glb', layers: 'kit-layers.webp', decals: 'kit-decals.webp' },
  pieces: Object.fromEntries(pieces.map(({ id, ...rest }) => [id, rest])),
};
writeFileSync(`${outDir}/kit.json`, JSON.stringify(manifest, null, 2) + '\n');

const kb = (f) => Math.round(statSync(`${outDir}/${f}`).size / 1024);
const total = ['kit.glb', 'kit.json', 'kit-layers.webp', 'kit-decals.webp'].map((f) => [f, kb(f)]);
for (const [f, size] of total) console.log(`${f.padEnd(18)} ${String(size).padStart(5)} KB`);
console.log(`${'total'.padEnd(18)} ${String(total.reduce((s, [, k]) => s + k, 0)).padStart(5)} KB`);
console.log(
  `${pieces.length} pieces, ${pieces.reduce((s, p) => s + p.tris, 0)} triangles, ${LAYERS.length} layers`,
);
