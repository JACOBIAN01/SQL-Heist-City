import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld } from '@gltf-transform/functions';

// usage: node build-cars.mjs <OBJ dir of the Quaternius Cars pack> <out .glb>
// One glb with every car: a node per car (named after its file), holding the body and three
// wheel nodes (<car>_wheel_fl, _wheel_fr, _wheels_back) whose origins are their axles. Part
// names carry the car's id because loaders rename duplicate node names. Colours from the
// .mtl files are baked into the vertices (one material for every car); light materials get a
// _GLOW vertex flag so headlights can shine at night. Cars face −z (the game's forward).
// The models are flat-shaded, so no normals are stored: the game draws them with flatShading
// (face normals from screen-space derivatives), and without per-face normals the corners weld
// back into shared vertices, about a fifth of the size.
const [, , objDir, outFile] = process.argv;
if (!objDir || !outFile) throw new Error('usage: node build-cars.mjs <OBJ dir> <out .glb>');

/** Materials that are lamps: they glow at night. */
const LIGHTS = new Set(['Headlights', 'TailLights', 'BlueLights', 'WhiteLights']);
/** OBJ object name part → node name. */
const PARTS = {
  FrontLeftWheel: 'wheel_fl',
  FrontRightWheel: 'wheel_fr',
  BackWheels: 'wheels_back',
};

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

/** Objects of one OBJ file as flat triangle lists (position, colour, glow per corner). */
function readObj(file, colours) {
  const v = [];
  const objects = new Map();
  let current;
  let colour = [1, 1, 1];
  let glow = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === 'v') v.push(rest.map(Number));
    else if (key === 'o') {
      current = { position: [], colour: [], glow: [] };
      objects.set(rest[0], current);
    } else if (key === 'usemtl') {
      colour = colours.get(rest[0]) ?? [1, 0, 1];
      glow = LIGHTS.has(rest[0]) ? 1 : 0;
    } else if (key === 'f') {
      const corners = rest.map((c) => c.split('/').map((n) => Number(n) - 1));
      // Fan-triangulate quads and n-gons.
      for (let k = 1; k + 1 < corners.length; k++)
        for (const [vi] of [corners[0], corners[k], corners[k + 1]]) {
          current.position.push(...v[vi]);
          current.colour.push(...colour);
          current.glow.push(glow);
        }
    }
  }
  return objects;
}

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('cars');
const material = doc.createMaterial('car').setRoughnessFactor(0.55).setMetallicFactor(0.1);
const report = [];

for (const file of readdirSync(objDir)
  .filter((f) => f.endsWith('.obj'))
  .sort()) {
  const id = file.replace('.obj', '');
  const objects = readObj(`${objDir}/${file}`, readMtl(`${objDir}/${id}.mtl`));
  const car = doc.createNode(id);
  scene.addChild(car);
  let tris = 0;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  const wheels = {};
  for (const [objName, data] of objects) {
    // Turn 180° about y: the pack faces +z, the game's forward is −z.
    for (let i = 0; i < data.position.length; i += 3) {
      data.position[i] = -data.position[i];
      data.position[i + 2] = -data.position[i + 2];
    }
    const part = Object.entries(PARTS).find(([key]) => objName.includes(`_${key}_`))?.[1] ?? 'body';
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.position.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], data.position[i]);
      hi[i % 3] = Math.max(hi[i % 3], data.position[i]);
    }
    min = min.map((m, i) => Math.min(m, lo[i]));
    max = max.map((m, i) => Math.max(m, hi[i]));
    // Wheels pivot about their own centre so the game can spin and steer them.
    const pivot = part === 'body' ? [0, 0, 0] : lo.map((l, i) => (l + hi[i]) / 2);
    const position = new Float32Array(data.position.map((p, i) => p - pivot[i % 3]));
    const acc = (type, array) =>
      doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute('POSITION', acc('VEC3', position))
      .setAttribute('COLOR_0', acc('VEC3', new Float32Array(data.colour)))
      .setAttribute('_GLOW', acc('SCALAR', new Uint8Array(data.glow)));
    tris += position.length / 9;
    const node = doc
      .createNode(`${id}_${part}`)
      .setMesh(doc.createMesh(`${id}_${part}`).addPrimitive(prim))
      .setTranslation(pivot);
    car.addChild(node);
    if (part !== 'body')
      wheels[part] = {
        at: pivot.map((p) => +p.toFixed(3)),
        radius: +((hi[1] - lo[1]) / 2).toFixed(3),
      };
  }
  report.push({
    id,
    tris,
    length: +(max[2] - min[2]).toFixed(2),
    width: +(max[0] - min[0]).toFixed(2),
    height: +(max[1] - min[1]).toFixed(2),
    wheels,
  });
}

await doc.transform(weld(), dedup(), prune({ keepAttributes: true }));
writeFileSync(outFile, await new NodeIO().writeBinary(doc));
writeFileSync(
  outFile.replace(/\.glb$/, '.json'),
  JSON.stringify({ version: 1, cars: report }, null, 2) + '\n',
);
for (const r of report)
  console.log(`${r.id.padEnd(12)} ${r.tris} tris  ${r.length} × ${r.width} × ${r.height} m`);
console.log(`${outFile}: ${Math.round(statSync(outFile).size / 1024)} KB`);
