import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, prune, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// usage: node build-lod.mjs <character .glb> [ratio]
// Adds a far-distance copy of the body and hair to a built character (in place), skinned to
// the same skeleton, so a clone carries both and the game just swaps which one is visible.
// Eyes get no copy: at 25 m they are a couple of pixels. Safe to run again (old LODs are replaced).
const [, , file, ratioArg] = process.argv;
if (!file) throw new Error('usage: node build-lod.mjs <character .glb> [ratio]');
const RATIO = Number(ratioArg ?? 0.28);
const SUFFIX = '_LOD';

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();
const scene = root.listScenes()[0];

for (const node of root.listNodes()) if (node.getName().endsWith(SUFFIX)) node.dispose();
await doc.transform(prune());

let before = 0;
let after = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  const skin = node.getSkin();
  if (!mesh || !skin || /eyes/i.test(node.getName())) continue;
  const lod = doc.createMesh(mesh.getName() + SUFFIX);
  for (const prim of mesh.listPrimitives()) {
    const copy = doc
      .createPrimitive()
      .setMaterial(prim.getMaterial())
      .setIndices(prim.getIndices().clone());
    for (const semantic of prim.listSemantics())
      copy.setAttribute(semantic, prim.getAttribute(semantic).clone());
    before += prim.getIndices().getCount() / 3;
    simplifyPrimitive(copy, { simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.02 });
    // Simplifying only rewrites the index; drop the vertices nothing references any more.
    compactPrimitive(copy);
    after += copy.getIndices().getCount() / 3;
    lod.addPrimitive(copy);
  }
  const lodNode = doc
    .createNode(node.getName() + SUFFIX)
    .setMesh(lod)
    .setSkin(skin);
  // Same parent as the original, so it shares the skeleton's frame.
  const parent = node.getParentNode();
  if (parent) parent.addChild(lodNode);
  else scene.addChild(lodNode);
}
await doc.transform(prune());
await io.write(file, doc);
console.log(`${file}: ${before} → ${after} triangles in the LOD (eyes dropped)`);
