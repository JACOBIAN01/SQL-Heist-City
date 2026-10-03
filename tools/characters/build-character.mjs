import { readFileSync, mkdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { weld, simplify, prune, mergeDocuments, unpartition } from '@gltf-transform/functions';
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

// Only these attributes are used by the game; extra UV sets and vertex colours just add bytes
// (and stop primitives with different attribute sets from being merged later).
const USED = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']);
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const semantic of prim.listSemantics())
      if (!USED.has(semantic)) prim.setAttribute(semantic, null);
  }
}

// Make joints/weights the same storage type everywhere so primitives can be merged.
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const j = prim.getAttribute('JOINTS_0');
    const w = prim.getAttribute('WEIGHTS_0');
    if (j) {
      const out = new Uint16Array(j.getCount() * 4);
      const e = [0, 0, 0, 0];
      for (let i = 0; i < j.getCount(); i++) out.set(j.getElement(i, e), i * 4);
      prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(out));
    }
    if (w) {
      const out = new Float32Array(w.getCount() * 4);
      const e = [0, 0, 0, 0];
      for (let i = 0; i < w.getCount(); i++) out.set(w.getElement(i, e), i * 4);
      prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(out));
    }
  }
}

await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.02 }));

// --- tag every body vertex with a clothing region; the game recolours by region in the shader.
// Codes are ordered so regions that touch are neighbours (skin 0, shirt 1, trousers 2, shoes 3):
// smooth interpolation across a seam then never passes through an unrelated region.
const REGION = { skin: 0, shirt: 1, trousers: 2, shoes: 3 };
const regionOfJoint = (name) => {
  if (/^(spine_|clavicle_|upperarm_)/.test(name)) return REGION.shirt;
  if (/^(pelvis|thigh_|calf_)/.test(name)) return REGION.trousers;
  if (/^(foot_|ball_)/.test(name)) return REGION.shoes;
  return REGION.skin;
};
const jointRegion = jointNames.map(regionOfJoint);

const meshTris = (m) => m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount(), 0);
const meshes = root.listMeshes();
const bodyMesh = meshes.reduce((a, b) => (meshTris(a) > meshTris(b) ? a : b));
const bodyPrim = bodyMesh.listPrimitives()[0];
const joints = bodyPrim.getAttribute('JOINTS_0').getArray();
const weights = bodyPrim.getAttribute('WEIGHTS_0').getArray();
const vertexCount = bodyPrim.getAttribute('POSITION').getCount();
const regionCodes = new Float32Array(vertexCount);
const counts = [0, 0, 0, 0];
for (let v = 0; v < vertexCount; v++) {
  const sums = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) sums[jointRegion[joints[v * 4 + k]]] += weights[v * 4 + k];
  regionCodes[v] = sums.indexOf(Math.max(...sums));
  counts[regionCodes[v]]++;
}
bodyPrim.setAttribute('_REGION', doc.createAccessor().setType('SCALAR').setArray(regionCodes));
bodyPrim.getMaterial().setName('body');
console.log('vertices by region (skin shirt trousers shoes):', counts.join(' '));

// --- fewer draw calls: eyebrows ride along with the hair (same texture), leaving body / hair / eyes
const hairMaterial = hairMesh.listPrimitives()[0].getMaterial();
const eyes = meshes.find((m) =>
  m.listPrimitives().some((p) => /Eyes/.test(p.getMaterial()?.getName() ?? '')),
);
for (const mesh of meshes) {
  if (mesh === bodyMesh || mesh === eyes || mesh === hairMesh) continue;
  for (const p of [...mesh.listPrimitives()]) {
    mesh.removePrimitive(p);
    p.setMaterial(hairMaterial); // same texture, so one draw call covers both
    hairMesh.addPrimitive(p);
  }
  for (const n of root.listNodes()) if (n.getMesh() === mesh) n.dispose();
  mesh.dispose();
}
// Hair and eyebrows now share a material: fold their vertex data into one primitive.
{
  const [first, ...rest] = hairMesh.listPrimitives();
  for (const other of rest) {
    const base = first.getAttribute('POSITION').getCount();
    for (const semantic of first.listSemantics()) {
      const a = first.getAttribute(semantic);
      const b = other.getAttribute(semantic);
      const Ctor = a.getArray().constructor;
      const merged = new Ctor(a.getArray().length + b.getArray().length);
      merged.set(a.getArray());
      merged.set(b.getArray(), a.getArray().length);
      first.setAttribute(semantic, doc.createAccessor().setType(a.getType()).setArray(merged));
    }
    const ia = first.getIndices().getArray();
    const ib = other.getIndices().getArray();
    const indices = new Uint32Array(ia.length + ib.length);
    indices.set(ia);
    for (let i = 0; i < ib.length; i++) indices[ia.length + i] = ib[i] + base;
    first.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices));
    hairMesh.removePrimitive(other);
    other.dispose();
  }
}

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
await doc.transform(prune(), unpartition());
mkdirSync(new URL('.', 'file://' + outFile).pathname, { recursive: true });
await io.write(outFile, doc);
const tris = root
  .listMeshes()
  .reduce(
    (n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0),
    0,
  );
console.log(outFile, 'triangles', tris, 'bytes', readFileSync(outFile).length);
