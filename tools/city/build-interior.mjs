import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';

// usage: node build-interior.mjs <Interior dir of the House Pack> <out .glb>
// One glb with the furniture the banks use: a node per piece (named after its file), one mesh,
// colours from the .mtl files baked into the vertices so every piece shares one material, and
// lamp materials flagged _GLOW (they light up at night, like the cars' lamps). The pack is drawn
// about twice life size, so pieces are scaled (0.5 unless listed) and given the game's frame:
// base at y = 0 (ceiling lights hang from y = 0), centred on x and z (doors keep their hinge at
// x = 0), front facing +z. Flat-shaded, so no normals are stored (see build-cars.mjs).
const [, , objDir, outFile] = process.argv;
if (!objDir || !outFile)
  throw new Error('usage: node build-interior.mjs <Interior dir> <out .glb>');

const SCALE = 0.5;
/**
 * The pieces the banks use, with their scale where 0.5 is wrong and a quarter turn (about y)
 * where the pack's front is not +z.
 */
const PIECES = {
  // Structure
  Column_Round1: {},
  Column_Round2: {},
  Column_Round3: {},
  Column_SquareBig: {},
  Column_SquareSmall: {},
  Door_1: {},
  Door_3: {},
  Door_7: {},
  Door_Double: {},
  Window_Large1: {},
  Window_Small1: {},
  Curtains_Double: {},
  Curtains_Single: {},
  // Lights
  Light_Ceiling1: {},
  Light_Ceiling2: {},
  Light_Ceiling3: {},
  Light_Ceiling5: {},
  Light_Ceiling6: {},
  Light_CeilingSingle: {},
  Light_Chandelier: { scale: 0.8 },
  Light_Cube: {},
  Light_Desk: { scale: 0.6 },
  Light_Floor1: {},
  Light_Stand1: {},
  Light_Small: {},
  // Seating and tables
  Chair_1: {},
  Chair_2: {},
  Chair_3: {},
  Chair_4: {},
  Stool: {},
  Couch_Large1: {},
  Couch_Medium1: {},
  Couch_Small1: {},
  Couch_Small2: {},
  Couch_L: {},
  Table_RoundLarge: { scale: 0.65 },
  Table_RoundSmall: { scale: 0.65 },
  // Storage
  Drawer_1: {},
  Drawer_2: {},
  Drawer_3: {},
  Drawer_4: {},
  Drawer_5: {},
  Bookshelf: {},
  Shelf_1: {},
  Shelf_2: {},
  Shelf_Large: {},
  Shelf_Small1: {},
  NightStand_1: {},
  Kitchen_Cabinet1: {},
  Kitchen_Fridge: {},
  Kitchen_Sink: {},
  // Decoration
  Houseplant_3: {},
  Houseplant_4: {},
  Houseplant_6: {},
  Houseplant_7: {},
  Houseplant_8: {},
  Carpet_1: { scale: 1 },
  Carpet_2: { scale: 1 },
  Carpet_Round: { scale: 1 },
  Trashcan_Cylindric: {},
  Trashcan_Small1: {},
  // Washrooms
  Bathroom_Sink: {},
  Bathroom_Toilet2: {},
  Bathroom_Mirror1: { scale: 1 },
};

/** Materials that are lamps. */
const LIGHTS = new Set(['Light']);

function readMtl(file) {
  const colours = new Map();
  let name;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === 'newmtl') name = rest[0];
    if (key === 'Kd' && name) colours.set(name, rest.map(Number));
  }
  return colours;
}

/** One OBJ file as a flat triangle list (position, colour, glow per corner), all objects merged. */
function readObj(file, colours) {
  const v = [];
  const out = { position: [], colour: [], glow: [] };
  let colour = [1, 1, 1];
  let glow = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === 'v') v.push(rest.slice(0, 3).map(Number));
    else if (key === 'usemtl') {
      colour = colours.get(rest[0]) ?? [1, 0, 1];
      glow = LIGHTS.has(rest[0]) ? 1 : 0;
    } else if (key === 'f') {
      const corners = rest.map((c) => Number(c.split('/')[0]) - 1);
      for (let k = 1; k + 1 < corners.length; k++)
        for (const vi of [corners[0], corners[k], corners[k + 1]]) {
          out.position.push(...v[vi]);
          out.colour.push(...colour);
          out.glow.push(glow);
        }
    }
  }
  return out;
}

const bounds = (p) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], p[i]);
    hi[i % 3] = Math.max(hi[i % 3], p[i]);
  }
  return { lo, hi };
};

const doc = new Document();
doc.createExtension(KHRMeshQuantization).setRequired(true);
const buffer = doc.createBuffer();
const scene = doc.createScene('interior');
const material = doc.createMaterial('interior').setRoughnessFactor(0.7).setMetallicFactor(0);
const report = [];

for (const [id, opts] of Object.entries(PIECES)) {
  const data = readObj(`${objDir}/${id}.obj`, readMtl(`${objDir}/${id}.mtl`));
  const scale = opts.scale ?? SCALE;
  const turns = opts.turns ?? 0;
  // Scale, then turn by quarter turns about y.
  for (let i = 0; i < data.position.length; i += 3) {
    let x = data.position[i] * scale;
    const y = data.position[i + 1] * scale;
    let z = data.position[i + 2] * scale;
    for (let t = 0; t < turns; t++) [x, z] = [z, -x];
    data.position[i] = x;
    data.position[i + 1] = y;
    data.position[i + 2] = z;
  }
  // Base (or, for ceiling lights, top) at y = 0; centred on x and z, but doors keep their hinge.
  const { lo, hi } = bounds(data.position);
  const hangs = hi[1] <= 0.01;
  const door = id.startsWith('Door_') && id !== 'Door_Double';
  const shift = [door ? 0 : -(lo[0] + hi[0]) / 2, hangs ? -hi[1] : -lo[1], -(lo[2] + hi[2]) / 2];
  for (let i = 0; i < data.position.length; i++) data.position[i] += shift[i % 3];
  const b = bounds(data.position);
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', acc('VEC3', new Float32Array(data.position)))
    .setAttribute('COLOR_0', acc('VEC3', new Float32Array(data.colour)))
    .setAttribute('_GLOW', acc('SCALAR', new Uint8Array(data.glow)));
  scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  const round = (a) => a.map((n) => +n.toFixed(3));
  report.push({
    id,
    tris: data.position.length / 9,
    min: round(b.lo),
    max: round(b.hi),
    size: round(b.hi.map((h, i) => h - b.lo[i])),
    glow: data.glow.some((g) => g > 0),
  });
}

await doc.transform(
  weld(),
  dedup(),
  quantize({ quantizePosition: 14, quantizeColor: 8 }),
  prune({ keepAttributes: true }),
);
writeFileSync(
  outFile,
  await new NodeIO().registerExtensions([KHRMeshQuantization]).writeBinary(doc),
);
writeFileSync(
  outFile.replace(/\.glb$/, '.json'),
  JSON.stringify({ version: 1, pieces: report }, null, 2) + '\n',
);
const total = report.reduce((n, r) => n + r.tris, 0);
for (const r of report)
  console.log(`${r.id.padEnd(22)} ${String(r.tris).padStart(5)} tris  ${r.size.join(' × ')} m`);
console.log(`${report.length} pieces, ${total} triangles`);
console.log(`${outFile}: ${Math.round(statSync(outFile).size / 1024)} KB`);
