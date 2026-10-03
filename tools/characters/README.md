# Character asset build

Turns the free [Quaternius](https://quaternius.com) CC0 packs into the small, game-ready files in `client/public/characters/`. Run it only when the characters change; it is not part of `npm run ci` and its dependencies are not installed by the repo.

Inputs (free downloads, CC0):
- **Universal Base Characters [Standard]** — `Superhero_Male_FullBody.gltf`, `Superhero_Female_FullBody.gltf`, hairstyles, textures
- **Universal Animation Library [Standard]** — `UAL1_Standard.glb` (same 65-bone skeleton, 43 clips)

```
cd tools/characters && npm install
node build-character.mjs  <male .gltf>   <hair .gltf (rigged to head bone)>  ../../client/public/characters/male.glb   0.33
node build-character.mjs  <female .gltf> <hair .gltf>                       ../../client/public/characters/female.glb 0.33
node build-animations.mjs <UAL1_Standard.glb>                               ../../client/public/characters/animations.glb
node build-skins.mjs      <Universal Base Characters dir>                    ../../client/public/characters
```

What the character script does: merges the hair onto the body skeleton, simplifies the meshes to ~1/3 (≈5k triangles per character), splits the body into **skin / shirt / trousers / shoes** primitives by which bones move each triangle (so the game can recolour clothes), and shrinks the textures to small WebP. The animation script keeps 13 clips, drops finger tracks and the mannequin mesh.

Note: the packs reference a couple of textures under slightly different names (`*_png.png`); copy the plain `.png` to the missing name before running.
