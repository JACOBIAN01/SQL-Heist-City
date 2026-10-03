import { readFileSync, mkdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import {
  weld,
  simplify,
  prune,
  dedup,
  mergeDocuments,
  unpartition,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , bodyFile, hairFile, outFile, ratioArg] = process.argv;
const RATIO = Number(ratioArg ?? 0.33);

const io = new NodeIO().registerExtensions([EXTTextureWebP]);
const doc = await io.read(bodyFile);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const skin = root.listSkins()[0];
const jointNames = skin.listJoints().map((j) => j.getName());

// --- merge the hair, which is skinned to the same 65-bone skeleton in the same order
const hairDoc = await io.read(hairFile);
const hairNames = hairDoc
  .getRoot()
  .listSkins()[0]
  .listJoints()
  .map((j) => j.getName());
if (jointNames.join() !== hairNames.join())
  throw new Error('hair skeleton differs from body skeleton');
const before = new Set(root.listMeshes());
mergeDocuments(doc, hairDoc);
const hairMesh = root.listMeshes().find((m) => !before.has(m));
// The merged hair brought its own armature and skin; keep only its mesh, bound to the body skin.
for (const n of root.listNodes()) if (n.getMesh() === hairMesh) n.dispose();
const hairNode = doc.createNode('Hair').setMesh(hairMesh).setSkin(skin);
scene.addChild(hairNode);
for (const s of root.listSkins()) if (s !== skin) s.dispose();
for (const n of root.listScenes()[0].listChildren()) {
  // remove the duplicate armature root that came with the hair file
  if (n !== hairNode && n.getName() === 'Armature' && n !== skin.getSkeleton()?.getParentNode()) {
    const joints = new Set(skin.listJoints());
    if (![...joints].some((j) => n.listChildren().includes(j))) n.dispose();
  }
}

await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.02 }));

// --- split the body into skin / shirt / trousers / shoes by which bones move each triangle
const REGION = { skin: 0, shirt: 1, trousers: 2, shoes: 3 };
const regionOfJoint = (name) => {
  if (/^(spine_|clavicle_|upperarm_)/.test(name)) return REGION.shirt;
  if (/^(pelvis|thigh_|calf_)/.test(name)) return REGION.trousers;
  if (/^(foot_|ball_)/.test(name)) return REGION.shoes;
  return REGION.skin;
};
const jointRegion = jointNames.map(regionOfJoint);

const bodyMesh = root.listMeshes().reduce((a, b) => {
  const tris = (m) => m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount(), 0);
  return tris(a) > tris(b) ? a : b;
});
const bodyPrim = bodyMesh.listPrimitives()[0];
const skinMaterial = bodyPrim.getMaterial();
const joints = bodyPrim.getAttribute('JOINTS_0').getArray();
const weights = bodyPrim.getAttribute('WEIGHTS_0').getArray();
const vertexCount = bodyPrim.getAttribute('POSITION').getCount();
const vertexRegion = new Uint8Array(vertexCount);
for (let v = 0; v < vertexCount; v++) {
  const sums = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) sums[jointRegion[joints[v * 4 + k]]] += weights[v * 4 + k];
  vertexRegion[v] = sums.indexOf(Math.max(...sums));
}
const index = bodyPrim.getIndices().getArray();
const buckets = [[], [], [], []];
for (let t = 0; t < index.length; t += 3) {
  const rs = [vertexRegion[index[t]], vertexRegion[index[t + 1]], vertexRegion[index[t + 2]]];
  // Majority region wins; a three-way split falls back to skin so seams stay on bare skin.
  const r = rs[0] === rs[1] || rs[0] === rs[2] ? rs[0] : rs[1] === rs[2] ? rs[1] : REGION.skin;
  buckets[r].push(index[t], index[t + 1], index[t + 2]);
}
const normalTex = skinMaterial.getNormalTexture();
const mk = (name, color, roughness) => {
  const m = doc
    .createMaterial(name)
    .setBaseColorFactor(color)
    .setRoughnessFactor(roughness)
    .setMetallicFactor(0);
  if (normalTex) m.setNormalTexture(normalTex).setNormalScale(0.6);
  return m;
};
const materials = [
  skinMaterial,
  mk('cloth_shirt', [1, 1, 1, 1], 0.9),
  mk('cloth_trousers', [1, 1, 1, 1], 0.9),
  mk('cloth_shoes', [1, 1, 1, 1], 0.7),
];
skinMaterial.setName('skin');
const names = ['skin', 'shirt', 'trousers', 'shoes'];
for (const p of [...bodyMesh.listPrimitives()]) bodyMesh.removePrimitive(p);
buckets.forEach((tris, r) => {
  if (tris.length === 0) return;
  const prim = doc
    .createPrimitive()
    .setMaterial(materials[r])
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(tris)));
  for (const semantic of bodyPrim.listSemantics())
    prim.setAttribute(semantic, bodyPrim.getAttribute(semantic));
  bodyMesh.addPrimitive(prim);
});
bodyPrim.dispose();
console.log('regions (tris):', names.map((n, i) => `${n}=${buckets[i].length / 3}`).join(' '));

// --- textures: small WebP, and drop maps that do not pay for themselves
const keep = new Map(); // texture -> max size
const want = (tex, size) => tex && keep.set(tex, Math.max(keep.get(tex) ?? 0, size));
for (const m of root.listMaterials()) {
  const name = m.getName();
  if (/Eyes/.test(name)) {
    m.setNormalTexture(null);
    want(m.getBaseColorTexture(), 128);
  } else if (/Hair/.test(name)) {
    m.setNormalTexture(null);
    want(m.getBaseColorTexture(), 256);
    m.setDoubleSided(true);
  } else {
    want(m.getBaseColorTexture(), 512);
    want(m.getNormalTexture(), 512);
    want(m.getMetallicRoughnessTexture(), 256);
  }
}
doc.createExtension(EXTTextureWebP).setRequired(true);
for (const tex of root.listTextures()) {
  const size = keep.get(tex);
  if (!size) {
    tex.dispose();
    continue;
  }
  const out = await sharp(Buffer.from(tex.getImage()))
    .resize(size, size, { fit: 'inside' })
    .webp({ quality: 82 })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
}
await doc.transform(prune(), dedup(), unpartition());
mkdirSync(new URL('.', 'file://' + outFile).pathname, { recursive: true });
await io.write(outFile, doc);
const tris = root
  .listMeshes()
  .reduce(
    (n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0),
    0,
  );
console.log(outFile, 'triangles', tris, 'bytes', readFileSync(outFile).length);
