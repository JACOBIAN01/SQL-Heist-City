import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { prune, resample, unpartition } from '@gltf-transform/functions';

const [, , srcFile, outFile] = process.argv;
const KEEP = [
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Crouch_Idle_Loop',
  'Crouch_Fwd_Loop',
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
  'Death01',
  'Hit_Chest',
  'Pistol_Idle_Loop',
  'Pistol_Shoot',
];
const io = new NodeIO();
const doc = await io.read(srcFile);
const root = doc.getRoot();
for (const a of root.listAnimations()) {
  if (KEEP.includes(a.getName())) continue;
  // Samplers (and the data they hold) outlive a disposed animation unless removed with it.
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}
// Fingers are ~half of all tracks and invisible at game distance: leave them at the bind pose.
const FINGER = /^(index|middle|pinky|ring|thumb)_/;
for (const a of root.listAnimations()) {
  for (const ch of a.listChannels()) {
    if (FINGER.test(ch.getTargetNode()?.getName() ?? '')) {
      const sampler = ch.getSampler();
      ch.dispose();
      sampler?.dispose();
    }
  }
}
for (const mesh of root.listMeshes()) mesh.dispose();
for (const skin of root.listSkins()) skin.dispose();
for (const m of root.listMaterials()) m.dispose();
for (const t of root.listTextures()) t.dispose();
for (const node of root.listNodes()) node.setMesh(null).setSkin(null);
await doc.transform(resample({ tolerance: 0.0005 }), prune(), unpartition());
await io.write(outFile, doc);
console.log(
  outFile,
  root
    .listAnimations()
    .map((a) => a.getName())
    .join(','),
  readFileSync(outFile).length,
  'bytes',
);
